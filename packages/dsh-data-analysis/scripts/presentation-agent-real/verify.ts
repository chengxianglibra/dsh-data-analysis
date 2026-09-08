import assert from 'node:assert/strict'
import { defaultSelection, interactionRows } from '../../src/presentation/contracts/interaction.ts'
import type { PresentationDocument } from '../../src/presentation/contracts/types.ts'
import { days, type JourneyId, regionalValues, regions } from './fixtures.ts'

export interface RuntimeObservation {
  timeMs: number
  pid: number
  cwd: string
  operation: string
  agentCode: boolean
  sessionId?: string
  objectId?: number
  artifactRef?: string
  unclosedObjectIds?: number[]
}

type Expected = Record<string, number[]>

/** Discover actual column bindings by values, rather than forcing a report schema or labels. */
function bindings(document: PresentationDocument, expected: Expected) {
  const names = Object.keys(expected).sort()
  const width = expected[names[0]!]!.length
  return document.datasets.flatMap((dataset) => {
    if (dataset.data.truncated) return []
    const rows = dataset.data.rows
    // A report may put both baselines in one long table, or in separate datasets.
    const groups = [
      rows,
      ...dataset.data.columns.flatMap((_, index) =>
        [...new Set(rows.map((row) => row[index]))].map((value) =>
          rows.filter((row) => row[index] === value),
        ),
      ),
    ]
    return groups.flatMap((group) => {
      if (group.length < names.length) return []
      return dataset.data.columns.flatMap((key, keyIndex) => {
        const selected = group.filter((row) => names.includes(String(row[keyIndex])))
        if (
          JSON.stringify(selected.map((row) => String(row[keyIndex])).sort()) !==
          JSON.stringify(names)
        )
          return []
        const columns = Array.from({ length: width }, (_, slot) =>
          dataset.data.columns.flatMap((column, index) =>
            ['float64', 'int64', 'decimal'].includes(column.type) &&
            selected.every(
              (row) =>
                row[index] !== null &&
                Number(row[index]) === expected[String(row[keyIndex])]![slot],
            )
              ? [column.id]
              : [],
          ),
        )
        if (columns.some((items) => items.length === 0)) return []
        return [
          {
            datasetId: dataset.id,
            key: key.id,
            columns,
            rows: selected,
            excludedRows: group.filter((row) => !selected.includes(row)),
            columnContext: dataset.data.columns,
            sourceIds: dataset.sourceIds,
            reviewRequired:
              'Match date/group context and column labels to the requested scope and direction.',
          },
        ]
      })
    })
  })
}

function comparison(document: PresentationDocument, expected: Expected) {
  const matches = bindings(document, expected).filter((binding) =>
    document.blocks.some(
      (block) =>
        block.kind === 'table' &&
        block.datasetId === binding.datasetId &&
        (!block.columns ||
          (block.columns.includes(binding.key) &&
            binding.columns.every((choices) =>
              choices.some((column) => block.columns!.includes(column)),
            ))),
    ),
  )
  assert.ok(
    matches.length > 0,
    `No complete table preserves current/baseline/delta: ${JSON.stringify(expected)}`,
  )
  const deltas = Object.fromEntries(
    Object.entries(expected).map(([name, values]) => [name, [values[2]!]]),
  )
  const charts = bindings(document, deltas).filter((binding) =>
    document.blocks.some(
      (block) =>
        block.kind === 'chart' &&
        block.chart === 'bar' &&
        block.datasetId === binding.datasetId &&
        block.x === binding.key &&
        binding.columns[0]!.some((column) => block.y.includes(column)),
    ),
  )
  assert.ok(charts.length > 0, 'No bar chart binds the complete signed contributions')
  const selected = matches[0]!
  const dataset = document.datasets.find((item) => item.id === selected.datasetId)!
  const indexes = selected.columns.map((choices) =>
    dataset.data.columns.findIndex((column) => column.id === choices[0]),
  )
  const values = selected.rows.map((row) => indexes.map((index) => Number(row[index])))
  const current = values.reduce((sum, value) => sum + value[0]!, 0)
  const baseline = values.reduce((sum, value) => sum + value[1]!, 0)
  const reductions = values.reduce((sum, value) => sum + Math.min(value[2]!, 0), 0)
  const offsets = values.reduce((sum, value) => sum + Math.max(value[2]!, 0), 0)
  assert.equal(current - baseline, reductions + offsets)
  for (const value of values) assert.equal(value[0]! - value[1]!, value[2])
  return {
    matches,
    charts,
    current,
    baseline,
    net: current - baseline,
    reductions,
    offsets,
    residualAfterDecreases: current - baseline - reductions,
    arithmeticBasis:
      'Computed from the matched complete report detail rows; not a claim about narrative or summary labels.',
    summaryReviewRequired:
      'Check actual metric cards, summaries, date labels and narrative against these independently reconciled detail sums.',
    summaryBlocks: document.blocks
      .filter((block) => block.kind === 'metric')
      .map((block) => {
        const data = document.datasets.find((item) => item.id === block.datasetId)!
        const index = data.data.columns.findIndex((column) => column.id === block.columnId)
        return {
          ...block,
          column: data.data.columns[index],
          row: data.data.rows[
            block.rowSelection === 'slice'
              ? interactionRows(
                  document.interaction,
                  defaultSelection(document.interaction!),
                  block,
                )![0]!
              : block.rowIndex
          ],
          value:
            data.data.rows[
              block.rowSelection === 'slice'
                ? interactionRows(
                    document.interaction,
                    defaultSelection(document.interaction!),
                    block,
                  )![0]!
                : block.rowIndex
            ]![index],
        }
      }),
  }
}

function regionalComparison(baselineIndex: number): Expected {
  return Object.fromEntries(
    regions.map((region, index) => {
      const current = regionalValues[2][index]!
      const baseline = regionalValues[baselineIndex]![index]!
      return [region, [current, baseline, current - baseline]]
    }),
  )
}

export function verifyReport(document: PresentationDocument, journey: JourneyId) {
  assert.ok(document.sources.length > 0)
  assert.ok(
    document.sources.every((source) => source.status === 'available'),
    'All synthetic local Artifact sources must recover',
  )
  const sourceIds = new Set(document.sources.map((source) => source.id))
  assert.ok(
    document.datasets.every(
      (dataset) =>
        !dataset.data.truncated &&
        dataset.sourceIds.length > 0 &&
        dataset.sourceIds.every((id) => sourceIds.has(id)),
    ),
    'Every analytical dataset needs complete rows and exact declared sources',
  )
  if (journey === 'complex-charts') {
    const charts = document.blocks.filter((block) => block.kind === 'chart')
    for (const type of ['line', 'stackedBar100', 'boxPlot', 'histogram', 'waterfall'])
      assert.ok(
        charts.some((block) => block.chart === type),
        `Missing authored ${type}`,
      )
    const values = (type: string, columns: (block: (typeof charts)[number]) => string[]) => {
      const block = charts.find((block) => block.chart === type)!
      const dataset = document.datasets.find((dataset) => dataset.id === block.datasetId)!.data
      const indices = columns(block).map((id) =>
        dataset.columns.findIndex((column) => column.id === id),
      )
      return dataset.rows.map((row) => indices.map((index) => Number(row[index])))
    }
    assert.deepEqual(
      values('histogram', (block) => [
        block.bindings!.binStart!,
        block.bindings!.binEnd!,
        block.y[0]!,
      ]),
      [
        [0, 25, 3],
        [25, 50, 1],
        [50, 75, 3],
        [75, 101, 2],
      ],
    )
    assert.deepEqual(
      values('boxPlot', (block) => [
        block.bindings!.minimum!,
        block.bindings!.q1!,
        block.y[0]!,
        block.bindings!.q3!,
        block.bindings!.maximum!,
      ]).sort((a, b) => a[0]! - b[0]!),
      [
        [10, 15, 20, 35, 50],
        [20, 35, 50, 65, 80],
        [40, 45, 50, 75, 100],
      ],
    )
    const waterfall = values('waterfall', (block) => [
      block.bindings!.start!,
      block.bindings!.end!,
      block.y[0]!,
    ])
    assert.deepEqual(waterfall[0], [0, 200, 200])
    assert.deepEqual(waterfall.at(-1), [0, 150, 150])
    assert.deepEqual(
      waterfall
        .slice(1, -1)
        .map((row) => row[2]!)
        .sort((a, b) => a - b),
      [-50, -30, 30],
    )
    assert.deepEqual(
      values('stackedBar100', (block) => [block.bindings!.denominator!])
        .flat()
        .sort((a, b) => a - b),
      [70, 150, 200],
    )
    const line = charts.find((block) => block.chart === 'line')!
    assert.ok(line.preparedViews?.some((view) => view.chart === 'histogram'))
    assert.ok(line.preparedViews?.some((view) => view.chart === 'boxPlot'))
    return {
      chartTypes: charts.map((block) => block.chart),
      precomputedStatistics: true,
      waterfall,
      narrativeReviewRequired:
        'Review actual source binding, sample size and three-date limitations.',
    }
  }
  if (journey === 'semantic-gap-reuse') {
    return { daily: comparison(document, { acct_a: [100, 170, -70], acct_b: [50, 30, 20] }) }
  }
  const daily = comparison(document, regionalComparison(1))
  assert.equal(daily.net, -50)
  assert.equal(daily.reductions, -80)
  assert.equal(daily.offsets, 30)
  assert.equal(daily.residualAfterDecreases, 30)
  if (journey === 'incomplete-evidence') {
    // Preserve context for semantic review: a wide row can legitimately contain
    // an unavailable baseline and a valid current value. Do not null the whole row.
    const missingDateRows = document.datasets.flatMap((dataset) =>
      dataset.data.rows
        .filter((row) =>
          row.some((value) => typeof value === 'string' && value.startsWith(days[0])),
        )
        .map((row) => ({ datasetId: dataset.id, columns: dataset.data.columns, row })),
    )
    return {
      daily,
      missingBaseline: days[0],
      missingDateRows,
      baselineReviewRequired:
        '08-30 has no rows in the fixture. Check only its baseline and dependent comparison values are unavailable; current values may remain available.',
      causalEvidence: 'not provided; review actual narrative',
    }
  }
  const weekly = comparison(document, regionalComparison(0))
  const series = document.blocks.flatMap((block) => {
    if (block.kind !== 'chart' || block.chart !== 'line') return []
    const dataset = document.datasets.find((item) => item.id === block.datasetId)!
    const xIndex = dataset.data.columns.findIndex((column) => column.id === block.x)
    if (xIndex < 0 || dataset.data.rows.length !== days.length) return []
    const actualDays = dataset.data.rows.map((row) => String(row[xIndex]).slice(0, 10))
    if (JSON.stringify(actualDays) !== JSON.stringify(days)) return []
    const matches = regions.map((region, regionIndex) => ({
      region,
      y: block.y.filter((id) => {
        const index = dataset.data.columns.findIndex((column) => column.id === id)
        return (
          index >= 0 &&
          dataset.data.rows.every(
            (row, dateIndex) =>
              row[index] !== null && Number(row[index]) === regionalValues[dateIndex]![regionIndex],
          )
        )
      }),
    }))
    return matches.every((match) => match.y.length > 0)
      ? [{ blockId: block.id, datasetId: dataset.id, matches, days: actualDays }]
      : []
  })
  assert.ok(
    series.length > 0,
    'Three actual region series must bind the correct ordered dates and values',
  )
  return { daily, weekly, series }
}

export function verifyLifecycle(observations: RuntimeObservation[]) {
  const activeProcesses = new Set(
    observations.filter((item) => item.operation === 'agent-code-start').map((item) => item.pid),
  )
  assert.ok(activeProcesses.size > 0, 'The observer never saw actual marivo_python execution')
  const calls = observations.filter((item) => activeProcesses.has(item.pid))
  for (const pid of activeProcesses)
    assert.equal(
      calls.filter((item) => item.pid === pid && item.operation === 'process-exit').length,
      1,
      `Expected exactly one observed normal process exit for pid=${pid}`,
    )
  const starts = calls.filter((item) => item.operation === 'acquire')
  assert.ok(starts.length > 0, 'The observer never saw a public Session acquisition')
  const closures = starts.map((start) => {
    const lastUse = Math.max(
      start.timeMs,
      ...calls
        .filter(
          (item) =>
            item.pid === start.pid &&
            item.objectId === start.objectId &&
            ['observe', 'compare', 'attribute', 'artifact'].includes(item.operation),
        )
        .map((item) => item.timeMs),
    )
    const close = calls.find(
      (item) =>
        item.pid === start.pid &&
        item.objectId === start.objectId &&
        item.operation === 'close' &&
        item.timeMs >= lastUse,
    )
    assert.ok(
      close,
      `Session was not explicitly closed: pid=${start.pid}, session=${start.sessionId}`,
    )
    return {
      pid: start.pid,
      sessionId: start.sessionId,
      objectId: start.objectId,
      openedAt: start.timeMs,
      closedAt: close.timeMs,
    }
  })
  assert.ok(
    !calls.some((item) => item.operation === 'close-unwound'),
    'Actual Session.close raised instead of returning',
  )
  assert.ok(
    calls
      .filter((item) => item.operation === 'process-exit')
      .every((item) => item.unclosedObjectIds?.length === 0),
  )
  return { processCount: activeProcesses.size, closures }
}

/** Cleanup guidance conformance is separate from analysis/report acceptance. */
export function assessLifecycle(observations: RuntimeObservation[]) {
  const pids = [
    ...new Set(
      observations.filter((item) => item.operation === 'agent-code-start').map((item) => item.pid),
    ),
  ]
  const processes = pids.map((pid) => ({
    pid,
    exitCount: observations.filter((item) => item.pid === pid && item.operation === 'process-exit')
      .length,
    acquired: observations.filter((item) => item.pid === pid && item.operation === 'acquire'),
    explicitCloseReturns: observations.filter(
      (item) => item.pid === pid && item.operation === 'close',
    ),
    constructorOnlyObserver:
      observations.some((item) => item.pid === pid && item.operation === '__init__') &&
      !observations.some((item) => item.pid === pid && item.operation === 'acquire'),
  }))
  const incomplete =
    pids.length === 0 ||
    processes.some((item) => item.exitCount !== 1 || item.constructorOnlyObserver)
  const boundary =
    'Session.close releases process resources and does not end the durable question Session or delete Artifacts. Each marivo_python call has a separate process; observed exit is a resource boundary, not proof that explicit close ran.'
  try {
    const conformance = verifyLifecycle(observations)
    return {
      status: incomplete ? ('evidence-incomplete' as const) : ('conformant' as const),
      boundary,
      processes,
      conformance,
    }
  } catch (error) {
    return {
      status: incomplete ? ('evidence-incomplete' as const) : ('nonconformant' as const),
      boundary,
      processes,
      diagnostic: error instanceof Error ? error.message : String(error),
      impact:
        'Cleanup-guidance deviation or missing observer evidence; not a finding of analysis invalidity, durable Session termination, or resource/credential leakage.',
    }
  }
}
