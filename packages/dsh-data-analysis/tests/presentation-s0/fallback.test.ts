import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { assertBrowserInputs, renderS0Fallback } from '../../scripts/presentation-s0/build.ts'
import { parsePresentationDocument } from '../../src/presentation/contracts/index.ts'

const fixture = (name: string) =>
  parsePresentationDocument(
    JSON.parse(readFileSync(new URL(`./fixtures/${name}.document.json`, import.meta.url), 'utf8')),
  )

test('fallback retains explicit metric cell, label and unit in document block order', () => {
  const document = fixture('computed')
  document.blocks = [
    { id: 'intro', kind: 'markdown', text: '先读正文' },
    {
      id: 'metric',
      kind: 'metric',
      datasetId: 'computed',
      columnId: 'amount',
      rowIndex: 2,
      label: '精确金额',
    },
    { id: 'end', kind: 'markdown', text: '后读正文' },
  ]
  const html = renderS0Fallback(document)
  assert.match(html, /<h2>精确金额<\/h2><strong>0\.1000 CNY<\/strong>/)
  assert.ok(html.indexOf('先读正文') < html.indexOf('<h2>精确金额'))
  assert.ok(html.indexOf('<h2>精确金额') < html.indexOf('后读正文'))
  assert.doesNotMatch(html, /<table/)
})

test('fallback table honors selected column order and does not expose omitted columns', () => {
  const document = fixture('computed')
  document.blocks = [
    { id: 'selected', kind: 'table', datasetId: 'computed', columns: ['account_id', 'amount'] },
  ]
  const html = renderS0Fallback(document)
  assert.match(html, /<thead><tr><th>大整数标识<\/th><th>精确金额 \(CNY\)<\/th><\/tr><\/thead>/)
  assert.match(html, /<tr><td>9007199254740993<\/td><td>12345678901234\.5678<\/td><\/tr>/)
  assert.match(html, /<tr><td>9223372036854775807<\/td><td>—<\/td><\/tr>/)
  assert.match(html, /显示 3 \/ 5 行（已截断；不能代表全量汇总）/)
  assert.doesNotMatch(html, /<th>月份<\/th>|2026-01-01|<td>一月<\/td>/)
})

test('fallback includes exact Finding identity and actual unavailable reason without a fabricated dataset', () => {
  const document = fixture('artifact')
  document.blocks = [{ id: 'sources', kind: 'source', sourceIds: ['sales'] }]
  const ref = document.sources[0]!.ref
  const html = renderS0Fallback(document)
  assert.ok(html.includes(`<code>${ref.sessionId} / ${ref.artifactRef} / ${ref.findingId}</code>`))
  assert.doesNotMatch(html, /<table/)
  const sourceOnly = fixture('source-only')
  const sourceOnlyHtml = renderS0Fallback(sourceOnly)
  const source = sourceOnly.sources[0]!
  assert.equal(source.status, 'unavailable')
  assert.ok(sourceOnlyHtml.includes(source.reason))
  assert.ok(sourceOnlyHtml.includes(source.ref.artifactRef))
  assert.doesNotMatch(sourceOnlyHtml, /<table/)
})

test('chart-only fallback retains exact selected values and identifies approximate chart encoding', () => {
  const document = fixture('computed')
  document.blocks = [
    {
      id: 'chart',
      kind: 'chart',
      datasetId: 'computed',
      chart: 'line',
      x: 'period',
      y: ['amount'],
      numericMode: 'approximate',
    },
  ]
  const html = renderS0Fallback(document)
  assert.match(html, /图形使用近似值；下表保留精确值。/)
  assert.match(html, /<td>12345678901234\.5678<\/td>/)
  assert.match(html, /<td>0\.1000<\/td>/)
  assert.doesNotMatch(html, /9007199254740993/)
})

test('fallback escapes all authored display content and keeps Markdown as plain text', () => {
  const document = fixture('computed')
  document.title = '<script>alert("title")</script>'
  document.datasets[0]!.data.columns[1]!.unit = '<img src=x>'
  document.blocks = [
    { id: 'text', kind: 'markdown', text: '**plain** <img src=x onerror=alert(1)>' },
    {
      id: 'metric',
      kind: 'metric',
      datasetId: 'computed',
      columnId: 'amount',
      rowIndex: 0,
      label: '<script>metric</script>',
    },
    { id: 'source', kind: 'source', sourceIds: ['sales'] },
  ]
  document.sources[0]!.ref.findingId = '<script>finding</script>'
  const html = renderS0Fallback(parsePresentationDocument(document))
  assert.doesNotMatch(html, /<script|<img|<em|<b>/)
  assert.ok(html.includes('**plain** &lt;img src=x onerror=alert(1)&gt;'))
  assert.ok(html.includes('&lt;script&gt;finding&lt;/script&gt;'))
  assert.ok(html.includes('12345678901234.5678 &lt;img src=x&gt;'))
})

test('browser input boundary rejects bundled or external Host packages in both builds', () => {
  for (const portable of [false, true]) {
    for (const input of [
      'node_modules/@deepseek-ai/dsh/dist/index.js',
      '/workspace/node_modules/@deepseek-ai/dsh-plugin-sdk/dist/client.js',
      'node_modules/.pnpm/sdk/node_modules/@deepseek-ai/sdk/index.js',
    ]) {
      assert.throws(
        () =>
          assertBrowserInputs(
            { inputs: { [input]: { bytes: 1, imports: [] } }, outputs: {} },
            portable,
          ),
        /host-module-in-browser/,
      )
    }
    assert.throws(
      () =>
        assertBrowserInputs(
          {
            inputs: {},
            outputs: {
              'browser.js': {
                bytes: 1,
                inputs: {},
                exports: [],
                imports: [
                  { path: '@deepseek-ai/dsh/client', external: true, kind: 'import-statement' },
                ],
              },
            },
          },
          portable,
        ),
      /unexpected-browser-external/,
    )
    assert.doesNotThrow(() =>
      assertBrowserInputs(
        {
          inputs: {
            'packages/dsh-data-analysis/src/presentation/contracts/index.ts': {
              bytes: 1,
              imports: [],
            },
          },
          outputs: {},
        },
        portable,
      ),
    )
  }
})
