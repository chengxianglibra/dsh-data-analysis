import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { months, observeTimeCategory, token } from './frame-fixtures.ts'
import { bundleRenderer, type Renderer } from './frame-render-fixtures.ts'

let renderer: Renderer
before(async () => {
  renderer = await bundleRenderer()
})
after(async () => {
  await renderer?.dispose()
})

function savedPeriods() {
  const snapshot = observeTimeCategory(9)
  snapshot.frame.sections.periods = {
    status: 'captured',
    pages: [
      {
        target: { kind: 'axis', axisToken: token('month') },
        totalCount: 3,
        hasMore: false,
        items: months(3).map((key, index) => ({
          kind: 'calendar',
          key: [key],
          timezone: 'Asia/Shanghai',
          label: index < 2 ? 'Period A' : 'Long period description',
          selection: index === 1 || index === 2 ? 'partial' : 'full',
          cutoff: index === 1 ? '2025-02-15' : null,
        })),
      },
    ],
  }
  return snapshot
}

test('heatmaps use captured periods on both axes without merging duplicate labels', async () => {
  const snapshot = savedPeriods()
  const x = await renderer.render(snapshot, {
    askPoint: true,
    view: { chart: 'heatmap', encoding: { x: 'month', y: 'region', value: 'm0' } },
  })
  assert.equal((x.match(/data-heatmap-column="Period A"/g) ?? []).length, 2)
  assert.match(x, /<title>Period A · Partial period: 2025-02-15<\/title>/)
  assert.match(x, /data-mark="cell"/)
  assert.match(x, /◌/)
  const y = await renderer.render(snapshot, {
    view: { chart: 'heatmap', encoding: { x: 'region', y: 'month', value: 'm0' } },
  })
  assert.match(y, /data-row-label="Long period description" data-row-incomplete="true"/)
  assert.match(y, /Long period descr… ◌/)
})

test('uncaptured periods keep the saved key as label instead of inferring a civil period', async () => {
  const snapshot = savedPeriods()
  const section = snapshot.frame.sections.periods
  if (section.status !== 'captured') throw new Error('periods required')
  section.pages[0]!.items.splice(1)
  section.pages[0]!.hasMore = true
  const options = {
    view: { chart: 'heatmap', encoding: { x: 'month', y: 'region', value: 'm0' } },
  } as const
  const partial = await renderer.render(snapshot, options)
  assert.match(partial, /data-heatmap-column="Period A"/)
  assert.match(partial, /data-heatmap-column="2025-02-01T00:00:00\+08:00"/)
  snapshot.frame.sections.periods = { status: 'unavailable', reason: 'read-failed' }
  const unavailable = await renderer.render(snapshot, options)
  assert.match(unavailable, /data-heatmap-column="2025-01-01T00:00:00\+08:00"/)
  assert.doesNotMatch(unavailable, /data-heatmap-column="Period A"/)
})

test('ambiguous captured keys fall back to the raw key and no inferred selection state', async () => {
  const snapshot = savedPeriods()
  const periods = snapshot.frame.sections.periods
  if (periods.status !== 'captured') throw new Error('periods required')
  const page = periods.pages[0]!
  const first = page.items[0]!
  if (first.kind !== 'calendar' || !('selection' in first)) throw new Error('calendar required')
  page.items.push({ ...first, label: 'Conflicting label', selection: 'partial' })
  page.totalCount = 4
  const html = await renderer.render(snapshot, {
    view: { chart: 'heatmap', encoding: { x: 'month', y: 'region', value: 'm0' } },
  })
  assert.match(html, /data-heatmap-column="2025-01-01T00:00:00\+08:00"/)
  assert.doesNotMatch(html, /Conflicting label/)
})

test('heatmap detects conflicting keys across captured pages', async () => {
  const snapshot = savedPeriods()
  const periods = snapshot.frame.sections.periods
  if (periods.status !== 'captured') throw new Error('periods required')
  const page = periods.pages[0]!
  const first = page.items[0]!
  if (first.kind !== 'calendar') throw new Error('calendar required')
  periods.pages.push({ ...page, totalCount: 1, items: [{ ...first, label: 'Other label' }] })
  const html = await renderer.render(snapshot, {
    view: { chart: 'heatmap', encoding: { x: 'month', y: 'region', value: 'm0' } },
  })
  assert.match(html, /data-heatmap-column="2025-01-01T00:00:00\+08:00"/)
  assert.doesNotMatch(html, /data-heatmap-column="Other label"/)
})
