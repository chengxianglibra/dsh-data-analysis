import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const suites = [
  'runtime-workspace',
  'environment-execution',
  'help-disclosure',
  'datasource-credentials',
  'presentation-surface',
  'plugin-integration-delivery',
  'semantic-reference-input',
  'semantic-browser',
  'presentation-projection',
  'presentation-integration',
  'presentation-skill',
  'right-tabs',
  'python-tool',
  'unified-analysis-ui',
]
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const declared = Object.keys(manifest.scripts)
  .filter((name) => name.startsWith('test:') && name !== 'test:validation-guards')
  .map((name) => name.slice('test:'.length))
  .sort()
if (JSON.stringify([...suites].sort()) !== JSON.stringify(declared)) {
  throw new Error('Update the full test suite list to match package.json')
}

/** @param {string} command @param {string[]} args @param {NodeJS.ProcessEnv} env */
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env,
    shell: process.platform === 'win32' && command === 'npm.cmd',
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

// build-client also prepares the generated source consumed by the other suites.
run(process.execPath, ['packages/dsh-data-analysis/scripts/build-client.mjs'])
const env = { ...process.env, DSH_DATA_ANALYSIS_TEST_PREPARED: '1' }
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
for (const suite of suites) run(npm, ['run', `test:${suite}`], env)
