#!/usr/bin/env node

import path from 'node:path'
import process from 'node:process'
import { lintPresentationDraft } from '../presentation/lint.ts'

const usage = 'Usage: dsh-data-analysis-presentation-lint DRAFT_PATH [--project-root PATH]\n'
const args = process.argv.slice(2)
if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
  process.stdout.write(usage)
} else if (
  (args.length !== 1 && args.length !== 3) ||
  !args[0] ||
  args[0].startsWith('-') ||
  (args.length === 3 && (args[1] !== '--project-root' || !args[2]))
) {
  process.stderr.write(usage)
  process.exitCode = 2
} else {
  const result = await lintPresentationDraft(path.resolve(args[2] ?? process.cwd()), args[0])
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  process.exitCode = result.ok ? 0 : 1
}
