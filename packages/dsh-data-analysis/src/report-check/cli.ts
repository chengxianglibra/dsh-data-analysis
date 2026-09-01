#!/usr/bin/env node

import { realpathSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { renderReportCheckResult } from './tool.ts'
import { ReportCheckInvocationError } from './types.ts'
import { checkWorkspaceReport } from './workspace.ts'

export interface ReportCheckCliIo {
  cwd(): string
  writeStdout(text: string): void
  writeStderr(text: string): void
}

const PROCESS_IO: ReportCheckCliIo = {
  cwd: () => process.cwd(),
  writeStdout: (text) => process.stdout.write(text),
  writeStderr: (text) => process.stderr.write(text),
}

interface CliArgs {
  entryPath: string
  json: boolean
}

function parseArgs(argv: readonly string[]): CliArgs {
  let entryPath: string | undefined
  let json = false
  for (const argument of argv) {
    if (argument === '--json') {
      json = true
      continue
    }
    if (argument.startsWith('-') || entryPath !== undefined) {
      throw new TypeError('usage: dsh-data-analysis-report-check <index.html> [--json]')
    }
    entryPath = argument
  }
  if (entryPath === undefined) {
    throw new TypeError('usage: dsh-data-analysis-report-check <index.html> [--json]')
  }
  return { entryPath, json }
}

/** Run the operator CLI adapter. Returns 0=passed, 1=static failure, 2=invocation failure. */
export async function runReportCheckCli(
  argv: readonly string[],
  io: ReportCheckCliIo = PROCESS_IO,
  signal: AbortSignal = new AbortController().signal,
): Promise<0 | 1 | 2> {
  try {
    const args = parseArgs(argv)
    const result = await checkWorkspaceReport({
      workspaceRoot: io.cwd(),
      entryPath: args.entryPath,
      signal,
    })
    io.writeStdout(
      `${args.json ? JSON.stringify(result, null, 2) : renderReportCheckResult(result)}\n`,
    )
    return result.status === 'passed_static' ? 0 : 1
  } catch (error) {
    const message =
      error instanceof ReportCheckInvocationError || error instanceof TypeError
        ? error.message
        : 'report checker failed unexpectedly'
    io.writeStderr(`${message}\n`)
    return 2
  }
}

const invokedPath = process.argv[1]
if (
  invokedPath !== undefined &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(path.resolve(invokedPath))
) {
  process.exitCode = await runReportCheckCli(process.argv.slice(2))
}
