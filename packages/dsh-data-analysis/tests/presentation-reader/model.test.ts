import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import test from 'node:test'
import type { ChartBlock } from '../../src/client/presentation/model.ts'
import {
  cellText,
  chartRows,
  compareDecimalText,
  datasetScope,
  followUpContext,
  formatAxisTick,
  formatCategoryTick,
  metricText,
  selectMetric,
  snapshotDate,
  sortedRowIndices,
  valueWithUnit,
} from '../../src/client/presentation/model.ts'
import { parsePresentationDocument } from '../../src/presentation/contracts/index.ts'
import type { DatasetColumn, TypedDataset } from '../../src/presentation/contracts/types.ts'

const decimal: DatasetColumn = {
  id: 'value',
  label: '金额',
  type: 'decimal',
  nullable: true,
  unit: 'CNY',
}
const data = (values: (string | null)[], column = decimal): TypedDataset => ({
  schemaVersion: 1,
  columns: [column],
  rows: values.map((value) => [value]),
  rowCount: values.length,
  limit: Math.max(1, values.length),
  truncated: false,
})

test('Decimal and int64 sorting retains exact ordering, spelling, stable ties and null-last behavior', () => {
  const dataset = data([
    '9007199254740993',
    '9007199254740992',
    null,
    '0.1000',
    '0.1',
    '-9223372036854775808',
  ])
  const before = JSON.stringify(dataset)
  assert.deepEqual(
    sortedRowIndices(dataset, { columnId: 'value', direction: 'ascending' }),
    [5, 3, 4, 1, 0, 2],
  )
  assert.deepEqual(
    sortedRowIndices(dataset, { columnId: 'value', direction: 'descending' }),
    [0, 1, 3, 4, 5, 2],
  )
  assert.equal(JSON.stringify(dataset), before)
  assert.equal(compareDecimalText('1e999999999999999999999', '9e999999999999999999998'), 1)
  assert.equal(compareDecimalText('-1e-999999999999999999999', '0'), -1)
  assert.equal(compareDecimalText('-0.0000', '0e99'), 0)
  assert.equal(compareDecimalText('1.100e-4', '0.00011'), 0)
  assert.equal(compareDecimalText('-100.00', '-99.99'), -1)
})

test('datetime sorts chronological instants with explicit offsets and all six fractional digits', () => {
  const dataset = data(
    [
      '2026-01-01T08:00:00.000002+08:00',
      '2026-01-01T00:00:00.000001Z',
      '2025-12-31T19:00:00.000001-05:00',
      null,
    ],
    { ...decimal, type: 'datetime' },
  )
  assert.deepEqual(
    sortedRowIndices(dataset, { columnId: 'value', direction: 'ascending' }),
    [1, 2, 0, 3],
  )
})

test('cells distinguish null, empty, exact decimal, zero and units without rescaling', () => {
  assert.equal(cellText(null, decimal), '—')
  assert.equal(cellText('', { ...decimal, type: 'string' }), '（空字符串）')
  assert.equal(valueWithUnit('0.1000', decimal), '0.1000 CNY')
  assert.equal(valueWithUnit('0', decimal), '0 CNY')
  assert.equal(cellText('9007199254740993', { ...decimal, type: 'int64' }), '9007199254740993')
})

test('metric grouping keeps exact significant and fractional digits without rounding or rescaling', () => {
  assert.equal(
    metricText('9007199254740993', { ...decimal, type: 'int64' }),
    '9,007,199,254,740,993 CNY',
  )
  assert.equal(metricText('-1234567.123456700', decimal), '-1,234,567.123456700 CNY')
  assert.equal(metricText('0.1000', decimal), '0.1000 CNY')
  assert.equal(metricText('1.234e99', decimal), '1.234e99 CNY')
  assert.equal(metricText(null, decimal), '—')
  assert.equal(metricText('1234567', { ...decimal, type: 'string' }), '1234567 CNY')
  assert.match(snapshotDate('2026-09-07T17:08:22+08:00'), /2026\/09\/07 09:08 UTC/)
})

test('axis labels keep large/tiny signs and exponents and truncate only presentation text', () => {
  assert.equal(formatAxisTick(0), '0')
  assert.equal(formatAxisTick(12.5), '12.5')
  assert.equal(formatAxisTick(50_000), '50,000')
  assert.equal(formatAxisTick(150_000), '15万')
  assert.equal(formatAxisTick(-150_000), '-15万')
  assert.equal(formatAxisTick(0.00123), '0.00123')
  assert.equal(formatAxisTick(9007199254740992), '9.01e+15')
  assert.equal(formatAxisTick(-9007199254740992), '-9.01e+15')
  assert.equal(formatAxisTick(0.0000000000123), '1.23e-11')
  assert.equal(formatAxisTick(-0.0000000000123), '-1.23e-11')
  assert.equal(formatCategoryTick('完整短标签'), '完整短标签')
  assert.equal(formatCategoryTick('长'.repeat(32_768)), `${'长'.repeat(16)}…`)
  assert.equal(formatCategoryTick('😀'.repeat(20)), `${'😀'.repeat(16)}…`)
})

test('metric selects only its explicit cell and rejects missing rows', () => {
  const dataset = data(['9.00', '15.000', null])
  const block = {
    id: 'metric',
    kind: 'metric' as const,
    datasetId: 'd',
    columnId: 'value',
    rowIndex: 1,
    label: '已有值',
  }
  assert.equal(selectMetric(dataset, block).value, '15.000')
  assert.equal(selectMetric(dataset, { ...block, rowIndex: 2 }).value, null)
  assert.throws(() => selectMetric(dataset, { ...block, rowIndex: 3 }), /existing row/)
})

test('chart coordinates keep duplicate labels, null gaps and original precision', () => {
  const dataset: TypedDataset = {
    schemaVersion: 1,
    columns: [{ id: 'x', label: '坐标', type: 'string', nullable: true }, decimal],
    rows: [
      ['A', '9007199254740993'],
      ['A', null],
      [null, '0.1000'],
    ],
    rowCount: 3,
    limit: 3,
    truncated: false,
  }
  const block: ChartBlock = {
    id: 'chart',
    kind: 'chart',
    datasetId: 'd',
    chart: 'line',
    x: 'x',
    y: ['value'],
    numericMode: 'approximate',
  }
  const before = JSON.stringify(dataset)
  assert.deepEqual(chartRows(dataset, block), [
    { rowIndex: 0, xLabel: 'A', series0: 9007199254740992 },
    { rowIndex: 1, xLabel: 'A', series0: null },
    { rowIndex: 2, xLabel: '—', series0: 0.1 },
  ])
  assert.equal(JSON.stringify(dataset), before)
  assert.throws(
    () => chartRows(dataset, { ...block, numericMode: 'exact' }),
    /Exact chart encoding/,
  )
})

test('dataset scope reports only empty, complete or truncated row counts', () => {
  assert.equal(datasetScope(data([])), '暂无数据')
  assert.equal(datasetScope(data(['1'])), '1 行')
  assert.equal(
    datasetScope({ ...data(['1']), rowCount: 9, truncated: true }),
    '显示 1 / 9 行（已截断）',
  )
})

async function contextFixture() {
  return parsePresentationDocument(
    JSON.parse(
      await fs.readFile(
        new URL('../presentation-s0/fixtures/computed.document.json', import.meta.url),
        'utf8',
      ),
    ),
  )
}

test('context identifies same-title reports by the displayed Workspace, Report, Build and cell', async () => {
  const base = await contextFixture()
  const block = base.blocks[0]!
  const documents = [
    base,
    { ...base, reportId: 'another-report' },
    { ...base, workspaceId: 'another-workspace', buildId: 'another-build' },
  ]
  const contexts = documents.map((document) => followUpContext(document, block))
  assert.equal(new Set(contexts).size, documents.length)
  for (const [index, document] of documents.entries()) {
    const lines = contexts[index]!.split('\n')
    assert.equal(lines[0], `Report title: ${base.title}`)
    assert.ok(lines.includes(`Workspace: ${JSON.stringify(document.workspaceId)}`))
    assert.ok(lines.includes(`Report ID: ${document.reportId}`))
    assert.ok(lines.includes(`Build ID: ${document.buildId}`))
    assert.ok(lines.includes(`Cell: ${JSON.stringify(block.id)}`))
  }
})

test('all cell references omit saved content, bindings and sources', async () => {
  const document = await contextFixture()
  const before = JSON.stringify(document)
  for (const block of document.blocks) {
    const context = followUpContext(document, block)
    assert.ok(context.includes(`Cell: ${JSON.stringify(block.id)}`))
    assert.ok(context.includes(`Block kind: ${block.kind}`))
    assert.match(context, /presentation.json/)
    assert.doesNotMatch(
      context,
      /binding:|Metric raw value|Columns:|来源 |Markdown:|Snapshot row indices|12345678901234/,
    )
  }
  assert.equal(JSON.stringify(document), before)
})
