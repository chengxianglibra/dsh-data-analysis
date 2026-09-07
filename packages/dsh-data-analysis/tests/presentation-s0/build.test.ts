import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { assertBrowserInputs, buildS0Artifacts } from '../../scripts/presentation-s0/build.ts'
import { sha256 } from '../../scripts/presentation-s0/files.ts'
import { parsePresentationDocument } from '../../src/presentation/contracts/index.ts'

test('S0 Host and portable bundle the same reader, preserve exact payload and close resources', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'presentation-s0-build-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const document = parsePresentationDocument(
    JSON.parse(await readFile(new URL('fixtures/computed.document.json', import.meta.url), 'utf8')),
  )
  document.title = '</script><script>throw new Error("author-script")</script>'
  const built = await buildS0Artifacts(root, [document])
  const receipt = built.receipts[0]!
  const json = await readFile(receipt.files.document.path)
  const html = await readFile(receipt.files.html.path, 'utf8')
  assert.equal(sha256(json), receipt.files.document.sha256)
  assert.equal(sha256(Buffer.from(html)), receipt.files.html.sha256)
  const payload = /<script id="presentation-data" type="application\/json">(.*?)<\/script>/s.exec(
    html,
  )![1]!
  assert.deepEqual(JSON.parse(payload), JSON.parse(json.toString()))
  assert.doesNotMatch(html, /<script(?:\s[^>]*?)?\s+src=/i)
  assert.doesNotMatch(payload, /</)
  assert.ok(html.includes('9007199254740993'))
  assert.ok(html.includes('12345678901234.5678'))
  const noticePayload =
    /<script id="third-party-notices" type="application\/json">(.*?)<\/script>/s.exec(html)![1]!
  const portableNotices = JSON.parse(noticePayload) as {
    package: string
    version: string
    files: { file: string; text: string; sourceUrl?: string }[]
  }[]
  const hostNotices = JSON.parse(
    /^\/\*! Third-party notices\n(.*?)\n\*\//s.exec(built.client)![1]!,
  ) as typeof portableNotices
  assert.doesNotMatch(noticePayload, /</)
  const installedNotice = (name: string, file: string) =>
    readFile(new URL(`../../../../node_modules/${name}/${file}`, import.meta.url), 'utf8')
  for (const notices of [portableNotices, hostNotices]) {
    for (const [name, file] of [
      ['recharts', 'LICENSE'],
      ['d3-scale', 'LICENSE'],
      ['es-toolkit', 'NOTICE'],
    ] as const) {
      const notice = notices.find((notice) => notice.package === name)!
      assert.ok(notice, `Missing ${name} notice`)
      assert.equal(
        notice.files.find((entry) => entry.file === file)!.text,
        await installedNotice(name, file),
      )
    }
    const victory = notices.find((notice) => notice.package === 'victory-vendor')!
    assert.equal(victory.version, '37.3.6')
    assert.equal(
      victory.files[0]!.sourceUrl,
      'https://raw.githubusercontent.com/FormidableLabs/victory/v37.3.6/LICENSE.txt',
    )
    assert.equal(
      victory.files[0]!.text,
      await readFile(
        new URL(
          '../../scripts/presentation-s0/third-party/victory-vendor-37.3.6-LICENSE.txt',
          import.meta.url,
        ),
        'utf8',
      ),
    )
  }
  assert.ok(portableNotices.some((notice) => notice.package === 'react'))
  assert.ok(portableNotices.some((notice) => notice.package === 'react-dom'))
  assert.ok(
    !hostNotices.some((notice) => notice.package === 'react' || notice.package === 'react-dom'),
  )
  for (const meta of [built.hostMetafile, built.portableMetafile]) {
    assert.ok(
      Object.keys(meta.inputs).some((input) => input.endsWith('presentation-s0/reader.tsx')),
    )
    assert.ok(Object.keys(meta.inputs).some((input) => input.includes('recharts/')))
  }
  assert.ok(
    Object.keys(built.portableMetafile.inputs).some((input) => input.includes('react-dom/')),
  )
  assert.ok(
    !Object.keys(built.hostMetafile.inputs).some((input) =>
      /node_modules\/(react|react-dom)\//.test(input),
    ),
  )
  assert.ok(
    Object.values(built.portableMetafile.outputs).every((output) => output.imports.length === 0),
  )
})

test('S0 browser allowlist rejects Node, credential and unrelated local modules', () => {
  for (const input of [
    'packages/dsh-data-analysis/src/datasource/service.ts',
    'packages/dsh-data-analysis/src/environment/runtime.ts',
    'packages/dsh-data-analysis/scripts/presentation-s0/files.ts',
  ]) {
    assert.throws(
      () =>
        assertBrowserInputs({ inputs: { [input]: { bytes: 1, imports: [] } }, outputs: {} }, false),
      /host-module-in-browser/,
    )
  }
  assert.throws(
    () =>
      assertBrowserInputs(
        { inputs: { 'node_modules/react/index.js': { bytes: 1, imports: [] } }, outputs: {} },
        false,
      ),
    /duplicate-host-react/,
  )
})
