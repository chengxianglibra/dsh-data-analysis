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
import LlmRuntime, { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import * as DeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { MarivoDatasourceBridge } from '../src/datasource/bridge.ts'
import { registerMarivoDatasourceTestTool } from '../src/datasource/index.ts'
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
    secret = 'fixture-bearer-canary-852093',
    secondSecret = 'fixture-second-bearer-canary-463012'
  let accepted = 0
  const acceptedDatasources = new Set<string>()
  const server = createServer((req, res) => {
    const expected = req.url?.startsWith('/two/') ? secondSecret : secret
    if (req.headers.authorization !== `Bearer ${expected}`) {
      res.writeHead(403)
      res.end()
      return
    }
    accepted++
    acceptedDatasources.add(req.url?.startsWith('/two/') ? 'warehouse_two' : 'warehouse')
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
  const evidence: Record<string, unknown> = {
    scenario: realModel ? 'real-agent-execution' : 'direct-tool-credentials',
    programSource: 'fixture-provided-python',
    status: 'running',
    model: realModel
      ? (process.env.DSH_DATA_ANALYSIS_VALIDATION_MODEL ?? 'deepseek-v4-flash')
      : null,
  }
  let executionTrace = (): Record<string, unknown> => ({})
  try {
    const ds = path.join(root, 'models', 'datasources')
    await mkdir(ds, { recursive: true })
    for (const name of ['warehouse', 'ungranted'])
      await writeFile(
        path.join(ds, `${name}.py`),
        `import marivo.datasource as md\nmd.duckdb(name=${JSON.stringify(name)}, path=":memory:", http_scope=${JSON.stringify(scope)}, http_bearer_token_env="VALIDATION_TOKEN")\n`,
      )
    await writeFile(
      path.join(ds, 'warehouse_two.py'),
      `import marivo.datasource as md\nmd.duckdb(name="warehouse_two", path=":memory:", http_scope=${JSON.stringify(`${scope}two/`)}, http_bearer_token_env="SECOND_VALIDATION_TOKEN")\n`,
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
    evidence.runtime = bridge.binding
    assert.equal((await bridge.describe('warehouse')).refs[0], 'VALIDATION_TOKEN')
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(TestShellEnv)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 })
    await ctx.plugin(SubprocessLocal)
    await ctx.plugin(BashLocal, { timeoutMs: 120_000, maxOutputBytes: 65536 })
    const agent = await ctx.agentLoop.create(
      SessionId(`credential-${Date.now()}`),
      {
        provider: 'deepseek-official',
        model: process.env.DSH_DATA_ANALYSIS_VALIDATION_MODEL ?? 'deepseek-v4-flash',
        maxTokens: 2048,
      },
      { cwd: root },
    )
    registerMarivoDatasourceTestTool(agent.ctx, bridge, service)
    registerMarivoPythonTool(agent.ctx, bridge, service)
    const pythonResults: { callId: string; isError: boolean; value?: unknown }[] = []
    ctx.on('tools/result', (exec, result) => {
      if (exec.name === 'marivo_python')
        pythonResults.push({ callId: String(exec.callId), ...result })
    })
    let starts = 0
    const shell = agent.ctx.get('shell')!,
      originalRun = shell.run.bind(shell)
    shell.run = (spec) => {
      starts++
      return originalRun(spec)
    }
    let tests = 0
    const originalTest = bridge.test.bind(bridge)
    bridge.test = (description, values, signal) => {
      tests++
      return originalTest(description, values, signal)
    }
    executionTrace = () => ({
      pythonStarts: starts,
      connectionTests: tests,
      acceptedHttpRequests: accepted,
      acceptedDatasources: [...acceptedDatasources].sort(),
      pythonResults,
      toolCalls: agent.session.snapshotEvents().flatMap((event) =>
        event.type === 'tool/call'
          ? [
              {
                callId: String(event.data.callId),
                name: event.data.name,
                arguments: event.data.arguments,
              },
            ]
          : [],
      ),
    })
    let counter = 0
    const call = (name: string, args: object) =>
      agent.ctx.tools.execute({
        agent,
        name,
        arguments: args,
        callId: ToolCallId(`credential-${++counter}`),
        signal: AbortSignal.timeout(120_000),
      })
    const executionCode = `import os\nimport marivo.datasource as md\nassert "VALIDATION_TOKEN" not in os.environ\nassert "SECOND_VALIDATION_TOKEN" not in os.environ\nfor name, endpoint in [("warehouse", "${scope}data.json"), ("warehouse_two", "${scope}two/data.json")]:\n    with md.connect(name) as backend:\n        assert backend.raw_sql("SELECT sum(amount) FROM read_json_auto('" + endpoint + "')").fetchall() == [(30,)]\nprint("AGGREGATE=30_EACH")\n`
    if (!realModel) {
      const missing = await call('marivo_python', {
        datasources: ['warehouse', 'warehouse_two'],
        code: 'raise AssertionError("missing credentials must prevent execution")',
      })
      assert(
        !missing.isError && (missing.value as { status: string }).status === 'needs-credentials',
      )
      assert.equal(starts, 0)
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
      const partial = await call('marivo_python', {
        datasources: ['warehouse', 'warehouse_two'],
        code: 'raise AssertionError("partial credentials must prevent execution")',
      })
      assert(!partial.isError)
      assert.equal((partial.value as { status: string }).status, 'needs-credentials')
      assert.equal((partial.value as { name: string }).name, 'warehouse_two')
      assert.equal(starts, 0)
      store.put('SECOND_VALIDATION_TOKEN', secondSecret)
      const testsBeforeExecution = tests
      const executed = await call('marivo_python', {
        datasources: ['warehouse', 'warehouse_two'],
        code: executionCode,
      })
      assert(!executed.isError, JSON.stringify(executed))
      assert.equal((executed.value as { exitCode: number }).exitCode, 0, JSON.stringify(executed))
      assert.match((executed.value as { stdout: string }).stdout, /AGGREGATE=30_EACH/)
      assert.equal(starts, 1)
      assert.equal(tests, testsBeforeExecution)
      // Raw fd writes and Python tracebacks are redacted before Shell output collection.
      const leakage = await call('marivo_python', {
        datasources: ['warehouse'],
        code: 'import os\nfrom marivo.datasource.credentials import current_resolver\nvalue=current_resolver().values["VALIDATION_TOKEN"]\nos.write(1, value.encode())\nraise RuntimeError(value)',
      })
      assert(!leakage.isError)
      assert.notEqual((leakage.value as { exitCode: number }).exitCode, 0)
      assert.equal(starts, 2, 'failed Python code must execute only once')
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
        evidence.status = 'blocked'
        evidence.reason = 'DSH model credential unavailable'
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
              text: `This validates execution admission for a supplied Python program. Call marivo_python exactly once with datasources ["warehouse", "warehouse_two"] and the exact code below. The host will handle missing credentials during that same call. Do not ask for secrets or create another conversation. Do not retry failed code. After a successful result containing AGGREGATE=30_EACH, end with CREDENTIAL_AGENT_OK.\n\nPython code:\n${executionCode}`,
            },
          ],
        }),
      )
      let cursor: string | undefined
      const waitSignal = AbortSignal.timeout(180_000)
      let fulfilled = 0
      while (fulfilled < 2) {
        const snapshot = await service.waitWatch(agent.session.id, cursor, waitSignal)
        cursor = snapshot.cursor
        const request = snapshot.requests.find((r) => r.endedAt === undefined)
        if (!request) continue
        assert.equal(starts, 0, 'all datasources must be ready before Python starts')
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
          changes:
            request.context.name === 'warehouse_two'
              ? { SECOND_VALIDATION_TOKEN: secondSecret }
              : { VALIDATION_TOKEN: secret },
        })
        fulfilled++
        // A submitted operation stays live while its diagnostic test finishes.
        while (
          service
            .watch(agent.session.id)
            .requests.some((r) => r.id === request.id && r.endedAt === undefined)
        ) {
          const current = service.watch(agent.session.id)
          await service.waitWatch(agent.session.id, current.cursor, waitSignal)
        }
      }
      await agent.whenIdle()
      clearTimeout(deadline)
      assert(accepted > 0)
      assert.equal(starts, 1, 'the real Agent must complete one Python execution')
      assert.equal(tests, 2, 'only credential submission should test connections')
      assert.equal(pythonResults.length, 1)
      assert(!pythonResults[0]!.isError)
      assert.equal((pythonResults[0]!.value as { exitCode: number }).exitCode, 0)
      assert.match((pythonResults[0]!.value as { stdout: string }).stdout, /AGGREGATE=30_EACH/)
      assert.match(JSON.stringify(agent.session.snapshotEvents()), /CREDENTIAL_AGENT_OK/)
      assert.doesNotMatch(JSON.stringify(agent.session.snapshotEvents()), new RegExp(secret))
      assert.doesNotMatch(JSON.stringify(agent.session.snapshotEvents()), new RegExp(secondSecret))
    }
    assert.deepEqual([...acceptedDatasources].sort(), ['warehouse', 'warehouse_two'])
    async function scan(dir: string): Promise<void> {
      for (const item of await readdir(dir, { withFileTypes: true })) {
        const file = path.join(dir, item.name)
        if (item.isDirectory()) await scan(file)
        else
          for (const value of [secret, secondSecret])
            assert(
              !(await readFile(file)).includes(Buffer.from(value)),
              `fixture value persisted in ${item.name}`,
            )
      }
    }
    await scan(root)
    const summary = {
      publicResolver: 'passed',
      realHttpAggregate: 30,
      harnessPython: 'passed',
      multiDatasourceAdmission: 'passed',
      noAdditionalConnectionTest: 'passed',
      failedExecutionNoReplay: realModel ? 'not-run' : 'passed',
      pythonStarts: starts,
      defaultEnvCanary: realModel ? 'not-run' : 'passed',
      definitionDriftDenied: realModel ? 'not-run' : 'passed',
      rawOutputRedaction: realModel ? 'not-run' : 'passed',
      projectSecretScan: 'passed',
      realModel: realModel ? 'passed' : 'not-run',
    }
    evidence.status = 'passed'
    evidence.summary = summary
    console.log(JSON.stringify(summary))
  } catch (error) {
    evidence.status = 'failed'
    evidence.failure = error instanceof Error ? error.message : 'Unknown validation failure'
    throw error
  } finally {
    const output =
      process.env.DSH_DATA_ANALYSIS_VALIDATION_OUTPUT ?? '/tmp/dsh-credential-validation'
    await mkdir(output, { recursive: true })
    const evidencePath = path.join(output, `${path.basename(root)}.json`)
    const json = [secret, secondSecret].reduce(
      (text, value) => text.split(value).join('[REDACTED]'),
      JSON.stringify({ ...evidence, ...executionTrace() }, null, 2),
    )
    await writeFile(evidencePath, `${json}\n`)
    console.log(JSON.stringify({ evidence: evidencePath }))
    await service.close()
    await ctx.fiber.dispose()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(root, { recursive: true, force: true })
  }
}
