import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const projectRoot = path.join(packageRoot, 'python', 'report-kit')
const distRoot = path.join(projectRoot, 'dist')
const verifier = path.join(projectRoot, 'scripts', 'verify_wheel.py')

/** @param {string[]} args */
function runUv(args) {
  const result = spawnSync('uv', args, { cwd: packageRoot, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

runUv(['build', '--wheel', '--project', projectRoot, '--out-dir', distRoot])

// uv protects its output directory with `dist/.gitignore`; npm needs its own
// empty ignore file here so the parent package files allowlist remains authoritative.
writeFileSync(path.join(distRoot, '.npmignore'), '')

runUv(['run', '--project', projectRoot, '--frozen', 'python', verifier])
