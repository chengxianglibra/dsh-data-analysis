import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const reporter = fileURLToPath(new URL('./test-reporter.mjs', import.meta.url))

/** @param {string} source */
function runFixture(source) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-test-reporter-'))
  try {
    const fixture = join(dir, 'fixture.test.mjs')
    writeFileSync(
      fixture,
      `import { test } from 'node:test'\nimport assert from 'node:assert/strict'\n${source}`,
    )
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    return spawnSync(process.execPath, ['--test', `--test-reporter=${reporter}`, fixture], {
      encoding: 'utf8',
      env,
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('summarizes success and explains skips while hiding passing test output', () => {
  const result = runFixture(`
    test('pass', () => console.log('noisy output'))
    test('skipped', { skip: 'runtime unavailable' }, () => {})
    test('warn', () => process.emitWarning('actionable warning'))
  `)
  assert.equal(result.status, 0)
  assert.match(result.stdout, /Tests: 3; passed: 2; failed: 0; cancelled: 0; skipped: 1/)
  assert.match(result.stdout, /Skipped \(1\): runtime unavailable/)
  assert.match(result.stdout, /actionable warning/)
  assert.doesNotMatch(result.stdout, /noisy output/)
})

test('retains failure details and stdout without repeating the parent failure', () => {
  const result = runFixture(`
    test('parent', async (t) => {
      console.log('failure context')
      await t.test('child', () => assert.equal(1, 2))
    })
  `)
  assert.equal(result.status, 1)
  assert.match(result.stdout, /FAIL child .*fixture\.test\.mjs/)
  assert.match(result.stdout, /AssertionError/)
  assert.match(result.stdout, /1 !== 2/)
  assert.match(result.stdout, /failure context/)
  assert.doesNotMatch(result.stdout, /FAIL parent/)
  assert.match(result.stdout, /failed: 2/)
})

test('reports a cancelled test and its cause', () => {
  const result = runFixture("test('unfinished', () => new Promise(() => {}))")
  assert.equal(result.status, 1)
  assert.match(result.stdout, /FAIL unfinished/)
  assert.match(result.stdout, /cancelled: 1/)
  assert.match(result.stdout, /Promise resolution is still pending/)
})
