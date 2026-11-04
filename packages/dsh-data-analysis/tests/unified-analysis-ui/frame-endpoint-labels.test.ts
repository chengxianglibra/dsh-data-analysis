import assert from 'node:assert/strict'
import { test } from 'node:test'
import { endpointLabels } from '../../src/client/analysis-ui/frame/model.ts'
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
