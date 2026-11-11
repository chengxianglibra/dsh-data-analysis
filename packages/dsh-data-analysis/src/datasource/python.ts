import { performance } from 'node:perf_hooks'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-shell'
import type {} from '@deepseek-ai/dsh-shell-env'
import { defineTool, type ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import { MarivoEnvironmentError } from '../environment/errors.ts'
import {
  MARIVO_PROJECT_INIT_PROGRAM,
  type ProjectPreparation,
} from '../environment/project-preparation.ts'
import { type PythonCodeRef, savePythonExecution } from '../python-execution.ts'
import {
  pythonResults,
  pythonResultVariables,
  readPythonResultOutput,
} from '../python-result-references.ts'
import { pythonResultsMeta } from '../python-results-context.ts'
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
  readonly code: string
  readonly phase: MarivoPythonExecutionSummary['phase']
  readonly recovery: string | null
  constructor(
    message: string,
    execution: MarivoPythonExecutionSummary,
    code = 'python-execution-failed',
  ) {
    super(
      `${message}; error=${JSON.stringify({ code, phase: execution.phase, recovery: execution.nextAction })}; execution=${JSON.stringify(execution)}`,
    )
    this.name = 'MarivoPythonExecutionError'
    this.execution = execution
    this.code = code
    this.phase = execution.phase
    this.recovery = execution.nextAction
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

const nullableNumber = { oneOf: [{ type: 'number' }, { type: 'null' }] } as const
const nullableInteger = { oneOf: [{ type: 'integer' }, { type: 'null' }] } as const
const nullableString = { oneOf: [{ type: 'string' }, { type: 'null' }] } as const
const executionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    phase: { type: 'string', enum: ['preparing', 'executing', 'capturing-code'], required: true },
    reason: {
      type: 'string',
      enum: ['not-started', 'succeeded', 'nonzero-exit', 'timed-out', 'cancelled', 'unknown'],
      required: true,
    },
    requestedTimeoutMs: { ...nullableInteger, required: true },
    effectiveTimeoutMs: { ...nullableInteger, required: true },
    elapsedMs: { type: 'number', required: true },
    executionElapsedMs: { ...nullableNumber, required: true },
    nextAction: { ...nullableString, required: true },
  },
} as const satisfies ValueSchemaSpec
const projectSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['created', 'already-ready'], required: true },
    projectRoot: { type: 'string', required: true },
  },
} as const satisfies ValueSchemaSpec
const commonOutput = {
  execution: { ...executionSchema, required: true },
  project: projectSchema,
} as const
const pythonOutputSchema = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        ...commonOutput,
        exitCode: { ...nullableInteger, required: true },
        timedOut: { type: 'boolean', required: true },
        aborted: { type: 'boolean', required: true },
        stdout: { type: 'string', required: true },
        stderr: { type: 'string', required: true },
        truncated: { type: 'boolean', required: true },
        sandbox: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                mode: { type: 'string', required: true },
                denied: { type: 'boolean', required: true },
                enforcement: { type: 'string' },
                runnerFailed: { type: 'boolean' },
              },
            },
            { type: 'null' },
          ],
          required: true,
          description: 'Host-owned Shell sandbox receipt.',
        },
        results: {
          type: 'object',
          additionalProperties: true,
          description:
            'Named fixed outputs. Each entry provides a complete resource, metadata and sourceStatus. Pass resource unchanged to the report writer. Outputs can be available even when the execution or other exports failed.',
        },
        resultCaptureError: {
          type: 'string',
          description:
            'One or more outputs could not be exported. Use any available results and inspect existing effects before retrying.',
        },
        codeCaptureError: {
          type: 'string',
          description:
            'Source recording failed independently of execution and reference export; valid results remain usable without codeRef.',
        },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        ...commonOutput,
        status: { type: 'string', const: 'needs-credentials', required: true },
        name: { type: 'string', required: true },
        refs: { type: 'array', items: { type: 'string' }, required: true },
        handoff: {
          type: 'object',
          additionalProperties: false,
          required: true,
          properties: {
            reason: {
              type: 'string',
              enum: ['parent-agent-required', 'web-interaction-disabled'],
              required: true,
            },
            nextAction: { type: 'string', required: true },
          },
        },
      },
    },
  ],
} as const satisfies ValueSchemaSpec

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
        'Run user code once in the bound Runtime and Workspace. Declare reusable outputs with resultVariables and pass results[name].resource unchanged to the report writer. Derived computations explicitly read fixed inputs. Use project=required for Marivo datasource access, project analysis or result exports; project=none defaults to ordinary files. Execution, result export and source recording have independent outcomes. Memory ends with the call; use returned resources to continue. Follow credential handoffs and keep secrets out of code and output.',
      parameters: {
        code: {
          type: 'string',
          required: true,
          description:
            'Python code, never credential values. Include explicit input reads and computation. Assign each declared output to a variable. Consult current Runtime Help for Session lifetime and persistence.',
        },
        datasources: {
          type: 'array',
          required: true,
          items: { type: 'string' },
          description:
            'All exact Marivo datasource names this execution may access through data or metadata connections, including inspection and datasources without passwords. Pass [] for local pandas or native DuckDB file analysis without Marivo datasource access. Catalog-only definition reads need no datasource connection.',
        },
        project: {
          type: 'string',
          enum: ['none', 'required'],
          description:
            'Project intent, default none. Use required for Marivo project analysis, persistence, nonempty datasources or resultVariables. The tool prepares the exact Workspace root through the bound Runtime CLI without force. none skips plugin project preparation and does not restrict arbitrary code behavior.',
        },
        timeoutMs: {
          type: 'number',
          description:
            'Optional foreground Shell timeout in milliseconds, a positive integer at most 2147483647. Defaults to the current plugin pythonTimeoutMs setting. Applied separately to project init when needed and to user code. Credential waiting precedes user execution; Harness Shell limits, outer Code Mode deadlines and cancellation remain independent.',
        },
        resultVariables: {
          type: 'object',
          additionalProperties: true,
          description:
            'Optional resource name -> Python variable name (up to 16, project=required). Assign a computed AnalysisFrame, pandas DataFrame or exact fixed reference. The plugin saves declared in-memory outputs and reuses fixed references. Call compute() explicitly for a pending Frame. Use results[name].resource to continue, including after partial failure.',
        },
      },
      output: {
        schema: pythonOutputSchema,
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
        presentationMeta: (_args, value) => pythonResultsMeta(value),
      },
      async execute(args, exec) {
        const calledAt = performance.now()
        let phase: MarivoPythonExecutionSummary['phase'] = 'preparing'
        let requestedTimeoutMs: number | null = null
        let effectiveTimeoutMs: number | null = null
        let shellStartedAt: number | null = null
        let executionElapsedMs: number | null = null
        let prepared: PreparedCredentialExecution | undefined
        let preparationSignal: AbortSignal | undefined
        let project: ProjectPreparation | undefined
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
            'python-input-invalid',
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
          const selected =
            args.resultVariables === undefined
              ? undefined
              : pythonResultVariables.safeParse(args.resultVariables)
          if (selected && !selected.success)
            rejectInput(
              'Invalid resultVariables; use 1-16 resource names mapped to Python variable identifiers',
            )
          const resultVariables = selected?.success ? selected.data : undefined
          if (args.project !== undefined && args.project !== 'none' && args.project !== 'required')
            rejectInput('project must be none or required')
          if (!Array.isArray(args.datasources)) rejectInput('datasources must be an array')
          if (args.project !== 'required' && (args.datasources.length > 0 || resultVariables))
            rejectInput('project=required is required for datasources or resultVariables')
          const shell = ctx.get('shell')
          if (!shell) rejectInput('DSH Shell execution service is required')
          const shellEnv = ctx.get('shellEnv')
          if (!shellEnv) rejectInput('DSH Shell environment service is required')
          const policyService = ctx.get('sandboxPolicy')
          if (shell.sandboxMode !== undefined && !policyService)
            rejectInput('DSH sandbox policy is required')
          if (args.project === 'required') {
            if (!exec.agent) rejectInput('An Agent is required')
            const agent = exec.agent!
            const session = agent.session
            const workspace = JSON.stringify([
              session.header.cwd,
              Reflect.get(session.header, 'workspaceId'),
            ])
            const signal = service.executionSignal(exec.signal, agent)
            preparationSignal = signal
            const bridge = await service.track(resolveMarivoDatasourceBridge(source))
            const fingerprint = bridge.binding.fingerprint
            const unchanged = () =>
              exec.agent?.session === session &&
              JSON.stringify([session.header.cwd, Reflect.get(session.header, 'workspaceId')]) ===
                workspace
            const assertCurrent = async () => {
              signal.throwIfAborted()
              if (!unchanged()) throw new CredentialServiceError('context-changed')
              const current = await resolveMarivoDatasourceBridge(source)
              signal.throwIfAborted()
              if (!unchanged() || current.binding.fingerprint !== fingerprint)
                throw new CredentialServiceError('context-changed')
            }
            await assertCurrent()
            if (!bridge.ensureProject)
              rejectInput('Bound Runtime project preparation is unavailable')
            project = await service.track(
              bridge.ensureProject!({
                signal,
                assertCurrent,
                initialize: async () => {
                  await assertCurrent()
                  const policy = policyService?.resolve({ session })
                  const spec = shell.resolve({
                    command: `${process.platform === 'win32' ? '& ' : ''}${quote(bridge.binding.pythonExecutable)} -c ${quote(MARIVO_PROJECT_INIT_PROGRAM)}`,
                    workdir: bridge.binding.projectRoot,
                    timeoutMs: requestedTimeoutMs!,
                    onExpiry: 'kill',
                    signal,
                    stdin: JSON.stringify(bridge.binding),
                    env: { MARIVO_PERSIST_CREDENTIALS: '0', MARIVO_TELEMETRY: 'off' },
                    dshEnv: shellEnv.collect(exec),
                    ...(policy ? { sandboxPolicy: policy } : {}),
                  })
                  await assertCurrent()
                  const execution = await service.track(shell.execute(spec))
                  const result = await service.track(execution.result())
                  if (result.exitCode !== 0 || result.timedOut || result.aborted)
                    throw new Error('Project initialization did not confirm success')
                },
              }),
            )
            await assertCurrent()
          }
          const admission = await service.track(
            service.prepareExecution(
              exec,
              () => resolveMarivoDatasourceBridge(source),
              args.datasources,
            ),
          )
          if (admission.status !== 'ready')
            return {
              ...admission,
              ...(project ? { project } : {}),
              execution: summary('not-started', admission.handoff.nextAction),
            }
          prepared = admission
          const { binding } = prepared.bridge
          const policy = policyService?.resolve(exec.agent ? { session: exec.agent.session } : {})
          const spec = shell.resolve({
            command: `${process.platform === 'win32' ? '& ' : ''}${quote(binding.pythonExecutable)} -c ${quote(PYTHON_LAUNCHER)}`,
            workdir: binding.projectRoot,
            timeoutMs: requestedTimeoutMs!,
            onExpiry: 'kill',
            signal: prepared.signal,
            stdin: JSON.stringify({
              identity: binding,
              project_root: binding.projectRoot,
              grants: prepared.grants,
              values: prepared.values,
              code,
              ...(resultVariables ? { result_variables: resultVariables } : {}),
              ...(resultVariables
                ? {
                    projection_root: fileURLToPath(
                      new URL('../../python/presentation/', import.meta.url),
                    ),
                  }
                : {}),
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
          const execution = await service.track(shell.execute(spec))
          const result = await service.track(execution.result())
          executionElapsedMs = performance.now() - shellStartedAt
          const finishedAt = new Date().toISOString()
          const exported = resultVariables
            ? readPythonResultOutput(
                result.stderr.text,
                resultVariables,
                Object.values(prepared.values),
              )
            : {
                stderr: result.stderr.text,
                resultRefs: undefined,
                resultCaptureError: undefined,
                resultMetadata: undefined,
              }
          const stderr = exported.stderr
          const succeeded = result.exitCode === 0 && !result.timedOut && !result.aborted
          const completed =
            result.exitCode !== null &&
            !result.timedOut &&
            !result.aborted &&
            !result.sandbox?.denied &&
            !result.sandbox?.runnerFailed
          const resultCaptureError = completed ? exported.resultCaptureError : undefined
          const credentialValues = prepared.values
          // Defense at the result seam as well as before Harness collection/spill.
          const redact = (text: string) =>
            Object.values(credentialValues)
              .filter(Boolean)
              .sort((a, b) => b.length - a.length)
              .reduce((out, value) => out.split(value).join('[REDACTED]'), text)
          // Execution-level declarations are Host-verified names/metadata, never DataFrame inference.
          const declaredDatasources = Object.values(prepared.grants)
            .map(({ name, backend }) => ({
              name,
              backend: typeof backend === 'string' && backend.trim() ? backend : null,
            }))
            .sort((left, right) => left.name.localeCompare(right.name))
          let codeRef: PythonCodeRef | undefined
          let codeCaptureError: string | undefined
          if (result.exitCode === 0 && !result.timedOut && !result.aborted) {
            phase = 'capturing-code'
            try {
              prepared.assertCurrent()
              if (Object.values(prepared.values).some((value) => value && code.includes(value)))
                throw new Error('Host credential in submitted code')
              const references = exported.resultRefs ? Object.values(exported.resultRefs) : []
              const session = exec.agent!.session
              codeRef = await service.track(
                savePythonExecution(
                  binding.projectRoot,
                  {
                    text: code,
                    startedAt,
                    finishedAt,
                    ...(declaredDatasources.length ? { datasources: declaredDatasources } : {}),
                    ...(references.length
                      ? {
                          results: {
                            sessionId: String(session.id),
                            callId: String(exec.callId),
                            rootCallId: String(exec.rootCallId ?? exec.callId),
                            variables: resultVariables!,
                            references,
                          },
                        }
                      : {}),
                  },
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
          if (completed && exported.resultRefs) prepared.assertCurrent()
          return JSON.parse(
            JSON.stringify({
              exitCode: result.exitCode,
              timedOut: result.timedOut,
              aborted: result.aborted,
              stdout: redact(result.stdout.text),
              stderr: redact(stderr),
              truncated: result.stdout.truncated || result.stderr.truncated,
              sandbox: result.sandbox ?? null,
              ...(project ? { project } : {}),
              ...(codeCaptureError ? { codeCaptureError } : {}),
              ...(exported.resultRefs && completed
                ? {
                    results: pythonResults(
                      exported.resultRefs,
                      exported.resultMetadata,
                      codeRef,
                      succeeded
                        ? codeCaptureError
                        : 'The execution failed after assigning this fixed output; no execution source was recorded.',
                    ),
                  }
                : {}),
              ...(resultCaptureError ? { resultCaptureError } : {}),
              execution: summary(
                reason,
                (!succeeded && exported.resultRefs && completed
                  ? 'Reuse the returned fixed outputs. Inspect the failed part before retrying.'
                  : undefined) ??
                  codeCaptureError ??
                  resultCaptureError ??
                  (reason === 'succeeded' ? null : CHECK_EFFECTS),
              ),
            }),
          )
        } catch (error) {
          if (error instanceof MarivoPythonExecutionError) throw error
          const cancelled = (prepared?.signal ?? preparationSignal ?? exec.signal).aborted
          const reason = cancelled
            ? 'cancelled'
            : shellStartedAt === null
              ? 'not-started'
              : 'unknown'
          const code =
            error instanceof MarivoEnvironmentError
              ? error.code
              : error instanceof CredentialServiceError && PREPARATION_CODES.has(error.code)
                ? error.code
                : shellStartedAt === null
                  ? 'python-preparation-failed'
                  : 'python-outcome-unknown'
          const projectRecovery =
            error instanceof MarivoEnvironmentError &&
            ['project-manifest-invalid', 'project-preparation-uncertain'].includes(error.code)
              ? error.code === 'project-preparation-uncertain'
                ? 'Project initialization outcome is uncertain. Inspect the Workspace and public Runtime doctor before retrying; do not automatically repeat init or delete files.'
                : 'Repair the exact Workspace root marivo.toml using the bound Runtime public contract; existing files were not overwritten.'
              : undefined
          throw new MarivoPythonExecutionError(
            shellStartedAt === null
              ? `Marivo Python preparation failed or was cancelled; user Python code was not started (${code})`
              : 'Marivo Python execution outcome is unknown after an execution service failure or cancellation',
            summary(
              reason,
              projectRecovery ??
                (shellStartedAt === null
                  ? 'Check credentials, Workspace binding and Host execution policy before retrying.'
                  : CHECK_EFFECTS),
            ),
            code,
          )
        } finally {
          prepared?.release()
        }
      },
    }),
  )
}
