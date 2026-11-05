import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import type { FrameSnapshotV2 } from '../../src/presentation/contracts/snapshot.ts'
import { categoryAxis, comparisonOf, decompositionOf, frame } from './frame-fixtures.ts'
import { bundleRenderer, type Renderer } from './frame-render-fixtures.ts'

let renderer: Renderer
before(async () => {
  renderer = await bundleRenderer()
})
after(async () => {
  await renderer?.dispose()
})

/** Both totals are saved independently: the view must never derive one from the other. */
function changes() {
  const absolute = decompositionOf([
    ['contribution', 'absolute_contribution'],
    ['total', 'absolute_total'],
  ])
  absolute.target = { kind: 'absolute', comparison: 0, group: 'sales' }
  const relative = decompositionOf([
    ['contribution', 'relative_contribution'],
    ['total', 'relative_total'],
  ])
  relative.target = { kind: 'relative', comparison: 0, group: 'sales' }
  return frame({
    axes: [categoryAxis(3)],
    values: [
      { name: 'absolute_contribution', values: [-40, 10, 5] },
      { name: 'absolute_total', values: [-25, -25, -25] },
      { name: 'relative_contribution', values: [-0.04, 0.01, 0.005] },
      { name: 'relative_total', values: [-0.1234, -0.1234, -0.1234] },
    ],
    comparisons: [comparisonOf({ kind: 'ordinary' }, [{ name: 'sales', values: [] }])],
    decompositions: [absolute, relative],
  })
}

function interpretation(snapshot: FrameSnapshotV2) {
  const result = snapshot.frame.sections.interpretation
  if (result.status !== 'captured') throw new Error('interpretation required')
  return result
}

async function header(snapshot: FrameSnapshotV2) {
  const html = await renderer.render(snapshot, {
    view: { chart: 'decomposition', encoding: { value: 'absolute_contribution' } },
  })
  assert.match(html, /data-number="absolute_total"/)
  return html
}

test('a uniquely matched relative total is displayed from its saved value', async () => {
  const html = await header(changes())
  assert.match(html, /data-number="relative_total"[^>]*>[\s\S]*?-12\.34%/)
  assert.match(html, /Change rate/)
})

test('unmatched and ambiguous relative decompositions do not supply a total', async () => {
  for (const variant of ['absent', 'duplicate', 'group', 'scope', 'comparison'] as const) {
    const snapshot = changes()
    const facts = interpretation(snapshot)
    const relative = facts.decompositions[1]!
    if (variant === 'absent') facts.decompositions.pop()
    if (variant === 'duplicate') facts.decompositions.push(structuredClone(relative))
    if (variant === 'group' && relative.target.kind === 'relative') relative.target.group = 'other'
    if (variant === 'scope') relative.rowScope = 'restricted'
    if (variant === 'comparison' && relative.target.kind === 'relative')
      relative.target.comparison = 1
    const html = await header(snapshot)
    assert.doesNotMatch(html, /data-number="relative_total"/, variant)
  }
})

test('repeated parent totals must be present and equal in every saved row', async () => {
  for (const replacement of [-0.1235, null] as const) {
    const snapshot = changes()
    const column = snapshot.data.columns.findIndex((item) => item.id === 'relative_total')
    snapshot.data.rows[1]![column] = replacement
    const html = await header(snapshot)
    assert.doesNotMatch(html, /data-number="relative_total"/)
  }
})

test('decomposition parent groups must match exactly', async () => {
  const snapshot = changes()
  interpretation(snapshot).decompositions[1]!.groups = [{ kind: 'axis', axisToken: 't_region' }]
  const html = await header(snapshot)
  assert.doesNotMatch(html, /data-number="relative_total"/)
})
