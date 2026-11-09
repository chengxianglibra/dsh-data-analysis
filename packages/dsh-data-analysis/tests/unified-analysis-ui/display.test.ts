import assert from 'node:assert/strict'
import { test } from 'node:test'
import { displayFrameCell, periodLabel } from '../../src/client/analysis-ui/frame/model.ts'
import { displayCell } from '../../src/client/presentation/display.ts'
import { columnLabel } from '../../src/client/presentation/model.ts'
import type { DatasetColumn } from '../../src/presentation/contracts/types.ts'
import { correlate, shareByRegion } from './frame-fixtures.ts'

const column = (type: DatasetColumn['type'], unit?: string): DatasetColumn => ({
  id: 'value',
  label: 'value',
  type,
  nullable: true,
  ...(unit === undefined ? {} : { unit }),
})

test('displayCell groups floats with two fraction digits', () => {
  assert.equal(displayCell('en-US', 1234567.891, column('float64')), '1,234,567.89')
  assert.equal(displayCell('en-US', 1234.5, column('float64')), '1,234.50')
  assert.equal(displayCell('en-US', -1234.567, column('float64')), '-1,234.57')
})

test('displayCell groups int64 through BigInt without losing precision', () => {
  assert.equal(
    displayCell('en-US', '12345678901234567890', column('int64')),
    '12,345,678,901,234,567,890',
  )
  assert.equal(displayCell('en-US', '-9007199254740993', column('int64')), '-9,007,199,254,740,993')
})

test('displayCell rounds decimal strings without losing integer precision', () => {
  assert.equal(displayCell('en-US', '0.1000', column('decimal')), '0.10')
  assert.equal(displayCell('en-US', '-1.20e3', column('decimal')), '-1,200.00')
  assert.equal(
    displayCell('en-US', '9007199254740993.125', column('decimal')),
    '9,007,199,254,740,993.13',
  )
})

test('Frame value formatting uses captured share and coefficient semantics', () => {
  const share = shareByRegion()
  const shareColumn = share.data.columns.find((item) => item.id === 'revenue_share')!
  assert.equal(displayFrameCell(share, 'en-US', 0.25, shareColumn), '25.00%')
  const correlation = correlate(false)
  const coefficient = correlation.data.columns.find((item) => item.id === 'coefficient')!
  assert.equal(displayFrameCell(correlation, 'en-US', 0.5, coefficient), '0.500')
  assert.equal(displayCell('en-US', 1234.5, column('float64', 'USD')), '$1,234.50')
})

test('USD displays $ in both locales without losing decimal or integer precision', () => {
  for (const locale of ['zh-CN', 'en-US'] as const) {
    assert.equal(displayCell(locale, 1234.5, column('float64', 'USD')), '$1,234.50')
    assert.equal(
      displayCell(locale, '-9007199254740993.125', column('decimal', 'USD')),
      '-$9,007,199,254,740,993.13',
    )
    assert.equal(
      displayCell(locale, '9007199254740993', column('int64', 'USD')),
      '$9,007,199,254,740,993.00',
    )
  }
})

test('explicit currency formatting uses $ only for USD', () => {
  const snapshot = shareByRegion()
  const value = snapshot.data.columns.find((item) => item.id === 'revenue')!
  const withCurrency = {
    ...snapshot,
    frameDisplay: { formats: [{ value: value.id, format: 'currency' as const, decimals: 2 }] },
  }
  for (const locale of ['zh-CN', 'en-US'] as const) {
    assert.equal(
      displayFrameCell(withCurrency, locale, -1234.5, { ...value, unit: 'USD' }),
      '-$1,234.50',
    )
    const cad = new Intl.NumberFormat(locale, { style: 'currency', currency: 'CAD' }).format(
      -1234.5,
    )
    assert.equal(displayFrameCell(withCurrency, locale, -1234.5, { ...value, unit: 'CAD' }), cad)
  }
})

test('explicit currency formatting retains arbitrary saved units and requested decimals', () => {
  const snapshot = shareByRegion()
  const value = snapshot.data.columns.find((item) => item.id === 'revenue')!
  const withCurrency = {
    ...snapshot,
    frameDisplay: { formats: [{ value: value.id, format: 'currency' as const, decimals: 1 }] },
  }
  for (const locale of ['zh-CN', 'en-US'] as const) {
    for (const unit of ['USD/mile', '人/小时', undefined, '1']) {
      const suffix = unit && unit !== '1' ? ` ${unit}` : ''
      assert.equal(
        displayFrameCell(withCurrency, locale, '9007199254740993.125', {
          ...value,
          type: 'decimal',
          unit,
        }),
        `9,007,199,254,740,993.1${suffix}`,
      )
    }
  }
})

test('displayCell formats datetimes in the supplied timezone and falls back to raw text', () => {
  assert.equal(
    displayCell('en-US', '2025-06-01T00:00:00-04:00', column('datetime'), 'America/New_York'),
    '2025-06-01 00:00',
  )
  assert.equal(displayCell('en-US', '2025-06-01T04:00:00Z', column('datetime')), '2025-06-01 04:00')
  assert.equal(displayCell('en-US', 'not-a-date', column('datetime')), 'not-a-date')
})

test('displayCell renders null and plain values unchanged', () => {
  assert.equal(displayCell('en-US', null, column('float64')), '—')
  assert.equal(displayCell('en-US', 'abc', column('string')), 'abc')
  assert.equal(displayCell('en-US', true, column('boolean')), 'true')
})

test('columnLabel omits dimensionless and blank units but keeps real units', () => {
  const label = (unit: string | undefined, text = 'trips'): DatasetColumn => ({
    id: 'trips',
    label: text,
    type: 'int64',
    nullable: false,
    ...(unit === undefined ? {} : { unit }),
  })
  assert.equal(columnLabel(label('1')), 'trips')
  assert.equal(columnLabel(label('  ')), 'trips')
  assert.equal(columnLabel(label(undefined)), 'trips')
  assert.equal(columnLabel(label('USD')), 'trips (USD)')
  assert.equal(columnLabel(label('USD', 'Revenue (USD)')), 'Revenue (USD)')
})

type SavedPeriod = NonNullable<Parameters<typeof periodLabel>[0]>
const interval = (start: string, end: string): SavedPeriod => ({
  kind: 'interval',
  key: [start],
  timezone: 'America/New_York',
  start,
  end,
})

test('interval period labels name civil endpoints without an exclusive upper bound', () => {
  // A month start to the next month start is one civil month.
  assert.equal(
    periodLabel(interval('2025-06-01T00:00:00-04:00', '2025-07-01T00:00:00-04:00')),
    '2025-06',
  )
  // The year stays visible at a civil-month boundary.
  assert.equal(
    periodLabel(interval('2025-12-01T00:00:00-05:00', '2026-01-01T00:00:00-05:00')),
    '2025-12',
  )
  // A one-day interval is one civil date, not a range.
  assert.equal(
    periodLabel(interval('2025-06-01T00:00:00-04:00', '2025-06-02T00:00:00-04:00')),
    '2025-06-01',
  )
  // Any other day-aligned interval ends on the previous calendar day, inclusive.
  assert.equal(
    periodLabel(interval('2025-06-01T00:00:00-04:00', '2025-06-15T00:00:00-04:00')),
    '2025-06-01 ~ 2025-06-14',
  )
  // Non-midnight boundaries keep the full instants.
  assert.equal(
    periodLabel(interval('2025-06-01T08:30:00-04:00', '2025-06-02T09:45:00-04:00')),
    '2025-06-01 08:30 GMT-04:00 – 2025-06-02 09:45 GMT-04:00',
  )
})
