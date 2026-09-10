import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { buildPresentation } from '../../src/presentation/build/index.ts'
import { parsePresentationDocument } from '../../src/presentation/contracts/index.ts'

test('portable HTML preserves Python and SQL snapshots without a report source fallback', async () => {
  const document = parsePresentationDocument(
    JSON.parse(
      await readFile(
        new URL('../presentation-s0/fixtures/artifact.document.json', import.meta.url),
        'utf8',
      ),
    ),
  )
  const python = 'print("</script><img src=x onerror=attack()>")\n# 原文 📊\n'
  const sql = "SELECT 'literal-value', '</script><img src=x onerror=attack()>'\n"
  document.datasets[0]!.code = [
    {
      language: 'python',
      text: python,
      provenance: 'execution',
      executionId: '12345678-1234-4567-89ab-123456789abc',
      sha256: 'b'.repeat(64),
    },
  ]
  const source = document.sources[0]!
  assert.equal(source.status, 'available')
  source.code = {
    snippets: [
      {
        language: 'sql',
        text: sql,
        provenance: 'execution',
        artifactRef: source.ref.artifactRef,
        runId: 'run-actual',
        queryId: 'query-actual',
      },
    ],
    notices: [],
  }
  const built = await buildPresentation(document)
  const html = built.htmlBytes.toString('utf8')
  const embedded = JSON.parse(
    html.match(/<script id="presentation-data" type="application\/json">([\s\S]*?)<\/script>/)![1]!,
  )
  assert.deepEqual(embedded, JSON.parse(built.documentBytes.toString('utf8')))
  assert.equal(embedded.datasets[0].code[0].text, python)
  assert.equal(embedded.sources[0].code.snippets[0].text, sql)
  const fallback = html.split('<div id="reader">')[0]!
  assert.doesNotMatch(
    fallback,
    /<details class="pr-source-summary"|<code class="language-(?:python|sql)"/,
  )
  assert.match(html, /&#39;wasm-unsafe-eval&#39;/)
  assert.doesNotMatch(html, /<img src=x|<script[^>]+src=/)

  document.sources = []
  document.datasets[0]!.origin = 'computed'
  document.datasets[0]!.sourceIds = []
  document.blocks = [{ id: 'python-only', kind: 'table', datasetId: document.datasets[0]!.id }]
  const onlyPython = (await buildPresentation(document)).htmlBytes.toString('utf8')
  assert.doesNotMatch(
    onlyPython.split('<div id="reader">')[0]!,
    /<details class="pr-source-summary"/,
  )
})
