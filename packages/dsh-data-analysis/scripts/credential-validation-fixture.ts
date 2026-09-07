import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import BashLocal from '@deepseek-ai/dsh-bash-local'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import LlmRuntime, { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import * as DeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { MarivoDatasourceBridge } from '../src/datasource/bridge.ts'
import {
  registerMarivoDatasourceAccessTool,
  registerMarivoDatasourceTestTool,
} from '../src/datasource/index.ts'
import { registerMarivoPythonTool } from '../src/datasource/python.ts'
import { MarivoCredentialService } from '../src/datasource/service.ts'
import { bindMarivoEnvironment } from '../src/environment/index.ts'
import { Store } from '../tests/datasource-credentials/fixtures.ts'
import { TestShellEnv } from '../tests/test-shell-env.ts'

/** Real Python + HTTP authentication + Harness Tool execution. Uses only fixture datasource values. */
export async function runCredentialValidation(realModel: boolean): Promise<void> {
  const python = process.env.DSH_DATA_ANALYSIS_PYTHON
  if (!python)
    throw new Error(
      'Set DSH_DATA_ANALYSIS_PYTHON to a Runtime with the packaged credential_scope capability',
    )
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-credential-integration-')))
  const store = new Store(),
    secret = 'fixture-bearer-canary-852093'
  let accepted = 0
  const server = createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${secret}`) {
      res.writeHead(403)
      res.end()
      return
    }
    accepted++
    const body = '[{"amount":10},{"amount":20}]'
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    })
    res.end(req.method === 'HEAD' ? undefined : body)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert(address && typeof address !== 'string')
  const scope = `http://127.0.0.1:${address.port}/`
  const ctx = new Context(),
    service = new MarivoCredentialService(store, realModel ? 'web' : 'none')
  try {
    const ds = path.join(root, 'models', 'datasources')
    await mkdir(ds, { recursive: true })
    for (const name of ['warehouse', 'ungranted'])
      await writeFile(
        path.join(ds, `${name}.py`),
        `import marivo.datasource as md\nmd.duckdb(name=${JSON.stringify(name)}, path=":memory:", http_scope=${JSON.stringify(scope)}, http_bearer_token_env="VALIDATION_TOKEN")\n`,
      )
    const environment = await bindMarivoEnvironment(
      { projectRoot: root, pythonExecutable: python },
      {
        environment: {
          ...process.env,
          MARIVO_TELEMETRY: 'off',
          VALIDATION_TOKEN: 'ambient-canary-must-not-be-used',
        },
      },
    )
    const bridge = new MarivoDatasourceBridge(environment)
    assert.equal((await bridge.describe('warehouse')).refs[0], 'VALIDATION_TOKEN')
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(TestShellEnv)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 })
    await ctx.plugin(SubprocessLocal)
    await ctx.plugin(BashLocal, { timeoutMs: 120_000, maxOutputBytes: 65536 })
    const agent = ctx.agentLoop.create(
      SessionId(`credential-${Date.now()}`),
      {
        provider: 'deepseek-official',
        model: process.env.DSH_DATA_ANALYSIS_VALIDATION_MODEL ?? 'deepseek-v4-flash',
        maxTokens: 2048,
      },
      { cwd: root },
    )
    registerMarivoDatasourceTestTool(agent.ctx, bridge, service)
    registerMarivoDatasourceAccessTool(agent.ctx, bridge, service)
    registerMarivoPythonTool(agent.ctx, bridge, service)
    let counter = 0
    const call = (name: string, args: object) =>
      agent.ctx.tools.execute({
        agent,
        name,
        arguments: args,
        callId: CallId(`credential-${++counter}`),
        signal: AbortSignal.timeout(120_000),
      })
    if (!realModel) {
      const missing = await call('marivo_datasource_access', { name: 'warehouse' })
      assert(
        !missing.isError && (missing.value as { status: string }).status === 'needs-credentials',
      )
      assert.equal(
        (await bridge.test(await bridge.describe('warehouse'), {})).failure?.code,
        'credential_missing',
      )
      const admitted = await bridge.describe('warehouse')
      const definitionFile = path.join(ds, 'warehouse.py')
      const originalDefinition = await readFile(definitionFile, 'utf8')
      try {
        await writeFile(definitionFile, originalDefinition.replace(scope, `${scope}changed/`))
        assert.equal(
          (await bridge.test(admitted, { VALIDATION_TOKEN: secret })).failure?.code,
          'credential_denied',
        )
      } finally {
        await writeFile(definitionFile, originalDefinition)
      }
      store.put('VALIDATION_TOKEN', secret)
      const test = await call('marivo_datasource_test', { name: 'warehouse' })
      assert(!test.isError, JSON.stringify(test))
      assert.equal((test.value as { status: string }).status, 'ok')
      assert(!(await call('marivo_datasource_access', { name: 'warehouse' })).isError)
      const executed = await call('marivo_python', {
        datasources: ['warehouse'],
        code: `import os\nimport marivo.datasource as md\nassert "VALIDATION_TOKEN" not in os.environ\nwith md.connect("warehouse") as backend:\n    assert backend.raw_sql("SELECT sum(amount) FROM read_json_auto('${scope}data.json')").fetchall() == [(30,)]\nprint("AGGREGATE=30")\n`,
      })
      assert(!executed.isError, JSON.stringify(executed))
      assert.equal((executed.value as { exitCode: number }).exitCode, 0, JSON.stringify(executed))
      assert.match((executed.value as { stdout: string }).stdout, /AGGREGATE=30/)
      // Raw fd writes and Python tracebacks are redacted before Shell output collection.
      const leakage = await call('marivo_python', {
        datasources: ['warehouse'],
        code: 'import os\nfrom marivo.datasource.credentials import current_resolver\nvalue=current_resolver().values["VALIDATION_TOKEN"]\nos.write(1, value.encode())\nraise RuntimeError(value)',
      })
      assert(!leakage.isError)
      assert.doesNotMatch(JSON.stringify(leakage), new RegExp(secret))
      assert.match(JSON.stringify(leakage), /REDACTED/)
      const denied = await call('marivo_python', {
        datasources: ['warehouse'],
        code: 'import marivo.datasource as md\nr=md.test("ungranted")\nassert not r.ok and r.failure.code == "credential_denied"\nprint("DENIED_OK")',
      })
      assert(!denied.isError)
      assert.equal((denied.value as { exitCode: number }).exitCode, 0, JSON.stringify(denied))
      assert(accepted > 0)
    } else {
      // The live-model path starts with no fixture credential and completes its original Tool via the service.
      await ctx.plugin(LocalCredentialProvider, { watch: false })
      if (!(await ctx.credentials.resolve(credentialRef('DEEPSEEK_API_KEY')))) {
        console.log(
          JSON.stringify({ realModel: 'blocked', reason: 'DSH model credential unavailable' }),
        )
        return
      }
      await ctx.plugin(DeepSeek, { thinking: 'disabled' })
      const deadline = setTimeout(
        () => agent.cancel({ kind: 'user' }, { keepInbox: true }),
        180_000,
      )
      deadline.unref()
      agent.followup(
        createUserMessage({
          source: { kind: 'user' },
          content: [
            {
              type: 'text',
              text: `Call marivo_datasource_access for warehouse, then marivo_python with datasources ["warehouse"] to connect with marivo.datasource.connect and compute SELECT sum(amount) FROM read_json_auto('${scope}data.json'). The total must be 30. Do not ask for secrets, do not use environment variables, and do not create another conversation. End with CREDENTIAL_AGENT_OK.`,
            },
          ],
        }),
      )
      let cursor: string | undefined
      const waitSignal = AbortSignal.timeout(180_000)
      for (;;) {
        const snapshot = await service.waitWatch(agent.session.id, cursor, waitSignal)
        cursor = snapshot.cursor
        const request = snapshot.requests.find((r) => r.endedAt === undefined)
        if (!request) continue
        const waitMs = Number(process.env.DSH_CREDENTIAL_WAIT_MS ?? 0)
        if (waitMs > 0)
          await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, 70_000)))
        assert.equal(
          service.watch(agent.session.id).requests.find((r) => r.id === request.id)?.endedAt,
          undefined,
        )
        service.start({
          generation: service.generation,
          id: crypto.randomUUID(),
          scope: request.context.token,
          action: 'submit',
          requestId: request.id,
          version: request.context.version,
          changes: { VALIDATION_TOKEN: secret },
        })
        break
      }
      await agent.whenIdle()
      clearTimeout(deadline)
      assert(accepted > 0)
      assert.match(JSON.stringify(agent.session.events), /CREDENTIAL_AGENT_OK/)
      assert.doesNotMatch(JSON.stringify(agent.session.events), new RegExp(secret))
    }
    async function scan(dir: string): Promise<void> {
      for (const item of await readdir(dir, { withFileTypes: true })) {
        const file = path.join(dir, item.name)
        if (item.isDirectory()) await scan(file)
        else
          assert(
            !(await readFile(file)).includes(Buffer.from(secret)),
            `fixture value persisted in ${item.name}`,
          )
      }
    }
    await scan(root)
    console.log(
      JSON.stringify({
        publicResolver: 'passed',
        realHttpAggregate: 30,
        harnessPython: 'passed',
        defaultEnvCanary: realModel ? 'not-run' : 'passed',
        definitionDriftDenied: realModel ? 'not-run' : 'passed',
        rawOutputRedaction: realModel ? 'not-run' : 'passed',
        projectSecretScan: 'passed',
        realModel: realModel ? 'passed' : 'not-run',
      }),
    )
  } finally {
    await service.close()
    await ctx.fiber.dispose()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(root, { recursive: true, force: true })
  }
}
