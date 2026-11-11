import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

/** @param {string} suite @param {'daily' | 'release'} tier */
function list(suite, tier) {
  const result = spawnSync(process.execPath, ['scripts/test-suite.mjs', suite, '--list'], {
    encoding: 'utf8',
    env: { ...process.env, DSH_DATA_ANALYSIS_TEST_TIER: tier },
  })
  assert.equal(result.status, 0, result.stderr)
  /** @type {string[]} */
  const paths = JSON.parse(result.stdout)
  return paths
}

test('release includes all suite files, while daily excludes browser and real catalog tests', () => {
  for (const suite of [
    'unified-analysis-ui',
    'right-tabs',
    'semantic-browser',
    'semantic-reference-input',
  ]) {
    const directory = path.join('packages/dsh-data-analysis/tests', suite)
    const all = readdirSync(directory)
      .filter((name) => name.endsWith('.test.ts'))
      .map((name) => path.join(directory, name))
      .sort()
    const release = list(suite, 'release')
    const daily = list(suite, 'daily')
    assert.deepEqual(release, all)
    assert.ok(daily.length < release.length)
    const skipped = release.filter((file) => !daily.includes(file))
    for (const file of skipped) {
      assert.ok(
        file.endsWith('.browser.test.ts') ||
          file.endsWith('/real-catalog.test.ts') ||
          /from\s*['"]playwright['"]/.test(readFileSync(file, 'utf8')),
        file,
      )
    }
    for (const file of daily) {
      assert.doesNotMatch(readFileSync(file, 'utf8'), /from\s*['"]playwright['"]/, file)
      assert.ok(!file.endsWith('/real-catalog.test.ts'), file)
    }
  }
})
