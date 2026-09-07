import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  chartNumber,
  formatCell,
  PresentationContractError,
  type PresentationReceipt,
  parsePresentationDocument,
  parsePresentationDraft,
  parsePresentationReceipt,
  parseTypedDataset,
} from '../../src/presentation/contracts/index.ts'

const fixture = (name: string): any =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'))

test('Unicode strings match the Python writer and preserve complete emoji', () => {
  const data = fixture('computed.dataset')
  data.columns[0].label = '月份 📊'
  data.rows[0][0] = '一月 📈'
  assert.equal(parseTypedDataset(data).rows[0]![0], '一月 📈')
  data.columns[0].label = '\uD800'
  invalid(() => parseTypedDataset(data), '/columns/0/label')
  data.columns[0].label = '月份'
  data.rows[0][0] = '\uDC00'
  invalid(() => parseTypedDataset(data), '/rows/0/0')
})

function invalid(run: () => unknown, path: string, code?: string) {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof PresentationContractError)
    assert.equal(error.path, path)
    if (code) assert.equal(error.code, code)
    assert.ok(error.hint.length > 0)
    return true
  })
}

test('persisted Artifact fixture matches the captured fresh-process public read, including source identity', () => {
  const document = parsePresentationDocument(fixture('artifact.document'))
  const snapshot = fixture('artifact.runtime-snapshot')
  const expected = fixture('expected')
  const data = document.datasets[0]!.data
  assert.deepEqual(data.rows, snapshot.restored.rows)
  assert.deepEqual(data.rows, expected.artifact.rows)
  assert.deepEqual(
    data.columns.map((column) => column.id),
    expected.artifact.columns,
  )
  assert.equal(data.rowCount, snapshot.restored.truncation.totalRows)
  assert.equal(data.rows.length, snapshot.restored.truncation.writtenRows)
  assert.equal(document.sources[0]!.ref.sessionId, snapshot.generated.primary.sessionId)
  assert.equal(document.sources[0]!.ref.artifactRef, snapshot.generated.primary.artifactRef)
  assert.equal(document.sources[0]!.ref.findingId, snapshot.generated.primary.findingId)
  assert.equal(snapshot.freshProcessRead, true)
  assert.deepEqual(snapshot.restored.forbiddenCalls, {
    observe: 0,
    revalidate: 0,
    credentialResolve: 0,
  })
  assert.deepEqual(snapshot.secondary.forbiddenCalls, snapshot.restored.forbiddenCalls)
  const computed = parsePresentationDocument(fixture('computed.document'))
  assert.equal(computed.sources[1]!.ref.artifactRef, snapshot.generated.secondary.artifactRef)
  assert.equal(snapshot.secondary.rows[0][1], expected.secondaryArtifact.firstInt64)
  assert.deepEqual(computed.sources[2]!.ref, snapshot.unavailable.ref)
  assert.equal(snapshot.unavailable.exceptionType, 'ArtifactNotFoundError')
  assert.deepEqual(snapshot.unavailable.forbiddenCalls, snapshot.restored.forbiddenCalls)
  assert.equal(parsePresentationDraft(fixture('artifact.draft')).datasets[0]!.kind, 'artifact')
})

test('the captured upstream precision limitation is not relabeled as exact presentation data', () => {
  const snapshot = fixture('artifact.runtime-snapshot')
  const expected = fixture('expected').precisionProbe
  assert.equal(snapshot.generated.precisionInputs.decimal, expected.inputDecimal)
  assert.equal(snapshot.generated.precisionInputs.int64, expected.inputInt64)
  assert.equal(snapshot.precisionProbe.rows[0][1], expected.publicDecimal)
  assert.equal(snapshot.precisionProbe.rows[0][2], expected.publicInt64)
  const data = {
    schemaVersion: 1,
    columns: snapshot.precisionProbe.columns.map((column: any) => ({
      id: column.name,
      label: column.name,
      type: column.artifactDtype === 'object' ? 'string' : column.artifactDtype,
      nullable: column.nullable,
    })),
    rows: snapshot.precisionProbe.rows,
    rowCount: 4,
    limit: 4,
    truncated: false,
  }
  invalid(() => parseTypedDataset(data), '/rows/0/2', 'numeric_precision')
})

test('fixed computed values retain decimal, int64, null and explicit truncation after JSON round trip', () => {
  const document = parsePresentationDocument(fixture('computed.document'))
  const data = document.datasets[0]!.data
  assert.deepEqual(data, parseTypedDataset(fixture('computed.dataset')))
  assert.equal(data.rows[0]![1], '12345678901234.5678')
  assert.equal(data.rows[0]![2], '9007199254740993')
  assert.equal(data.rows[1]![1], null)
  assert.equal(data.rows[1]![2], '9223372036854775807')
  assert.equal(data.rows[2]![2], '-9223372036854775808')
  assert.equal(formatCell(data.rows[2]![1]!, data.columns[1]!), '0.1000')
  assert.equal(formatCell(null, data.columns[1]!), '—')
  assert.equal(data.rowCount, 5)
  assert.equal(data.limit, 3)
  assert.equal(data.truncated, true)
  assert.equal(document.sources.filter((source) => source.status === 'available').length, 2)
  assert.equal(document.sources.filter((source) => source.status === 'unavailable').length, 1)
  assert.deepEqual(parsePresentationDocument(JSON.parse(JSON.stringify(document))), document)
  assert.equal(parsePresentationDraft(fixture('computed.draft')).datasets[0]!.kind, 'computed')
})

test('source-only has no dataset and can retain an unavailable exact source reference', () => {
  const document = parsePresentationDocument(fixture('source-only.document'))
  assert.deepEqual(document.datasets, [])
  assert.equal(document.sources[0]!.status, 'unavailable')
  const bad = structuredClone(document)
  bad.blocks.push({
    id: 'fake-metric',
    kind: 'metric',
    datasetId: 'missing',
    columnId: 'value',
    rowIndex: 0,
    label: '不存在的值',
  })
  invalid(() => parsePresentationDocument(bad), '/blocks/2/datasetId', 'invalid_reference')
})

test('exact charts reject decimal and unsafe int64; approximate is explicit and remains finite', () => {
  const document = parsePresentationDocument(fixture('computed.document'))
  const data = document.datasets[0]!.data
  invalid(
    () => chartNumber(data.rows[0]![1]!, data.columns[1]!, 'exact', '/value'),
    '/value',
    'numeric_precision',
  )
  invalid(
    () => chartNumber(data.rows[0]![2]!, data.columns[2]!, 'exact', '/value'),
    '/value',
    'numeric_precision',
  )
  assert.equal(chartNumber(data.rows[0]![1]!, data.columns[1]!, 'approximate'), 12345678901234.568)
  assert.equal(chartNumber('42', data.columns[2]!, 'exact'), 42)
  assert.equal(chartNumber(null, data.columns[1]!, 'exact'), null)
  invalid(
    () => chartNumber('1e999', data.columns[1]!, 'approximate', '/value'),
    '/value',
    'numeric_precision',
  )
  const chart = document.blocks.find((block) => block.kind === 'chart')!
  assert.equal(chart.kind, 'chart')
  chart.y = ['amount']
  invalid(
    () => parsePresentationDocument(document),
    '/datasets/0/data/rows/0/1',
    'numeric_precision',
  )
  chart.numericMode = 'approximate'
  assert.doesNotThrow(() => parsePresentationDocument(document))
})

test('numeric encodings reject silent loss, nonfinite values, invalid dates and incompatible nulls', () => {
  for (const value of [9007199254740992, Number.NaN, Number.POSITIVE_INFINITY]) {
    const data = fixture('computed.dataset')
    data.rows[0][3] = value
    invalid(() => parseTypedDataset(data), '/rows/0/3')
  }
  for (const [column, value] of [
    [2, '9223372036854775808'],
    [2, 42],
    [1, 'NaN'],
    [4, '2026-02-30'],
    [5, '2026-01-01T00:00:00'],
    [0, null],
  ] as const) {
    const data = fixture('computed.dataset')
    data.rows[0][column] = value
    invalid(() => parseTypedDataset(data), `/rows/0/${column}`)
  }
})

test('schema, row budgets and concrete JSON pointers reject malformed display data', () => {
  const malformedType = fixture('computed.dataset')
  malformedType.columns[3].type = ['float64']
  malformedType.rows[0][3] = { wouldBypassCellValidation: true }
  invalid(() => parseTypedDataset(malformedType), '/columns/3/type')
  const data = fixture('computed.dataset')
  data.schemaVersion = 2
  invalid(() => parseTypedDataset(data), '/schemaVersion')
  data.schemaVersion = 1
  data.truncated = false
  invalid(() => parseTypedDataset(data), '/truncated')
  data.truncated = true
  data.rows[0].pop()
  invalid(() => parseTypedDataset(data), '/rows/0', 'budget')
  const tooMany = fixture('computed.dataset')
  tooMany.limit = 5001
  invalid(() => parseTypedDataset(tooMany), '/limit')
  const unknown = fixture('computed.document')
  unknown['semantic~registry/override'] = {}
  invalid(
    () => parsePresentationDocument(unknown),
    '/semantic~0registry~1override',
    'unknown_field',
  )
})

test('metrics select an existing single cell and source references cannot silently disappear', () => {
  const document = fixture('computed.document')
  document.blocks[1].rowIndex = 3
  invalid(() => parsePresentationDocument(document), '/blocks/1/rowIndex', 'invalid_reference')
  document.blocks[1].rowIndex = 0
  document.datasets[0].sourceIds.push('not-declared')
  invalid(() => parsePresentationDocument(document), '/datasets/0/sourceIds/3', 'invalid_reference')
  document.datasets[0].sourceIds = ['missing']
  document.datasets[0].origin = 'artifact'
  invalid(() => parsePresentationDocument(document), '/datasets/0/sourceIds', 'invalid_reference')
})

test('draft file references reject absolute paths and traversal without inspecting source semantics', () => {
  for (const file of ['/tmp/data.json', '../data.json', 'data/../../escape', 'data\\escape.json']) {
    const draft = fixture('computed.draft')
    draft.datasets[0].path = file
    invalid(() => parsePresentationDraft(draft), '/datasets/0/path', 'file_boundary')
  }
  const draft = fixture('computed.draft')
  draft.datasets[0].transformationProof = 'not-a-presentation-concern'
  invalid(() => parsePresentationDraft(draft), '/datasets/0/transformationProof', 'unknown_field')
})

test('receipt binds two fixed assets to one build and never treats a digest as ownership', () => {
  const dir = '/validation/workspace/.dsh-data-analysis/presentations/report/builds/s0-test'
  const receipt: PresentationReceipt = {
    schemaVersion: 2,
    kind: 'marivo.presentation',
    workspaceId: 'validation-workspace',
    reportId: 'report',
    buildId: 's0-test',
    title: 'S0 文件身份',
    summary: '契约测试使用占位 digest；真实字节由 Host 接缝测试验证。',
    files: {
      document: {
        asset: 'presentation.json',
        path: `${dir}/presentation.json`,
        sha256: 'a'.repeat(64),
        bytes: 1024,
      },
      html: { asset: 'index.html', path: `${dir}/index.html`, sha256: 'b'.repeat(64), bytes: 2048 },
    },
  }
  assert.deepEqual(parsePresentationReceipt(receipt), receipt)
  receipt.buildId = '../other'
  invalid(() => parsePresentationReceipt(receipt), '/buildId')
  receipt.buildId = 's0-test'
  receipt.files.html.path = receipt.files.html.path.replace('/validation/', '/other/')
  invalid(() => parsePresentationReceipt(receipt), '/files/html/path', 'file_boundary')
  receipt.files.html.path = `${dir}/index.html`
  receipt.files.html.sha256 = 'not-a-digest'
  invalid(() => parsePresentationReceipt(receipt), '/files/html/sha256')
})
