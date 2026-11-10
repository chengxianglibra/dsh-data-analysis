import { lstat, realpath } from 'node:fs/promises'
import path from 'node:path'
import { admitDoctorReport, parseDoctorReport } from './doctor.ts'
import { MarivoEnvironmentError } from './errors.ts'
import type { MarivoCheckedRunner } from './types.ts'

export interface ProjectPreparation {
  status: 'already-ready' | 'created'
  projectRoot: string
}

export interface ProjectPreparationOptions {
  signal?: AbortSignal
  /** Python tools supply the same Harness Shell policy used by their user code. */
  initialize?: (signal?: AbortSignal) => Promise<void>
  assertCurrent?: () => Promise<void>
}

const locks = new Map<string, Promise<void>>()
const limits = { timeoutMs: 30_000, stdoutMaxBytes: 1_048_576, stderrMaxBytes: 65_536 }
const cli = String.raw`
import runpy, sys
sys.argv = ["marivo", *sys.argv[1:]]
runpy.run_module("marivo", run_name="__main__")
`.trim()

/** The Host Shell owns policy/cancellation; this program only invokes the public CLI. */
export const MARIVO_PROJECT_INIT_PROGRAM = String.raw`
import json, os, runpy, sys
from pathlib import Path
import marivo
expected = json.load(sys.stdin)
if (os.path.abspath(sys.executable) != os.path.abspath(expected["pythonExecutable"]) or
    marivo.__version__ != expected["marivoVersion"] or
    os.path.abspath(marivo.__file__ or "") != os.path.abspath(expected["packagePath"]) or
    str(Path.cwd().resolve()) != expected["projectRoot"]):
    raise RuntimeError("Marivo project preparation identity changed; rebind required")
sys.argv = ["marivo", "init", "--project-root", expected["projectRoot"]]
runpy.run_module("marivo", run_name="__main__")
`.trim()

async function manifestPresent(root: string): Promise<boolean> {
  try {
    const info = await lstat(path.join(root, 'marivo.toml'))
    if (!info.isFile() || info.isSymbolicLink())
      throw new MarivoEnvironmentError(
        'project-manifest-invalid',
        'Workspace marivo.toml must be a regular file, not a symbolic link',
      )
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function validateProject(runner: MarivoCheckedRunner, signal?: AbortSignal) {
  const { binding } = runner
  const result = await runner.runChecked({
    program: cli,
    args: ['doctor', '--project-root', binding.projectRoot, '--format', 'json'],
    environmentOverlay: { MARIVO_TELEMETRY: 'off' },
    limits,
    signal,
  })
  const report = parseDoctorReport(result.stdout)
  admitDoctorReport(report, binding.projectRoot, binding.pythonExecutable)
  if (
    report.marivo.version !== binding.marivoVersion ||
    path.normalize(report.marivo.package_path) !== path.normalize(binding.packagePath) ||
    !report.sections.some((section) =>
      section.checks.some((check) => check.id === 'project.marivo_toml' && check.status === 'ok'),
    )
  )
    throw new MarivoEnvironmentError(
      'project-manifest-invalid',
      'Bound Runtime did not validate the Workspace root manifest',
    )
}

function waitFor<T>(
  operation: Promise<T>,
  waiting: () => boolean,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return operation
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = () => {
      // Once init starts, wait for its cancellation and inspect the actual manifest.
      if (waiting()) reject(signal.reason)
    }
    signal.addEventListener('abort', abort, { once: true })
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    if (signal.aborted) abort()
  })
}

/** Explicit project preparation; the lock coordinates this plugin's requests only. */
export async function ensureMarivoProject(
  runner: MarivoCheckedRunner,
  options: ProjectPreparationOptions = {},
): Promise<ProjectPreparation> {
  const root = runner.binding.projectRoot
  const previous = locks.get(root) ?? Promise.resolve()
  let started = false
  const operation = previous
    .catch(() => {})
    .then(async (): Promise<ProjectPreparation> => {
      started = true
      options.signal?.throwIfAborted()
      await options.assertCurrent?.()
      if ((await realpath(root)) !== root)
        throw new MarivoEnvironmentError('project-root-invalid', 'Bound Workspace root changed')
      let created = false
      if (!(await manifestPresent(root))) {
        // Recheck in the root lock. Never inherit a parent project or use --force.
        await options.assertCurrent?.()
        options.signal?.throwIfAborted()
        try {
          if (options.initialize) await options.initialize(options.signal)
          else {
            const result = await runner.runChecked({
              program: cli,
              args: ['init', '--project-root', root],
              environmentOverlay: { MARIVO_TELEMETRY: 'off' },
              limits,
              signal: options.signal,
            })
            if (result.exitCode !== 0) throw new Error('Project init did not complete')
          }
        } catch (cause) {
          let manifest: 'present' | 'missing' | 'invalid' = 'invalid'
          try {
            manifest = (await manifestPresent(root)) ? 'present' : 'missing'
          } catch {}
          throw new MarivoEnvironmentError(
            'project-preparation-uncertain',
            'Project initialization did not confirm completion. Inspect the Workspace before retrying; do not automatically repeat init or delete files',
            { projectRoot: root, manifest },
            { cause },
          )
        }
        created = true
      }
      options.signal?.throwIfAborted()
      await options.assertCurrent?.()
      if (!(await manifestPresent(root)))
        throw new MarivoEnvironmentError(
          'project-manifest-invalid',
          'Workspace manifest is missing',
        )
      await validateProject(runner, options.signal)
      await options.assertCurrent?.()
      return { status: created ? 'created' : 'already-ready', projectRoot: root }
    })
  const tail = operation.then(
    () => {},
    () => {},
  )
  locks.set(root, tail)
  void tail.finally(() => {
    if (locks.get(root) === tail) locks.delete(root)
  })
  return waitFor(operation, () => !started, options.signal)
}
