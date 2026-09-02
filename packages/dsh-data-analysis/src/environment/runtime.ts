import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  access,
  chmod,
  cp,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { MARIVO_PACKAGE_SPEC, MARIVO_VERSION } from '../compatibility.ts'
import { MarivoEnvironmentError } from './errors.ts'
import { FixedSubprocessPolicy } from './subprocess.ts'
import type { SharedMarivoRuntime, SharedMarivoRuntimeConfig, SubprocessResult } from './types.ts'

export const SHARED_PYTHON_SPEC = '3.10'
const PINNED_MARIVO_VERSION = MARIVO_VERSION
export const SHARED_MARIVO_PACKAGE_SPEC = MARIVO_PACKAGE_SPEC
export const REPORT_KIT_DISTRIBUTION = 'dsh-data-analysis-report-kit'
export const REPORT_KIT_VERSION = '2.1.0'
export const REPORT_KIT_PANDAS_RANGE = '>=2.2.0,<3.0.0'
export const REPORT_KIT_WHEEL_FILENAME = 'dsh_data_analysis_report_kit-2.1.0-py3-none-any.whl'
export const DEFAULT_SHARED_RUNTIME_INSTALL_TIMEOUT_MS = 600_000

const INSTALLATION_SCHEMA = 'dsh-data-analysis-runtime/v2' as const
const INSTALLATION_FILENAME = 'installation.json'
const SKILL_NAMES = ['marivo-analysis', 'marivo-semantic'] as const
const PROBE_SCRIPT = String.raw`
import json
import os
import sys
import marivo
import pandas
import dsh_data_analysis_report
from packaging.specifiers import SpecifierSet
from packaging.version import Version

print(json.dumps({
    "python_executable": os.path.abspath(sys.executable),
    "marivo_version": marivo.__version__,
    "package_path": os.path.abspath(marivo.__file__ or ""),
    "pandas_version": pandas.__version__,
    "pandas_supported": Version(pandas.__version__) in SpecifierSet(">=2.2.0,<3.0.0"),
    "report_kit_version": dsh_data_analysis_report.__version__,
    "report_kit_package_path": os.path.abspath(dsh_data_analysis_report.__file__ or ""),
    "report_kit_public_imports": all(callable(value) for value in (
        dsh_data_analysis_report.emit_computed,
        dsh_data_analysis_report.emit_dataset,
        dsh_data_analysis_report.emit_session_trace,
    )),
}, sort_keys=True))
`.trim()
const PYTHON_VERSION_SCRIPT = String.raw`
import json
import os
import sys

print(json.dumps({
    "python_executable": os.path.abspath(sys.executable),
    "version": list(sys.version_info[:3]),
    "prefix": os.path.abspath(sys.prefix),
}, sort_keys=True))
`.trim()

interface RuntimeProbe {
  python_executable: string
  marivo_version: string
  package_path: string
  pandas_version: string
  pandas_supported: boolean
  report_kit_version: string
  report_kit_package_path: string
  report_kit_public_imports: boolean
}

interface InstallationRecord {
  schema: typeof INSTALLATION_SCHEMA
  marivoVersion: string
  pythonExecutable: string
  packagePath: string
  reportKitVersion: string
  reportKitPackagePath: string
  skillsRoot: string
}

interface RuntimeInstallOptions {
  environment?: NodeJS.ProcessEnv
  waitIntervalMs?: number
  /** Test/build seam; production always resolves the wheel distributed beside the plugin. */
  reportKitWheelPath?: string
}

interface AdministratorRepair {
  message: string
  commands: readonly {
    executable: string
    args: readonly string[]
  }[]
}

function administratorRepair(executable: string, reportKitWheel: string): AdministratorRepair {
  const dependencies = [SHARED_MARIVO_PACKAGE_SPEC, `pandas${REPORT_KIT_PANDAS_RANGE}`]
  const commands = [
    {
      executable,
      args: ['-m', 'pip', 'install', '--upgrade', ...dependencies],
    },
    {
      executable,
      args: ['-m', 'pip', 'install', '--no-deps', reportKitWheel],
    },
  ] as const
  const commandText = (command: (typeof commands)[number]): string =>
    [command.executable, ...command.args].map((value) => JSON.stringify(value)).join(' ')
  return {
    message: `Run ${commandText(commands[0])}, then run ${commandText(commands[1])}`,
    commands,
  }
}

function positiveTimeout(value: number | undefined): number {
  const resolved = value ?? DEFAULT_SHARED_RUNTIME_INSTALL_TIMEOUT_MS
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new MarivoEnvironmentError(
      'shared-runtime-config-invalid',
      'Shared Marivo runtime installTimeoutMs must be a positive safe integer',
      { installTimeoutMs: resolved },
    )
  }
  return resolved
}

function normalizeAbsolute(name: string, value: string): string {
  if (!path.isAbsolute(value)) {
    throw new MarivoEnvironmentError(
      'shared-runtime-config-invalid',
      `${name} must be an absolute path: ${value}`,
      { [name]: value },
    )
  }
  return path.normalize(value)
}

function defaultRuntimeRoot(): string {
  return path.join(resolveDshHome(), 'dsh-data-analysis', 'runtimes', 'marivo')
}

function bundledReportKitWheel(): string {
  return fileURLToPath(
    new URL(`../../python/report-kit/dist/${REPORT_KIT_WHEEL_FILENAME}`, import.meta.url),
  )
}

async function assertReportKitWheel(filename: string): Promise<string> {
  const selected = path.normalize(path.resolve(filename))
  if (path.basename(selected) !== REPORT_KIT_WHEEL_FILENAME) {
    throw new MarivoEnvironmentError(
      'shared-runtime-report-kit-wheel-invalid',
      `Bundled report-kit wheel must be named ${REPORT_KIT_WHEEL_FILENAME}`,
      { expectedWheel: REPORT_KIT_WHEEL_FILENAME, actualWheel: path.basename(selected) },
    )
  }
  try {
    if (!(await stat(selected)).isFile()) throw new Error('not a file')
  } catch (cause) {
    throw new MarivoEnvironmentError(
      'shared-runtime-report-kit-wheel-unavailable',
      `Bundled report-kit wheel is unavailable: ${selected}`,
      {
        distribution: REPORT_KIT_DISTRIBUTION,
        version: REPORT_KIT_VERSION,
        wheel: selected,
      },
      { cause },
    )
  }
  return selected
}

function venvPython(runtimeRoot: string): string {
  return path.join(
    runtimeRoot,
    '.venv',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  )
}

function boundedText(buffer: Buffer, max = 4_000): string {
  return buffer.toString('utf8').slice(0, max)
}

function requireSuccess(stage: string, result: SubprocessResult): SubprocessResult {
  if (result.exitCode === 0) return result
  throw new MarivoEnvironmentError(
    'shared-runtime-install-failed',
    `Shared Marivo runtime stage failed: ${stage}`,
    {
      stage,
      exitCode: result.exitCode,
      signal: result.signal,
      stdout: boundedText(result.stdout),
      stderr: boundedText(result.stderr),
    },
  )
}

async function assertExecutable(executable: string): Promise<string> {
  const selected = path.normalize(path.resolve(executable))
  try {
    const info = await stat(selected)
    if (!info.isFile()) throw new Error('not a file')
    await access(selected, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
    return selected
  } catch (cause) {
    throw new MarivoEnvironmentError(
      'python-unavailable',
      `Shared Marivo Python executable is missing or not executable: ${selected}`,
      { pythonExecutable: selected },
      { cause },
    )
  }
}

function parseJsonObject<T>(stage: string, result: SubprocessResult): T {
  requireSuccess(stage, result)
  try {
    const value: unknown = JSON.parse(result.stdout.toString('utf8'))
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      throw new Error('not an object')
    return value as T
  } catch (cause) {
    throw new MarivoEnvironmentError(
      'shared-runtime-install-failed',
      `Shared Marivo runtime stage returned invalid JSON: ${stage}`,
      { stage, stdout: boundedText(result.stdout), stderr: boundedText(result.stderr) },
      { cause },
    )
  }
}

async function probeRuntime(
  runtimeRoot: string,
  executable: string,
  environment: NodeJS.ProcessEnv | undefined,
  timeoutMs: number,
  reportKitWheel: string,
  administrator: boolean,
  expectedMarivoVersion?: string,
): Promise<RuntimeProbe> {
  const canonical = await assertExecutable(executable)
  const policy = new FixedSubprocessPolicy(runtimeRoot, environment)
  const result = await policy.run({
    executable: canonical,
    args: ['-c', PROBE_SCRIPT],
    limits: { timeoutMs, stdoutMaxBytes: 16_384, stderrMaxBytes: 16_384 },
  })
  const repair = administrator ? administratorRepair(canonical, reportKitWheel) : undefined
  if (administrator && result.exitCode !== 0) {
    throw new MarivoEnvironmentError(
      'shared-runtime-package-unavailable',
      `Administrator Python must provide Marivo ${PINNED_MARIVO_VERSION}, pandas ${REPORT_KIT_PANDAS_RANGE}, and ${REPORT_KIT_DISTRIBUTION} ${REPORT_KIT_VERSION}. ${repair!.message}`,
      {
        pythonExecutable: canonical,
        marivoVersion: PINNED_MARIVO_VERSION,
        pandasRange: REPORT_KIT_PANDAS_RANGE,
        reportKitDistribution: REPORT_KIT_DISTRIBUTION,
        reportKitVersion: REPORT_KIT_VERSION,
        reportKitWheel: reportKitWheel,
        exitCode: result.exitCode,
        stderr: boundedText(result.stderr),
        repairCommands: repair!.commands,
      },
    )
  }
  const probe = parseJsonObject<RuntimeProbe>('probe Runtime package identity', result)
  if (
    typeof probe.python_executable !== 'string' ||
    typeof probe.marivo_version !== 'string' ||
    probe.marivo_version.length === 0 ||
    typeof probe.package_path !== 'string' ||
    probe.package_path.length === 0 ||
    typeof probe.pandas_version !== 'string' ||
    probe.pandas_version.length === 0 ||
    typeof probe.pandas_supported !== 'boolean' ||
    typeof probe.report_kit_version !== 'string' ||
    probe.report_kit_version.length === 0 ||
    typeof probe.report_kit_package_path !== 'string' ||
    probe.report_kit_package_path.length === 0 ||
    probe.report_kit_public_imports !== true
  ) {
    throw new MarivoEnvironmentError(
      'shared-runtime-identity-mismatch',
      'Shared Runtime returned an incomplete package identity',
      { probe },
    )
  }
  const actualPython = await realpath(path.resolve(probe.python_executable))
  const selectedPython = await realpath(canonical)
  if (expectedMarivoVersion !== undefined && probe.marivo_version !== expectedMarivoVersion) {
    throw new MarivoEnvironmentError(
      'shared-runtime-version-unsupported',
      `Shared Marivo runtime version ${probe.marivo_version} is unsupported; install ${expectedMarivoVersion}.${repair === undefined ? '' : ` ${repair.message}`}`,
      {
        supportedMarivoVersion: expectedMarivoVersion,
        actualMarivoVersion: probe.marivo_version,
        packagePath: probe.package_path,
        ...(repair === undefined ? {} : { repairCommands: repair.commands }),
      },
    )
  }
  if (!probe.pandas_supported) {
    throw new MarivoEnvironmentError(
      'shared-runtime-pandas-unsupported',
      `Shared Runtime pandas ${probe.pandas_version} is unsupported; install ${REPORT_KIT_PANDAS_RANGE}.${repair === undefined ? '' : ` ${repair.message}`}`,
      {
        supportedPandasRange: REPORT_KIT_PANDAS_RANGE,
        actualPandasVersion: probe.pandas_version,
        ...(repair === undefined ? {} : { repairCommands: repair.commands }),
      },
    )
  }
  if (probe.report_kit_version !== REPORT_KIT_VERSION) {
    throw new MarivoEnvironmentError(
      'shared-runtime-report-kit-unsupported',
      `Shared Runtime report kit ${probe.report_kit_version} is unsupported; install ${REPORT_KIT_VERSION} from ${reportKitWheel}.${repair === undefined ? '' : ` ${repair.message}`}`,
      {
        supportedReportKitVersion: REPORT_KIT_VERSION,
        actualReportKitVersion: probe.report_kit_version,
        reportKitPackagePath: probe.report_kit_package_path,
        reportKitWheel,
        ...(repair === undefined ? {} : { repairCommands: repair.commands }),
      },
    )
  }
  if (actualPython !== selectedPython) {
    throw new MarivoEnvironmentError(
      'shared-runtime-identity-mismatch',
      'Shared Marivo runtime import identity does not match its selected Python',
      {
        expectedPython: canonical,
        actualPython,
        packagePath: probe.package_path,
      },
    )
  }
  return {
    python_executable: canonical,
    marivo_version: probe.marivo_version,
    package_path: path.resolve(probe.package_path),
    pandas_version: probe.pandas_version,
    pandas_supported: probe.pandas_supported,
    report_kit_version: probe.report_kit_version,
    report_kit_package_path: path.resolve(probe.report_kit_package_path),
    report_kit_public_imports: true,
  }
}

async function validateSkills(skillsRoot: string): Promise<void> {
  for (const skill of SKILL_NAMES) {
    const skillFile = path.join(skillsRoot, skill, 'SKILL.md')
    try {
      if (!(await stat(skillFile)).isFile()) throw new Error('not a file')
    } catch (cause) {
      throw new MarivoEnvironmentError(
        'shared-runtime-skills-invalid',
        `Shared Marivo skill is missing: ${skillFile}`,
        { skillsRoot, skill },
        { cause },
      )
    }
  }
}

async function syncSkills(runtimeRoot: string, packagePath: string): Promise<string> {
  const sourceRoot = path.join(path.dirname(packagePath), 'skills')
  await validateSkills(sourceRoot)
  const skillsRoot = path.join(runtimeRoot, 'skills')
  const staging = path.join(runtimeRoot, `.skills-staging-${randomUUID()}`)
  const previous = path.join(runtimeRoot, `.skills-previous-${randomUUID()}`)
  await mkdir(staging, { recursive: true })
  try {
    for (const skill of SKILL_NAMES) {
      await cp(path.join(sourceRoot, skill), path.join(staging, skill), { recursive: true })
    }
    await validateSkills(staging)
    let hadPrevious = false
    try {
      await rename(skillsRoot, previous)
      hadPrevious = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    try {
      await rename(staging, skillsRoot)
    } catch (error) {
      if (hadPrevious) await rename(previous, skillsRoot)
      throw error
    }
    if (hadPrevious) await rm(previous, { recursive: true, force: true })
    return skillsRoot
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

async function readInstallation(runtimeRoot: string): Promise<InstallationRecord | undefined> {
  try {
    const value: unknown = JSON.parse(
      await readFile(path.join(runtimeRoot, INSTALLATION_FILENAME), 'utf8'),
    )
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
    const record = value as Partial<InstallationRecord>
    const fields = Object.keys(record).sort()
    const expectedFields = [
      'marivoVersion',
      'packagePath',
      'pythonExecutable',
      'reportKitPackagePath',
      'reportKitVersion',
      'schema',
      'skillsRoot',
    ]
    if (
      fields.length !== expectedFields.length ||
      fields.some((field, index) => field !== expectedFields[index]) ||
      record.schema !== INSTALLATION_SCHEMA ||
      typeof record.marivoVersion !== 'string' ||
      record.marivoVersion.length === 0 ||
      typeof record.pythonExecutable !== 'string' ||
      record.pythonExecutable.length === 0 ||
      typeof record.packagePath !== 'string' ||
      record.packagePath.length === 0 ||
      typeof record.reportKitVersion !== 'string' ||
      record.reportKitVersion.length === 0 ||
      typeof record.reportKitPackagePath !== 'string' ||
      record.reportKitPackagePath.length === 0 ||
      typeof record.skillsRoot !== 'string' ||
      record.skillsRoot.length === 0
    )
      return undefined
    return record as InstallationRecord
  } catch {
    return undefined
  }
}

async function writeInstallation(runtimeRoot: string, record: InstallationRecord): Promise<string> {
  const installationPath = path.join(runtimeRoot, INSTALLATION_FILENAME)
  const temporary = path.join(runtimeRoot, `.installation-${randomUUID()}.json`)
  await writeFile(temporary, `${JSON.stringify(record, undefined, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  if (process.platform !== 'win32') await chmod(temporary, 0o600)
  await rename(temporary, installationPath)
  return installationPath
}

async function validatedExisting(
  runtimeRoot: string,
  configuredPython: string | undefined,
  environment: NodeJS.ProcessEnv | undefined,
  timeoutMs: number,
  reportKitWheel: string,
): Promise<SharedMarivoRuntime | undefined> {
  const record = await readInstallation(runtimeRoot)
  if (record === undefined) return undefined
  if (record.marivoVersion !== PINNED_MARIVO_VERSION) return undefined
  if (record.reportKitVersion !== REPORT_KIT_VERSION) return undefined
  const expectedPython = configuredPython ?? venvPython(runtimeRoot)
  const expectedSkillsRoot = path.join(runtimeRoot, 'skills')
  if (path.normalize(record.skillsRoot) !== path.normalize(expectedSkillsRoot)) return undefined
  try {
    const selectedPython = await assertExecutable(expectedPython)
    if (path.normalize(record.pythonExecutable) !== selectedPython) return undefined
    const probe = await probeRuntime(
      runtimeRoot,
      selectedPython,
      environment,
      timeoutMs,
      reportKitWheel,
      configuredPython !== undefined,
      record.marivoVersion,
    )
    if (path.normalize(probe.package_path) !== path.normalize(record.packagePath)) return undefined
    if (
      path.normalize(probe.report_kit_package_path) !== path.normalize(record.reportKitPackagePath)
    )
      return undefined
    await validateSkills(record.skillsRoot)
    return {
      runtimeRoot,
      pythonExecutable: probe.python_executable,
      marivoVersion: probe.marivo_version,
      packagePath: probe.package_path,
      reportKitVersion: probe.report_kit_version,
      reportKitPackagePath: probe.report_kit_package_path,
      skillsRoot: record.skillsRoot,
      installationPath: path.join(runtimeRoot, INSTALLATION_FILENAME),
    }
  } catch {
    return undefined
  }
}

async function acquireLock(
  lockPath: string,
  timeoutMs: number,
  waitIntervalMs: number,
): Promise<() => Promise<void>> {
  const started = Date.now()
  while (true) {
    try {
      await mkdir(lockPath)
      await writeFile(
        path.join(lockPath, 'owner.json'),
        `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`,
      )
      return async () => {
        await rm(lockPath, { recursive: true, force: true })
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      let age = 0
      try {
        age = Date.now() - (await stat(lockPath)).mtimeMs
      } catch {
        continue
      }
      if (age >= timeoutMs && !(await lockOwnerAlive(lockPath))) {
        try {
          await rename(lockPath, `${lockPath}.stale-${Date.now()}-${randomUUID()}`)
          continue
        } catch (renameError) {
          if ((renameError as NodeJS.ErrnoException).code === 'ENOENT') continue
        }
      }
      if (Date.now() - started >= timeoutMs) {
        throw new MarivoEnvironmentError(
          'shared-runtime-lock-timeout',
          `Timed out waiting for the shared Marivo runtime installation lock: ${lockPath}`,
          { lockPath, timeoutMs },
        )
      }
      await new Promise((resolve) => setTimeout(resolve, waitIntervalMs))
    }
  }
}

async function lockOwnerAlive(lockPath: string): Promise<boolean> {
  try {
    const owner = JSON.parse(await readFile(path.join(lockPath, 'owner.json'), 'utf8')) as {
      pid?: unknown
    }
    if (!Number.isSafeInteger(owner.pid) || (owner.pid as number) < 1) return false
    try {
      process.kill(owner.pid as number, 0)
      return true
    } catch (error) {
      return (error as NodeJS.ErrnoException).code !== 'ESRCH'
    }
  } catch {
    return false
  }
}

async function backupInvalidRuntime(runtimeRoot: string): Promise<void> {
  try {
    await stat(runtimeRoot)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  await rename(runtimeRoot, `${runtimeRoot}.invalid-${Date.now()}-${randomUUID()}`)
}

async function installManagedRuntime(
  runtimeRoot: string,
  uvExecutable: string,
  reportKitWheel: string,
  environment: NodeJS.ProcessEnv | undefined,
  timeoutMs: number,
): Promise<RuntimeProbe> {
  const policy = new FixedSubprocessPolicy(runtimeRoot, environment)
  const limits = { timeoutMs, stdoutMaxBytes: 1_048_576, stderrMaxBytes: 1_048_576 }
  requireSuccess(
    'install managed Python',
    await policy.run({
      executable: uvExecutable,
      args: ['python', 'install', SHARED_PYTHON_SPEC],
      limits,
    }),
  )
  const found = requireSuccess(
    'resolve managed Python',
    await policy.run({
      executable: uvExecutable,
      args: ['python', 'find', '--managed-python', SHARED_PYTHON_SPEC],
      limits,
    }),
  )
  const managedPython = found.stdout.toString('utf8').trim()
  if (!path.isAbsolute(managedPython)) {
    throw new MarivoEnvironmentError(
      'shared-runtime-install-failed',
      'uv returned a non-absolute managed Python path',
      { managedPython },
    )
  }
  const canonicalManagedPython = await assertExecutable(managedPython)
  const version = parseJsonObject<{ version?: unknown; python_executable?: unknown }>(
    'validate managed Python',
    await policy.run({
      executable: canonicalManagedPython,
      args: ['-c', PYTHON_VERSION_SCRIPT],
      limits,
    }),
  )
  if (
    !Array.isArray(version.version) ||
    typeof version.version[0] !== 'number' ||
    typeof version.version[1] !== 'number' ||
    version.version[0] < 3 ||
    (version.version[0] === 3 && version.version[1] < 10)
  ) {
    throw new MarivoEnvironmentError(
      'shared-runtime-install-failed',
      'uv managed Python does not satisfy Marivo >=3.10',
      { version: version.version, pythonExecutable: canonicalManagedPython },
    )
  }
  requireSuccess(
    'create shared virtual environment',
    await policy.run({
      executable: uvExecutable,
      args: ['venv', '--python', canonicalManagedPython, '--seed', path.join(runtimeRoot, '.venv')],
      limits,
    }),
  )
  const executable = venvPython(runtimeRoot)
  requireSuccess(
    `install Marivo ${PINNED_MARIVO_VERSION}`,
    await policy.run({
      executable: uvExecutable,
      args: ['pip', 'install', '--python', executable, '--upgrade', SHARED_MARIVO_PACKAGE_SPEC],
      limits,
    }),
  )
  requireSuccess(
    `install report kit ${REPORT_KIT_VERSION}`,
    await policy.run({
      executable: uvExecutable,
      args: ['pip', 'install', '--python', executable, '--no-deps', reportKitWheel],
      limits,
    }),
  )
  return probeRuntime(
    runtimeRoot,
    executable,
    environment,
    timeoutMs,
    reportKitWheel,
    false,
    PINNED_MARIVO_VERSION,
  )
}

/** Ensure and validate the one DSH-home-owned Marivo installation. */
export async function ensureSharedMarivoRuntime(
  config: SharedMarivoRuntimeConfig = {},
  options: RuntimeInstallOptions = {},
): Promise<SharedMarivoRuntime> {
  const runtimeRoot =
    config.runtimeRoot === undefined
      ? defaultRuntimeRoot()
      : normalizeAbsolute('runtimeRoot', config.runtimeRoot)
  const configuredPython =
    config.pythonExecutable === undefined
      ? undefined
      : normalizeAbsolute('pythonExecutable', config.pythonExecutable)
  const uvExecutable =
    config.uvExecutable === undefined
      ? 'uv'
      : normalizeAbsolute('uvExecutable', config.uvExecutable)
  const timeoutMs = positiveTimeout(config.installTimeoutMs)
  const reportKitWheel = path.normalize(
    path.resolve(options.reportKitWheelPath ?? bundledReportKitWheel()),
  )
  const existing = await validatedExisting(
    runtimeRoot,
    configuredPython,
    options.environment,
    timeoutMs,
    reportKitWheel,
  )
  if (existing !== undefined) return existing

  await mkdir(path.dirname(runtimeRoot), { recursive: true })
  const lockPath = `${runtimeRoot}.install-lock`
  const release = await acquireLock(lockPath, timeoutMs, options.waitIntervalMs ?? 100)
  try {
    const afterLock = await validatedExisting(
      runtimeRoot,
      configuredPython,
      options.environment,
      timeoutMs,
      reportKitWheel,
    )
    if (afterLock !== undefined) return afterLock
    if (configuredPython === undefined) await assertReportKitWheel(reportKitWheel)
    await backupInvalidRuntime(runtimeRoot)
    await mkdir(runtimeRoot, { recursive: true })
    const probe =
      configuredPython === undefined
        ? await installManagedRuntime(
            runtimeRoot,
            uvExecutable,
            reportKitWheel,
            options.environment,
            timeoutMs,
          )
        : await probeRuntime(
            runtimeRoot,
            configuredPython,
            options.environment,
            timeoutMs,
            reportKitWheel,
            true,
            PINNED_MARIVO_VERSION,
          )
    const skillsRoot = await syncSkills(runtimeRoot, probe.package_path)
    const record: InstallationRecord = {
      schema: INSTALLATION_SCHEMA,
      marivoVersion: probe.marivo_version,
      pythonExecutable: probe.python_executable,
      packagePath: probe.package_path,
      reportKitVersion: probe.report_kit_version,
      reportKitPackagePath: probe.report_kit_package_path,
      skillsRoot,
    }
    const installationPath = await writeInstallation(runtimeRoot, record)
    return {
      runtimeRoot,
      pythonExecutable: probe.python_executable,
      marivoVersion: probe.marivo_version,
      packagePath: probe.package_path,
      reportKitVersion: probe.report_kit_version,
      reportKitPackagePath: probe.report_kit_package_path,
      skillsRoot,
      installationPath,
    }
  } finally {
    await release()
  }
}
