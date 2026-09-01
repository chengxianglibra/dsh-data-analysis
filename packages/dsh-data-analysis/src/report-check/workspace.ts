import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { checkReportBundle } from './core.ts'
import {
  type ReportCheckFileAccess,
  type ReportCheckFileStat,
  ReportCheckInvocationError,
  type ReportCheckLimits,
  type ReportCheckResultV1,
} from './types.ts'

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  )
}

function cancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new ReportCheckInvocationError('aborted', 'report check was cancelled', {
      cause: signal.reason,
    })
  }
}

export const NODE_REPORT_CHECK_FILE_ACCESS: ReportCheckFileAccess = {
  async realpath(target, signal) {
    cancelled(signal)
    const result = await realpath(target)
    cancelled(signal)
    return result
  },
  async stat(target, signal): Promise<ReportCheckFileStat> {
    cancelled(signal)
    const result = await stat(target)
    cancelled(signal)
    return {
      kind: result.isFile() ? 'file' : result.isDirectory() ? 'directory' : 'other',
      size: result.size,
    }
  },
  async readFile(target, signal) {
    cancelled(signal)
    const result = await readFile(target, { signal })
    cancelled(signal)
    return result
  },
}

export interface CheckWorkspaceReportOptions {
  workspaceRoot: string
  entryPath: string
  signal: AbortSignal
  now?: () => Date
  limits?: Partial<ReportCheckLimits>
  files?: ReportCheckFileAccess
}

/** Admit one user-facing entry path and run the deterministic checker against its bundle. */
export async function checkWorkspaceReport(
  options: CheckWorkspaceReportOptions,
): Promise<ReportCheckResultV1> {
  cancelled(options.signal)
  if (typeof options.entryPath !== 'string' || options.entryPath.trim() === '') {
    throw new ReportCheckInvocationError(
      'entry-path-invalid',
      'entry_path must be a non-empty Workspace path',
    )
  }
  let workspaceRoot: string
  try {
    workspaceRoot = await realpath(path.resolve(options.workspaceRoot))
    if (!(await stat(workspaceRoot)).isDirectory()) throw new Error('not a directory')
  } catch (error) {
    throw new ReportCheckInvocationError(
      'workspace-boundary-invalid',
      'Workspace root must be an existing directory',
      { cause: error },
    )
  }
  const entryPath = path.isAbsolute(options.entryPath)
    ? path.normalize(options.entryPath)
    : path.resolve(workspaceRoot, options.entryPath)
  if (path.basename(entryPath) !== 'index.html') {
    throw new ReportCheckInvocationError(
      'entry-path-invalid',
      'entry_path basename must be index.html',
    )
  }
  if (!inside(workspaceRoot, entryPath)) {
    throw new ReportCheckInvocationError(
      'entry-path-invalid',
      'entry_path must stay inside the current Workspace',
    )
  }
  const bundleRoot = path.dirname(entryPath)
  let canonicalEntry: string
  try {
    const files = options.files ?? NODE_REPORT_CHECK_FILE_ACCESS
    const entryStat = await files.stat(entryPath, options.signal)
    if (entryStat.kind !== 'file') throw new Error('entry is not a regular file')
    canonicalEntry = await files.realpath(entryPath, options.signal)
  } catch (error) {
    throw new ReportCheckInvocationError(
      'io-failed',
      'entry_path does not resolve to a readable file',
      {
        cause: error,
      },
    )
  }
  if (!inside(workspaceRoot, canonicalEntry) || !inside(bundleRoot, canonicalEntry)) {
    throw new ReportCheckInvocationError(
      'entry-path-invalid',
      'entry_path symlink must stay inside its bundle and Workspace',
    )
  }
  return checkReportBundle({
    workspaceRoot,
    entryPath,
    files: options.files ?? NODE_REPORT_CHECK_FILE_ACCESS,
    signal: options.signal,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.limits === undefined ? {} : { limits: options.limits }),
  })
}
