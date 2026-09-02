import { createHash } from 'node:crypto'
import { access, constants, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { admitDoctorReport, parseDoctorReport } from './doctor.ts'
import { MarivoEnvironmentError } from './errors.ts'
import { FixedSubprocessPolicy } from './subprocess.ts'
import type {
  DoctorReport,
  ImportIdentity,
  MarivoCheckedRunRequest,
  MarivoEnvironmentBinding,
  MarivoEnvironmentConfig,
  SharedMarivoRuntime,
  SubprocessLimits,
} from './types.ts'

const DOCTOR_LIMITS: Readonly<Partial<SubprocessLimits>> = Object.freeze({
  timeoutMs: 30_000,
  stdoutMaxBytes: 1_048_576,
  stderrMaxBytes: 65_536,
})

const IDENTITY_LIMITS: Readonly<Partial<SubprocessLimits>> = Object.freeze({
  timeoutMs: 10_000,
  stdoutMaxBytes: 16_384,
  stderrMaxBytes: 16_384,
})

const CHECKED_IDENTITY_PRELUDE = String.raw`
import json as _dsh_json
import os as _dsh_os
import sys as _dsh_sys
import marivo as _dsh_marivo

_dsh_actual = {
    "python_executable": _dsh_os.path.abspath(_dsh_sys.executable),
    "marivo_version": _dsh_marivo.__version__,
    "package_path": _dsh_os.path.abspath(_dsh_marivo.__file__ or ""),
}
_dsh_expected = {
    "python_executable": _dsh_os.path.abspath(_dsh_sys.argv[1]),
    "marivo_version": _dsh_sys.argv[2],
    "package_path": _dsh_os.path.abspath(_dsh_sys.argv[3]),
}
if _dsh_actual != _dsh_expected:
    print(_dsh_json.dumps({"kind": "identity-mismatch", "actual": _dsh_actual}), file=_dsh_sys.stderr)
    raise SystemExit(78)
_dsh_sys.argv = [_dsh_sys.argv[0], *_dsh_sys.argv[4:]]
`.trim()

const IMPORT_IDENTITY_PROGRAM = String.raw`
print(_dsh_json.dumps(_dsh_actual, sort_keys=True))
`.trim()

function redactSubprocessOutput(
  result: Awaited<ReturnType<FixedSubprocessPolicy['run']>>,
  environmentOverlay: Readonly<NodeJS.ProcessEnv> | undefined,
) {
  if (environmentOverlay === undefined) return result
  const secrets = Object.values(environmentOverlay).filter(
    (value): value is string => value !== undefined && value !== '',
  )
  const redactText = (source: string): string => {
    let text = source
    for (const secret of secrets) text = text.split(secret).join('[REDACTED]')
    return text
  }
  const redactJsonValue = (value: unknown): unknown => {
    if (typeof value === 'string') return redactText(value)
    if (Array.isArray(value)) return value.map(redactJsonValue)
    if (typeof value !== 'object' || value === null) return value
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactJsonValue(item)]),
    )
  }
  const redactStdout = (): Buffer => {
    const text = result.stdout.toString('utf8')
    try {
      return Buffer.from(JSON.stringify(redactJsonValue(JSON.parse(text))))
    } catch {
      return Buffer.from(redactText(text))
    }
  }
  return {
    ...result,
    stdout: redactStdout(),
    stderr: Buffer.from(redactText(result.stderr.toString('utf8'))),
  }
}

function normalizeAbsolute(value: string): string {
  return path.normalize(path.resolve(value))
}

async function assertProjectRoot(projectRoot: string): Promise<string> {
  const resolved = normalizeAbsolute(projectRoot)
  try {
    const info = await stat(resolved)
    if (!info.isDirectory()) throw new Error('not a directory')
    return await realpath(resolved)
  } catch (cause) {
    throw new MarivoEnvironmentError(
      'project-root-invalid',
      `Marivo project root is not an existing directory: ${resolved}`,
      { projectRoot: resolved },
      { cause },
    )
  }
}

async function assertExecutable(executable: string): Promise<void> {
  try {
    const info = await stat(executable)
    if (!info.isFile()) throw new Error('not a file')
    await access(executable, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
  } catch (cause) {
    throw new MarivoEnvironmentError(
      'python-unavailable',
      `Marivo Python executable is missing or not executable: ${executable}`,
      { pythonExecutable: executable },
      { cause },
    )
  }
}

async function resolvePythonExecutable(
  projectRoot: string,
  configured: string | undefined,
): Promise<string> {
  if (configured !== undefined && !path.isAbsolute(configured)) {
    throw new MarivoEnvironmentError(
      'python-path-relative',
      `Configured Marivo Python executable must be absolute: ${configured}`,
      { pythonExecutable: configured },
    )
  }
  const executable =
    configured === undefined
      ? path.join(
          projectRoot,
          process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python',
        )
      : path.normalize(configured)
  await assertExecutable(executable)
  return executable
}

function fingerprint(binding: Omit<MarivoEnvironmentBinding, 'fingerprint'>): string {
  const payload = [
    binding.projectRoot,
    binding.pythonExecutable,
    binding.marivoVersion,
    binding.packagePath,
    binding.subprocessPolicyId,
  ]
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

function parseImportIdentity(stdout: Buffer): ImportIdentity {
  try {
    const value = JSON.parse(stdout.toString('utf8')) as Record<string, unknown>
    if (
      typeof value.python_executable !== 'string' ||
      typeof value.marivo_version !== 'string' ||
      typeof value.package_path !== 'string'
    )
      throw new TypeError('identity fields must be strings')
    return {
      pythonExecutable: value.python_executable,
      marivoVersion: value.marivo_version,
      packagePath: value.package_path,
    }
  } catch (cause) {
    throw new MarivoEnvironmentError(
      'binding-identity-mismatch',
      'Marivo import identity probe returned an invalid payload; explicit rebind is required',
      { stdoutBytes: stdout.byteLength },
      { cause },
    )
  }
}

/** A ready binding and the single frozen subprocess policy that established it. */
export class MarivoEnvironment {
  readonly binding: Readonly<MarivoEnvironmentBinding>
  readonly subprocessPolicy: FixedSubprocessPolicy
  #failed = false

  constructor(binding: MarivoEnvironmentBinding, subprocessPolicy: FixedSubprocessPolicy) {
    this.binding = Object.freeze({ ...binding })
    this.subprocessPolicy = subprocessPolicy
  }

  get status(): 'ready' | 'failed' {
    return this.#failed ? 'failed' : 'ready'
  }

  /**
   * Execute one Python program after checking the bound import identity in the same process.
   * Identity mismatch permanently fails this binding; ordinary program failures do not.
   */
  async runChecked(request: MarivoCheckedRunRequest) {
    if (this.#failed) {
      throw new MarivoEnvironmentError(
        'binding-failed',
        'Marivo Environment Binding has failed; explicit rebind is required',
        { fingerprint: this.binding.fingerprint },
      )
    }
    if (request.program.trim() === '')
      throw new TypeError('checked Python program must not be empty')
    const rawResult = await this.subprocessPolicy.run({
      executable: this.binding.pythonExecutable,
      args: [
        '-c',
        `${CHECKED_IDENTITY_PRELUDE}\n${request.program}`,
        this.binding.pythonExecutable,
        this.binding.marivoVersion,
        this.binding.packagePath,
        ...(request.args ?? []),
      ],
      ...(request.environmentOverlay === undefined
        ? {}
        : { environmentOverlay: request.environmentOverlay }),
      ...(request.limits === undefined ? {} : { limits: request.limits }),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    const result = redactSubprocessOutput(rawResult, request.environmentOverlay)
    if (result.exitCode === 78) {
      this.#failed = true
      throw new MarivoEnvironmentError(
        'binding-identity-mismatch',
        'Marivo import identity changed; explicit rebind is required',
        {
          fingerprint: this.binding.fingerprint,
          exitCode: result.exitCode,
          stderr: result.stderr.toString('utf8').slice(0, 2_000),
        },
      )
    }
    return result
  }

  /** Recheck and return the exact bound import identity. */
  async assertImportIdentity(signal?: AbortSignal): Promise<ImportIdentity> {
    const result = await this.runChecked({
      program: IMPORT_IDENTITY_PROGRAM,
      limits: IDENTITY_LIMITS,
      signal,
    })
    if (result.exitCode !== 0) {
      this.#failed = true
      throw new MarivoEnvironmentError(
        'binding-identity-mismatch',
        'Marivo import identity changed; explicit rebind is required',
        {
          fingerprint: this.binding.fingerprint,
          exitCode: result.exitCode,
          stderr: result.stderr.toString('utf8').slice(0, 2_000),
        },
      )
    }
    try {
      const identity = parseImportIdentity(result.stdout)
      if (
        normalizeAbsolute(identity.pythonExecutable) !==
          normalizeAbsolute(this.binding.pythonExecutable) ||
        identity.marivoVersion !== this.binding.marivoVersion ||
        normalizeAbsolute(identity.packagePath) !== normalizeAbsolute(this.binding.packagePath)
      )
        throw new Error('identity values differ from binding')
      return identity
    } catch (cause) {
      this.#failed = true
      if (cause instanceof MarivoEnvironmentError) throw cause
      throw new MarivoEnvironmentError(
        'binding-identity-mismatch',
        'Marivo import identity changed; explicit rebind is required',
        { fingerprint: this.binding.fingerprint },
        { cause },
      )
    }
  }
}

/** Build an identity-checked Help runner directly from an admitted shared Runtime. */
export function createSharedMarivoRuntimeRunner(
  runtime: Pick<
    SharedMarivoRuntime,
    'runtimeRoot' | 'pythonExecutable' | 'marivoVersion' | 'packagePath'
  >,
  options: { environment?: NodeJS.ProcessEnv } = {},
): MarivoEnvironment {
  const subprocessPolicy = new FixedSubprocessPolicy(runtime.runtimeRoot, options.environment)
  const partialBinding = {
    projectRoot: runtime.runtimeRoot,
    pythonExecutable: runtime.pythonExecutable,
    marivoVersion: runtime.marivoVersion,
    packagePath: runtime.packagePath,
    subprocessPolicyId: subprocessPolicy.id,
  }
  return new MarivoEnvironment(
    { ...partialBinding, fingerprint: fingerprint(partialBinding) },
    subprocessPolicy,
  )
}

/** Resolve, probe, and establish one Marivo Environment Binding. */
export async function bindMarivoEnvironment(
  config: MarivoEnvironmentConfig,
  options: { environment?: NodeJS.ProcessEnv; signal?: AbortSignal } = {},
): Promise<MarivoEnvironment> {
  const projectRoot = await assertProjectRoot(config.projectRoot)
  const pythonExecutable = await resolvePythonExecutable(projectRoot, config.pythonExecutable)
  const subprocessPolicy = new FixedSubprocessPolicy(projectRoot, options.environment)
  const result = await subprocessPolicy.run({
    executable: pythonExecutable,
    args: ['-m', 'marivo', 'doctor', '--project-root', projectRoot, '--format', 'json'],
    // Admission is observational. Keep Marivo's default telemetry from creating
    // .marivo/telemetry merely because DSH resolved a Workspace binding.
    environmentOverlay: { MARIVO_TELEMETRY: 'off' },
    limits: DOCTOR_LIMITS,
    signal: options.signal,
  })
  let report: DoctorReport
  try {
    report = parseDoctorReport(result.stdout)
  } catch (cause) {
    if (cause instanceof MarivoEnvironmentError && cause.code === 'doctor-json-invalid') {
      throw new MarivoEnvironmentError(
        cause.code,
        cause.message,
        {
          ...cause.details,
          exitCode: result.exitCode,
          stderr: result.stderr.toString('utf8').slice(0, 2_000),
        },
        { cause },
      )
    }
    throw cause
  }
  admitDoctorReport(report, projectRoot, pythonExecutable)

  const partialBinding = {
    projectRoot,
    pythonExecutable,
    marivoVersion: report.marivo.version,
    packagePath: normalizeAbsolute(report.marivo.package_path),
    subprocessPolicyId: subprocessPolicy.id,
  }
  const binding: MarivoEnvironmentBinding = {
    ...partialBinding,
    fingerprint: fingerprint(partialBinding),
  }
  return new MarivoEnvironment(binding, subprocessPolicy)
}
