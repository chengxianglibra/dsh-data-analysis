import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import LlmRuntime, { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import * as DeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import SessionStore, { type SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import type { MarivoDatasourceBridgePort } from '../src/datasource/index.ts'
import { registerMarivoDatasourceTestTool } from '../src/datasource/index.ts'
import {
  MARIVO_CREDENTIAL_GRANT_PREFIX,
  MarivoShellCredentialGrants,
} from '../src/datasource/shell-env.ts'
import { bindMarivoEnvironment } from '../src/environment/index.ts'
import { TestShellEnv } from '../tests/test-shell-env.ts'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workspaceRoot = path.resolve(packageRoot, '../..')
const reportPath = path.join(workspaceRoot, 'artifacts', 'datasource-grants-real-model.json')
const model = process.env.DSH_DATA_ANALYSIS_VALIDATION_MODEL ?? 'deepseek-v4-flash'
const execFileAsync = promisify(execFile)
const runtimeEnvironment = await bindMarivoEnvironment({
  projectRoot: workspaceRoot,
  ...(process.env.DSH_DATA_ANALYSIS_PYTHON === undefined
    ? {}
    : { pythonExecutable: process.env.DSH_DATA_ANALYSIS_PYTHON }),
})
const prompt = [
  'Perform the datasource credential terminal journey in strict sequential steps.',
  'First call marivo_datasource_test with name broken and verify it is failed and has no shell_grant.',
  'Then call marivo_datasource_test with name a. Copy its one-shot token into the first line of exactly one foreground bash command using the instructed marker; use query-fixture as the body and confirm query_result is 20.',
  'Then call one ordinary foreground bash command containing only query-fixture and confirm the query still returns 20 but has no datasource variables.',
  'Finally retry the first granted bash command with the same token and confirm that ToolRuntime rejects reuse.',
  'Never print or paraphrase credential values. End with DATASOURCE_GRANTS_REAL_AGENT_OK.',
].join(' ')

const secrets = Object.freeze({
  DSH_A_USER: 'a-user-canary-4d8d',
  DSH_A_PASSWORD: 'a-password-canary-a720',
  DSH_B_PASSWORD: 'b-password-canary-e1fb',
  DSH_EDGE_SECRET: 'edge-canary-4eb9',
})

class MemoryCredentials {
  readonly resolved: string[] = []

  async resolve(ref: CredentialRef) {
    this.resolved.push(ref)
    const value = secrets[ref as keyof typeof secrets]
    return value === undefined ? undefined : { value, source: 'acceptance-memory' }
  }
}

function binding(fingerprint: string) {
  return {
    projectRoot: path.join(
      workspaceRoot,
      'artifacts',
      'plugin-capability-optimization-real',
      fingerprint,
    ),
    pythonExecutable: runtimeEnvironment.binding.pythonExecutable,
    marivoVersion: runtimeEnvironment.binding.marivoVersion,
    packagePath: runtimeEnvironment.binding.packagePath,
    subprocessPolicyId: runtimeEnvironment.binding.subprocessPolicyId,
    fingerprint,
  }
}

const bridgeTests: Array<{
  name: string
  keys: string[]
  expectedValuesPresent: boolean
}> = []

function bridge(fingerprint: string): MarivoDatasourceBridgePort {
  return {
    binding: binding(fingerprint),
    async describe(name) {
      if (name === 'broken') return { name, refs: ['DSH_A_USER'] }
      if (name === 'a') return { name, refs: ['DSH_A_USER', 'DSH_A_PASSWORD'] }
      if (name === 'b') return { name, refs: ['DSH_B_PASSWORD'] }
      return { name, refs: ['DSH_EDGE_SECRET'] }
    },
    async inventory() {
      return []
    },
    async test(name, overlay) {
      const keys = Object.keys(overlay).sort()
      const expectedValuesPresent = keys.every(
        (key) => overlay[key] === secrets[key as keyof typeof secrets],
      )
      bridgeTests.push({ name, keys, expectedValuesPresent })
      if (name === 'broken') {
        return {
          name,
          ok: false,
          latency_ms: 3,
          failure: {
            code: 'connection-refused',
            exception_type: 'ConnectionError',
            backend_code: null,
            backend_name: 'fixture',
            message: 'bounded synthetic connection failure',
          },
          repair: {
            kind: 'inspect-datasource',
            help_target: 'datasource',
            action: 'Inspect the synthetic endpoint.',
            snippet: null,
            candidates: [],
            preserves_evidence: null,
          },
        }
      }
      return { name, ok: true, latency_ms: 2, failure: null, repair: null }
    },
  }
}

function shellEnv(ctx: Context): TestShellEnv {
  return (ctx as unknown as { shellEnv: TestShellEnv }).shellEnv
}

function textFromEvents(events: readonly SessionEvent[]): string {
  return events
    .flatMap((event): string[] => {
      if (event.type === 'assistant/message') {
        return event.data.message.content.flatMap((block) =>
          block.type === 'text' ? [block.text] : [],
        )
      }
      if (event.type === 'tool/result') {
        return event.data.message.content.flatMap((block) => {
          if (block.type !== 'tool-result') return []
          return block.content.flatMap((item) => (item.type === 'text' ? [item.text] : []))
        })
      }
      return []
    })
    .join('\n')
}

function callsFromEvents(events: readonly SessionEvent[]) {
  const errors = new Map<string, boolean>()
  for (const event of events) {
    if (event.type !== 'tool/result') continue
    const result = event.data.message.content.find((item) => item.type === 'tool-result')
    if (result?.type === 'tool-result')
      errors.set(String(result.toolCallId), Boolean(result.isError))
  }
  return events.flatMap((event) =>
    event.type === 'tool/call'
      ? [
          {
            id: String(event.data.callId),
            name: event.data.name,
            arguments: event.data.arguments.replace(
              /# dsh-marivo-credential-grant:[A-Za-z0-9_-]{43}/g,
              '# dsh-marivo-credential-grant:[REDACTED-CAPABILITY]',
            ),
            isError: errors.get(String(event.data.callId)) ?? null,
          },
        ]
      : [],
  )
}

const ctx = new Context()
await ctx.plugin(LlmRuntime)
await ctx.plugin(LocalCredentialProvider, { watch: false })
await ctx.plugin(DeepSeek, {
  thinking: 'disabled',
  reasoningEffort: 'off',
  maxTokens: 2_048,
  streamIdleTimeoutMs: 120_000,
  models: [{ id: model, contextWindow: 128_000, maxTokens: 2_048 }],
})
await ctx.plugin(SessionStore)
await ctx.plugin(SystemPrompt)
await ctx.plugin(TestShellEnv)
await ctx.plugin(ToolRuntime)
await ctx.plugin(AgentRegistry)
await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 })

ctx.systemPrompt.section({
  name: 'datasource-grant-acceptance',
  order: 100,
  text: [
    'marivo_datasource_test tests one named datasource.',
    `Only a successful test returns a one-shot foreground shell grant. The exact first command line is ${MARIVO_CREDENTIAL_GRANT_PREFIX}<token>.`,
    'A grant is single-use and scoped to this Agent and Workspace. Ordinary, background, persistent, expired, reused, or cross-Workspace executions receive no secret.',
  ].join(' '),
})

const shellExecutions: Array<{
  callId: string
  aUser: boolean
  aPassword: boolean
  bPassword: boolean
  edge: boolean
  queryResult: number
}> = []
let shellSpawnCount = 0
ctx.tools.register(
  defineTool({
    name: 'bash',
    description:
      'Run the isolated Python/DuckDB query fixture in one foreground execution and report only its result and variable presence.',
    parameters: {
      command: { type: 'string', required: true },
      run_in_background: { type: 'boolean' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: async (_args, execution) => {
      shellSpawnCount++
      const env = shellEnv(ctx).collect(execution)
      const { stdout } = await execFileAsync(
        runtimeEnvironment.binding.pythonExecutable,
        [
          '-I',
          '-c',
          [
            'import json, os',
            'import ibis',
            'con = ibis.duckdb.connect()',
            'con.create_table("query_fixture", obj=[{"value": 12.0}, {"value": 8.0}])',
            'result = float(con.table("query_fixture").value.sum().execute())',
            'print(json.dumps({',
            '  "aUser": "DSH_A_USER" in os.environ,',
            '  "aPassword": "DSH_A_PASSWORD" in os.environ,',
            '  "bPassword": "DSH_B_PASSWORD" in os.environ,',
            '  "edge": "DSH_EDGE_SECRET" in os.environ,',
            '  "queryResult": result,',
            '}))',
          ].join('\n'),
        ],
        {
          env: {
            ...env,
            MARIVO_PROJECT_ROOT: workspaceRoot,
            MARIVO_TELEMETRY: 'off',
            PYTHONDONTWRITEBYTECODE: '1',
          },
          timeout: 30_000,
        },
      )
      const childResult = JSON.parse(stdout) as {
        aUser: boolean
        aPassword: boolean
        bPassword: boolean
        edge: boolean
        queryResult: number
      }
      const result = {
        callId: String(execution.callId),
        ...childResult,
      }
      shellExecutions.push(result)
      return result
    },
  }),
)

let persistentSpawnCount = 0
ctx.tools.register(
  defineTool({
    name: 'pwsh',
    description: 'Synthetic persistent shell; a credential grant must reject it before spawn.',
    parameters: { command: { type: 'string', required: true } },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute: () => {
      persistentSpawnCount++
      return Promise.resolve('unexpected spawn')
    },
  }),
)

const agent: Agent = ctx.agentLoop.create(
  SessionId(`datasource-grants-real-${Date.now().toString(36)}`),
  { provider: 'deepseek-official', model, maxTokens: 2_048 },
  { cwd: binding('workspace-a').projectRoot },
)
const credentials = new MemoryCredentials()
let activeBridge = bridge('workspace-a')
const bridgeSource = () => Promise.resolve(activeBridge)
const grants = new MarivoShellCredentialGrants(ctx, credentials)
const disposeGrantAgent = grants.installAgent(agent, bridgeSource)
const disposeDatasourceTool = registerMarivoDatasourceTestTool(ctx, bridgeSource, credentials, {
  issueShellGrant: (resolvedBridge, name, refs) =>
    grants.issueGrant(agent, resolvedBridge, name, refs),
})

agent.followup(
  createUserMessage({
    content: [{ type: 'text', text: prompt }],
    source: { kind: 'user' },
  }),
)
await agent.whenIdle()
const transcript = textFromEvents(agent.session.events)
const toolCalls = callsFromEvents(agent.session.events)
assert.match(transcript, /DATASOURCE_GRANTS_REAL_AGENT_OK/)
assert.match(transcript, /20/)
assert.ok(bridgeTests.some((item) => item.name === 'broken' && item.expectedValuesPresent))
assert.ok(bridgeTests.some((item) => item.name === 'a' && item.expectedValuesPresent))
assert.ok(
  shellExecutions.some(
    (item) =>
      item.queryResult === 20 && item.aUser && item.aPassword && !item.bPassword && !item.edge,
  ),
)
assert.ok(
  shellExecutions.some(
    (item) =>
      item.queryResult === 20 && !item.aUser && !item.aPassword && !item.bPassword && !item.edge,
  ),
)
assert.ok(toolCalls.some((item) => item.name === 'bash' && item.isError === true))

disposeDatasourceTool()
disposeGrantAgent()
grants.dispose()

const persistentSpawnCountBeforeEdges = persistentSpawnCount
const edgeGrants = new MarivoShellCredentialGrants(ctx, credentials, { ttlMs: 20 })
activeBridge = bridge('workspace-a')
const disposeEdgeAgent = edgeGrants.installAgent(agent, bridgeSource)
const edgeChecks: Array<{ name: string; isError: boolean; messageMatched: boolean }> = []

async function executeEdge(
  name: string,
  tool: 'bash' | 'pwsh',
  token: string,
  extra: Record<string, unknown> = {},
) {
  const result = await ctx.tools.execute({
    callId: CallId(`edge-${name}`),
    name: tool,
    arguments: {
      command: `${MARIVO_CREDENTIAL_GRANT_PREFIX}${token}\ntrue`,
      ...extra,
    },
    agent,
    signal: new AbortController().signal,
  })
  return result
}

const wrongWorkspace = edgeGrants.issueGrant(agent, activeBridge, 'edge', ['DSH_EDGE_SECRET'])
activeBridge = bridge('workspace-b')
const wrongWorkspaceResult = await executeEdge('wrong-workspace', 'bash', wrongWorkspace.token)
edgeChecks.push({
  name: 'wrong-workspace',
  isError: wrongWorkspaceResult.isError,
  messageMatched: /another Workspace binding/.test(JSON.stringify(wrongWorkspaceResult)),
})

activeBridge = bridge('workspace-a')
const expired = edgeGrants.issueGrant(agent, activeBridge, 'edge', ['DSH_EDGE_SECRET'])
await new Promise((resolve) => setTimeout(resolve, 30))
const expiredResult = await executeEdge('expired', 'bash', expired.token)
edgeChecks.push({
  name: 'expired',
  isError: expiredResult.isError,
  messageMatched: /expired/.test(JSON.stringify(expiredResult)),
})

const background = edgeGrants.issueGrant(agent, activeBridge, 'edge', ['DSH_EDGE_SECRET'])
const backgroundResult = await executeEdge('background', 'bash', background.token, {
  run_in_background: true,
})
edgeChecks.push({
  name: 'background',
  isError: backgroundResult.isError,
  messageMatched: /background Shell/.test(JSON.stringify(backgroundResult)),
})

const persistent = edgeGrants.issueGrant(agent, activeBridge, 'edge', ['DSH_EDGE_SECRET'])
const persistentResult = await executeEdge('persistent', 'pwsh', persistent.token)
edgeChecks.push({
  name: 'persistent',
  isError: persistentResult.isError,
  messageMatched: /persistent pwsh/.test(JSON.stringify(persistentResult)),
})

assert.ok(edgeChecks.every((item) => item.isError && item.messageMatched))
assert.equal(persistentSpawnCount, persistentSpawnCountBeforeEdges)
assert.equal(shellSpawnCount, shellExecutions.length)

disposeEdgeAgent()
edgeGrants.dispose()

const finalText = agent.session.events.filter((event) => event.type === 'assistant/message').at(-1)
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  model: { provider: 'deepseek-official', id: model, thinking: 'disabled' },
  runtimeIdentity: {
    dsh: '0.1.1-rc.2',
    plugin: '2.0.0',
    marivo: runtimeEnvironment.binding.marivoVersion,
    admittedRuntime: runtimeEnvironment.binding,
    syntheticBridgeBinding: binding('workspace-a'),
  },
  prompt,
  agentJourney: {
    sessionId: String(agent.session.header.id),
    completed: transcript.includes('DATASOURCE_GRANTS_REAL_AGENT_OK'),
    finalText:
      finalText?.type === 'assistant/message'
        ? finalText.data.message.content
            .flatMap((item) => (item.type === 'text' ? [item.text] : []))
            .join('\n')
        : '',
    toolCalls,
    bridgeTests,
    shellExecutions,
  },
  preSpawnLifecycleChecks: edgeChecks,
  shellSpawnCount,
  persistentSpawnCount,
  persistentEdgeSpawnCount: persistentSpawnCount - persistentSpawnCountBeforeEdges,
  credentialRefsResolved: credentials.resolved,
  credentialValuesRecorded: false,
  capabilityTokensRecorded: false,
  safetyBoundary:
    'A grant limits which foreground Shell execution receives values; it does not sandbox code inside that execution.',
}
const serialized = JSON.stringify(report, null, 2)
for (const value of Object.values(secrets)) assert.doesNotMatch(serialized, new RegExp(value))
assert.doesNotMatch(serialized, /# dsh-marivo-credential-grant:[A-Za-z0-9_-]{43}/)
await mkdir(path.dirname(reportPath), { recursive: true })
await writeFile(reportPath, `${serialized}\n`, { mode: 0o600 })
await chmod(reportPath, 0o600)
process.stdout.write(
  `${JSON.stringify(
    {
      status: 'ok',
      reportPath,
      sessionId: String(agent.session.header.id),
      agentToolCalls: toolCalls.map((item) => ({ name: item.name, isError: item.isError })),
      edgeChecks,
    },
    null,
    2,
  )}\n`,
)
