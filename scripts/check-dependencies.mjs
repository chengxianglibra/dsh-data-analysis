import { spawnSync } from 'node:child_process'

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

console.log('verified npm dependency tree')
