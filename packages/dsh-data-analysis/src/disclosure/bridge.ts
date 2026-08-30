import { MarivoEnvironmentError } from '../environment/errors.ts'
import type { MarivoBridgeSource } from '../environment/source.ts'
import { resolveMarivoBridgeSource } from '../environment/source.ts'
import type { MarivoCheckedRunner, MarivoEnvironmentBinding } from '../environment/types.ts'
import { MARIVO_HELP_INVENTORY_PROGRAM, MARIVO_HELP_PROGRAM } from './bridge-program.ts'

export interface MarivoHelpBridgeLimits {
  timeoutMs: number
  stdoutMaxBytes: number
  stderrMaxBytes: number
}

export interface MarivoHelpBridgePort {
  readonly binding: Readonly<MarivoEnvironmentBinding>
  inventory(limits: Readonly<MarivoHelpBridgeLimits>, signal?: AbortSignal): Promise<Buffer>
  runTarget(
    target: string,
    limits: Readonly<MarivoHelpBridgeLimits>,
    signal?: AbortSignal,
  ): Promise<Buffer>
}

export type MarivoHelpBridgeSource = MarivoBridgeSource<MarivoHelpBridgePort>

export type MarivoHelpFailureCode =
  | 'invalid-request'
  | 'target-failed'
  | 'empty-help'
  | 'combined-output-limit'

export class MarivoHelpError extends Error {
  readonly code: MarivoHelpFailureCode
  readonly details: Readonly<Record<string, unknown>>

  constructor(
    code: MarivoHelpFailureCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'MarivoHelpError'
    this.code = code
    this.details = details
  }
}

function boundedStderr(stderr: Buffer): string {
  const text = stderr.toString('utf8').trim()
  return text.length === 0 ? 'no stderr was returned' : text.slice(0, 4_000)
}

/** Identity-checked adapter for the live Marivo Help surface. */
export class MarivoHelpBridge {
  readonly binding: Readonly<MarivoEnvironmentBinding>
  readonly #runner: MarivoCheckedRunner

  constructor(runner: MarivoCheckedRunner) {
    this.#runner = runner
    this.binding = runner.binding
  }

  async runTarget(
    target: string,
    limits: Readonly<MarivoHelpBridgeLimits>,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    return this.#run(
      MARIVO_HELP_PROGRAM,
      [target],
      limits,
      signal,
      `target ${JSON.stringify(target)}`,
    )
  }

  async inventory(limits: Readonly<MarivoHelpBridgeLimits>, signal?: AbortSignal): Promise<Buffer> {
    return this.#run(MARIVO_HELP_INVENTORY_PROGRAM, [], limits, signal, 'inventory')
  }

  async #run(
    program: string,
    args: readonly string[],
    limits: Readonly<MarivoHelpBridgeLimits>,
    signal: AbortSignal | undefined,
    subject: string,
  ): Promise<Buffer> {
    try {
      const result = await this.#runner.runChecked({
        program,
        args,
        limits,
        signal,
      })
      if (result.exitCode !== 0) {
        throw new MarivoHelpError(
          'target-failed',
          `marivo_help ${subject} failed with exit code ${String(result.exitCode)}: ${boundedStderr(result.stderr)}`,
          { subject, exitCode: result.exitCode },
        )
      }
      if (result.stdout.byteLength === 0) {
        throw new MarivoHelpError('empty-help', `marivo_help ${subject} returned empty stdout`, {
          subject,
        })
      }
      return result.stdout
    } catch (cause) {
      if (cause instanceof MarivoHelpError) throw cause
      if (
        cause instanceof MarivoEnvironmentError &&
        (cause.code === 'binding-identity-mismatch' || cause.code === 'binding-failed')
      )
        throw cause
      if (cause instanceof MarivoEnvironmentError) {
        throw new MarivoHelpError(
          'target-failed',
          `marivo_help ${subject} failed: ${cause.message}`,
          { subject, environmentFailureCode: cause.code },
          { cause },
        )
      }
      throw new MarivoHelpError(
        'target-failed',
        `marivo_help ${subject} failed`,
        { subject },
        { cause },
      )
    }
  }
}

export function resolveMarivoHelpBridge(
  source: MarivoHelpBridgeSource,
): Promise<MarivoHelpBridgePort> {
  return resolveMarivoBridgeSource(source)
}
