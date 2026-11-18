import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const reporter = fileURLToPath(new URL('./test-reporter.mjs', import.meta.url))

/** @param {string | Record<string, string>} source */
function runFixture(source) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-test-reporter-'))
  try {
    const fixtures = Object.entries(
      typeof source === 'string' ? { 'fixture.test.mjs': source } : source,
    ).map(([name, contents]) => {
      const fixture = join(dir, name)
      writeFileSync(
        fixture,
        `import { test } from 'node:test'\nimport assert from 'node:assert/strict'\n${contents}`,
      )
      return fixture
    })
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const result = spawnSync(
      process.execPath,
      ['--test', '--test-concurrency=1', `--test-reporter=${reporter}`, ...fixtures],
      { encoding: 'utf8', env, timeout: 15_000 },
    )
    if (result.error) throw result.error
    return result
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('summarizes success and explains skips while hiding passing test output', () => {
  const result = runFixture(`
    test('pass', () => console.log('noisy output'))
    test('skipped', { skip: 'runtime unavailable' }, () => {})
    test('warn', (t) => {
      console.error('expected stderr')
      process.emitWarning('passing warning')
      t.diagnostic('passing diagnostic')
    })
  `)
  assert.equal(result.status, 0)
  assert.match(result.stdout, /Tests: 3; passed: 2; failed: 0; cancelled: 0; skipped: 1/)
  assert.match(result.stdout, /Skipped \(1\): runtime unavailable/)
  assert.doesNotMatch(
    result.stdout,
    /noisy output|expected stderr|passing warning|passing diagnostic/,
  )
})

test('retains failure details and stdout without repeating the parent failure', () => {
  const result = runFixture(`
    test('parent', async (t) => {
      console.log('failure context')
      await t.test('child', (child) => {
        console.error('failure stderr')
        child.diagnostic('failure diagnostic')
        assert.equal(1, 2)
      })
    })
  `)
  assert.equal(result.status, 1)
  assert.match(result.stdout, /FAIL child .*fixture\.test\.mjs/)
  assert.match(result.stdout, /AssertionError/)
  assert.match(result.stdout, /1 !== 2/)
  assert.match(result.stdout, /failure context/)
  assert.match(result.stdout, /failure stderr/)
  assert.match(result.stdout, /failure diagnostic/)
  assert.doesNotMatch(result.stdout, /FAIL parent/)
  assert.match(result.stdout, /failed: 2/)
})

test('shows only the failed file output when passing and failing files run together', () => {
  const result = runFixture({
    'a-failing.test.mjs': `test('fail', () => {
      console.error('failure context')
      throw new Error('broken contract')
    })`,
    'b-passing.test.mjs': `test('pass', (t) => {
      console.log('passing stdout', 'x'.repeat(300_000))
      console.error('passing stderr')
      t.diagnostic('passing diagnostic')
    })`,
  })
  assert.equal(result.status, 1)
  assert.match(result.stdout, /Tests: 2; passed: 1; failed: 1/)
  assert.match(result.stdout, /broken contract/)
  assert.match(result.stdout, /failure context/)
  assert.doesNotMatch(
    result.stdout,
    /passing stdout|passing stderr|passing diagnostic|earlier output truncated/,
  )
})

test('reports a test file that crashes before registering tests', () => {
  const result = runFixture(`
    console.error('startup context')
    throw new Error('test file could not load')
  `)
  assert.equal(result.status, 1)
  assert.match(result.stdout, /failed: 1/)
  assert.match(result.stdout, /test file could not load/)
  assert.match(result.stdout, /startup context/)
})

test('retains asynchronous process errors after a passing test finishes', () => {
  const result = runFixture(`
    test('late error', () => {
      setImmediate(() => { throw new Error('asynchronous failure') })
    })
  `)
  assert.equal(result.status, 1)
  assert.match(result.stdout, /asynchronous failure/)
  assert.match(result.stdout, /failed: 1/)
})

test('bounds captured failure output while retaining its tail and failure details', () => {
  const result = runFixture(`
    test('large log', () => {
      console.error('x'.repeat(300_000))
      console.error('last failure context')
      throw new Error('failed after a large log')
    })
  `)
  assert.equal(result.status, 1)
  assert.match(result.stdout, /earlier output truncated/)
  assert.match(result.stdout, /last failure context/)
  assert.match(result.stdout, /failed after a large log/)
  assert.ok(result.stdout.length < 270_000)
})

test('reports a cancelled test and its cause', () => {
  const result = runFixture(`
    test('parent', (t) => {
      t.test('unfinished', () => new Promise(() => {}))
      throw new Error('parent failed')
    })
  `)
  assert.equal(result.status, 1)
  assert.match(result.stdout, /FAIL unfinished/)
  assert.match(result.stdout, /cancelled: 1/)
  assert.match(result.stdout, /test did not finish before its parent and was cancelled/)
})
