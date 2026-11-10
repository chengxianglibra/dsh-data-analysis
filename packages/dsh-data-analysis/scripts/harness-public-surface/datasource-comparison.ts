/** Isolated G3 routing experiment; never installed by the production plugin. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, {
  defineTool,
  type JsonSchemaNode,
  type ToolDefinition,
  validateJsonSchemaValue,
} from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import type { MarivoDatasourceBridgeSource } from '../../src/datasource/bridge.ts'
import { createMarivoDatasourceConfigureTool } from '../../src/datasource/configure.ts'
import type { MarivoCredentialService } from '../../src/datasource/service.ts'
import { createMarivoDatasourceTestTool } from '../../src/datasource/test.ts'
import { failed, fixture } from '../../tests/datasource-credentials/fixtures.ts'
import { TestShellEnv } from '../../tests/test-shell-env.ts'
import { installDeepSeekValidationProvider } from '../deepseek-validation-provider.ts'

const name = z.string().trim().min(1).max(256)
const reason = z.string().trim().min(1).max(1000)
export const datasourceActionInput = z.union([
  z.strictObject({ action: z.literal('configure'), mode: z.literal('create'), reason }),
  z.strictObject({ action: z.literal('configure'), mode: z.literal('edit'), name, reason }),
  z.strictObject({ action: z.literal('test'), name }),
])
export const datasourceActionSchema: JsonSchemaNode = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['action', 'mode', 'reason'],
      properties: {
        action: { type: 'string', const: 'configure' },
        mode: { type: 'string', const: 'create' },
        reason: {
          type: 'string',
          description: 'Non-secret setup reason, at most 1000 characters.',
        },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['action', 'mode', 'name', 'reason'],
      properties: {
        action: { type: 'string', const: 'configure' },
        mode: { type: 'string', const: 'edit' },
        name: { type: 'string', description: 'Exact existing datasource name.' },
        reason: {
          type: 'string',
          description: 'Non-secret repair reason, at most 1000 characters.',
        },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['action', 'name'],
      properties: {
        action: { type: 'string', const: 'test' },
        name: { type: 'string', description: 'Exact existing datasource name.' },
      },
    },
  ],
}

/** Delegate one existing definition, preserving the execution owner and cancellation signal. */
export function createDatasourceActionAdapter(
  configure: ToolDefinition,
  test: ToolDefinition,
): ToolDefinition {
  return {
    name: 'marivo_datasource',
    description:
      'Manage Host datasource configuration or test an existing connection. action=configure opens setup or repair: mode=create has no name; mode=edit requires an exact name; both require a non-secret reason. action=test accepts only name, after a relevant change, failure or explicit request. Never pass connection settings or secrets. Normal analysis needs no preliminary test; successful configuration already tested the connection. Root Web calls can wait; delegated calls return a handoff to the parent. Follow returned statuses; connection success does not prove table access.',
    parameters: { ...datasourceActionSchema },
    output: {
      schema: {},
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const violations = validateJsonSchemaValue(datasourceActionSchema, args)
      if (violations.length) throw new Error(`Invalid datasource action: ${violations.join('; ')}`)
      const input = datasourceActionInput.parse(args)
      if (input.action === 'test') return test.execute({ name: input.name }, exec)
      return configure.execute(
        input.mode === 'edit'
          ? { mode: input.mode, name: input.name, reason: input.reason }
          : { mode: input.mode, reason: input.reason },
        exec,
      )
    },
  }
}
export function comparisonDefinitions(
  source: MarivoDatasourceBridgeSource,
  service: MarivoCredentialService,
  variant: 'separate' | 'action',
) {
  const configure = createMarivoDatasourceConfigureTool(source, service)
  const test = createMarivoDatasourceTestTool(source, service)
  return variant === 'separate'
    ? [configure, test]
    : [createDatasourceActionAdapter(configure, test)]
}

const scenarios = [
  {
    id: 'create',
    prompt:
      'Create or select a datasource through the Host setup form, then report whether configuration succeeded. Do not run analysis or a separate connection test.',
    expected: ['configure:create'],
  },
  {
    id: 'edit',
    prompt:
      'Open the Host repair form for the exact existing datasource warehouse. The user wants to edit it, then report whether the saved connection works. Do not run analysis or a separate connection test.',
    expected: ['configure:edit'],
  },
  {
    id: 'test',
    prompt:
      'The connection settings for warehouse changed. Explicitly test that existing connection once, then report the outcome. Do not open a configuration form when it works.',
    expected: ['test'],
  },
  {
    id: 'configured-analysis',
    prompt:
      'warehouse is already configured and its connection test has just succeeded. Analyze its orders amount total now and report the answer. No setup or preliminary test is needed.',
    expected: ['analyze'],
  },
  {
    id: 'delegate-handoff',
    prompt:
      'You are a delegated Agent. This work needs warehouse configuration repaired through the Host before analysis can proceed. Request the necessary repair once; if the returned status requires the parent Agent, return the non-secret handoff and stop without retrying or analyzing.',
    expected: ['configure:edit'],
  },
  {
    id: 'failure-repair',
    prompt:
      'First test the existing warehouse connection because it failed recently. If the test fails, open its Host repair form. After repair succeeds, analyze orders amount total and report the answer. Do not ask for secrets in chat or test again after successful configuration.',
    expected: ['test', 'configure:edit', 'analyze'],
  },
] as const

type Trace = { name: string; arguments: unknown; isError: boolean; value?: unknown }
function actionOf(entry: Trace): string {
  if (entry.name === 'fixture_analyze') return 'analyze'
  const args = z
    .object({ action: z.string().optional(), mode: z.string().optional() })
    .safeParse(entry.arguments)
  if (entry.name === 'marivo_datasource_test' || (args.success && args.data.action === 'test'))
    return 'test'
  return `configure:${args.success ? (args.data.mode ?? 'missing') : 'invalid'}`
}
async function completeForms(f: ReturnType<typeof fixture>, agent: Agent, signal: AbortSignal) {
  let cursor: string | undefined
  const handled = new Set<string>()
  while (!signal.aborted) {
    const snapshot = await f.service.waitWatch(String(agent.session.id), cursor, signal)
    cursor = snapshot.cursor
    for (const request of snapshot.configurationRequests) {
      if (request.endedAt !== undefined || handled.has(request.id)) continue
      handled.add(request.id)
      f.setResult({ name: 'warehouse', ok: true, latency_ms: 1, failure: null, repair: null })
      const selected = await f.service.selectConfiguration(
        request.id,
        'workspace',
        'warehouse',
        f.resolve,
        signal,
      )
      assert.ok(selected.context)
      f.service.start({
        generation: f.service.generation,
        id: randomUUID(),
        scope: selected.context.token,
        version: selected.context.version,
        action: 'submit',
        requestId: request.id,
      })
    }
  }
}

export async function runDatasourceComparison() {
  const directory = path.resolve(
    process.env.DSH_DATASOURCE_COMPARISON_OUTPUT ??
      'artifacts/harness-public-surface/dev-d/datasource-comparison',
  )
  await mkdir(directory, { recursive: true })
  const ctx = new Context()
  const model = process.env.DSH_DATA_ANALYSIS_VALIDATION_MODEL ?? 'deepseek-v4-flash'
  const results: Array<{
    variant: 'separate' | 'action'
    success: boolean
    mechanicalCalls: number
    toolErrors: number
    schemaBytes: number
  }> = []
  try {
    for (const plugin of [
      LlmRuntime,
      SessionStore,
      SystemPrompt,
      TestShellEnv,
      ToolRuntime,
      AgentRegistry,
      SessionProjectionRegistry,
    ])
      await ctx.plugin(plugin)
    await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 })
    await ctx.plugin(LocalCredentialProvider, { watch: false })
    if (!(await ctx.credentials.describe(credentialRef('DEEPSEEK_API_KEY')))?.configured) {
      const blocked = {
        status: 'blocked',
        reason: 'Harness local model credential unavailable',
        model,
      }
      await writeFile(path.join(directory, 'summary.json'), JSON.stringify(blocked, null, 2))
      console.log(JSON.stringify(blocked))
      return
    }
    await installDeepSeekValidationProvider(ctx, { thinking: 'disabled' })
    for (const scenario of scenarios)
      for (const variant of ['separate', 'action'] as const) {
        const f = fixture('web')
        f.store.put('DB_PASSWORD')
        if (scenario.id === 'failure-repair') f.setResult(failed)
        const handle = await ctx.agents.create({
          sessionId: SessionId(`g3-${scenario.id}-${variant}-${randomUUID()}`),
          agentOptions: { provider: 'deepseek-official', model, maxTokens: 1024 },
          meta: {
            cwd: '/workspace',
            ...(scenario.id === 'delegate-handoff'
              ? { origin: 'subagent' as const, delegationDepth: 1 }
              : {}),
          },
        })
        const agent = handle.agent
        assert.equal(agent.session.header.origin === 'subagent', scenario.id === 'delegate-handoff')
        const definitions = comparisonDefinitions(f.bridge, f.service, variant)
        const stops = definitions.map((definition) => agent.ctx.tools.register(definition))
        stops.push(
          agent.ctx.tools.register(
            defineTool({
              name: 'fixture_analyze',
              description:
                'Analyze configured warehouse orders and return amount total. This is the isolated non-secret business fixture.',
              parameters: {},
              output: {
                schema: { type: 'json' },
                render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
              },
              async execute(_args, exec) {
                const prepared = await f.service.prepareExecution(exec, f.resolve, ['warehouse'])
                if (!('status' in prepared) || prepared.status !== 'ready')
                  return { status: 'blocked', name: 'warehouse', amountSum: null }
                try {
                  return { status: 'ok', name: 'warehouse', amountSum: 30 }
                } finally {
                  prepared.release()
                }
              },
            }),
          ),
        )
        stops.push(
          agent.ctx.systemPrompt.section({
            name: 'g3-routing-comparison',
            order: 100,
            text: 'Use the available tools to complete the user request. warehouse is the only fixture datasource. Configuration and credential values belong to the Host form; never request or supply them in chat. A successful configuration already includes a connection test. For requested business analysis, call fixture_analyze. Honor handoffs and do not retry unchanged delegated requests. Return a concise final result.',
          }),
        )
        const trace: Trace[] = []
        stops.push(
          agent.ctx.on('tools/result', (exec, result) => {
            trace.push({
              name: exec.name,
              arguments: exec.arguments,
              isError: result.isError,
              ...(!result.isError ? { value: result.value } : {}),
            })
          }),
        )
        const uiLifetime = new AbortController()
        const ui = completeForms(f, agent, uiLifetime.signal).catch((error) => {
          if (!uiLifetime.signal.aborted) throw error
        })
        const timeout = setTimeout(() => agent.cancel({ kind: 'user' }), 45000)
        const started = Date.now()
        try {
          agent.followup(
            createUserMessage({
              source: { kind: 'user' },
              content: [{ type: 'text', text: scenario.prompt }],
            }),
          )
          await agent.whenIdle()
          const events = agent.session.snapshotEvents()
          const turnEnd = [...events].reverse().find((event) => event.type === 'turn/end')
          const actions = trace.map(actionOf)
          const statuses = trace.map(
            (entry) =>
              z.object({ status: z.string() }).safeParse(entry.value).data?.status ?? 'invalid',
          )
          const expectedStatuses =
            scenario.id === 'delegate-handoff'
              ? ['needs-configuration']
              : scenario.id === 'failure-repair'
                ? ['failed', 'ok', 'ok']
                : ['ok']
          const expectedConnectionTests = ['configured-analysis', 'delegate-handoff'].includes(
            scenario.id,
          )
            ? 0
            : scenario.id === 'failure-repair'
              ? 2
              : 1
          const outcome = {
            scenario: scenario.id,
            variant,
            model,
            provider: 'deepseek-official',
            thinking: 'disabled',
            maxTokens: 1024,
            prompt: scenario.prompt,
            schemaBytes: Buffer.byteLength(
              JSON.stringify(
                ctx.tools.schemas(agent).filter((schema) => schema.name !== 'fixture_analyze'),
              ),
            ),
            schemas: ctx.tools.schemas(agent).filter((schema) => schema.name !== 'fixture_analyze'),
            elapsedMs: Date.now() - started,
            mechanicalCalls: trace.length,
            toolErrors: trace.filter((entry) => entry.isError).length,
            businessFailureResults: trace.filter(
              (entry) => z.object({ status: z.literal('failed') }).safeParse(entry.value).success,
            ).length,
            connectionTests: f.tests,
            actions,
            expectedActions: scenario.expected,
            statuses,
            expectedStatuses,
            expectedConnectionTests,
            success:
              turnEnd?.type === 'turn/end' &&
              turnEnd.data.reason.kind === 'completed' &&
              JSON.stringify(actions) === JSON.stringify(scenario.expected) &&
              JSON.stringify(statuses) === JSON.stringify(expectedStatuses) &&
              f.tests === expectedConnectionTests &&
              trace.every((entry) => !entry.isError),
            endReason: turnEnd?.data.reason,
            trace,
            messages: events.flatMap((event) =>
              event.type === 'assistant/message'
                ? [{ message: event.data.message, usage: event.data.usage }]
                : [],
            ),
          }
          results.push(outcome)
          await writeFile(
            path.join(directory, `${scenario.id}-${variant}.json`),
            JSON.stringify(outcome, null, 2),
          )
          console.log(
            JSON.stringify({
              scenario: scenario.id,
              variant,
              mechanicalCalls: outcome.mechanicalCalls,
              schemaBytes: outcome.schemaBytes,
              success: outcome.success,
              elapsedMs: outcome.elapsedMs,
            }),
          )
        } finally {
          clearTimeout(timeout)
          uiLifetime.abort()
          await ui
          for (const stop of stops.reverse()) stop()
          await f.service.close()
          await handle.dispose()
        }
      }
    const separate = results.filter((result) => result.variant === 'separate')
    const action = results.filter((result) => result.variant === 'action')
    const calls = (rows: typeof results) => rows.reduce((sum, row) => sum + row.mechanicalCalls, 0)
    const errors = (rows: typeof results) => rows.reduce((sum, row) => sum + row.toolErrors, 0)
    const summary = {
      status: 'complete',
      model,
      observationsPerScenarioVariant: 1,
      businessBoundary:
        'Actual configure/test definitions and MarivoCredentialService with the existing non-secret fake bridge fixture; no real datasource backend or actual Web form UI is claimed.',
      scenarios: scenarios.map((scenario) => scenario.id),
      separate: {
        successful: separate.filter((row) => row.success).length,
        mechanicalCalls: calls(separate),
        errors: errors(separate),
        schemaBytes: separate[0]?.schemaBytes,
      },
      action: {
        successful: action.filter((row) => row.success).length,
        mechanicalCalls: calls(action),
        errors: errors(action),
        schemaBytes: action[0]?.schemaBytes,
      },
      decision:
        calls(action) < calls(separate) &&
        errors(action) <= errors(separate) &&
        action.every((row) => row.success)
          ? 'candidate-benefit-observed-further-acceptance-required'
          : 'retain-separate-configure-test',
      limitation:
        'A single observation per scenario is not a statistical performance or quality claim. Schema bytes are UTF-8 serialized model schema bytes, not billing tokens. Production installation remains unchanged.',
    }
    await writeFile(path.join(directory, 'summary.json'), JSON.stringify(summary, null, 2))
    console.log(JSON.stringify(summary))
  } finally {
    await ctx.fiber.dispose()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  await runDatasourceComparison()
