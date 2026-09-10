/** Real model -> configuration wait -> real query, using a temporary database and no datasource secrets. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import BashLocal from '@deepseek-ai/dsh-bash-local'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import * as DeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { MarivoDatasourceBridge } from '../src/datasource/bridge.ts'
import { registerMarivoDatasourceConfigureTool } from '../src/datasource/configure.ts'
import { registerMarivoPythonTool } from '../src/datasource/python.ts'
import { MarivoCredentialService } from '../src/datasource/service.ts'
import { MARIVO_DATASOURCE_CREDENTIAL_PROMPT } from '../src/disclosure/execution-guidance.ts'
import { bindMarivoEnvironment } from '../src/environment/index.ts'
import { Store } from '../tests/datasource-credentials/fixtures.ts'
import { TestShellEnv } from '../tests/test-shell-env.ts'

const python = process.env.DSH_DATA_ANALYSIS_PYTHON
if (!python) throw new Error('DSH_DATA_ANALYSIS_PYTHON required')
const root = await mkdtemp(path.join(tmpdir(), 'dsh-config-model-'))
const ctx = new Context(),
  service = new MarivoCredentialService(new Store(), 'web')
try {
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(TestShellEnv)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 })
  await ctx.plugin(SubprocessLocal)
  await ctx.plugin(BashLocal, { timeoutMs: 120000, maxOutputBytes: 65536 })
  await ctx.plugin(LocalCredentialProvider, { watch: false })
  if (!(await ctx.credentials.describe(credentialRef('DEEPSEEK_API_KEY')))?.configured) {
    process.stdout.write(
      JSON.stringify({ status: 'blocked', reason: 'DSH model credential unavailable' }) + '\n',
    )
  } else {
    await ctx.plugin(DeepSeek, { thinking: 'disabled' })
    const runner = await bindMarivoEnvironment({ projectRoot: root, pythonExecutable: python })
    const bridge = new MarivoDatasourceBridge(runner)
    const db = path.join(root, 'orders.duckdb')
    const seed = await runner.runChecked({
      program: `import duckdb
connection=duckdb.connect(${JSON.stringify(db)})
connection.execute("CREATE TABLE orders(amount INTEGER)")
connection.execute("INSERT INTO orders VALUES (10),(20)")
connection.close()
`,
      limits: { timeoutMs: 30000, stdoutMaxBytes: 65536, stderrMaxBytes: 65536 },
    })
    assert.equal(seed.exitCode, 0)
    const agent = await ctx.agentLoop.create(
      SessionId(`config-model-${Date.now()}`),
      {
        provider: 'deepseek-official',
        model: process.env.DSH_DATA_ANALYSIS_VALIDATION_MODEL ?? 'deepseek-v4-flash',
        maxTokens: 2048,
      },
      { cwd: root },
    )
    registerMarivoDatasourceConfigureTool(agent.ctx, bridge, service)
    registerMarivoPythonTool(agent.ctx, bridge, service)
    agent.ctx.systemPrompt.section({
      name: 'configuration-validation',
      order: 100,
      text: `${MARIVO_DATASOURCE_CREDENTIAL_PROMPT}\nPublic API examples: import marivo.datasource as md; md.list().ids() discovers registered datasource names; with md.connect(name) as backend: print(backend.raw_sql("SELECT SUM(amount) FROM orders").fetchall()). Use only read-only analysis queries.`,
    })
    const results: { name: string; isError: boolean; value?: unknown }[] = []
    ctx.on('tools/result', (exec, result) => {
      results.push({ name: exec.name, ...result })
    })
    const deadline = setTimeout(() => agent.cancel({ kind: 'user' }, { keepInbox: true }), 180000)
    try {
      agent.followup(
        createUserMessage({
          source: { kind: 'user' },
          content: [
            {
              type: 'text',
              text: '请分析 orders 表的 amount 总和。当前 Workspace 尚未配置数据源，需要我在页面中填写连接信息，完成后请继续查询并给出结果。',
            },
          ],
        }),
      )
      let cursor: string | undefined
      const signal = AbortSignal.timeout(180000)
      for (;;) {
        const snapshot = await service.waitWatch(agent.session.id, cursor, signal)
        cursor = snapshot.cursor
        const request = snapshot.configurationRequests.find((r) => r.endedAt === undefined)
        if (!request) continue
        assert.equal(request.configuration.mode, 'create')
        assert.deepEqual(await bridge.inventory(), [])
        await service.createDatasource(
          service.generation,
          bridge.binding.fingerprint,
          { backend: 'duckdb', fields: { name: 'orders_source', path: db, read_only: true } },
          async () => bridge,
          signal,
        )
        const selected = await service.selectConfiguration(
          request.id,
          'workspace',
          'orders_source',
          async () => bridge,
          signal,
        )
        service.start({
          generation: service.generation,
          id: randomUUID(),
          scope: selected.context!.token,
          version: selected.context!.version,
          action: 'submit',
          requestId: request.id,
        })
        break
      }
      await agent.whenIdle()
      assert.ok(
        results.some(
          (r) =>
            r.name === 'marivo_datasource_configure' &&
            !r.isError &&
            (r.value as any)?.status === 'ok',
        ),
      )
      assert.ok(
        results.some(
          (r) =>
            r.name === 'marivo_python' &&
            !r.isError &&
            /\b30\b/.test(String((r.value as { stdout?: string })?.stdout ?? '')),
        ),
      )
      process.stdout.write(
        JSON.stringify({
          passed: true,
          model: process.env.DSH_DATA_ANALYSIS_VALIDATION_MODEL ?? 'deepseek-v4-flash',
          configured: true,
          verifiedQuerySum: 30,
          tools: results.map((r) => ({ name: r.name, isError: r.isError })),
        }) + '\n',
      )
    } finally {
      clearTimeout(deadline)
    }
  }
} finally {
  await service.close()
  await ctx.fiber.dispose()
  await rm(root, { recursive: true, force: true })
}
