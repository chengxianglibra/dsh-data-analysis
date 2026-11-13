import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

test('source typechecking ignores conflicting declarations from an older build', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-typecheck-'))
  const source = path.join(root, 'packages/dsh-data-analysis/src')
  const build = path.join(root, 'packages/dsh-data-analysis/lib/types')
  try {
    mkdirSync(source, { recursive: true })
    mkdirSync(build, { recursive: true })
    copyFileSync('tsconfig.json', path.join(root, 'tsconfig.json'))
    symlinkSync(path.resolve('node_modules'), path.join(root, 'node_modules'), 'dir')
    writeFileSync(
      path.join(source, 'fixture.d.ts'),
      "declare module 'fixture' { interface Locale {} }\n",
    )
    writeFileSync(
      path.join(source, 'host.ts'),
      "import type {} from 'fixture'\ndeclare module 'fixture' { interface Locale { label: 'current' } }\n",
    )
    writeFileSync(
      path.join(build, 'host.d.ts'),
      "import type {} from 'fixture'\ndeclare module 'fixture' { interface Locale { label: 'stale' } }\n",
    )
    writeFileSync(
      path.join(root, 'with-build.json'),
      JSON.stringify({ extends: './tsconfig.json', exclude: [] }),
    )
    const tsc = path.resolve('node_modules/typescript/bin/tsc')
    /** @param {string} config */
    const compile = (config) =>
      spawnSync(process.execPath, [tsc, '-p', config], { cwd: root, encoding: 'utf8' })
    const staleIncluded = compile('with-build.json')
    assert.notEqual(staleIncluded.status, 0)
    assert.match(staleIncluded.stdout, /TS2717/)
    const current = compile('tsconfig.json')
    assert.equal(current.status, 0, `${current.stdout}\n${current.stderr}`)
    writeFileSync(path.join(source, 'invalid.ts'), 'const value: string = 42\nvoid value\n')
    const invalid = compile('tsconfig.json')
    assert.notEqual(invalid.status, 0)
    assert.match(invalid.stdout, /TS2322/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
