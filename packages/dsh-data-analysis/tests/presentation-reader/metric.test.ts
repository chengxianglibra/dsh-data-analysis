import assert from 'node:assert/strict'
import { test } from 'node:test'
import { selectMetric } from '../../src/client/presentation/model.ts'
import { parsePresentationDocument } from '../../src/presentation/contracts/index.ts'
import type { PresentationBlock } from '../../src/presentation/contracts/types.ts'
import { interactionFixture } from './interaction-fixture.ts'

test('comparison bindings follow the selected prepared row and reject non-numeric columns', async () => {
  const { document } = await interactionFixture()
  const block = document.blocks.find(
    (entry) => entry.kind === 'metric' && entry.rowSelection === 'slice',
  ) as Extract<PresentationBlock, { kind: 'metric' }>
  const data = document.datasets.find((entry) => entry.id === block.datasetId)!.data
  block.comparisons = [{ label: '同一筛选组合', deltaColumnId: block.columnId }]
  parsePresentationDocument(document)
  for (let row = 0; row < data.rows.length; row++) {
    const metric = selectMetric(data, block, [row])
    assert.equal(metric.comparisons[0]!.delta!.value, metric.value)
  }
  assert.throws(() => selectMetric(data, block, []), /exactly one/)
  const malformed = structuredClone(document)
  const malformedMetric = malformed.blocks.find((entry) => entry.id === block.id)!
  Object.assign(malformedMetric, {
    comparisons: [{ label: '错误方向', deltaColumnId: block.columnId, sentiment: ['neutral'] }],
  })
  assert.throws(() => parsePresentationDocument(malformed), /sentiment/)
  data.columns.push({ id: 'invalid', label: '文本', type: 'string', nullable: false })
  for (const row of data.rows) row.push('不是数值')
  block.comparisons = [{ label: '错误比较', deltaColumnId: 'invalid' }]
  assert.throws(() => parsePresentationDocument(document), /numeric columns/)
  block.comparisons = [
    { label: '重复', deltaColumnId: block.columnId },
    { label: '重复', deltaColumnId: block.columnId },
  ]
  assert.throws(() => parsePresentationDocument(document), /Duplicate/)
})
