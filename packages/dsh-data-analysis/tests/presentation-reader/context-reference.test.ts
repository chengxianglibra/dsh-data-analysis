import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { errorMessage as readError, translator } from '../../src/client/i18n/copy.ts'
import {
  initialChartExploration,
  savedChartView,
} from '../../src/client/presentation/chart-view.ts'
import {
  followUpContext,
  PRESENTATION_CONTEXT_BYTES,
  wrapPresentationContext,
} from '../../src/client/presentation/context-reference.ts'
import { selectMetric } from '../../src/client/presentation/model.ts'
import { presentationAssetRelativePath } from '../../src/presentation/contracts/asset-path.ts'
import { parsePresentationDocument } from '../../src/presentation/contracts/index.ts'
import { interactionRows } from '../../src/presentation/contracts/interaction.ts'
import { presentationAssetPath } from '../../src/presentation/files.ts'
import { interactionFixture } from './interaction-fixture.ts'

function field<T>(text: string, name: string): T {
  return JSON.parse(
    text
      .split('\n')
      .find((line) => line.startsWith(`${name}: `))!
      .slice(name.length + 2),
  ) as T
}

test('JSON identity fields round-trip valid special characters without selecting another cell or view', async () => {
  const { document } = await interactionFixture()
  document.title = 'Cell: "foo"'
  document.workspaceId = 'workspace\nCell: "foo"'
  const targetId = 'foo\nbar\r\t"\\😀'
  document.blocks.push(
    { id: 'foo', kind: 'markdown', text: 'wrong cell' },
    { id: targetId, kind: 'markdown', text: 'intended cell' },
  )
  const chart = document.blocks.find((block) => block.kind === 'chart')!
  if (chart.kind !== 'chart') throw new Error('Expected chart')
  const view = savedChartView(chart)
  const preparedId = 'ready\nview\r\t"\\😀'
  chart.preparedViews = [
    { ...view, id: 'ready', label: 'wrong view' },
    { ...view, id: preparedId, label: 'intended view' },
  ]
  const parsed = parsePresentationDocument(document)
  const reference = followUpContext(parsed, parsed.blocks.at(-1)!)
  assert.equal(field(reference, 'Workspace'), document.workspaceId)
  assert.equal(field(reference, 'Cell'), targetId)
  assert.equal(reference.split('\n').filter((line) => line.startsWith('Cell: ')).length, 1)
  assert.equal(parsed.blocks.find((block) => block.id === field(reference, 'Cell'))?.id, targetId)
  const chartReference = followUpContext(parsed, chart, {
    view,
    hidden: [],
    preparedViewId: preparedId,
  })
  const selected = chart.preparedViews.find(
    (entry) => entry.id === field(chartReference, 'Prepared view'),
  )
  assert.equal(selected?.label, 'intended view')
  assert.doesNotMatch(chartReference, /Current chart view override:/)
})

test('locator matches storage; reference plus fixed document resolves filters and exact metric', async () => {
  const { document } = await interactionFixture()
  const metric = document.blocks.find((block) => block.id === 'count')!
  const reference = followUpContext(document, metric, undefined, { day: 'mon', cluster: 'a' })
  const relative = reference
    .split('\n')
    .find((line) => line.startsWith('Report file '))!
    .split(': ')[1]!
  assert.equal(
    path.join('/workspace', relative),
    presentationAssetPath('/workspace', document.reportId, document.buildId, 'presentation.json'),
  )
  const filters = field<{ filterId: string; optionId: string }[]>(reference, 'Filters')
  const chosen = Object.fromEntries(filters.map((filter) => [filter.filterId, filter.optionId]))
  const cellId = field<string>(reference, 'Cell')
  const found = document.blocks.find((block) => block.id === cellId)!
  assert.equal(found.kind, 'metric')
  if (found.kind !== 'metric') throw new Error('Expected metric')
  const data = document.datasets.find((dataset) => dataset.id === found.datasetId)!.data
  assert.equal(
    selectMetric('zh-CN', data, found, interactionRows(document.interaction, chosen, found)).value,
    '150',
  )
  const fixed = document.blocks.find((block) => block.id === 'fixed-count') ?? document.blocks[0]!
  assert.doesNotMatch(followUpContext(document, fixed, undefined, chosen), /Filters:/)
  assert.throws(
    () => followUpContext(document, metric, undefined, { day: 'missing', cluster: 'a' }),
    (error: unknown) => {
      assert.match(translator('zh-CN')(readError(error)), /Unknown/)
      return true
    },
  )
  assert.throws(() => presentationAssetRelativePath('../report', 'build', 'presentation.json'))
})

test('prepared reference reconstructs configuration; only modified views carry overrides', async () => {
  const { document } = await interactionFixture()
  const chart = document.blocks.find((block) => block.kind === 'chart')!
  if (chart.kind !== 'chart') throw new Error('Expected chart')
  const initial = initialChartExploration(chart)
  const base = followUpContext(document, chart)
  assert.equal(followUpContext(document, chart, initial), base)
  // Reordering JSON object keys does not manufacture an exploration.
  const reversed = Object.fromEntries(Object.entries(initial.view).reverse()) as typeof initial.view
  assert.equal(followUpContext(document, chart, { ...initial, view: reversed }), base)
  chart.preparedViews = [{ ...initial.view, id: 'ready', label: '预备视图', chart: 'area' }]
  const prepared = chart.preparedViews[0]!
  const state = {
    view: savedChartView({ ...prepared, kind: 'chart' }),
    hidden: [prepared.y[0]!],
    preparedViewId: prepared.id,
  }
  const reference = followUpContext(document, chart, state)
  assert.match(reference, /Prepared view: "ready"/)
  assert.doesNotMatch(reference, /override:|preparedViews|Saved chart/)
  assert.deepEqual(field(reference, 'Hidden series'), state.hidden)
  const changed = { ...state, view: { ...state.view, x: 'another-column' } }
  assert.deepEqual(
    field(followUpContext(document, chart, changed), 'Current chart view override'),
    changed.view,
  )
  assert.equal(followUpContext(document, chart, initial), base)
  assert.throws(
    () => followUpContext(document, chart, { ...state, preparedViewId: 'missing' }),
    (error: unknown) => {
      assert.match(translator('zh-CN')(readError(error)), /Unknown prepared/)
      return true
    },
  )
})

test('table reference includes ordering and all-row scope, independent of row count and contents', async () => {
  const { document } = await interactionFixture()
  const table = document.blocks.find((block) => block.kind === 'table')!
  if (table.kind !== 'table') throw new Error('Expected table')
  const sort = {
    columnId: document.datasets.find((dataset) => dataset.id === table.datasetId)!.data.columns[0]!
      .id,
    direction: 'descending' as const,
  }
  const baseline = followUpContext(document, table, undefined, undefined, sort)
  assert.deepEqual(field(baseline, 'Table sort'), sort)
  assert.match(baseline, /all filtered rows, not only the visible page/)
  const dataset = document.datasets.find((entry) => entry.id === table.datasetId)!
  dataset.data.rows = Array.from({ length: 5000 }, () => [...dataset.data.rows[0]!])
  dataset.data.rowCount = 5000
  dataset.data.limit = 5000
  for (const slice of document.interaction!.slices) {
    const binding = slice.datasets.find((entry) => entry.datasetId === dataset.id)!
    binding.rowIndices = Array.from({ length: 5000 }, (_, i) => i)
  }
  parsePresentationDocument(document)
  assert.equal(followUpContext(document, table, undefined, undefined, sort), baseline)
  for (const slice of document.interaction!.slices)
    slice.datasets.find((entry) => entry.datasetId === dataset.id)!.rowIndices = []
  parsePresentationDocument(document)
  assert.equal(followUpContext(document, table, undefined, undefined, sort), baseline)
})

test('long Markdown and many sources never expand the reference; labels preserve Unicode', async () => {
  const { document } = await interactionFixture()
  const block = { kind: 'markdown' as const, id: 'long-text', text: 'short' }
  document.blocks.push(block)
  const before = followUpContext(document, block)
  block.text = '中'.repeat(32768)
  document.sources = Array.from({ length: 64 }, (_, i) => ({
    id: `source-${i}`,
    ref: { sessionId: 'session', artifactRef: `artifact-${i}` },
    status: 'unavailable' as const,
    reason: '不可用'.repeat(100),
  }))
  parsePresentationDocument(document)
  assert.equal(followUpContext(document, block), before)
  document.title = '😀'.repeat(81)
  const title = followUpContext(document, block).split('\n')[0]!.slice('Report title: '.length)
  assert.equal(Array.from(title).length, 80)
  assert.equal(title, `${'😀'.repeat(79)}…`)
  assert.ok(Buffer.byteLength(before) < 1024)
})

test('byte ceiling includes wrappers and separator; locator/state are never truncated', async () => {
  const overhead = Buffer.byteLength(wrapPresentationContext('', '\n\n'))
  const exact = 'a'.repeat(PRESENTATION_CONTEXT_BYTES - overhead)
  assert.equal(
    Buffer.byteLength(wrapPresentationContext(exact, '\n\n')),
    PRESENTATION_CONTEXT_BYTES,
  )
  assert.throws(
    () => wrapPresentationContext(`${exact}a`, '\n\n'),
    (error: unknown) => {
      assert.match(translator('zh-CN')(readError(error)), /12 KiB/)
      return true
    },
  )
  const { document } = await interactionFixture()
  const chart = document.blocks.find((block) => block.kind === 'chart')!
  if (chart.kind !== 'chart') throw new Error('Expected chart')
  const state = initialChartExploration(chart)
  state.view.options = { referenceLines: [{ axis: 'y', value: 1, label: '中'.repeat(5000) }] }
  assert.throws(
    () => followUpContext(document, chart, state),
    (error: unknown) => {
      assert.match(translator('zh-CN')(readError(error)), /12 KiB/)
      return true
    },
  )
  assert.throws(
    () => followUpContext({ ...document, workspaceId: 'w'.repeat(13000) }, chart),
    (error: unknown) => {
      assert.match(translator('zh-CN')(readError(error)), /12 KiB/)
      return true
    },
  )
})
