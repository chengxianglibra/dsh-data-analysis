import { MarivoEnvironmentError } from '../environment/errors.ts'
import type { MarivoBridgeSource } from '../environment/source.ts'
import { resolveMarivoBridgeSource } from '../environment/source.ts'
import type { MarivoCheckedRunner, MarivoEnvironmentBinding } from '../environment/types.ts'
import { MARIVO_REPORT_PROJECTION_PROGRAM } from './bridge-program.ts'
import { parseReportProjection, type ReportProjectionInspection } from './projection.ts'

const REPORT_LIMITS = Object.freeze({
  timeoutMs: 120_000,
  stdoutMaxBytes: 16 * 1024 * 1024 + 65_536,
  stderrMaxBytes: 65_536,
})

export interface MarivoReportBridgePort {
  readonly binding: Readonly<Pick<MarivoEnvironmentBinding, 'fingerprint' | 'marivoVersion'>>
  project(
    sessionId: string,
    artifactRefs: readonly string[],
    signal?: AbortSignal,
  ): Promise<ReportProjectionInspection>
}

export type MarivoReportBridgeSource = MarivoBridgeSource<MarivoReportBridgePort>

/** Identity-checked adapter for bounded Marivo Artifact and Session DAG projections. */
export class MarivoReportBridge {
  readonly binding: Readonly<MarivoEnvironmentBinding>
  readonly #runner: MarivoCheckedRunner

  constructor(runner: MarivoCheckedRunner) {
    this.#runner = runner
    this.binding = runner.binding
  }

  async project(
    sessionId: string,
    artifactRefs: readonly string[],
    signal?: AbortSignal,
  ): Promise<ReportProjectionInspection> {
    const result = await this.#runner.runChecked({
      program: MARIVO_REPORT_PROJECTION_PROGRAM,
      args: [sessionId, JSON.stringify(artifactRefs)],
      limits: REPORT_LIMITS,
      signal,
    })
    if (result.exitCode !== 0) {
      throw new MarivoEnvironmentError(
        'subprocess-failed',
        `Marivo report projection failed with exit code ${String(result.exitCode)}`,
        { exitCode: result.exitCode, stderr: result.stderr.toString('utf8').slice(0, 2_000) },
      )
    }
    try {
      return parseReportProjection(result.stdout, { sessionId, artifactRefs })
    } catch (cause) {
      throw new MarivoEnvironmentError(
        'subprocess-output-invalid',
        'Marivo report projection returned an invalid payload',
        { stdoutBytes: result.stdout.byteLength },
        { cause },
      )
    }
  }
}

export function resolveMarivoReportBridge(
  source: MarivoReportBridgeSource,
): Promise<MarivoReportBridgePort> {
  return resolveMarivoBridgeSource(source)
}
