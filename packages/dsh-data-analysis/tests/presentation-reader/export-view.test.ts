import assert from 'node:assert/strict'
import { test } from 'node:test'
import { initialChartExploration } from '../../src/client/presentation/chart-view.ts'
import { currentViewBlocks } from '../../src/client/presentation/export-view.ts'
import { interactionFixture } from './interaction-fixture.ts'

test('current view resolves the combined slice and prepared chart while preserving the source Build', async () => {
  const { document } = await interactionFixture()
  const before = structuredClone(document)
  const chart = document.blocks.find((block) => block.kind === 'chart')!
  assert.equal(chart.kind, 'chart')
  const state = initialChartExploration(chart)
  state.view = { ...state.view, chart: 'horizontalBar' }
  const blocks = currentViewBlocks(document, {
    selection: { day: 'mon', cluster: 'a' },
    explorations: { chart: state },
    tableSorts: { table: { columnId: 'query_count', direction: 'ascending' } },
  })
  assert.deepEqual(blocks.find((entry) => entry.block.id === 'count')!.rowIndices, [4])
  assert.deepEqual(blocks.find((entry) => entry.block.id === 'table')!.rowIndices, [9, 8])
  const view = blocks.find((entry) => entry.block.id === 'chart')!
  assert.equal(view.block.kind === 'chart' && view.block.chart, 'horizontalBar')
  assert.deepEqual(view.rowIndices, [8, 9])
  assert.deepEqual(document, before)
})

test('table export order preserves exact int64 comparisons, stable ties, and nulls last', async () => {
  const { document } = await interactionFixture()
  delete document.interaction
  document.blocks = [{ kind: 'table', id: 'table', datasetId: 'detail', columns: ['query_count'] }]
  const data = document.datasets.find((entry) => entry.id === 'detail')!.data
  data.rows = [
    ['a', '9007199254740993'],
    ['b', null],
    ['c', '9007199254740992'],
    ['d', '9007199254740993'],
  ]
  const blocks = currentViewBlocks(document, {
    selection: {},
    explorations: {},
    tableSorts: { table: { columnId: 'query_count', direction: 'descending' } },
  })
  assert.deepEqual(blocks[0]!.rowIndices, [0, 3, 2, 1])
  assert.equal(data.rows[0]![1], '9007199254740993')
})
