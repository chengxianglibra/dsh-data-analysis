import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  assertCompatibleVersion,
  assertHostIdentity,
  assertProductionImport,
  checkPluginDependencies,
  checkProductionSource,
} from './dependency-policy.mjs'

const range = '^0.1.5-alpha.1'
for (const version of ['0.1.5-alpha.1', '0.1.5-alpha.2', '0.1.5-rc.1', '0.1.5', '0.1.6', '0.1.99'])
  test(`compatibility admits ${version} without requiring exact baseline equality`, () => {
    assert.doesNotThrow(() => assertCompatibleVersion('fixture', version, range))
  })
for (const version of [
  '0.1.2-rc.1',
  '0.1.5-alpha.0',
  '0.1.6-alpha.1',
  '0.2.0-alpha.1',
  '0.2.0',
  '1.0.0',
  'invalid',
])
  test(`compatibility rejects ${version}`, () => {
    assert.throws(
      () => assertCompatibleVersion('fixture', version, range),
      /compatibility requires/,
    )
  })
test('different service package versions may both satisfy the contract; duplicate identities cannot', () => {
  assertCompatibleVersion('service-a', '0.1.5', range)
  assertCompatibleVersion('service-b', '0.1.6', range)
  assertHostIdentity(
    '@deepseek-ai/cordis',
    '/host/cordis/package.json',
    '/host/cordis/package.json',
  )
  assert.throws(
    () =>
      assertHostIdentity(
        '@deepseek-ai/cordis',
        '/plugin/cordis/package.json',
        '/host/cordis/package.json',
      ),
    /duplicate-host-instance/,
  )
})
test('production import guard permits public Session types, rejects persistence and external implementation paths', () => {
  const root = path.resolve('fixture/src'),
    filename = path.join(root, 'feature/index.ts')
  assertProductionImport(filename, '@deepseek-ai/dsh-session', root)
  assertProductionImport(filename, '../lifecycle.ts', root)
  for (const specifier of [
    '@deepseek-ai/dsh-session-persistence',
    '@deepseek-ai/dsh-session-persistence-jsonl',
    '../../scripts/validation.ts',
    '/neighbor/host.ts',
    'file:../harness',
  ])
    assert.throws(() => assertProductionImport(filename, specifier, root), /import/)
})
test('production graph parses reexports, import types and literal dynamic imports and rejects escaping symlinks', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-dependency-policy-'))
  try {
    const source = path.join(root, 'src')
    mkdirSync(source)
    const main = path.join(source, 'index.ts')
    writeFileSync(
      main,
      '// import("@deepseek-ai/dsh-session-persistence")\nimport type {} from "@deepseek-ai/dsh-session"',
    )
    assert.doesNotThrow(() => checkProductionSource(source))
    for (const code of [
      'export * from "@deepseek-ai/dsh-session-persistence"',
      'type T = import("@deepseek-ai/dsh-session-persistence").SessionPersistence',
      'const result = import("@deepseek-ai/dsh-session-persistence-jsonl")',
    ]) {
      writeFileSync(main, code)
      assert.throws(() => checkProductionSource(source), /validation-only-import/)
    }
    writeFileSync(path.join(root, 'outside.ts'), 'export const x = 1')
    symlinkSync(path.join(root, 'outside.ts'), path.join(source, 'alias.ts'))
    writeFileSync(main, 'export * from "./alias.ts"')
    assert.throws(() => checkProductionSource(source), /production-import-outside-src/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('resolved dependency fixture accepts workspace links and mixed compatible services but rejects a second Host instance', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-resolution-policy-'))
  /** @param {string} filename @param {unknown} value */
  const write = (filename, value) => {
    mkdirSync(path.dirname(filename), { recursive: true })
    writeFileSync(filename, JSON.stringify(value))
  }
  try {
    const plugin = path.join(root, 'packages/dsh-data-analysis')
    write(path.join(root, 'package.json'), {})
    write(path.join(plugin, 'package.json'), {
      dshDataAnalysisCompatibility: { dsh: { peerRange: range } },
      peerDependencies: { '@deepseek-ai/dsh-agent': range, '@deepseek-ai/dsh-tools': range },
    })
    mkdirSync(path.join(plugin, 'src'))
    for (const [name, version] of [
      ['dsh', '0.1.5'],
      ['cordis', '4.0.2'],
      ['dsh-agent', '0.1.5'],
      ['dsh-tools', '0.1.6'],
    ])
      write(path.join(root, 'node_modules/@deepseek-ai', name ?? '', 'package.json'), {
        name: '@deepseek-ai/' + name,
        version,
      })
    const linked = path.join(plugin, 'node_modules/@deepseek-ai')
    mkdirSync(linked, { recursive: true })
    symlinkSync(
      path.join(root, 'node_modules/@deepseek-ai/dsh-agent'),
      path.join(linked, 'dsh-agent'),
    )
    assert.equal(checkPluginDependencies(root).peers, 2)
    write(path.join(linked, 'cordis/package.json'), {
      name: '@deepseek-ai/cordis',
      version: '4.0.2',
    })
    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [
            '--input-type=module',
            '-e',
            `import { checkPluginDependencies } from ${JSON.stringify(new URL('./dependency-policy.mjs', import.meta.url).href)}; checkPluginDependencies(${JSON.stringify(root)})`,
          ],
          { stdio: 'pipe' },
        ),
      /duplicate-host-instance/,
    )
    rmSync(path.join(linked, 'cordis'), { recursive: true })
    write(path.join(root, 'node_modules/@deepseek-ai/dsh-tools/package.json'), {
      name: '@deepseek-ai/dsh-tools',
      version: '0.2.0',
    })
    assert.throws(() => checkPluginDependencies(root), /compatibility requires/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
