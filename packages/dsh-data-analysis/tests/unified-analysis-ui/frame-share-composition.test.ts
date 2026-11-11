import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import type { FrameSnapshotV2 } from '../../src/presentation/contracts/snapshot.ts'
import { shareByRegion, statistic } from './frame-fixtures.ts'
import { bundleRenderer, type Renderer } from './frame-render-fixtures.ts'

let renderer: Renderer
before(async () => {
  renderer = await bundleRenderer()
})
after(async () => {
  await renderer.dispose()
})

function completeShares(values = [0.2, 0.3, 0.5]): FrameSnapshotV2 {
  const snapshot = shareByRegion()
  const column = snapshot.data.columns.findIndex((item) => item.id === 'revenue_share')
  for (const [index, value] of values.entries()) snapshot.data.rows[index]![column] = value
  return snapshot
}

test('complete saved category shares, including zero, expose their numerator and selectable fractions', async () => {
  const html = await renderer.render(completeShares([0, 0.25, 0.75]), { askPoint: true })
  assert.match(html, /data-chart="share-composition"/)
  assert.equal((html.match(/class="fv-share-row"/g) ?? []).length, 3)
  assert.match(html, /0\.00%/)
  assert.match(html, /25\.00%/)
  assert.match(html, /75\.00%/)
  assert.match(html, /data-frame-point="0:revenue_share"/)
  assert.match(html, /data-frame-point="0:revenue"/)
  assert.match(html, /data-frame-point="2:revenue_share"/)
  const header = html.match(/<li class="fv-share-row fv-share-header">[\s\S]*?<\/li>/)?.[0] ?? ''
  assert.match(header, />revenue</)
  assert.match(header, />revenue_share</)
})

test('partial, restricted, missing or non-partition shares do not imply a whole', async () => {
  const partial = shareByRegion(3, 4)
  const restricted = completeShares()
  const context = restricted.frame.sections.interpretation
  if (context.status !== 'captured') throw new Error('Expected interpretation')
  const share = context.valueContexts.revenue_share
  if (share?.kind !== 'share') throw new Error('Expected share')
  share.rowScope = 'restricted'
  const missing = completeShares()
  const index = missing.data.columns.findIndex((column) => column.id === 'revenue_share')
  missing.data.columns[index]!.nullable = true
  missing.data.rows[0]![index] = null
  const negative = completeShares([-0.1, 0.3, 0.8])
  const notWhole = completeShares([0.2, 0.3, 0.4])
  const wrongAxis = completeShares()
  const facts = wrongAxis.frame.sections.interpretation
  if (facts.status !== 'captured') throw new Error('Expected interpretation')
  const wrongContext = facts.valueContexts.revenue_share
  if (wrongContext?.kind !== 'share') throw new Error('Expected share')
  wrongContext.along = []
  const many = shareByRegion(9)
  const manyIndex = many.data.columns.findIndex((column) => column.id === 'revenue_share')
  for (const row of many.data.rows) row[manyIndex] = 1 / 9
  for (const snapshot of [partial, restricted, missing, negative, notWhole, wrongAxis, many]) {
    const html = await renderer.render(snapshot)
    assert.doesNotMatch(html, /data-chart="share-composition"/)
  }
})

test('a broadcast or non-value numerator is not presented as a selectable category value', async () => {
  const broadcast = completeShares()
  const facts = broadcast.frame.sections.interpretation
  if (facts.status !== 'captured') throw new Error('Expected interpretation')
  facts.valueContexts.revenue = statistic('sum', [])
  const numeratorIndex = broadcast.data.columns.findIndex((column) => column.id === 'revenue')
  for (const row of broadcast.data.rows) row[numeratorIndex] = 123456
  const html = await renderer.render(broadcast, { askPoint: true })
  assert.match(html, /data-chart="share-composition"/)
  assert.doesNotMatch(html, /data-frame-point="\d+:revenue"/)
  assert.doesNotMatch(html, /123,456/)
  assert.match(html, /data-frame-point="0:revenue_share"/)
  const header = html.match(/<li class="fv-share-row fv-share-header">[\s\S]*?<\/li>/)?.[0] ?? ''
  assert.doesNotMatch(header, />revenue</)
  assert.match(header, />revenue_share</)

  const coordinate = completeShares()
  const coordinateFacts = coordinate.frame.sections.interpretation
  if (coordinateFacts.status !== 'captured') throw new Error('Expected interpretation')
  const context = coordinateFacts.valueContexts.revenue_share
  if (context?.kind !== 'share' || context.numerator.kind !== 'named')
    throw new Error('Expected named numerator')
  context.numerator.name = 'region'
  const coordinateHtml = await renderer.render(coordinate, { askPoint: true })
  assert.match(coordinateHtml, /data-chart="share-composition"/)
  assert.doesNotMatch(coordinateHtml, /data-frame-point="\d+:region"/)
  assert.match(coordinateHtml, /data-frame-point="0:revenue_share"/)
})
