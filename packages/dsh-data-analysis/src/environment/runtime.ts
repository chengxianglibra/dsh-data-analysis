import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  access,
  chmod,
  cp,
  lstat,
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
import {
  MARIVO_PACKAGE_SPEC,
  MARIVO_VERSION,
  MARIVO_WHEEL_FILENAME,
  MARIVO_WHEEL_SHA256,
  RUNTIME_INSTALLATION_VERSION,
} from '../compatibility.ts'
import { MarivoEnvironmentError } from './errors.ts'
import { FixedSubprocessPolicy } from './subprocess.ts'
import type { SharedMarivoRuntime, SharedMarivoRuntimeConfig, SubprocessResult } from './types.ts'

export const SHARED_PYTHON_SPEC = '3.10'
const PINNED_MARIVO_VERSION = MARIVO_VERSION
export const SHARED_MARIVO_PACKAGE_SPEC = MARIVO_PACKAGE_SPEC
export const DEFAULT_SHARED_RUNTIME_INSTALL_TIMEOUT_MS = 600_000

const INSTALLATION_SCHEMA = RUNTIME_INSTALLATION_VERSION
const INSTALLATION_FILENAME = 'installation.json'
const SKILL_NAMES = ['marivo-analysis', 'marivo-semantic'] as const
const SERVICE_SKILL = 'marivo-service'
const PROBE_SCRIPT = String.raw`
import json
import os
import sys
from importlib.metadata import distribution
import marivo
import ibis.backends.duckdb
from marivo.semantic import SemanticCatalog
from marivo.datasource import DatasourceCatalog
from marivo.analysis import AnalysisFrame, persist_dataframe, read_dataframe
assert callable(SemanticCatalog.search) and callable(DatasourceCatalog.describe)
assert callable(AnalysisFrame.persist) and callable(persist_dataframe) and callable(read_dataframe) and hasattr(AnalysisFrame, "ref")
dist = distribution("marivo")
origin = json.loads(dist.read_text("direct_url.json") or "{}")
archive = origin.get("archive_info", {})
archive_sha = archive.get("hashes", {}).get("sha256") or archive.get("hash", "").removeprefix("sha256=")
print(json.dumps({
    "marivo_distribution_version": dist.version,
    "marivo_archive_sha256": archive_sha,
    "marivo_import_identity": os.path.realpath(marivo.__file__) == os.path.realpath(dist.locate_file("marivo/__init__.py")),
    "python_executable": os.path.abspath(sys.executable),
    "marivo_version": marivo.__version__,
    "package_path": os.path.abspath(marivo.__file__ or ""),
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
  marivo_archive_sha256: string
  marivo_distribution_version: string
  marivo_import_identity: boolean
  python_executable: string
  marivo_version: string
  package_path: string
}

interface InstallationRecord {
  marivoArchiveSha256: string
  schema: typeof INSTALLATION_SCHEMA
  marivoVersion: string
  pythonExecutable: string
  packagePath: string
  skillsRoot: string
}

interface RuntimeInstallOptions {
  /** Validate an existing installation without creating directories or acquiring an install lock. */
  marivoWheelPath?: string
  existingOnly?: boolean
  environment?: NodeJS.ProcessEnv
  waitIntervalMs?: number
}

interface AdministratorRepair {
  message: string
  commands: readonly {
    executable: string
    args: readonly string[]
  }[]
}

function administratorRepair(executable: string, wheel: string): AdministratorRepair {
  const commands = [
    {
      executable,
      args: ['-m', 'pip', 'install', '--force-reinstall', `${wheel}[duckdb,trino,clickhouse]`],
    },
  ]
  return {
    message: `Run ${[executable, ...commands[0]!.args].map((value) => JSON.stringify(value)).join(' ')}`,
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
  wheel: string,
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
  const repair = administrator ? administratorRepair(canonical, wheel) : undefined
  if (administrator && result.exitCode !== 0) {
    throw new MarivoEnvironmentError(
      'shared-runtime-package-unavailable',
      `Administrator Python must provide Marivo ${PINNED_MARIVO_VERSION} from the bundled wheel with the duckdb extra. ${repair!.message}`,
      {
        pythonExecutable: canonical,
        marivoVersion: PINNED_MARIVO_VERSION,
        exitCode: result.exitCode,
        stderr: boundedText(result.stderr),
        repairCommands: repair!.commands,
      },
    )
  }
  const probe = parseJsonObject<RuntimeProbe>('probe Runtime package identity', result)
  if (
    probe.marivo_archive_sha256 !== MARIVO_WHEEL_SHA256 ||
    probe.marivo_distribution_version !== probe.marivo_version ||
    probe.marivo_import_identity !== true ||
    typeof probe.python_executable !== 'string' ||
    typeof probe.marivo_version !== 'string' ||
    probe.marivo_version.length === 0 ||
    typeof probe.package_path !== 'string' ||
    probe.package_path.length === 0
  ) {
    throw new MarivoEnvironmentError(
      'shared-runtime-identity-mismatch',
      'Shared Runtime returned an incomplete or mismatched package identity',
      { probe, ...(repair === undefined ? {} : { repairCommands: repair.commands }) },
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
    marivo_archive_sha256: probe.marivo_archive_sha256,
    marivo_distribution_version: probe.marivo_distribution_version,
    marivo_import_identity: true,
    python_executable: canonical,
    marivo_version: probe.marivo_version,
    package_path: path.resolve(probe.package_path),
  }
}

async function availableSkills(skillsRoot: string): Promise<readonly string[]> {
  try {
    await lstat(path.join(skillsRoot, SERVICE_SKILL))
    return [...SKILL_NAMES, SERVICE_SKILL]
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return SKILL_NAMES
    throw error
  }
}

async function validateSkills(skillsRoot: string, skills: readonly string[]): Promise<void> {
  for (const skill of skills) {
    const skillFile = path.join(skillsRoot, skill, 'SKILL.md')
    try {
      if (!(await stat(skillFile)).isFile()) throw new Error('not a file')
      const lines = (await readFile(skillFile, 'utf8')).split(/\r?\n/)
      if (lines[0] !== '---') throw new Error('frontmatter is missing')
      const closing = lines.indexOf('---', 1)
      if (closing < 2) throw new Error('frontmatter is not closed')
      const names = lines
        .slice(1, closing)
        .filter((line) => line.startsWith('name:'))
        .map((line) => line.slice('name:'.length).trim())
      if (names.length !== 1 || names[0] !== skill) {
        throw new Error(`frontmatter name must be ${skill}`)
      }
    } catch (cause) {
      throw new MarivoEnvironmentError(
        'shared-runtime-skills-invalid',
        `Shared Marivo skill is invalid: ${skillFile}`,
        { skillsRoot, skill },
        { cause },
      )
    }
  }
}

async function syncSkills(runtimeRoot: string, packagePath: string): Promise<string> {
  const sourceRoot = path.join(path.dirname(packagePath), 'skills')
  const skills = await availableSkills(sourceRoot)
  await validateSkills(sourceRoot, skills)
  const skillsRoot = path.join(runtimeRoot, 'skills')
  const staging = path.join(runtimeRoot, `.skills-staging-${randomUUID()}`)
  const previous = path.join(runtimeRoot, `.skills-previous-${randomUUID()}`)
  await mkdir(staging, { recursive: true })
  try {
    for (const skill of skills) {
      await cp(path.join(sourceRoot, skill), path.join(staging, skill), { recursive: true })
    }
    await validateSkills(staging, skills)
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
      'marivoArchiveSha256',
      'packagePath',
      'pythonExecutable',
      'schema',
      'skillsRoot',
    ].sort()
    if (
      fields.length !== expectedFields.length ||
      fields.some((field, index) => field !== expectedFields[index]) ||
      record.schema !== INSTALLATION_SCHEMA ||
      record.marivoArchiveSha256 !== MARIVO_WHEEL_SHA256 ||
      typeof record.marivoVersion !== 'string' ||
      record.marivoVersion.length === 0 ||
      typeof record.pythonExecutable !== 'string' ||
      record.pythonExecutable.length === 0 ||
      typeof record.packagePath !== 'string' ||
      record.packagePath.length === 0 ||
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
  wheel: string,
): Promise<SharedMarivoRuntime | undefined> {
  const record = await readInstallation(runtimeRoot)
  if (record === undefined) return undefined
  if (record.marivoVersion !== PINNED_MARIVO_VERSION) return undefined
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
      wheel,
      configuredPython !== undefined,
      record.marivoVersion,
    )
    if (path.normalize(probe.package_path) !== path.normalize(record.packagePath)) return undefined
    const sourceRoot = path.join(path.dirname(probe.package_path), 'skills')
    await validateSkills(record.skillsRoot, await availableSkills(sourceRoot))
    return {
      runtimeRoot,
      pythonExecutable: probe.python_executable,
      marivoVersion: probe.marivo_version,
      marivoArchiveSha256: probe.marivo_archive_sha256,
      packagePath: probe.package_path,
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
  bootstrapPythonExecutable: string,
  wheel: string,
  environment: NodeJS.ProcessEnv | undefined,
  timeoutMs: number,
): Promise<RuntimeProbe> {
  const policy = new FixedSubprocessPolicy(runtimeRoot, environment)
  const limits = { timeoutMs, stdoutMaxBytes: 1_048_576, stderrMaxBytes: 1_048_576 }
  let version: { version?: unknown; python_executable?: unknown }
  try {
    version = parseJsonObject(
      'validate local Python',
      await policy.run({
        executable: bootstrapPythonExecutable,
        args: ['-c', PYTHON_VERSION_SCRIPT],
        limits,
      }),
    )
  } catch (error) {
    if (!(error instanceof MarivoEnvironmentError)) throw error
    throw new MarivoEnvironmentError(
      'shared-runtime-install-failed',
      'Could not validate local Python. Install Python 3.10+ with venv/ensurepip, or set bootstrapPythonExecutable to its absolute path.',
      { pythonExecutable: bootstrapPythonExecutable, causeCode: error.code },
    )
  }
  if (
    !Array.isArray(version.version) ||
    typeof version.version[0] !== 'number' ||
    typeof version.version[1] !== 'number' ||
    version.version[0] < 3 ||
    (version.version[0] === 3 && version.version[1] < 10)
  ) {
    throw new MarivoEnvironmentError(
      'shared-runtime-install-failed',
      `Local Python does not satisfy Marivo >=${SHARED_PYTHON_SPEC}; detected ${Array.isArray(version.version) ? version.version.join('.') : 'unknown'}`,
      { version: version.version, pythonExecutable: bootstrapPythonExecutable },
    )
  }
  if (
    typeof version.python_executable !== 'string' ||
    !path.isAbsolute(version.python_executable)
  ) {
    throw new MarivoEnvironmentError(
      'shared-runtime-install-failed',
      'Local Python returned a non-absolute interpreter path',
    )
  }
  const canonicalPython = await assertExecutable(version.python_executable)
  requireSuccess(
    'create shared virtual environment (requires Python venv/ensurepip; install python3-venv on Debian/Ubuntu)',
    await policy.run({
      executable: canonicalPython,
      args: ['-m', 'venv', path.join(runtimeRoot, '.venv')],
      limits,
    }),
  )
  const executable = venvPython(runtimeRoot)
  requireSuccess(
    `install Marivo ${PINNED_MARIVO_VERSION}`,
    await policy.run({
      executable,
      args: ['-m', 'pip', 'install', '--force-reinstall', `${wheel}[duckdb,trino,clickhouse]`],
      limits,
    }),
  )
  return probeRuntime(
    runtimeRoot,
    executable,
    environment,
    timeoutMs,
    wheel,
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
  const bootstrapPythonExecutable =
    config.bootstrapPythonExecutable === undefined
      ? process.platform === 'win32'
        ? 'python'
        : 'python3'
      : normalizeAbsolute('bootstrapPythonExecutable', config.bootstrapPythonExecutable)
  const timeoutMs = positiveTimeout(config.installTimeoutMs)
  const wheel = path.resolve(
    options.marivoWheelPath ??
      fileURLToPath(new URL(`../../python/marivo/dist/${MARIVO_WHEEL_FILENAME}`, import.meta.url)),
  )
  const bytes = await readFile(wheel)
  if (
    path.basename(wheel) !== MARIVO_WHEEL_FILENAME ||
    createHash('sha256').update(bytes).digest('hex') !== MARIVO_WHEEL_SHA256
  )
    throw new MarivoEnvironmentError(
      'shared-runtime-identity-mismatch',
      'Bundled Marivo wheel identity mismatch',
      { wheel },
    )
  const existing = await validatedExisting(
    runtimeRoot,
    configuredPython,
    options.environment,
    timeoutMs,
    wheel,
  )
  if (existing !== undefined) return existing
  if (options.existingOnly)
    throw new MarivoEnvironmentError(
      'shared-runtime-installation-required',
      'A valid shared Marivo Runtime installation is required',
    )

  await mkdir(path.dirname(runtimeRoot), { recursive: true })
  const lockPath = `${runtimeRoot}.install-lock`
  const release = await acquireLock(lockPath, timeoutMs, options.waitIntervalMs ?? 100)
  try {
    const afterLock = await validatedExisting(
      runtimeRoot,
      configuredPython,
      options.environment,
      timeoutMs,
      wheel,
    )
    if (afterLock !== undefined) return afterLock
    await backupInvalidRuntime(runtimeRoot)
    await mkdir(runtimeRoot, { recursive: true })
    const probe =
      configuredPython === undefined
        ? await installManagedRuntime(
            runtimeRoot,
            bootstrapPythonExecutable,
            wheel,
            options.environment,
            timeoutMs,
          )
        : await probeRuntime(
            runtimeRoot,
            configuredPython,
            options.environment,
            timeoutMs,
            wheel,
            true,
            PINNED_MARIVO_VERSION,
          )
    const skillsRoot = await syncSkills(runtimeRoot, probe.package_path)
    const record: InstallationRecord = {
      schema: INSTALLATION_SCHEMA,
      marivoVersion: probe.marivo_version,
      marivoArchiveSha256: probe.marivo_archive_sha256,
      pythonExecutable: probe.python_executable,
      packagePath: probe.package_path,
      skillsRoot,
    }
    const installationPath = await writeInstallation(runtimeRoot, record)
    return {
      runtimeRoot,
      pythonExecutable: probe.python_executable,
      marivoVersion: probe.marivo_version,
      marivoArchiveSha256: probe.marivo_archive_sha256,
      packagePath: probe.package_path,
      skillsRoot,
      installationPath,
    }
  } finally {
    await release()
  }
}
