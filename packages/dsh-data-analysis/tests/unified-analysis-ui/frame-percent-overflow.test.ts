import assert from 'node:assert/strict'
import { test } from 'node:test'
import { displayFrameCell, percent } from '../../src/client/analysis-ui/frame/model.ts'
import { shareByRegion } from './frame-fixtures.ts'

test('large saved percentages retain their exact source spelling instead of missing or infinity', () => {
  for (const locale of ['zh-CN', 'en-US'] as const) {
    assert.equal(percent(locale, null, false, '1e400'), '1e400 × 100%')
    assert.equal(percent(locale, null, true, '-1e400'), '▼1e400 × 100%')
    assert.equal(percent(locale, 1e307, false, '1e307'), '1e307 × 100%')
    assert.equal(percent(locale, -1e307, true, '-1e307'), '▼1e307 × 100%')
    assert.equal(percent(locale, 90071992547410, false, '90071992547410'), '90071992547410 × 100%')
    assert.equal(percent(locale, null, false), '—')
    assert.equal(percent(locale, 0, false, '1e-400'), '<0.01%')
    assert.equal(percent(locale, 0, true, '-1e-400'), '▼<0.01%')
  }
})

test('explicit percentage formatting retains large Decimal values', () => {
  const snapshot = shareByRegion()
  const column = {
    ...snapshot.data.columns.find((item) => item.id === 'revenue_share')!,
    type: 'decimal' as const,
  }
  const withFormat = {
    ...snapshot,
    frameDisplay: { formats: [{ value: column.id, format: 'percent' as const, decimals: 1 }] },
  }
  assert.equal(displayFrameCell(withFormat, 'zh-CN', '1e400', column), '1e400 × 100%')
  assert.equal(displayFrameCell(withFormat, 'en-US', '-1e307', column), '-1e307 × 100%')
})

test('Decimal rounding uses saved digits at and around percentage boundaries', () => {
  for (const locale of ['zh-CN', 'en-US'] as const) {
    const below = '0.144499999999999999999'
    const above = '0.144500000000000000001'
    assert.equal(percent(locale, Number(below), false, below, 1), '14.4%')
    assert.equal(percent(locale, Number(above), false, above, 1), '14.5%')
    assert.equal(percent(locale, Number(`-${below}`), true, `-${below}`, 1), '▼14.4%')
    assert.equal(percent(locale, Number(`-${above}`), false, `-${above}`, 1), '-14.5%')
    const tinyBelow = '0.000499999999999999999'
    const tinyAbove = '0.000500000000000000001'
    assert.equal(percent(locale, Number(tinyBelow), false, tinyBelow, 1), '<0.1%')
    assert.equal(percent(locale, Number(tinyAbove), false, tinyAbove, 1), '0.1%')
  }
})
