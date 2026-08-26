import { spawn } from 'node:child_process'
import process from 'node:process'
import { MarivoEnvironmentError } from './errors.ts'
import type { SubprocessLimits, SubprocessRequest, SubprocessResult } from './types.ts'

export const SUBPROCESS_POLICY_ID = 'direct-argv-inherited-env-snapshot-v1'

export const DEFAULT_SUBPROCESS_LIMITS: Readonly<SubprocessLimits> = Object.freeze({
  timeoutMs: 30_000,
  stdoutMaxBytes: 1_048_576,
  stderrMaxBytes: 65_536,
  terminateGraceMs: 250,
})

function snapshotEnvironment(source: NodeJS.ProcessEnv): Readonly<NodeJS.ProcessEnv> {
  return Object.freeze(Object.fromEntries(
    Object.entries(source).filter((entry): entry is [string, string] => entry[1] !== undefined),
  ))
}

function positiveLimit(name: keyof SubprocessLimits, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive safe integer`)
  }
  return value
}

function resolveLimits(overrides: Partial<SubprocessLimits> | undefined): SubprocessLimits {
  const merged = { ...DEFAULT_SUBPROCESS_LIMITS, ...overrides }
  return {
    timeoutMs: positiveLimit('timeoutMs', merged.timeoutMs),
    stdoutMaxBytes: positiveLimit('stdoutMaxBytes', merged.stdoutMaxBytes),
    stderrMaxBytes: positiveLimit('stderrMaxBytes', merged.stderrMaxBytes),
    terminateGraceMs: positiveLimit('terminateGraceMs', merged.terminateGraceMs),
  }
}

/**
 * Direct-argv subprocess runner shared by doctor, inventory, and focused help.
 *
 * The policy captures cwd and the environment projection once. Calls never use a shell. On
 * POSIX, detached children form a process group so timeout, cancellation, and output overflow
 * terminate the whole group.
 */
export class FixedSubprocessPolicy {
  readonly id = SUBPROCESS_POLICY_ID
  readonly cwd: string
  readonly #environment: Readonly<NodeJS.ProcessEnv>

  constructor(cwd: string, environment: NodeJS.ProcessEnv = process.env) {
    this.cwd = cwd
    this.#environment = snapshotEnvironment(environment)
  }

  run(request: SubprocessRequest): Promise<SubprocessResult> {
    const limits = resolveLimits(request.limits)
    const startedAt = performance.now()

    if (request.signal?.aborted) {
      return Promise.reject(new MarivoEnvironmentError(
        'subprocess-cancelled',
        'Marivo subprocess was cancelled before it started',
      ))
    }

    return new Promise((resolve, reject) => {
      const child = spawn(request.executable, request.args, {
        cwd: this.cwd,
        env: this.#environment,
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      let stdoutBytes = 0
      let stderrBytes = 0
      let settled = false
      let failure: MarivoEnvironmentError | undefined
      let killTimer: NodeJS.Timeout | undefined

      const killTree = (signal: NodeJS.Signals): void => {
        if (child.pid === undefined) return
        if (process.platform === 'win32') {
          const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
            cwd: this.cwd,
            env: this.#environment,
            shell: false,
            windowsHide: true,
            stdio: 'ignore',
          })
          killer.once('error', () => child.kill(signal))
          killer.unref()
          return
        }
        try {
          process.kill(-child.pid, signal)
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code
          if (code !== 'ESRCH') child.kill(signal)
        }
      }

      const terminate = (error: MarivoEnvironmentError): void => {
        if (failure !== undefined || settled) return
        failure = error
        killTree('SIGTERM')
        killTimer = setTimeout(() => killTree('SIGKILL'), limits.terminateGraceMs)
        killTimer.unref()
      }

      const timeout = setTimeout(() => terminate(new MarivoEnvironmentError(
        'subprocess-timeout',
        `Marivo subprocess exceeded ${limits.timeoutMs} ms`,
        { timeoutMs: limits.timeoutMs },
      )), limits.timeoutMs)
      timeout.unref()

      const onAbort = (): void => terminate(new MarivoEnvironmentError(
        'subprocess-cancelled',
        'Marivo subprocess was cancelled',
      ))
      request.signal?.addEventListener('abort', onAbort, { once: true })

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBytes += chunk.byteLength
        if (stdoutBytes > limits.stdoutMaxBytes) {
          terminate(new MarivoEnvironmentError(
            'subprocess-output-limit',
            `Marivo subprocess stdout exceeded ${limits.stdoutMaxBytes} bytes`,
            { stream: 'stdout', maxBytes: limits.stdoutMaxBytes, observedBytes: stdoutBytes },
          ))
          return
        }
        stdout.push(chunk)
      })

      child.stderr.on('data', (chunk: Buffer) => {
        stderrBytes += chunk.byteLength
        if (stderrBytes > limits.stderrMaxBytes) {
          terminate(new MarivoEnvironmentError(
            'subprocess-output-limit',
            `Marivo subprocess stderr exceeded ${limits.stderrMaxBytes} bytes`,
            { stream: 'stderr', maxBytes: limits.stderrMaxBytes, observedBytes: stderrBytes },
          ))
          return
        }
        stderr.push(chunk)
      })

      child.once('error', (cause: NodeJS.ErrnoException) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (killTimer !== undefined) clearTimeout(killTimer)
        request.signal?.removeEventListener('abort', onAbort)
        reject(new MarivoEnvironmentError(
          'subprocess-start-failed',
          `Could not start Marivo subprocess: ${cause.message}`,
          { executable: request.executable, errorCode: cause.code },
          { cause },
        ))
      })

      child.once('close', (exitCode, signal) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (killTimer !== undefined) clearTimeout(killTimer)
        request.signal?.removeEventListener('abort', onAbort)
        if (failure !== undefined) {
          reject(failure)
          return
        }
        resolve({
          exitCode,
          signal,
          stdout: Buffer.concat(stdout, stdoutBytes),
          stderr: Buffer.concat(stderr, stderrBytes),
          durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        })
      })
    })
  }
}
