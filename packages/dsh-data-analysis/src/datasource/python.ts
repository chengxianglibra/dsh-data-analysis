import process from 'node:process'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-shell'
import type {} from '@deepseek-ai/dsh-shell-env'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { type MarivoDatasourceBridgeSource, resolveMarivoDatasourceBridge } from './bridge.ts'
import { PYTHON_LAUNCHER, PYTHON_WORKER } from './resolver-program.ts'
import type { MarivoCredentialService } from './service.ts'
import { datasourceToolValue } from './test.ts'

function quote(value: string): string {
  return process.platform === 'win32'
    ? `'${value.replaceAll("'", "''")}'`
    : `'${value.replaceAll("'", "'\\''")}'`
}
export function registerMarivoPythonTool(
  ctx: Context,
  source: MarivoDatasourceBridgeSource,
  service: MarivoCredentialService,
): () => void {
  return ctx.tools.register(
    defineTool({
      name: 'marivo_python',
      description:
        'Execute foreground Python in the bound Marivo Workspace using Host-injected credentials. This call waits for missing credentials for every listed datasource before starting Python once; configured credentials do not trigger a connection test. Create/resume Sessions and readers inside this execution; close Sessions in finally. No background execution or secret environment variables. Nonzero exits are reported without replay.',
      parameters: {
        code: {
          type: 'string',
          required: true,
          description:
            'Python code, never credential values. Use try/finally for per-call Session resource cleanup; consult current Runtime Help for Session APIs.',
        },
        datasources: {
          type: 'array',
          required: true,
          items: { type: 'string' },
          description:
            'All exact datasource names this execution may access through data or metadata connections, including inspection and datasources without passwords; pass [] only when no datasource will be accessed. Catalog-only definition reads need no datasource connection.',
        },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      async execute(args, exec) {
        if (!args.code.trim() || Buffer.byteLength(args.code) > 131072)
          throw new Error('Invalid Python code size')
        const shell = ctx.get('shell')
        if (!shell) throw new Error('DSH Shell execution service is required')
        const shellEnv = ctx.get('shellEnv')
        if (!shellEnv) throw new Error('DSH Shell environment service is required')
        const policyService = ctx.get('sandboxPolicy')
        if (shell.sandboxMode !== undefined && !policyService)
          throw new Error('DSH sandbox policy is required')
        const prepared = await service.track(
          service.prepareExecution(
            exec,
            () => resolveMarivoDatasourceBridge(source),
            args.datasources,
          ),
        )
        if (!('status' in prepared) || prepared.status !== 'ready')
          return datasourceToolValue(prepared)
        try {
          const { binding } = prepared.bridge
          const policy = policyService?.resolve(exec.agent ? { session: exec.agent.session } : {})
          const spec = shell.resolve({
            command: `${process.platform === 'win32' ? '& ' : ''}${quote(binding.pythonExecutable)} -c ${quote(PYTHON_LAUNCHER)}`,
            workdir: binding.projectRoot,
            timeoutMs: 120_000,
            signal: prepared.signal,
            stdin: JSON.stringify({
              identity: binding,
              project_root: binding.projectRoot,
              grants: prepared.grants,
              values: prepared.values,
              code: args.code,
              worker: PYTHON_WORKER,
            }),
            env: { MARIVO_PERSIST_CREDENTIALS: '0' },
            dshEnv: shellEnv.collect(exec),
            ...(policy ? { sandboxPolicy: policy } : {}),
          })
          // Keep this guard adjacent to the only launch, after synchronous Host hooks.
          prepared.assertCurrent()
          const result = await service.track(shell.run(spec))
          // Defense at the result seam as well as before Harness collection/spill.
          const redact = (text: string) =>
            Object.values(prepared.values)
              .filter(Boolean)
              .sort((a, b) => b.length - a.length)
              .reduce((out, value) => out.split(value).join('[REDACTED]'), text)
          return JSON.parse(
            JSON.stringify({
              exitCode: result.exitCode,
              timedOut: result.timedOut,
              aborted: result.aborted,
              stdout: redact(result.stdout.text),
              stderr: redact(result.stderr.text),
              truncated: result.stdout.truncated || result.stderr.truncated,
              sandbox: result.sandbox ?? null,
            }),
          )
        } catch {
          throw new Error(
            'Marivo Python execution failed or was cancelled; inspect the execution policy and retry only after checking effects',
          )
        } finally {
          prepared.release()
        }
      },
    }),
  )
}
