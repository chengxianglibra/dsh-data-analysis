import { access, constants, realpath, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import process from 'node:process'
import { admitDoctorReport, boundedDoctorDiagnostics, parseDoctorReport } from './doctor.ts'
import { MarivoEnvironmentError } from './errors.ts'
import { FixedSubprocessPolicy } from './subprocess.ts'
import type {
  DoctorDiagnostic,
  ImportIdentity,
  MarivoEnvironmentBinding,
  MarivoEnvironmentConfig,
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

const IMPORT_IDENTITY_SCRIPT = String.raw`
import json
import os
import sys
import marivo

actual = {
    "python_executable": os.path.abspath(sys.executable),
    "marivo_version": marivo.__version__,
    "package_path": os.path.abspath(marivo.__file__ or ""),
}
expected = {
    "python_executable": os.path.abspath(sys.argv[1]),
    "marivo_version": sys.argv[2],
    "package_path": os.path.abspath(sys.argv[3]),
}
if actual != expected:
    print(json.dumps({"kind": "identity-mismatch", "actual": actual}), file=sys.stderr)
    raise SystemExit(78)
print(json.dumps(actual, sort_keys=True))
`.trim()

const CHECKED_HELP_SCRIPT = String.raw`
import json
import os
import sys
import marivo

actual = {
    "python_executable": os.path.abspath(sys.executable),
    "marivo_version": marivo.__version__,
    "package_path": os.path.abspath(marivo.__file__ or ""),
}
expected = {
    "python_executable": os.path.abspath(sys.argv[1]),
    "marivo_version": sys.argv[2],
    "package_path": os.path.abspath(sys.argv[3]),
}
if actual != expected:
    print(json.dumps({"kind": "identity-mismatch", "actual": actual}), file=sys.stderr)
    raise SystemExit(78)
marivo.help(sys.argv[4])
`.trim()

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
  const executable = configured === undefined
    ? path.join(projectRoot, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python')
    : path.normalize(configured)
  await assertExecutable(executable)
  return executable
}

function fingerprint(binding: Omit<MarivoEnvironmentBinding, 'fingerprint' | 'doctorOverallStatus'>): string {
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
      typeof value.python_executable !== 'string'
      || typeof value.marivo_version !== 'string'
      || typeof value.package_path !== 'string'
    ) throw new TypeError('identity fields must be strings')
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
  readonly diagnostics: readonly DoctorDiagnostic[]
  readonly subprocessPolicy: FixedSubprocessPolicy
  #failed = false

  constructor(
    binding: MarivoEnvironmentBinding,
    diagnostics: readonly DoctorDiagnostic[],
    subprocessPolicy: FixedSubprocessPolicy,
  ) {
    this.binding = Object.freeze({ ...binding })
    this.diagnostics = Object.freeze([...diagnostics])
    this.subprocessPolicy = subprocessPolicy
  }

  get status(): 'ready' | 'failed' {
    return this.#failed ? 'failed' : 'ready'
  }

  /**
   * Run the same-process assertion that future inventory/focused-help runners must execute before
   * rendering help. A mismatch permanently fails this binding.
   */
  async assertImportIdentity(signal?: AbortSignal): Promise<ImportIdentity> {
    if (this.#failed) {
      throw new MarivoEnvironmentError(
        'binding-failed',
        'Marivo Environment Binding has failed; explicit rebind is required',
        { fingerprint: this.binding.fingerprint },
      )
    }
    const result = await this.subprocessPolicy.run({
      executable: this.binding.pythonExecutable,
      args: [
        '-c',
        IMPORT_IDENTITY_SCRIPT,
        this.binding.pythonExecutable,
        this.binding.marivoVersion,
        this.binding.packagePath,
      ],
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
        normalizeAbsolute(identity.pythonExecutable) !== normalizeAbsolute(this.binding.pythonExecutable)
        || identity.marivoVersion !== this.binding.marivoVersion
        || normalizeAbsolute(identity.packagePath) !== normalizeAbsolute(this.binding.packagePath)
      ) throw new Error('identity values differ from binding')
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

  /**
   * Execute one real `marivo.help(target)` only after an in-process identity assertion. The
   * assertion and render share one Python process, removing a check/use race. Ordinary Marivo
   * target failures do not poison the binding; identity exit 78 does.
   */
  async runCheckedHelpTarget(
    target: string,
    limits: Partial<SubprocessLimits>,
    signal?: AbortSignal,
  ) {
    if (this.#failed) {
      throw new MarivoEnvironmentError(
        'binding-failed',
        'Marivo Environment Binding has failed; explicit rebind is required',
        { fingerprint: this.binding.fingerprint },
      )
    }
    const result = await this.subprocessPolicy.run({
      executable: this.binding.pythonExecutable,
      args: [
        '-c',
        CHECKED_HELP_SCRIPT,
        this.binding.pythonExecutable,
        this.binding.marivoVersion,
        this.binding.packagePath,
        target,
      ],
      limits,
      signal,
    })
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
    limits: DOCTOR_LIMITS,
    signal: options.signal,
  })
  let report
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
    doctorOverallStatus: report.status,
    fingerprint: fingerprint(partialBinding),
  }
  return new MarivoEnvironment(binding, boundedDoctorDiagnostics(report), subprocessPolicy)
}
