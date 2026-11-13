import { realpath } from 'node:fs/promises'
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
import { type PythonException, PythonOperationError } from '../python-exception.ts'
import { type PythonCodeRef, savePythonExecution } from '../python-execution.ts'
import {
  pythonResults,
  pythonResultVariables,
  readPythonResultOutput,
} from '../python-result-references.ts'
import { pythonResultsMeta } from '../python-results-context.ts'
import { registerMarivoTool } from '../tool-lifecycle.ts'
import { PresentationWorkspaceUnavailable } from '../workspace-identity.ts'
import { type MarivoDatasourceBridgeSource, resolveMarivoDatasourceBridge } from './bridge.ts'
import {
  type MarivoPythonOptionsSource,
  pythonTimeout,
  resolvePythonOptions,
} from './python-options.ts'
import { PYTHON_LAUNCHER, PYTHON_WORKER } from './resolver-program.ts'
import {
  assertExecutionDatasources,
  CredentialServiceError,
  credentialRecovery,
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

/** Preserve execution facts and public Python diagnostics through Harness error normalization. */
export class MarivoPythonExecutionError extends Error {
  readonly execution: MarivoPythonExecutionSummary
  readonly code: string
  readonly phase: MarivoPythonExecutionSummary['phase']
  readonly recovery: string | null
  readonly exception?: PythonException
  readonly preparation?: { step: string; timeoutMs: number | null }
  constructor(
    message: string,
    execution: MarivoPythonExecutionSummary,
    code = 'python-execution-failed',
    exception?: PythonException,
    preparation?: { step: string; timeoutMs: number | null },
  ) {
    super(
      `${message}; error=${JSON.stringify({ code, phase: execution.phase, recovery: execution.nextAction, ...(exception ? { exception } : {}), ...(preparation ? { preparation } : {}) })}; execution=${JSON.stringify(execution)}`,
    )
    this.name = 'MarivoPythonExecutionError'
    this.execution = execution
    this.code = code
    this.phase = execution.phase
    this.recovery = execution.nextAction
    this.exception = exception
    this.preparation = preparation
  }
}

const CHECK_EFFECTS =
  'Inspect existing effects and the intended Session through current Runtime Help before retrying; do not automatically replay. Saved results and remote query cancellation are not confirmed.'

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
        exception: {
          type: 'object',
          additionalProperties: false,
          properties: {
            type: { type: 'string', required: true },
            message: { type: 'string', required: true },
            code: { oneOf: [{ type: 'string' }, { type: 'number' }] },
            kind: { type: 'string' },
            expected: { type: 'string' },
            received: { type: 'string' },
            location: {
              oneOf: [{ type: 'string' }, { type: 'object', additionalProperties: true }],
            },
            repair: {
              oneOf: [
                {
                  type: 'object',
                  properties: { action: { type: 'string', required: true } },
                  additionalProperties: true,
                },
                { type: 'null' },
              ],
              required: true,
            },
          },
          description: 'Python exception and its upstream repair, when available.',
        },
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
            'Named fixed outputs with resource, metadata and sourceStatus. Reuse successful outputs, including partial results. Use metadata.viewCandidates for exact field names. When missing, use marivo_report_read with resource.ref and a candidateGroup.',
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
  outputWorkspace?: () => { path: string },
): () => Promise<void> {
  const readOptions = typeof options === 'function' ? options : () => options
  resolvePythonOptions(readOptions())
  return registerMarivoTool(
    ctx,
    defineTool({
      name: 'marivo_python',
      description:
        'Run Python once in the bound Runtime. Use resultVariables to preserve outputs and pass results[name].resource unchanged to the report writer. Explicitly read fixed inputs in later calls. Check execution, export and credential outcomes separately.',
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
            'Declare every exact Marivo datasource name this execution may access through data or metadata connections, including inspection and datasources without passwords. Use the configured name without the datasource: prefix used in Catalog IDs. For a Catalog ID of datasource:warehouse, pass ["warehouse"]. Pass [] for local pandas or native DuckDB file analysis without Marivo datasource access. Catalog-only definition reads need no datasource connection.',
        },
        project: {
          type: 'string',
          enum: ['none', 'required'],
          description:
            'Project intent. When omitted, nonempty datasources or resultVariables imply required; otherwise defaults to none. Use required for other Marivo project analysis or persistence. required prepares the exact Workspace root through the bound Runtime CLI without force, initializing a missing project. none skips plugin project preparation, conflicts with nonempty datasources or resultVariables, and does not restrict arbitrary code behavior.',
        },
        timeoutMs: {
          type: 'number',
          description:
            'Optional foreground Shell timeout in milliseconds, a positive integer at most 2147483647. Defaults to the current plugin pythonTimeoutMs setting. Applied separately to project init when needed and to user code. Internal preparation subprocesses use independent timeouts. Credential waiting precedes user execution; Harness Shell limits, outer Code Mode deadlines and cancellation remain independent.',
        },
        resultVariables: {
          type: 'object',
          additionalProperties: true,
          description:
            'Optional resource name -> Python variable name (up to 16). Requires project=required, inferred when project is omitted. Assign a computed AnalysisFrame, pandas DataFrame or exact fixed reference. Preserve AnalysisFrame outputs for AnalysisFrameView instead of converting them just for display. The plugin saves declared in-memory outputs and reuses fixed references. Call compute() explicitly for a pending Frame. Use results[name].resource to continue, including after partial failure.',
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
        let preparationStep = 'workspace-binding'
        const resolveBinding = async () => {
          try {
            return await resolveMarivoDatasourceBridge(source)
          } catch (error) {
            if (error instanceof MarivoEnvironmentError && error.code === 'subprocess-timeout')
              throw new MarivoEnvironmentError(
                error.code,
                error.message,
                {
                  ...error.details,
                  preparationStep: 'workspace-binding',
                },
                { cause: error },
              )
            throw error
          }
        }
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
        const rejectInput: (message: string, recovery?: string) => never = (message, recovery) => {
          throw new MarivoPythonExecutionError(
            message,
            summary(
              'not-started',
              recovery ?? 'Correct the input or Host configuration before retrying.',
            ),
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
          assertExecutionDatasources(args.datasources)
          const needsProject = args.datasources.length > 0 || !!resultVariables
          if (args.project === 'none' && needsProject)
            rejectInput(
              `project="none" conflicts with ${args.datasources.length > 0 && resultVariables ? 'nonempty datasources and resultVariables' : args.datasources.length > 0 ? 'nonempty datasources' : 'resultVariables'}`,
              'Omit project or set project="required" before retrying; no user code has run.',
            )
          const effectiveProject = args.project ?? (needsProject ? 'required' : 'none')
          const shell = ctx.get('shell')
          if (!shell) rejectInput('DSH Shell execution service is required')
          const shellEnv = ctx.get('shellEnv')
          if (!shellEnv) rejectInput('DSH Shell environment service is required')
          const policyService = ctx.get('sandboxPolicy')
          if (shell.sandboxMode !== undefined && !policyService)
            rejectInput('DSH sandbox policy is required')
          if (effectiveProject === 'required') {
            if (!exec.agent) rejectInput('An Agent is required')
            const agent = exec.agent!
            const session = agent.session
            const workspace = JSON.stringify([
              session.header.cwd,
              Reflect.get(session.header, 'workspaceId'),
            ])
            const signal = service.executionSignal(exec.signal, agent)
            preparationSignal = signal
            const bridge = await service.track(resolveBinding())
            if (
              resultVariables &&
              outputWorkspace &&
              bridge.binding.projectRoot !== (await realpath(outputWorkspace().path))
            )
              rejectInput(
                'The configured Marivo project differs from the Session Workspace.',
                'Open the Marivo project as a Harness Workspace before exporting view resources, or have the operator align projectRoot with this Workspace.',
              )
            const fingerprint = bridge.binding.fingerprint
            const unchanged = () =>
              exec.agent?.session === session &&
              JSON.stringify([session.header.cwd, Reflect.get(session.header, 'workspaceId')]) ===
                workspace
            const assertCurrent = async () => {
              signal.throwIfAborted()
              if (!unchanged()) throw new CredentialServiceError('context-changed')
              const current = await resolveBinding()
              signal.throwIfAborted()
              if (!unchanged() || current.binding.fingerprint !== fingerprint)
                throw new CredentialServiceError('context-changed')
            }
            await assertCurrent()
            if (!bridge.ensureProject)
              rejectInput('Bound Runtime project preparation is unavailable')
            preparationStep = 'project-preparation'
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
          preparationStep = 'credential-admission'
          const admission = await service.track(
            service.prepareExecution(exec, resolveBinding, args.datasources),
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
          const exported = readPythonResultOutput(
            result.stderr.text,
            resultVariables ?? {},
            Object.values(prepared.values),
          )
          const stderr = exported.stderr
          const succeeded = result.exitCode === 0 && !result.timedOut && !result.aborted
          const completed =
            result.exitCode !== null &&
            !result.timedOut &&
            !result.aborted &&
            !result.sandbox?.denied &&
            !result.sandbox?.runnerFailed
          const resultCaptureError =
            completed && resultVariables ? exported.resultCaptureError : undefined
          const exception = completed && !succeeded ? exported.error : undefined
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
              ...(exception ? { exception } : {}),
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
                  exception?.repair?.action ??
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
            error instanceof PresentationWorkspaceUnavailable
              ? 'presentation-workspace-unavailable'
              : error instanceof MarivoEnvironmentError
                ? error.code
                : error instanceof CredentialServiceError
                  ? error.code
                  : shellStartedAt === null
                    ? 'python-preparation-failed'
                    : 'python-outcome-unknown'
          const projectRecovery =
            error instanceof MarivoEnvironmentError &&
            ['project-manifest-invalid', 'project-preparation-uncertain'].includes(error.code)
              ? error.code === 'project-preparation-uncertain'
                ? 'Project initialization outcome is uncertain. Inspect the Workspace manifest (marivo.toml) and the Host Runtime diagnostic before retrying.'
                : 'Repair the exact Workspace root marivo.toml using the bound Runtime public contract; existing files were not overwritten.'
              : undefined
          const exception =
            !cancelled && error instanceof PythonOperationError ? error.diagnostic : undefined
          const preparation =
            !cancelled &&
            shellStartedAt === null &&
            error instanceof MarivoEnvironmentError &&
            error.code === 'subprocess-timeout'
              ? {
                  step:
                    error.details.preparationStep === 'datasource-describe' ||
                    error.details.preparationStep === 'workspace-binding'
                      ? error.details.preparationStep
                      : preparationStep,
                  timeoutMs:
                    typeof error.details.timeoutMs === 'number' &&
                    Number.isSafeInteger(error.details.timeoutMs) &&
                    error.details.timeoutMs > 0
                      ? error.details.timeoutMs
                      : null,
                }
              : undefined
          throw new MarivoPythonExecutionError(
            shellStartedAt === null
              ? `Marivo Python preparation failed or was cancelled; user Python code was not started (${code})`
              : 'Marivo Python execution outcome is unknown after an execution service failure or cancellation',
            summary(
              reason,
              (preparation
                ? 'Inspect the timed-out preparation step and wait for the underlying condition to clear before retrying. timeoutMs does not change the internal preparation subprocess timeout.'
                : undefined) ??
                projectRecovery ??
                exception?.repair?.action ??
                (shellStartedAt === null
                  ? (credentialRecovery(code) ??
                    (code === 'presentation-workspace-unavailable' ||
                    code.startsWith('binding-') ||
                    code.startsWith('project-root-')
                      ? 'Open the correct Workspace and repair its bound Runtime or project configuration before retrying.'
                      : null))
                  : null) ??
                (shellStartedAt === null
                  ? 'Check credentials, Workspace binding and Host execution policy before retrying.'
                  : CHECK_EFFECTS),
            ),
            code,
            exception,
            preparation,
          )
        } finally {
          prepared?.release()
        }
      },
    }),
  )
}
