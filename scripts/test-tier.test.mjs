import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

/** @param {string} suite @param {'daily' | 'release' | 'full'} tier */
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

test('release excludes browser files while retaining mixed contracts and real catalog tests', () => {
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
    const full = list(suite, 'full')
    const release = list(suite, 'release')
    const daily = list(suite, 'daily')
    assert.deepEqual(full, all)
    for (const file of release) assert.ok(full.includes(file), file)
    for (const file of daily) assert.ok(release.includes(file), file)
    assert.ok(release.every((file) => !file.endsWith('.browser.test.ts')))
    const catalog = all.find((file) => path.basename(file) === 'real-catalog.test.ts')
    if (catalog) {
      assert.ok(release.includes(catalog))
      assert.ok(!daily.includes(catalog))
    }
    if (suite === 'unified-analysis-ui') {
      for (const name of [
        'frame-browser.test.ts',
        'domain-points.test.ts',
        'frame-comparison-render.test.ts',
      ]) {
        assert.ok(full.some((file) => path.basename(file) === name))
        assert.ok(!release.some((file) => path.basename(file) === name))
      }
      for (const name of ['data-view.test.ts', 'frame-display-metadata.test.ts']) {
        assert.ok(release.some((file) => path.basename(file) === name))
      }
    }
  }
  assert.ok(
    list('presentation-integration', 'release').some(
      (file) => path.basename(file) === 'report-data-update.test.ts',
    ),
  )
})
