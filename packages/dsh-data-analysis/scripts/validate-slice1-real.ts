import assert from 'node:assert/strict'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { bindMarivoEnvironment } from '../src/environment/index.ts'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workspaceRoot = path.resolve(packageRoot, '../..')

const CHECKED_HELP_SCRIPT = String.raw`
import json
import os
import sys
import marivo

expected = {
    "python_executable": os.path.abspath(sys.argv[1]),
    "marivo_version": sys.argv[2],
    "package_path": os.path.abspath(sys.argv[3]),
}
actual = {
    "python_executable": os.path.abspath(sys.executable),
    "marivo_version": marivo.__version__,
    "package_path": os.path.abspath(marivo.__file__ or ""),
}
if actual != expected:
    print(json.dumps({"expected": expected, "actual": actual}), file=sys.stderr)
    raise SystemExit(78)
marivo.help(sys.argv[4])
`.trim()

const environment = await bindMarivoEnvironment({ projectRoot: workspaceRoot })
const identity = await environment.assertImportIdentity()
assert.equal(identity.pythonExecutable, environment.binding.pythonExecutable)

const observed: Record<string, number> = {}
for (const target of ['targets', 'analysis.observe']) {
  const result = await environment.subprocessPolicy.run({
    executable: environment.binding.pythonExecutable,
    args: [
      '-c',
      CHECKED_HELP_SCRIPT,
      environment.binding.pythonExecutable,
      environment.binding.marivoVersion,
      environment.binding.packagePath,
      target,
    ],
    limits: {
      timeoutMs: 30_000,
      stdoutMaxBytes: target === 'targets' ? 1_048_576 : 262_144,
      stderrMaxBytes: 65_536,
    },
  })
  assert.equal(result.exitCode, 0, result.stderr.toString('utf8'))
  assert.ok(result.stdout.byteLength > 0, `${target} returned empty help`)
  observed[target] = result.stdout.byteLength
}

process.stdout.write(`${JSON.stringify({
  status: 'ok',
  binding: environment.binding,
  helpStdoutBytes: observed,
}, null, 2)}\n`)
