import { MarivoEnvironmentError } from '../../environment/errors.ts'
import type { MarivoCheckedRunner } from '../../environment/types.ts'
import { PRESENTATION_BUDGETS, PresentationContractError } from '../contracts/index.ts'
import { type FrameSnapshot, parseAnalysisSnapshot } from '../contracts/snapshot.ts'
import { PRESENTATION_EXECUTION_BUDGETS } from '../execution-policy.ts'
import { MARIVO_PRESENTATION_READ_PROGRAM } from './program.ts'

function invalidOutput(): never {
  throw new MarivoEnvironmentError(
    'subprocess-output-invalid',
    'Marivo presentation reader returned an invalid projection.',
  )
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidOutput()
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).sort().join(',') !== keys.sort().join(',')) invalidOutput()
}

/** Internal bridge: restores public Frame data without observe, revalidation or credential admission. */
export class MarivoPresentationProjection {
  readonly #runner: MarivoCheckedRunner

  constructor(runner: MarivoCheckedRunner) {
    this.#runner = runner
  }

  get status() {
    return this.#runner.status
  }

  get binding() {
    return this.#runner.binding
  }

  /** Initial bounded projections share one checked execution; cursors remain internal. */
  async readFrames(
    frames: { sessionId: string; artifactId: string; columns?: string[]; rowLimit?: number }[],
    signal?: AbortSignal,
  ): Promise<FrameSnapshot[]> {
    this.#assertReady(signal)
    const requests = structuredClone(frames)
    if (
      !requests.length ||
      requests.length > PRESENTATION_BUDGETS.datasets ||
      requests.some(
        (r) =>
          !r.sessionId ||
          !r.artifactId ||
          (r.rowLimit !== undefined &&
            (!Number.isInteger(r.rowLimit) ||
              r.rowLimit < 1 ||
              r.rowLimit > PRESENTATION_BUDGETS.rows)),
      )
    )
      throw new PresentationContractError(
        'invalid_reference',
        '/frames',
        'Expected bounded persisted Frame references.',
      )
    const result = await this.#runner.runChecked({
      program: MARIVO_PRESENTATION_READ_PROGRAM,
      args: [JSON.stringify({ frames: requests })],
      limits: {
        timeoutMs: PRESENTATION_EXECUTION_BUDGETS.sourceReadTimeoutMs,
        stdoutMaxBytes: PRESENTATION_BUDGETS.documentBytes,
        stderrMaxBytes: 65_536,
      },
      signal,
    })
    this.#assertReady(signal)
    if (result.exitCode !== 0)
      throw new MarivoEnvironmentError('subprocess-failed', 'The bound Frame snapshot read failed.')
    const payload = record(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(result.stdout)),
    )
    if (payload.ok === false) {
      const error = record(payload.error)
      throw new PresentationContractError(
        typeof error.code === 'string' ? error.code : 'projection_read_failed',
        '/frames',
        'The persisted Frame cannot be projected within the supported identity, type and range contract.',
      )
    }
    exactKeys(payload, ['ok', 'snapshots'])
    if (
      payload.ok !== true ||
      !Array.isArray(payload.snapshots) ||
      payload.snapshots.length !== requests.length
    )
      invalidOutput()
    return payload.snapshots.map((value, i) => {
      const snapshot = parseAnalysisSnapshot(value)
      const expected = requests[i]!
      if (
        snapshot.kind !== 'frame' ||
        snapshot.source.sessionId !== expected.sessionId ||
        snapshot.source.artifactId !== expected.artifactId ||
        snapshot.data.limit > (expected.rowLimit ?? PRESENTATION_BUDGETS.rows)
      )
        invalidOutput()
      if (expected.columns?.some((name) => !snapshot.data.columns.some((c) => c.id === name)))
        invalidOutput()
      if (
        expected.columns &&
        snapshot.frame.fields.some(
          (field) => field.role !== 'coordinate' && !expected.columns!.includes(field.id),
        )
      )
        invalidOutput()
      return snapshot
    })
  }

  #assertReady(signal?: AbortSignal) {
    signal?.throwIfAborted()
    if (this.#runner.status !== 'ready')
      throw new MarivoEnvironmentError(
        'binding-failed',
        'Presentation projection requires a ready bound Runtime.',
      )
    if (!this.binding.presentationKit)
      throw new MarivoEnvironmentError(
        'binding-identity-mismatch',
        'Presentation projection requires the checked presentation helper identity.',
      )
  }
}
