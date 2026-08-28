import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const destination = new URL('../artifacts/npm/', import.meta.url)
mkdirSync(destination, { recursive: true })

const result = spawnSync(
  'npm',
  [
    'pack',
    '--workspace',
    '@deepseek-ai/dsh-data-analysis',
    '--pack-destination',
    destination.pathname,
  ],
  { cwd: new URL('../', import.meta.url), stdio: 'inherit' },
)
if (result.error !== undefined) throw result.error
process.exitCode = result.status ?? 1
