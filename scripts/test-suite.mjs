import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const sourceSuites = new Set([
  'help-disclosure',
  'plugin-integration-delivery',
  'presentation-surface',
  'presentation-skill',
  'right-tabs',
])
const clientSuites = new Set([
  'datasource-credentials',
  'semantic-reference-input',
  'semantic-browser',
  'presentation-integration',
  'unified-analysis-ui',
])
const unpreparedSuites = new Set([
  'runtime-workspace',
  'environment-execution',
  'presentation-projection',
  'python-tool',
])

// Older browser tests predate the .browser.test.ts suffix. Keep the explicit list
// checked against imports so new browser tests cannot silently enter daily checks.
const legacyBrowserFiles = new Set([
  'alignment-hbar-interaction.test.ts',
  'category-composition-interaction.test.ts',
  'data-view.test.ts',
  'frame-browser.test.ts',
  'frame-comparison-layout.test.ts',
  'frame-copy-controls.test.ts',
  'frame-layout.test.ts',
  'frame-presentation-integration.test.ts',
  'point-ui-browser.test.ts',
  'records-preview.test.ts',
])
// These files contain both browser cases and non-browser contracts. Their
// browser cases use skipBrowserTest so the remaining contracts stay in each tier.
const mixedBrowserFiles = new Set([
  'presentation-integration/report-data-update.test.ts',
  'unified-analysis-ui/category-composition.test.ts',
  'unified-analysis-ui/comparison-decomposition-redesign.test.ts',
  'unified-analysis-ui/data-view.test.ts',
  'unified-analysis-ui/frame-display-metadata.test.ts',
  'unified-analysis-ui/frame-presentation-integration.test.ts',
])
const suite = process.argv[2]
if (!suite || ![sourceSuites, clientSuites, unpreparedSuites].some((group) => group.has(suite))) {
  throw new Error(`Unknown test suite: ${suite}`)
}

/** @param {string} command @param {string[]} args */
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const listOnly = process.argv[3] === '--list'
if (!listOnly && sourceSuites.has(suite))
  run(process.execPath, ['scripts/prepare-test.mjs', 'source'])
if (!listOnly && clientSuites.has(suite))
  run(process.execPath, ['scripts/prepare-test.mjs', 'client'])

const directory = path.join('packages/dsh-data-analysis/tests', suite)
const files = readdirSync(directory)
  .filter((name) => name.endsWith('.test.ts'))
  .sort()
const daily = process.env.DSH_DATA_ANALYSIS_TEST_TIER === 'daily'
const release = process.env.DSH_DATA_ANALYSIS_TEST_TIER === 'release'
const selected = files.filter((name) => {
  const browserSuffix = name.endsWith('.browser.test.ts')
  const legacyBrowser = suite === 'unified-analysis-ui' && legacyBrowserFiles.has(name)
  const source = readFileSync(path.join(directory, name), 'utf8')
  const importsPlaywright =
    /(?:from\s*|import\s*\(|require\s*\()\s*['"]playwright(?:\/[^'"]*)?['"]/.test(source)
  const usesBrowserRenderer = /\b(?:bundleRenderer|sharedRenderer)\s*\(/.test(source)
  const mixedBrowser = mixedBrowserFiles.has(`${suite}/${name}`)
  if (importsPlaywright && !browserSuffix && !legacyBrowser) {
    throw new Error(`Classify browser test ${path.join(directory, name)} before running tests`)
  }
  if (legacyBrowser && !importsPlaywright) {
    throw new Error(`Update legacy browser test classification for ${path.join(directory, name)}`)
  }
  const realCatalog =
    ['semantic-browser', 'semantic-reference-input'].includes(suite) &&
    name === 'real-catalog.test.ts'
  const browser = browserSuffix || legacyBrowser || importsPlaywright || usesBrowserRenderer
  return !((daily || release) && browser && !mixedBrowser) && !(daily && realCatalog)
})
if (suite === 'unified-analysis-ui') {
  for (const name of legacyBrowserFiles) {
    if (!files.includes(name)) throw new Error(`Missing classified browser test: ${name}`)
  }
}
if (
  ['semantic-browser', 'semantic-reference-input'].includes(suite) &&
  !files.includes('real-catalog.test.ts')
) {
  throw new Error('Missing classified real-catalog test')
}
if (selected.length === 0) throw new Error(`No tests selected for ${suite}`)
const paths = selected.map((name) => path.join(directory, name))
if (suite === 'plugin-integration-delivery') {
  paths.push(
    'scripts/dependency-policy.test.mjs',
    'scripts/test-reporter.test.mjs',
    'scripts/test-tier.test.mjs',
    'scripts/typecheck-config.test.mjs',
  )
}
if (listOnly) {
  console.log(JSON.stringify(paths))
  process.exit(0)
}
if (daily || release) {
  const excluded = files.filter((name) => !selected.includes(name))
  const realCatalogCount = excluded.filter((name) => name === 'real-catalog.test.ts').length
  const browserCount = excluded.length - realCatalogCount
  if (excluded.length > 0) {
    console.log(
      `${daily ? 'Daily' : 'Release'} ${suite}: excluded ${browserCount} browser file(s), ${realCatalogCount} real-catalog file(s); run npm run test:full for full coverage.`,
    )
  }
}
run(process.execPath, [
  '--experimental-strip-types',
  '--test',
  '--test-reporter=./scripts/test-reporter.mjs',
  ...paths,
])
