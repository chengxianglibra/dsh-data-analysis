import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { categoryAxis, comparisonOf, decompositionOf, frame } from './frame-fixtures.ts'
import { bundleRenderer, type Renderer } from './frame-render-fixtures.ts'

let renderer: Renderer
before(async () => {
  renderer = await bundleRenderer()
})
after(async () => {
  await renderer?.dispose()
})

function attribution(
  target: 'absolute' | 'relative' = 'absolute',
  options: { restricted?: boolean; parents?: boolean } = {},
) {
  const facts = decompositionOf([
    ['contribution', 'contribution'],
    ['total', 'total'],
    ['share', 'share'],
    ['current', 'current'],
    ['baseline', 'baseline'],
  ])
  facts.target = { kind: target, comparison: 0, group: 'sales' }
  if (options.restricted) facts.rowScope = 'restricted'
  if (options.parents) facts.groups = [{ kind: 'axis', axisToken: 't_team' }]
  facts.outputs.push(
    { fieldKind: 'presence', role: 'current_present', name: 'current_present' },
    { fieldKind: 'presence', role: 'baseline_present', name: 'baseline_present' },
  )
  return frame({
    axes: options.parents
      ? [{ name: 'team', keys: ['A', 'A', 'B'] }, categoryAxis(3)]
      : [categoryAxis(3)],
    values: [
      { name: 'contribution', values: [-20, 5, null] },
      { name: 'total', values: [-15, -15, -15] },
      { name: 'share', values: [1.3333, -0.3333, null] },
      { name: 'current', values: [80, 25, 999999] },
      { name: 'baseline', values: [100, 20, 30] },
      { name: 'current_present', type: 'boolean', values: [true, true, false], presence: true },
      { name: 'baseline_present', type: 'boolean', values: [true, true, true], presence: true },
    ],
    comparisons: [comparisonOf({ kind: 'ordinary' }, [{ name: 'sales', values: [] }])],
    decompositions: [facts],
  })
}

test('attribution displays saved endpoints and signed shares while respecting presence', async () => {
  const html = await renderer.render(attribution(), { askPoint: true })
  const table = /<section[^>]*data-decomposition-rows="attribution"[\s\S]*?<\/section>/.exec(
    html,
  )?.[0]
  assert.ok(table)
  assert.match(table, /133\.33%/)
  assert.match(table, /-33\.33%/)
  assert.match(table, /data-frame-point="0:contribution"/)
  assert.match(table, /data-frame-point="0:current"/)
  assert.match(table, /data-frame-point="0:baseline"/)
  assert.doesNotMatch(table, /999,999|999999|data-frame-point="2:current"/)
  assert.match(table, /—/)
})

test('relative decompositions format contribution as a percentage without changing endpoint units', async () => {
  const snapshot = attribution('relative')
  const column = snapshot.data.columns.findIndex((item) => item.id === 'contribution')
  snapshot.data.rows[0]![column] = -0.125
  const html = await renderer.render(snapshot)
  const table = /<section[^>]*data-decomposition-rows="attribution"[\s\S]*?<\/section>/.exec(
    html,
  )?.[0]
  assert.ok(table)
  assert.match(table, /-12\.50%/)
  assert.match(table, />100\.00<\/span>/)
  assert.match(table, />80\.00<\/span>/)
})

test('endpoint selection requires one unambiguous saved presence binding', async () => {
  for (const mode of ['absent', 'duplicate', 'field-duplicate'] as const) {
    const snapshot = attribution()
    const interpretation = snapshot.frame.sections.interpretation
    assert.equal(interpretation.status, 'captured')
    if (interpretation.status !== 'captured') throw new Error('interpretation required')
    const outputs = interpretation.decompositions[0]!.outputs
    const index = outputs.findIndex((item) => item.role === 'current_present')
    if (mode === 'absent') outputs.splice(index, 1)
    if (mode === 'duplicate') outputs.push({ ...outputs[index]! })
    if (mode === 'field-duplicate')
      outputs.push({ ...outputs.find((item) => item.role === 'current')! })
    const html = await renderer.render(snapshot, { askPoint: true })
    const table = /<section[^>]*data-decomposition-rows="attribution"[\s\S]*?<\/section>/.exec(
      html,
    )?.[0]
    assert.ok(table)
    assert.match(table, /80\.00/)
    assert.doesNotMatch(table, /data-frame-point="0:current"/)
    assert.match(table, /data-frame-point="0:baseline"/)
    assert.match(table, /data-frame-point="0:contribution"/)
  }
})

test('restricted attribution keeps its scope status and groups saved rows by parent', async () => {
  const html = await renderer.render(attribution('absolute', { restricted: true, parents: true }))
  assert.match(html, /data-parent="A"/)
  assert.match(html, /data-parent="B"/)
  assert.equal((html.match(/data-decomposition-rows="attribution"/g) ?? []).length, 2)
  assert.match(html, /—/)
})

test('an absent endpoint does not hide a saved contribution', async () => {
  const snapshot = attribution()
  const column = snapshot.data.columns.findIndex((item) => item.id === 'contribution')
  snapshot.data.rows[2]![column] = -3
  const html = await renderer.render(snapshot, { askPoint: true })
  const table = /<section[^>]*data-decomposition-rows="attribution"[\s\S]*?<\/section>/.exec(
    html,
  )?.[0]
  assert.ok(table)
  assert.doesNotMatch(table, /data-frame-point="2:current"/)
  assert.match(table, /data-frame-point="2:contribution"/)
  assert.match(table, />-3\.00<\/button>/)
})
