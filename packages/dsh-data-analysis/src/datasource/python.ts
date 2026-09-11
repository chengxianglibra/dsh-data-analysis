import { performance } from 'node:perf_hooks'
import process from 'node:process'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-shell'
import type {} from '@deepseek-ai/dsh-shell-env'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { type PythonCodeRef, savePythonExecution } from '../python-execution.ts'
import { registerMarivoTool } from '../tool-lifecycle.ts'
import { type MarivoDatasourceBridgeSource, resolveMarivoDatasourceBridge } from './bridge.ts'
import {
  type MarivoPythonOptionsSource,
  pythonTimeout,
  resolvePythonOptions,
} from './python-options.ts'
import { PYTHON_LAUNCHER, PYTHON_WORKER } from './resolver-program.ts'
import {
  CredentialServiceError,
  type MarivoCredentialService,
  type PreparedCredentialExecution,
} from './service.ts'
import { datasourceToolValue } from './test.ts'

export interface MarivoPythonExecutionSummary {
  phase: 'preparing' | 'executing' | 'capturing-code'
  reason: 'not-started' | 'succeeded' | 'nonzero-exit' | 'timed-out' | 'cancelled' | 'unknown'
  requestedTimeoutMs: number | null
  effectiveTimeoutMs: number | null
  elapsedMs: number
  executionElapsedMs: number | null
  nextAction: string | null
}

/** The message survives Harness error normalization; it contains only safe adapter facts. */
export class MarivoPythonExecutionError extends Error {
  readonly execution: MarivoPythonExecutionSummary
  constructor(message: string, execution: MarivoPythonExecutionSummary) {
    super(`${message}; execution=${JSON.stringify(execution)}`)
    this.name = 'MarivoPythonExecutionError'
    this.execution = execution
  }
}

const CHECK_EFFECTS =
  'Inspect existing effects and the intended Session through current Runtime Help before retrying; do not automatically replay. Saved results and remote query cancellation are not confirmed.'
const PREPARATION_CODES = new Set([
  'agent-required',
  'invalid-datasources',
  'call-ended',
  'context-changed',
  'credentials-changed',
  'execution-ended',
  'disposed',
])

function quote(value: string): string {
  return process.platform === 'win32'
    ? `'${value.replaceAll("'", "''")}'`
    : `'${value.replaceAll("'", "'\\''")}'`
}
export function registerMarivoPythonTool(
  ctx: Context,
  source: MarivoDatasourceBridgeSource,
  service: MarivoCredentialService,
  options: MarivoPythonOptionsSource = {},
): () => Promise<void> {
  const readOptions = typeof options === 'function' ? options : () => options
  resolvePythonOptions(readOptions())
  return registerMarivoTool(
    ctx,
    defineTool({
      name: 'marivo_python',
      description:
        'Execute foreground Python in the bound Runtime and Workspace, including local pandas and native DuckDB file analysis. This call waits for missing credentials for every listed Marivo datasource before starting Python once; configured credentials do not trigger a connection test. When using Marivo Sessions or readers, create/resume them inside this execution and close Sessions in finally. No background execution or secret environment variables. Nonzero exits are reported without replay. Successful execution saves the exact submitted code and returns codeRef; explicitly associate it with presentation datasets through draft codeRefs. A codeCaptureError does not change the execution outcome and must not trigger replay. The execution summary reports adapter phase, outcome and effective Shell budget, not query progress or saved Artifacts. Credential waiting precedes the Shell budget; outer Code Mode deadlines and cancellation still apply. Timeout does not confirm remote query cancellation or absence of saved results.',
      parameters: {
        code: {
          type: 'string',
          required: true,
          description:
            'Python code, never credential values. Close resources within this call. When using Marivo Session APIs, consult current Runtime Help and close Sessions in finally.',
        },
        datasources: {
          type: 'array',
          required: true,
          items: { type: 'string' },
          description:
            'All exact Marivo datasource names this execution may access through data or metadata connections, including inspection and datasources without passwords. Pass [] for local pandas or native DuckDB file analysis without Marivo datasource access. Catalog-only definition reads need no datasource connection.',
        },
        timeoutMs: {
          type: 'number',
          description:
            'Optional foreground Shell timeout in milliseconds, a positive integer at most 2147483647. When omitted, uses the current plugin pythonTimeoutMs setting. Harness Shell limits and outer Code Mode deadlines remain independent.',
        },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      async execute(args, exec) {
        const calledAt = performance.now()
        let phase: MarivoPythonExecutionSummary['phase'] = 'preparing'
        let requestedTimeoutMs: number | null = null
        let effectiveTimeoutMs: number | null = null
        let shellStartedAt: number | null = null
        let executionElapsedMs: number | null = null
        let prepared: PreparedCredentialExecution | undefined
        const summary = (
          reason: MarivoPythonExecutionSummary['reason'],
          nextAction: string | null,
        ): MarivoPythonExecutionSummary => {
          const now = performance.now()
          return {
            phase,
            reason,
            requestedTimeoutMs,
            effectiveTimeoutMs,
            elapsedMs: now - calledAt,
            executionElapsedMs:
              executionElapsedMs ?? (shellStartedAt === null ? null : now - shellStartedAt),
            nextAction,
          }
        }
        const rejectInput: (message: string) => never = (message) => {
          throw new MarivoPythonExecutionError(
            message,
            summary('not-started', 'Correct the input or Host configuration before retrying.'),
          )
        }
        try {
          try {
            requestedTimeoutMs = pythonTimeout(
              args.timeoutMs === undefined
                ? resolvePythonOptions(readOptions()).pythonTimeoutMs
                : args.timeoutMs,
              'timeoutMs',
            )
          } catch {
            rejectInput('timeoutMs must be a positive integer no greater than 2147483647')
          }
          const code = args.code
          if (typeof code !== 'string' || !code.trim() || Buffer.byteLength(code) > 131072)
            rejectInput('Invalid Python code size')
          const shell = ctx.get('shell')
          if (!shell) rejectInput('DSH Shell execution service is required')
          const shellEnv = ctx.get('shellEnv')
          if (!shellEnv) rejectInput('DSH Shell environment service is required')
          const policyService = ctx.get('sandboxPolicy')
          if (shell.sandboxMode !== undefined && !policyService)
            rejectInput('DSH sandbox policy is required')
          const admission = await service.track(
            service.prepareExecution(
              exec,
              () => resolveMarivoDatasourceBridge(source),
              args.datasources,
            ),
          )
          if (!('status' in admission) || admission.status !== 'ready')
            return {
              ...datasourceToolValue(admission),
              execution: summary(
                'not-started',
                'Resolve the datasource credential requirement or reported connection failure before retrying.',
              ),
            }
          prepared = admission
          const { binding } = prepared.bridge
          const policy = policyService?.resolve(exec.agent ? { session: exec.agent.session } : {})
          const spec = shell.resolve({
            command: `${process.platform === 'win32' ? '& ' : ''}${quote(binding.pythonExecutable)} -c ${quote(PYTHON_LAUNCHER)}`,
            workdir: binding.projectRoot,
            timeoutMs: requestedTimeoutMs!,
            signal: prepared.signal,
            stdin: JSON.stringify({
              identity: binding,
              project_root: binding.projectRoot,
              grants: prepared.grants,
              values: prepared.values,
              code,
              worker: PYTHON_WORKER,
            }),
            env: { MARIVO_PERSIST_CREDENTIALS: '0' },
            dshEnv: shellEnv.collect(exec),
            ...(policy ? { sandboxPolicy: policy } : {}),
          })
          effectiveTimeoutMs = spec.timeoutMs
          // Keep this guard adjacent to the only launch, after synchronous Host hooks.
          prepared.assertCurrent()
          const startedAt = new Date().toISOString()
          phase = 'executing'
          shellStartedAt = performance.now()
          const result = await service.track(shell.run(spec))
          executionElapsedMs = performance.now() - shellStartedAt
          const finishedAt = new Date().toISOString()
          const credentialValues = prepared.values
          // Defense at the result seam as well as before Harness collection/spill.
          const redact = (text: string) =>
            Object.values(credentialValues)
              .filter(Boolean)
              .sort((a, b) => b.length - a.length)
              .reduce((out, value) => out.split(value).join('[REDACTED]'), text)
          let codeRef: PythonCodeRef | undefined
          let codeCaptureError: string | undefined
          if (result.exitCode === 0 && !result.timedOut && !result.aborted) {
            phase = 'capturing-code'
            try {
              prepared.assertCurrent()
              if (Object.values(prepared.values).some((value) => value && code.includes(value)))
                throw new Error('Host credential in submitted code')
              codeRef = await service.track(
                savePythonExecution(
                  binding.projectRoot,
                  { text: code, startedAt, finishedAt },
                  prepared.signal,
                ),
              )
              prepared.assertCurrent()
            } catch {
              codeRef = undefined
              codeCaptureError =
                'Python completed successfully, but its source code could not be saved. Do not rerun the code to recover this snapshot; inspect its existing effects.'
            }
          }
          const reason: MarivoPythonExecutionSummary['reason'] = result.timedOut
            ? 'timed-out'
            : result.aborted
              ? 'cancelled'
              : result.exitCode === 0
                ? 'succeeded'
                : result.exitCode === null
                  ? 'unknown'
                  : 'nonzero-exit'
          return JSON.parse(
            JSON.stringify({
              exitCode: result.exitCode,
              timedOut: result.timedOut,
              aborted: result.aborted,
              stdout: redact(result.stdout.text),
              stderr: redact(result.stderr.text),
              truncated: result.stdout.truncated || result.stderr.truncated,
              sandbox: result.sandbox ?? null,
              ...(codeRef ? { codeRef } : {}),
              ...(codeCaptureError ? { codeCaptureError } : {}),
              execution: summary(
                reason,
                codeCaptureError ?? (reason === 'succeeded' ? null : CHECK_EFFECTS),
              ),
            }),
          )
        } catch (error) {
          if (error instanceof MarivoPythonExecutionError) throw error
          const cancelled = (prepared?.signal ?? exec.signal).aborted
          const reason = cancelled
            ? 'cancelled'
            : shellStartedAt === null
              ? 'not-started'
              : 'unknown'
          const code =
            error instanceof CredentialServiceError && PREPARATION_CODES.has(error.code)
              ? ` (${error.code})`
              : ''
          throw new MarivoPythonExecutionError(
            shellStartedAt === null
              ? `Marivo Python preparation failed or was cancelled; Python was not started${code}`
              : 'Marivo Python execution outcome is unknown after an execution service failure or cancellation',
            summary(
              reason,
              shellStartedAt === null
                ? 'Check credentials, Workspace binding and Host execution policy before retrying.'
                : CHECK_EFFECTS,
            ),
          )
        } finally {
          prepared?.release()
        }
      },
    }),
  )
}
