import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { comparedSinglePeriodMultiGroup } from './frame-fixtures.ts'
import { bundleRenderer, type Renderer } from './frame-render-fixtures.ts'

let renderer: Renderer
before(async () => {
  renderer = await bundleRenderer()
})
after(async () => {
  await renderer.dispose()
})

test('comparison KPI pairs the explicit current period with its metric and keeps changes compact', async () => {
  const snapshot = comparedSinglePeriodMultiGroup()
  const facts = snapshot.frame.sections.interpretation
  if (facts.status !== 'captured') throw new Error('comparison facts required')
  facts.comparisons[0]!.alias = 'prior'
  const html = await renderer.render(snapshot, {
    display: { comparisonLabels: [{ alias: 'prior', current: 'June', baseline: 'May' }] },
  })
  const card = /<section[^>]*data-comparison-group="sales"[\s\S]*?<\/section>/.exec(html)?.[0] ?? ''
  assert.match(card, /<h4>sales · June<\/h4>/)
  assert.match(card, /<dt class="fv-sr-only">June<\/dt>/)
  assert.match(card, /<dt>May<\/dt>/)
  assert.match(card, /<dt class="fv-sr-only">Change<\/dt>/)
  assert.match(card, /<span aria-hidden="true"> · <\/span>/)
  assert.match(card, /<dt class="fv-sr-only">Change rate<\/dt>/)
  assert.ok(card.indexOf('>May</dt>') < card.indexOf('>Change</dt>'))
  assert.ok(card.indexOf('>Change</dt>') < card.indexOf('>Change rate</dt>'))
})

test('without captured or declared endpoints comparison KPI still identifies Current and Baseline', async () => {
  const html = await renderer.render(comparedSinglePeriodMultiGroup())
  const card = /<section[^>]*data-comparison-group="sales"[\s\S]*?<\/section>/.exec(html)?.[0] ?? ''
  assert.match(card, /<h4>sales<\/h4>/)
  assert.match(card, /<dt>Current<\/dt>/)
  assert.match(card, /<dt>Baseline<\/dt>/)
})
