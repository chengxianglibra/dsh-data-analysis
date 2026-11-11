import { spawnSync } from 'node:child_process'

const kind = process.argv[2]
if (kind !== 'source' && kind !== 'client') throw new Error('Expected source or client')

// The full test runner has already prepared both artifacts for this run.
if (process.env.DSH_DATA_ANALYSIS_TEST_PREPARED !== '1') {
  const args =
    kind === 'source'
      ? ['run', 'prepare:source']
      : ['packages/dsh-data-analysis/scripts/build-client.mjs']
  const command =
    kind === 'source' ? (process.platform === 'win32' ? 'npm.cmd' : 'npm') : process.execPath
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32' && command === 'npm.cmd',
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
