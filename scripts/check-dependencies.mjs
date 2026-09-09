import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { checkPluginDependencies } from './dependency-policy.mjs'

const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const result = spawnSync(npmExecutable, ['ls', '--all'], {
  encoding: 'utf8',
})

if (result.error) {
  throw result.error
}

if (result.status !== 0) {
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  process.exit(result.status ?? 1)
}

const resultPolicy = checkPluginDependencies(fileURLToPath(new URL('../', import.meta.url)))
console.log('verified npm dependency tree, Host identity and production imports', resultPolicy)
