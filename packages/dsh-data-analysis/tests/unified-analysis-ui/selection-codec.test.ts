import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'
import {
  dateFromDay,
  decodeSelection,
  optionId,
  validSelectionDraft,
} from '../../src/client/analysis-ui/selection-codec.ts'
import {
  isSnapshotFilterSelectionValid,
  resolveSnapshotFilter,
} from '../../src/presentation/contracts/snapshot-filter.ts'
import { datasetSnapshot } from './dataset-fixtures.ts'

const snapshot = datasetSnapshot(
  [
    ['A', '2026-11-12'],
    ['B', '2026-11-13'],
  ],
  [
    { id: 'region', label: 'Region', type: 'string', nullable: false },
    { id: 'day', label: 'Day', type: 'date', nullable: false },
  ],
)
const definition = resolveSnapshotFilter(snapshot, {
  filterId: 'region',
  ref: 'sales',
  field: { kind: 'column', name: 'region' },
  label: 'Region',
  mode: 'multiple',
})
const items = definition.options.map((value) => ({ id: optionId(value) }))
const regionA = optionId('A')
const from = dateFromDay('2026-11-12')
const to = dateFromDay('2026-11-13')
const range = resolveSnapshotFilter(snapshot, {
  filterId: 'period',
  ref: 'sales',
  field: { kind: 'column', name: 'day' },
  label: 'Period',
  mode: 'date-range',
})

test('invalid multiple selection cannot become an unfiltered selection', () => {
  for (const value of [
    { unknown: false },
    { [regionA]: 'true' },
    { [regionA]: null },
    [],
    new Date(),
    null,
  ]) {
    assert.equal(decodeSelection(definition, value), undefined)
    assert.equal(validSelectionDraft(value, items, 'multiple', true), false)
  }
  assert.deepEqual(decodeSelection(definition, {}), [])
  assert.equal(validSelectionDraft({}, items, 'multiple', true), true)
  assert.equal(validSelectionDraft({}, items, 'multiple', false), false)
  assert.equal(
    isSnapshotFilterSelectionValid(
      { ...definition, declaration: { ...definition.declaration, options: { allowAll: false } } },
      [],
    ),
    false,
  )
  assert.deepEqual(decodeSelection(definition, { [regionA]: true }), ['A'])
  assert.equal(validSelectionDraft({ [regionA]: true }, items, 'multiple', false), true)
})

test('only a complete date range or an empty object is accepted', () => {
  for (const value of [
    null,
    undefined,
    [],
    new Date(),
    { x: 1 },
    { from },
    { from, to: undefined },
    { from, to, x: 1 },
    { from: to, to: from },
  ]) {
    assert.equal(decodeSelection(range, value), undefined)
    assert.equal(validSelectionDraft(value, [], 'date-range', true), false)
  }
  assert.deepEqual(decodeSelection(range, {}), [])
  assert.equal(validSelectionDraft({}, [], 'date-range', true), true)
  assert.equal(validSelectionDraft({}, [], 'date-range', false), false)
  assert.deepEqual(decodeSelection(range, { from, to }), ['2026-11-12', '2026-11-13'])
  assert.equal(validSelectionDraft({ from, to }, [], 'date-range', false), true)
})

test('skipped local civil dates fail instead of becoming another day', () => {
  const moduleUrl = new URL('../../src/client/analysis-ui/selection-codec.ts', import.meta.url).href
  const script = `
    import { dateFromDay } from ${JSON.stringify(moduleUrl)};
    const encode = date => [date.getFullYear(), date.getMonth() + 1, date.getDate()];
    const before = encode(dateFromDay('2011-12-29'));
    const after = encode(dateFromDay('2011-12-31'));
    let failure;
    try { dateFromDay('2011-12-30') } catch (error) { failure = error.message }
    process.stdout.write(JSON.stringify({ before, after, failure }));
  `
  const output = execFileSync(
    process.execPath,
    ['--experimental-strip-types', '--input-type=module', '-e', script],
    { env: { ...process.env, TZ: 'Pacific/Apia' }, encoding: 'utf8' },
  )
  assert.deepEqual(JSON.parse(output), {
    before: [2011, 12, 29],
    after: [2011, 12, 31],
    failure: 'analysis-filter-date-unrepresentable',
  })
})
