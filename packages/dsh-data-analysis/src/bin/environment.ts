#!/usr/bin/env node

/** Fail-closed runtime environment probe for operators and deployment scripts. */

import process from 'node:process'
import {
  ensureSharedMarivoRuntime,
  MarivoWorkspaceEnvironmentManager,
} from '../environment/index.ts'
import { MarivoEnvironmentError } from '../environment/errors.ts'
import { environmentPayload } from '../environment/summary.ts'

interface Arguments {
  projectRoot: string
  pythonExecutable?: string
  runtimeRoot?: string
  uvExecutable?: string
}

function usage(): string {
  return `Usage: dsh-data-analysis-env [--project-root PATH] [--python PATH] [--runtime-root PATH] [--uv PATH]

Ensures the shared latest-resolved Marivo Runtime, initializes the minimal
Workspace layout, and checks the exact interpreter, import identity, and doctor admission
used by the DSH plugin. The JSON output contains no credentials or raw doctor
details.
`
}

function requireValue(argv: readonly string[], index: number, option: string): string {
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${option} requires a value`)
  return value
}

function parseArguments(argv: readonly string[]): Arguments | 'help' {
  let projectRoot = process.env.DSH_DATA_ANALYSIS_PROJECT_ROOT
    ?? process.env.DSH_CWD
    ?? process.cwd()
  let pythonExecutable = process.env.DSH_DATA_ANALYSIS_PYTHON
  let runtimeRoot = process.env.DSH_DATA_ANALYSIS_RUNTIME_ROOT
  let uvExecutable = process.env.DSH_DATA_ANALYSIS_UV
  for (let index = 0; index < argv.length; index++) {
    const option = argv[index]
    if (option === '--help' || option === '-h') return 'help'
    if (option === '--project-root') {
      projectRoot = requireValue(argv, index, option)
      index++
      continue
    }
    if (option === '--python') {
      pythonExecutable = requireValue(argv, index, option)
      index++
      continue
    }
    if (option === '--runtime-root') {
      runtimeRoot = requireValue(argv, index, option)
      index++
      continue
    }
    if (option === '--uv') {
      uvExecutable = requireValue(argv, index, option)
      index++
      continue
    }
    throw new Error(`unknown option: ${String(option)}`)
  }
  return {
    projectRoot,
    ...(pythonExecutable === undefined ? {} : { pythonExecutable }),
    ...(runtimeRoot === undefined ? {} : { runtimeRoot }),
    ...(uvExecutable === undefined ? {} : { uvExecutable }),
  }
}

async function main(argv: readonly string[]): Promise<number> {
  let args: Arguments | 'help'
  try {
    args = parseArguments(argv)
  } catch (error: unknown) {
    process.stderr.write(`${(error as Error).message}\n${usage()}`)
    return 2
  }
  if (args === 'help') {
    process.stdout.write(usage())
    return 0
  }
  try {
    const runtime = await ensureSharedMarivoRuntime({
      ...(args.pythonExecutable === undefined ? {} : { pythonExecutable: args.pythonExecutable }),
      ...(args.runtimeRoot === undefined ? {} : { runtimeRoot: args.runtimeRoot }),
      ...(args.uvExecutable === undefined ? {} : { uvExecutable: args.uvExecutable }),
    })
    const manager = new MarivoWorkspaceEnvironmentManager(runtime)
    const environment = await manager.resolve(args.projectRoot)
    process.stdout.write(`${JSON.stringify(environmentPayload(runtime, environment), undefined, 2)}\n`)
    return 0
  } catch (error: unknown) {
    const code = error instanceof MarivoEnvironmentError ? error.code : 'unexpected-error'
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`dsh-data-analysis-env: ${code}: ${message}\n`)
    return 1
  }
}

process.exitCode = await main(process.argv.slice(2))
