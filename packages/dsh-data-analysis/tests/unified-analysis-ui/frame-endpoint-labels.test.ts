import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  comparisonPeriodGrains,
  endpointLabels,
  periodLabel,
} from '../../src/client/analysis-ui/frame/model.ts'
import { translator } from '../../src/client/i18n/copy.ts'
import { categoryAxis, comparedIntervalMonth, compareOrdinary } from './frame-fixtures.ts'
import { comparedCalendarWithPeriods, comparedScalar } from './frame-render-fixtures.ts'

const zh = translator('zh-CN')
const en = translator('en-US')
const fallback = { current: '本期', baseline: '基期', specific: false }

test('ordinary comparisons with only an alias use symmetric endpoint labels', () => {
  const snapshot = compareOrdinary([categoryAxis(3)])
  const section = snapshot.frame.sections.interpretation
  assert.equal(section.status, 'captured')
  if (section.status !== 'captured') throw new Error('expected captured interpretation')
  section.comparisons[0]!.alias = '五月'
  assert.deepEqual(endpointLabels(zh, snapshot, 0), fallback)
  assert.deepEqual(endpointLabels(en, snapshot, 0), {
    current: 'Current',
    baseline: 'Baseline',
    specific: false,
  })
})

test('ordinary fixed comparison uses two saved members, but not a partial or missing pair', () => {
  const snapshot = comparedScalar({ current: 1, baseline: 2, absolute: -1, relative: -0.5 })
  assert.deepEqual(endpointLabels(zh, snapshot, 0), {
    current: 'west',
    baseline: 'east',
    specific: true,
  })
  const section = snapshot.frame.sections.interpretation
  if (section.status !== 'captured') throw new Error('expected captured interpretation')
  const comparison = section.comparisons[0]!
  comparison.baselineFixedAxes = []
  assert.deepEqual(endpointLabels(zh, snapshot, 0), fallback)
  comparison.baselineFixedAxes = structuredClone(comparison.currentFixedAxes)
  comparison.baselineFixedAxes[0]!.key = [null]
  assert.deepEqual(endpointLabels(zh, snapshot, 0), fallback)
})

test('captured interval and calendar endpoints retain the saved civil periods', () => {
  assert.deepEqual(endpointLabels(zh, comparedIntervalMonth(), 0), {
    current: '2025-06',
    baseline: '2025-05',
    specific: true,
  })
  const calendar = endpointLabels(en, comparedCalendarWithPeriods(2), 0)
  assert.equal(calendar.specific, true)
  assert.match(calendar.current, /^\d{4}-\d{2} – \d{4}-\d{2}$/)
  assert.match(calendar.baseline, /^\d{4}-\d{2} – \d{4}-\d{2}$/)
})

test('unlabeled historical calendar periods use each captured endpoint grain', () => {
  const snapshot = comparedCalendarWithPeriods(1)
  const facts = snapshot.frame.sections.interpretation
  const periods = snapshot.frame.sections.periods
  if (facts.status !== 'captured' || periods.status !== 'captured')
    throw new Error('expected captured sections')
  const binding = facts.comparisons[0]!.binding
  if (binding.kind !== 'calendar') throw new Error('expected calendar binding')
  const axis = snapshot.frame.axes[0]!
  if (axis.variant?.kind !== 'calendar') throw new Error('expected calendar axis')
  const item = periods.pages.find((page) => page.target.kind === 'comparison')!.items[0]!
  if (
    item.kind !== 'comparison' ||
    item.current.kind !== 'calendar' ||
    item.baseline?.kind !== 'calendar'
  )
    throw new Error('expected calendar period pair')
  item.current.label = null
  item.baseline.label = null
  assert.deepEqual(endpointLabels(en, snapshot, 0), {
    current: '2025-01',
    baseline: '2026-01',
    specific: true,
  })
  axis.variant.grain = { kind: 'builtin', unit: 'quarter', step: 1 }
  binding.baseline.grain = { kind: 'builtin', unit: 'year', step: 1 }
  assert.deepEqual(endpointLabels(en, snapshot, 0), {
    current: '2025-Q1',
    baseline: '2026',
    specific: true,
  })
  axis.variant.grain = { kind: 'builtin', unit: 'day', step: 1 }
  const grains = comparisonPeriodGrains(snapshot, 0)
  assert.equal(periodLabel(item.current, grains.current), '2025-01-01')
  assert.equal(periodLabel(item.baseline, grains.baseline), '2026')
  snapshot.frame.axes = []
  assert.equal(comparisonPeriodGrains(snapshot, 0).current, undefined)
  if (item.current.kind !== 'calendar' || !('nominalStart' in item.current))
    throw new Error('expected historical calendar period')
  assert.equal(periodLabel(item.current), item.current.nominalStart)
})

test('calendar labels retain captured names and never infer bounds for current unlabeled periods', () => {
  assert.equal(
    periodLabel(
      {
        kind: 'calendar',
        key: ['2025-01'],
        timezone: 'UTC',
        label: null,
        selection: 'full',
        cutoff: null,
      },
      { kind: 'builtin', unit: 'month', step: 1 },
    ),
    '—',
  )
  assert.equal(
    periodLabel(
      {
        kind: 'calendar',
        key: ['2025-01'],
        timezone: 'UTC',
        label: 'Saved period',
        selection: 'full',
        cutoff: null,
      },
      { kind: 'builtin', unit: 'month', step: 1 },
    ),
    'Saved period',
  )
})

test('captured month-start civil labels use exact month grain while custom anonymous labels take precedence', () => {
  const snapshot = comparedCalendarWithPeriods(1)
  const periods = snapshot.frame.sections.periods
  if (periods.status !== 'captured') throw new Error('expected captured periods')
  const pair = periods.pages.find((page) => page.target.kind === 'comparison')!.items[0]!
  if (pair.kind !== 'comparison') throw new Error('expected comparison pair')
  pair.current = {
    kind: 'calendar',
    key: ['2025-05-01T00:00:00+08:00'],
    timezone: 'Asia/Shanghai',
    label: '2025-05-01',
    selection: 'full',
    cutoff: null,
  }
  pair.baseline = {
    kind: 'calendar',
    key: ['2025-06-01T00:00:00+08:00'],
    timezone: 'Asia/Shanghai',
    label: '2025-06-01',
    selection: 'full',
    cutoff: null,
  }
  const original = JSON.stringify(snapshot)
  assert.deepEqual(endpointLabels(zh, snapshot, 0), {
    current: '2025-05',
    baseline: '2025-06',
    specific: true,
  })
  const grains = comparisonPeriodGrains(snapshot, 0)
  assert.equal(periodLabel(pair.current, grains.current), '2025-05')
  assert.equal(periodLabel(pair.baseline, grains.baseline), '2025-06')
  assert.equal(JSON.stringify(snapshot), original)
  assert.deepEqual(
    endpointLabels(
      zh,
      {
        ...snapshot,
        frameDisplay: { comparisonLabels: [{ alias: null, current: '5月', baseline: '6月' }] },
      },
      0,
    ),
    { current: '5月', baseline: '6月', specific: true },
  )
})

test('civil-label abbreviation requires a valid period start and exact step-one month or year grain', () => {
  const calendar = {
    kind: 'calendar' as const,
    key: ['saved'],
    timezone: 'UTC',
    label: '2025-01-01',
    selection: 'full' as const,
    cutoff: null,
  }
  assert.equal(periodLabel(calendar, { kind: 'builtin', unit: 'year', step: 1 }), '2025')
  for (const label of ['2025-05-15', '2025-13-01', 'custom fiscal month', '2025-05-01T00:00:00Z'])
    assert.equal(
      periodLabel({ ...calendar, label }, { kind: 'builtin', unit: 'month', step: 1 }),
      label,
    )
  assert.equal(periodLabel(calendar), '2025-01-01')
  assert.equal(periodLabel(calendar, { kind: 'builtin', unit: 'month', step: 2 }), '2025-01-01')
  assert.equal(periodLabel(calendar, { kind: 'builtin', unit: 'day', step: 1 }), '2025-01-01')
  assert.equal(
    periodLabel({ ...calendar, label: '2025-05-01' }, { kind: 'builtin', unit: 'year', step: 1 }),
    '2025-05-01',
  )
})

test('absent, incomplete or partially missing comparison periods fall back on both sides', () => {
  const snapshot = comparedIntervalMonth()
  const section = snapshot.frame.sections.periods
  if (section.status !== 'captured') throw new Error('expected captured periods')
  const page = section.pages[0]!
  page.hasMore = true
  assert.deepEqual(endpointLabels(zh, snapshot, 0), fallback)
  page.hasMore = false
  page.totalCount = 2
  assert.deepEqual(endpointLabels(zh, snapshot, 0), fallback)
  page.totalCount = 1
  const item = page.items[0]!
  if (item.kind !== 'comparison') throw new Error('expected comparison periods')
  item.baseline = null
  item.absentReason = 'period_absent'
  assert.deepEqual(endpointLabels(zh, snapshot, 0), fallback)
})

test('year, cross-year month and DST day intervals retain unambiguous civil labels', () => {
  const snapshot = comparedIntervalMonth()
  const section = snapshot.frame.sections.periods
  if (section.status !== 'captured') throw new Error('expected captured periods')
  const item = section.pages[0]!.items[0]!
  if (
    item.kind !== 'comparison' ||
    item.current.kind !== 'interval' ||
    item.baseline?.kind !== 'interval'
  )
    throw new Error('expected interval endpoints')
  item.current.start = '2025-01-01T00:00:00-05:00'
  item.current.end = '2026-01-01T00:00:00-05:00'
  item.baseline.start = '2024-01-01T00:00:00-05:00'
  item.baseline.end = '2025-01-01T00:00:00-05:00'
  assert.deepEqual(endpointLabels(zh, snapshot, 0), {
    current: '2025',
    baseline: '2024',
    specific: true,
  })
  item.current.start = '2025-01-01T00:00:00-05:00'
  item.current.end = '2025-02-01T00:00:00-05:00'
  item.baseline.start = '2024-12-01T00:00:00-05:00'
  item.baseline.end = '2025-01-01T00:00:00-05:00'
  assert.deepEqual(endpointLabels(en, snapshot, 0), {
    current: '2025-01',
    baseline: '2024-12',
    specific: true,
  })
  item.current.start = '2025-03-09T00:00:00-05:00'
  item.current.end = '2025-03-10T00:00:00-04:00'
  item.baseline.start = '2025-03-08T00:00:00-05:00'
  item.baseline.end = '2025-03-09T00:00:00-05:00'
  assert.deepEqual(endpointLabels(zh, snapshot, 0), {
    current: '2025-03-09',
    baseline: '2025-03-08',
    specific: true,
  })
})

test('interval endpoints with nonzero seconds or sub-millisecond fractions are not labeled as full days', () => {
  const snapshot = comparedIntervalMonth()
  const section = snapshot.frame.sections.periods
  if (section.status !== 'captured') throw new Error('expected captured periods')
  const item = section.pages[0]!.items[0]!
  if (
    item.kind !== 'comparison' ||
    item.current.kind !== 'interval' ||
    item.baseline?.kind !== 'interval'
  )
    throw new Error('expected interval endpoints')
  item.current.start = '2025-06-01T00:00:01-04:00'
  item.current.end = '2025-07-01T00:00:00-04:00'
  assert.deepEqual(endpointLabels(zh, snapshot, 0), {
    current: '2025-06-01 00:00:01 GMT-04:00 – 2025-07-01 00:00 GMT-04:00',
    baseline: '2025-05',
    specific: true,
  })
  item.current.start = '2025-06-01T04:00:00.000001Z'
  item.current.end = '2025-07-01T04:00:00Z'
  assert.deepEqual(endpointLabels(en, snapshot, 0), {
    current: '2025-06-01 00:00:00.000001 GMT-04:00 – 2025-07-01 00:00 GMT-04:00',
    baseline: '2025-05',
    specific: true,
  })
  item.current.start = '2025-06-01T00:00:00.000000-04:00'
  assert.equal(endpointLabels(zh, snapshot, 0).current, '2025-06')
})

test('repeated civil hours during DST fallback retain each saved instant and offset', () => {
  const snapshot = comparedIntervalMonth()
  const section = snapshot.frame.sections.periods
  if (section.status !== 'captured') throw new Error('expected captured periods')
  const item = section.pages[0]!.items[0]!
  if (item.kind !== 'comparison' || item.current.kind !== 'interval')
    throw new Error('expected interval endpoint')
  item.current.start = '2025-11-02T01:00:00-04:00'
  item.current.end = '2025-11-02T01:00:00-05:00'
  assert.equal(
    endpointLabels(en, snapshot, 0).current,
    '2025-11-02 01:00 GMT-04:00 – 2025-11-02 01:00 GMT-05:00',
  )
})
