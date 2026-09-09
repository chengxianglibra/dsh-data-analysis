import assert from 'node:assert/strict'
import test from 'node:test'
import { chartRows, followUpContext, selectMetric } from '../../src/client/presentation/model.ts'
import {
  applyPresentationEdits,
  presentationEdits,
} from '../../src/presentation/contracts/editing.ts'
import {
  PRESENTATION_BUDGETS,
  parsePresentationDocument,
  parsePresentationDraft,
} from '../../src/presentation/contracts/index.ts'
import {
  defaultSelection,
  interactionRows,
  selectedSlice,
} from '../../src/presentation/contracts/interaction.ts'
import type { PresentationDocument } from '../../src/presentation/contracts/types.ts'
import { interactionFixture } from './interaction-fixture.ts'

test('two fixed filters select complete prepared rows for KPI, charts and tables while shared-dataset fixed blocks stay unchanged', async () => {
  const { document } = await interactionFixture()
  const original = JSON.stringify(document)
  const selection = { day: 'mon', cluster: 'a' }
  const interaction = document.interaction!
  assert.deepEqual(defaultSelection(interaction), { day: 'any', cluster: 'any' })
  const rows = document.blocks.map((block) => interactionRows(interaction, selection, block))
  assert.deepEqual(rows, [undefined, undefined, [4], [4], [4], [8, 9], [8, 9], undefined])
  const metric = document.blocks.find((block) => block.id === 'count')!
  assert.equal(metric.kind, 'metric')
  if (metric.kind !== 'metric') return
  const data = document.datasets[0]!.data
  assert.equal(selectMetric(data, metric, [4]).value, '150')
  assert.match(
    followUpContext(document, metric, undefined, selection),
    /"filterId":"day","optionId":"mon","label":"日期：周一"/,
  )
  assert.match(
    followUpContext(document, metric, undefined, selection),
    /"filterId":"cluster","optionId":"a"/,
  )
  assert.match(followUpContext(document, metric), /"optionId":"any"/)
  assert.throws(() => selectedSlice(interaction, { day: 'missing', cluster: 'any' }))
  assert.throws(() => selectMetric(data, metric, []))
  assert.equal(JSON.stringify(document), original)
})

test('invalid declarations fail closed with a diagnostic path', async () => {
  const { document } = await interactionFixture()
  const cases: [string, (doc: PresentationDocument) => void][] = [
    [
      'missing combination',
      (d) => {
        d.interaction!.slices.pop()
      },
    ],
    [
      'duplicate combination',
      (d) => {
        d.interaction!.slices[1]!.selection = d.interaction!.slices[0]!.selection
      },
    ],
    [
      'unknown option',
      (d) => {
        d.interaction!.slices[0]!.selection.day = 'missing'
      },
    ],
    [
      'missing dataset',
      (d) => {
        d.interaction!.slices[0]!.datasets.pop()
      },
    ],
    [
      'unknown dataset',
      (d) => {
        d.interaction!.slices[0]!.datasets[0]!.datasetId = 'missing'
      },
    ],
    [
      'duplicate row',
      (d) => {
        d.interaction!.slices[0]!.datasets[1]!.rowIndices = [0, 0]
      },
    ],
    [
      'bad row',
      (d) => {
        d.interaction!.slices[0]!.datasets[1]!.rowIndices = [999]
      },
    ],
    [
      'fractional row',
      (d) => {
        d.interaction!.slices[0]!.datasets[1]!.rowIndices = [0.5]
      },
    ],
    [
      'zero metric rows',
      (d) => {
        d.interaction!.slices[0]!.datasets[0]!.rowIndices = []
      },
    ],
    [
      'multiple metric rows',
      (d) => {
        d.interaction!.slices[0]!.datasets[0]!.rowIndices = [0, 1]
      },
    ],
    [
      'fixed metric in region',
      (d) => {
        d.interaction!.blockIds.unshift('fixed')
      },
    ],
    [
      'noncontiguous region',
      (d) => {
        d.blocks.splice(4, 0, { id: 'gap', kind: 'markdown', text: 'fixed' })
      },
    ],
    [
      'dynamic without region',
      (d) => {
        delete d.interaction
      },
    ],
    [
      'both metric bindings',
      (d) => {
        Object.assign(d.blocks[2]!, { rowIndex: 0 })
      },
    ],
    [
      'no all option',
      (d) => {
        d.interaction!.filters[0]!.allOptionId = 'missing'
      },
    ],
    [
      'budget',
      (d) => {
        d.interaction!.title = 'x'.repeat(PRESENTATION_BUDGETS.documentBytes)
      },
    ],
  ]
  for (const [name, mutate] of cases) {
    const invalid = structuredClone(document)
    mutate(invalid)
    assert.throws(
      () => parsePresentationDocument(invalid),
      (error: unknown) => error instanceof Error && 'path' in error && 'code' in error,
      name,
    )
  }
})

test('empty charts, exact/null metrics, ordinary all label, and prepared dataset coverage', async () => {
  const { document } = await interactionFixture()
  document.interaction!.slices[0]!.datasets[1]!.rowIndices = []
  document.datasets[0]!.data.columns[0]!.nullable = true
  document.datasets[0]!.data.rows[0]![0] = null
  document.datasets[0]!.data.rows[1]![0] = '9007199254740993'
  document.interaction!.filters[0]!.options[1]!.label = 'all'
  parsePresentationDocument(document)
  const chart = document.blocks.find((block) => block.kind === 'chart')!
  if (chart.kind !== 'chart') return
  document.datasets.push({ ...structuredClone(document.datasets[1]!), id: 'prepared' })
  chart.preparedViews![0]!.datasetId = 'prepared'
  assert.throws(() => parsePresentationDocument(document), /cover every/)
  for (const slice of document.interaction!.slices)
    slice.datasets.push({ datasetId: 'prepared', rowIndices: [] })
  parsePresentationDocument(document)
})

test('draft keeps the declaration and validates references before generated-row validation', async () => {
  const { draft } = await interactionFixture()
  assert.deepEqual(parsePresentationDraft(draft).interaction, draft.interaction)
  draft.interaction!.slices[0]!.datasets[1]!.rowIndices = [999]
  parsePresentationDraft(draft) // actual data is loaded by projection
  draft.interaction!.blockIds.push('missing')
  assert.throws(() => parsePresentationDraft(draft), /existing/)
})

test('editing preserves region authority, allows internal reorder and deletes without dangling references', async () => {
  const { document } = await interactionFixture()
  const edits = presentationEdits(document)
  ;[edits.blocks[2], edits.blocks[3]] = [edits.blocks[3]!, edits.blocks[2]!]
  assert.deepEqual(applyPresentationEdits(document, edits).interaction!.blockIds.slice(0, 2), [
    'failed',
    'count',
  ])
  const illegal = presentationEdits(document)
  ;[illegal.blocks[1], illegal.blocks[2]] = [illegal.blocks[2]!, illegal.blocks[1]!]
  assert.throws(() => applyPresentationEdits(document, illegal), /boundaries/)
  const allDeleted = presentationEdits(document)
  allDeleted.blocks = allDeleted.blocks.filter(
    (block) => !document.interaction!.blockIds.includes(block.id),
  )
  assert.equal(applyPresentationEdits(document, allDeleted).interaction, undefined)
  const onlyTable = presentationEdits(document)
  onlyTable.blocks = onlyTable.blocks.filter(
    (block) => !['count', 'failed', 'rate', 'chart'].includes(block.id),
  )
  assert.deepEqual(
    applyPresentationEdits(document, onlyTable).interaction!.slices[0]!.datasets.map(
      (d) => d.datasetId,
    ),
    ['detail'],
  )
  assert.deepEqual(
    applyPresentationEdits(document, presentationEdits(document)).interaction,
    document.interaction,
  )
  assert.throws(() =>
    applyPresentationEdits(document, { ...edits, interaction: document.interaction }),
  )
})

test('independent statistical slices validate their own totals, ranks and waterfall sequences', async () => {
  const { chartGallery } = await import('../../scripts/presentation-chart-gallery.ts')
  const gallery = await chartGallery()
  for (const kind of ['pie', 'leaderboard', 'waterfall'] as const) {
    const block = gallery.blocks.find((block) => block.kind === 'chart' && block.chart === kind)!
    assert.equal(block.kind, 'chart')
    if (block.kind !== 'chart') continue
    const source = structuredClone(
      gallery.datasets.find((dataset) => dataset.id === block.datasetId)!,
    )
    const size = source.data.rows.length
    source.data.rows.push(...structuredClone(source.data.rows))
    source.data.rowCount = source.data.rows.length
    source.data.limit = source.data.rows.length
    const chart = { ...block, preparedViews: undefined }
    delete chart.preparedViews
    const document = {
      ...gallery,
      blocks: [chart],
      datasets: [source],
      interaction: {
        title: 'Independent slices',
        blockIds: [chart.id],
        filters: [
          {
            id: 'scope',
            label: '范围',
            allOptionId: 'any',
            options: [
              { id: 'any', label: '全部' },
              { id: 'next', label: '另一组合' },
            ],
          },
        ],
        slices: ['any', 'next'].map((scope, n) => ({
          selection: { scope },
          datasets: [
            {
              datasetId: source.id,
              rowIndices: Array.from({ length: size }, (_, i) => n * size + i),
            },
          ],
        })),
      },
    }
    parsePresentationDocument(document)
    assert.throws(() => parsePresentationDocument({ ...document, interaction: undefined }), kind)
  }
})

test('chart encoding does not read out-of-slice rows or lose their original identity', async () => {
  const { document } = await interactionFixture()
  const chart = document.blocks.find((block) => block.kind === 'chart')!
  if (chart.kind !== 'chart') return
  const data = document.datasets[1]!.data
  data.rows[0]![1] = '9007199254740993'
  assert.throws(() => chartRows(data, chart))
  assert.deepEqual(
    chartRows(data, chart, [8, 9]).map((row) => [row.rowIndex, row.series0]),
    [
      [8, 100],
      [9, 50],
    ],
  )
})
