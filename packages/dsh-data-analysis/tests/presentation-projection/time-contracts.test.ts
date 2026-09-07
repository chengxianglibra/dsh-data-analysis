import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PresentationContractError,
  parseTypedDataset,
} from '../../src/presentation/contracts/index.ts'

function dataset(value: string, type: 'date' | 'datetime') {
  return {
    schemaVersion: 1,
    columns: [{ id: 'time', label: 'time', type, nullable: false }],
    rows: [[value]],
    rowCount: 1,
    limit: 1,
    truncated: false,
  }
}

test('date/time matches the Python writer calendar, clock, offset and microsecond boundary', () => {
  for (const [value, type] of [
    ['0000-01-01', 'date'],
    ['0000-01-01T00:00:00Z', 'datetime'],
    ['2026-09-07T24:00:00Z', 'datetime'],
    ['2026-09-07T12:60:00Z', 'datetime'],
    ['2026-09-07T12:00:60Z', 'datetime'],
    ['2026-09-07T00:00:00+24:00', 'datetime'],
    ['2026-09-07T00:00:00+00:60', 'datetime'],
    ['2026-02-29', 'date'],
    ['2026-09-07T00:00:00.1234567Z', 'datetime'],
    ['2026-09-07T00:00:00', 'datetime'],
  ] as const) {
    assert.throws(
      () => parseTypedDataset(dataset(value, type)),
      (error: unknown) => error instanceof PresentationContractError && error.path === '/rows/0/0',
      value,
    )
  }
  for (const [value, type] of [
    ['0001-01-01', 'date'],
    ['9999-12-31', 'date'],
    ['2024-02-29', 'date'],
    ['2026-09-07T23:59:59.123456+23:59', 'datetime'],
    ['2026-09-07T00:00:00.000001-23:59', 'datetime'],
  ] as const)
    assert.equal(parseTypedDataset(dataset(value, type)).rows[0]![0], value)
})
