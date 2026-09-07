import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import type { Metafile } from 'esbuild'
import { buildPresentation as buildSourcePresentation } from '../../src/presentation/build/index.ts'
import {
  PRESENTATION_BUDGETS,
  parsePresentationDocument,
  PresentationContractError as SourceContractError,
} from '../../src/presentation/contracts/index.ts'

const { buildPresentation } = (await import(
  new URL('../../lib/presentation/build/index.js', import.meta.url).href
)) as typeof import('../../src/presentation/build/index.ts')
const { PresentationContractError } = (await import(
  new URL('../../lib/presentation/contracts/index.js', import.meta.url).href
)) as typeof import('../../src/presentation/contracts/index.ts')
const { assertBrowserInputs } = (await import(
  new URL('../../scripts/presentation-build/shared.mjs', import.meta.url).href
)) as { assertBrowserInputs: (meta: Metafile, options: { portable: boolean }) => void }

const fixture = async (name = 'computed') =>
  parsePresentationDocument(
    JSON.parse(
      await readFile(
        new URL(`../presentation-s0/fixtures/${name}.document.json`, import.meta.url),
        'utf8',
      ),
    ),
  )

function embeddedJson(html: string, id: string): string {
  const match = new RegExp(`<script id="${id}" type="application/json">(.*?)</script>`, 's').exec(
    html,
  )
  assert.ok(match, `Missing ${id} payload`)
  return match[1]!
}

test('builder preserves the S2 snapshot and static reader content for every fixture', async () => {
  for (const name of ['computed', 'artifact', 'source-only']) {
    const document = await fixture(name)
    const built = await buildPresentation(document)
    assert.deepEqual(Object.keys(built).sort(), ['document', 'documentBytes', 'htmlBytes'])
    assert.deepEqual(built.document, document)
    assert.notEqual(built.document, document)
    assert.ok(Buffer.isBuffer(built.documentBytes))
    assert.ok(Buffer.isBuffer(built.htmlBytes))
    const html = built.htmlBytes.toString('utf8')
    assert.deepEqual(JSON.parse(built.documentBytes.toString('utf8')), document)
    assert.deepEqual(JSON.parse(embeddedJson(html, 'presentation-data')), document)
    assert.ok(built.htmlBytes.length < PRESENTATION_BUDGETS.htmlBytes)
    assert.match(html, /^<!doctype html>/)
    assert.match(html, /<div id="presentation-fallback"><article/)
    assert.doesNotMatch(html, /<(?:script|img|iframe)[^>]*\ssrc=|<link[^>]*\shref=/i)
    for (const source of document.sources) {
      assert.ok(html.includes(source.ref.sessionId))
      assert.ok(html.includes(source.ref.artifactRef))
    }
    if (name === 'computed') {
      const fallback = html.split('<div id="reader">')[0]!
      assert.ok(fallback.includes('9007199254740993'))
      assert.ok(fallback.includes('12345678901234.5678'))
      assert.ok(fallback.includes('<table'))
    }
  }
})

test('builder snapshots before yielding and does not change identity or caller data', async () => {
  const document = await fixture()
  const snapshot = structuredClone(document)
  const result = buildPresentation(document)
  document.title = 'Changed by caller after invocation'
  document.datasets[0]!.data.rows[0]![0] = 'changed'
  const built = await result
  assert.deepEqual(built.document, snapshot)
  assert.deepEqual(JSON.parse(built.documentBytes.toString()), snapshot)
  assert.equal(document.title, 'Changed by caller after invocation')
})

test('source callers use the same prebuilt assets and their own shared contract module', async () => {
  const document = await fixture()
  assert.deepEqual(await buildSourcePresentation(document), await buildPresentation(document))
  document.datasets[0]!.data.rows[0] = []
  await assert.rejects(buildSourcePresentation(document), SourceContractError)
})

test('builder escapes authored HTML and hashes only the packaged runtime for CSP', async () => {
  const document = await fixture()
  const authored =
    '</ScRiPt><script>globalThis.AUTHOR_SCRIPT=true</script><img src="https://example.invalid/a">\u2028\u2029'
  document.title = authored
  document.blocks.unshift({ id: 'unsafe-markdown', kind: 'markdown', text: authored })
  const html = (await buildPresentation(document)).htmlBytes.toString('utf8')
  const payload = embeddedJson(html, 'presentation-data')
  assert.doesNotMatch(payload, /<|\u2028|\u2029/)
  assert.deepEqual(JSON.parse(payload), document)
  assert.doesNotMatch(html, /<script>globalThis\.AUTHOR_SCRIPT|<img src="https:/)
  assert.match(html, /&lt;\/ScRiPt&gt;/)
  const script = /<script id="presentation-runtime">(.*?)<\/script>/s.exec(html)?.[1]
  assert.ok(script)
  const hash = createHash('sha256').update(script).digest('base64')
  assert.ok(html.includes(`script-src &#39;sha256-${hash}&#39;`))
  assert.match(html, /connect-src &#39;none&#39;/)
  assert.match(html, /default-src &#39;none&#39;/)
  assert.doesNotMatch(html, /script-src &#39;unsafe-inline&#39;/)
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<style>'))
})

test('builder rejects invalid documents and HTML expansion beyond the shared budget', async () => {
  const invalid = await fixture()
  invalid.datasets[0]!.data.rows[0] = []
  await assert.rejects(buildPresentation(invalid), (error: unknown) => {
    assert.ok(error instanceof PresentationContractError)
    assert.match(error.message, /rows/)
    return true
  })
  const large = await fixture('source-only')
  large.blocks = Array.from({ length: PRESENTATION_BUDGETS.blocks }, (_, index) => ({
    id: `large-${index}`,
    kind: 'markdown',
    text: '&'.repeat(PRESENTATION_BUDGETS.text),
  }))
  assert.doesNotThrow(() => parsePresentationDocument(large))
  await assert.rejects(buildPresentation(large), (error: unknown) => {
    assert.ok(error instanceof PresentationContractError)
    assert.equal(error.code, 'budget')
    assert.equal(error.path, '/html')
    return true
  })
})

test('browser build boundary rejects Host code, duplicate React and unknown externals', () => {
  const inputs = (input: string): Metafile => ({
    inputs: { [input]: { bytes: 1, imports: [] } },
    outputs: {},
  })
  const external = (module: string): Metafile => ({
    inputs: {},
    outputs: {
      'reader.js': {
        imports: [{ path: module, kind: 'import-statement', external: true }],
        exports: [],
        inputs: {},
        bytes: 1,
      },
    },
  })
  for (const input of [
    'packages/dsh-data-analysis/src/presentation/projection/index.ts',
    'packages/dsh-data-analysis/src/datasource/service.ts',
    'packages/dsh-data-analysis/src/environment/runtime.ts',
    'packages/dsh-data-analysis/scripts/presentation-s0/files.ts',
    'node_modules/@deepseek-ai/dsh-credentials/index.js',
  ]) {
    for (const portable of [true, false]) {
      assert.throws(
        () => assertBrowserInputs(inputs(input), { portable }),
        /host-module-in-browser/,
      )
    }
  }
  for (const input of ['node_modules/react/index.js', 'node_modules/react-dom/client.js']) {
    assert.throws(
      () => assertBrowserInputs(inputs(input), { portable: false }),
      /duplicate-host-react/,
    )
    assert.doesNotThrow(() => assertBrowserInputs(inputs(input), { portable: true }))
  }
  for (const module of [
    'react',
    'react/jsx-runtime',
    'react-dom/client',
    '@deepseek-ai/dsh-client-connection',
    '@deepseek-ai/dsh-client-connection/subpath',
  ]) {
    assert.doesNotThrow(() => assertBrowserInputs(external(module), { portable: false }))
    assert.throws(
      () => assertBrowserInputs(external(module), { portable: true }),
      /unexpected-browser-external/,
    )
  }
  for (const module of [
    'node:fs',
    'recharts',
    '@deepseek-ai/undeclared-host-module',
    'https://example.invalid/runtime.js',
    './host.js',
  ]) {
    for (const portable of [true, false]) {
      assert.throws(
        () => assertBrowserInputs(external(module), { portable }),
        /unexpected-browser-external/,
      )
    }
  }
})

test('portable includes complete notices and isolated packaged builder needs no dependencies', async (t) => {
  const built = await buildPresentation(await fixture())
  const notices = JSON.parse(embeddedJson(built.htmlBytes.toString(), 'third-party-notices')) as {
    package: string
    version: string
    files: { file: string; text: string; sourceUrl?: string }[]
  }[]
  for (const [name, file] of [
    ['react', 'LICENSE'],
    ['react-dom', 'LICENSE'],
    ['recharts', 'LICENSE'],
    ['d3-scale', 'LICENSE'],
    ['es-toolkit', 'NOTICE'],
  ] as const) {
    const notice = notices.find((notice) => notice.package === name)
    assert.ok(notice, `Missing ${name} notice`)
    assert.equal(
      notice.files.find((entry) => entry.file === file)?.text,
      await readFile(new URL(`../../../../node_modules/${name}/${file}`, import.meta.url), 'utf8'),
    )
  }
  const victory = notices.find((notice) => notice.package === 'victory-vendor')
  assert.equal(victory?.version, '37.3.6')
  assert.equal(
    victory?.files[0]?.text,
    await readFile(
      new URL(
        '../../scripts/presentation-build/third-party/victory-vendor-37.3.6-LICENSE.txt',
        import.meta.url,
      ),
      'utf8',
    ),
  )
  const root = await mkdtemp(path.join(tmpdir(), 'presentation-isolated-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}')
  for (const part of ['assets', 'build', 'contracts']) {
    await cp(
      new URL(`../../lib/presentation/${part}/`, import.meta.url),
      path.join(root, 'lib', 'presentation', part),
      { recursive: true },
    )
  }
  const isolated = (await import(
    pathToFileURL(path.join(root, 'lib/presentation/build/index.js')).href
  )) as typeof import('../../src/presentation/build/index.ts')
  const document = await fixture('source-only')
  assert.deepEqual((await isolated.buildPresentation(document)).document, document)
})
