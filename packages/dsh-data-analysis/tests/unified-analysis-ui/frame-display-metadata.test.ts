import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { headerContext } from '../../src/client/analysis-ui/frame/model.ts'
import { translator } from '../../src/client/i18n/copy.ts'
import { validateFrameDisplay } from '../../src/presentation/contracts/frame-display.ts'
import {
  frameDisplaySchema,
  resolveFrameView,
} from '../../src/presentation/contracts/frame-view.ts'
import { browserTestsEnabled, skipBrowserTest } from '../browser-test.ts'
import { categoryAxis, comparedIntervalMonth, frame, months, timeAxis } from './frame-fixtures.ts'
import { bundleRenderer, comparedScalar, type Renderer } from './frame-render-fixtures.ts'

let renderer: Renderer
before(async () => {
  if (browserTestsEnabled) renderer = await bundleRenderer()
})
after(async () => {
  await renderer?.dispose()
})

test('explicit scalar formats and titles preserve the saved values', async (t) => {
  if (skipBrowserTest(t)) return
  const snapshot = frame({
    values: [
      { name: 'fare', type: 'decimal', values: ['82040902.13'] },
      { name: 'rate', type: 'decimal', values: ['0.14526'] },
      { name: 'distance', type: 'decimal', values: ['3.514'] },
    ],
  })
  snapshot.data.columns.find((column) => column.id === 'fare')!.unit = 'USD'
  snapshot.data.columns.find((column) => column.id === 'distance')!.unit = 'mile'
  const original = JSON.stringify(snapshot)
  const display = {
    title: 'Core metrics',
    subtitle: 'June records',
    formats: [
      { value: 'fare', format: 'currency' as const, decimals: 0 },
      { value: 'rate', format: 'percent' as const, decimals: 1 },
      { value: 'distance', format: 'number' as const, decimals: 2 },
    ],
  }
  const resolved = resolveFrameView(snapshot, { chart: 'metric' })
  assert.equal(resolved.ok, true)
  if (!resolved.ok) return
  assert.equal(validateFrameDisplay(snapshot, resolved.view, display), undefined)
  const html = await renderer.render(snapshot, { view: { chart: 'metric' }, display })
  assert.match(html, /Core metrics/)
  assert.match(html, /June records/)
  assert.match(html, /\$82,040,902/)
  assert.match(html, /14\.5%/)
  assert.match(html, /3\.51 mile/)
  assert.equal(JSON.stringify(snapshot), original)
})

test('a metric can hide its automatic time context while retaining its authored subtitle', async (t) => {
  if (skipBrowserTest(t)) return
  const snapshot = frame({
    values: [
      {
        name: 'v',
        values: [42],
        context: {
          kind: 'observation',
          subject: null,
          window: null,
          time: {
            kind: 'fixed',
            start: '2024-01-01T01:02:03Z',
            end: '2025-01-01T03:04:05Z',
            timezone: 'UTC',
          },
        },
      },
    ],
  })
  const original = JSON.stringify(snapshot)
  const view = { chart: 'metric' as const }
  const auto = await renderer.render(snapshot, { view })
  assert.match(auto, /2024-01-01 01:02:03 GMT/)
  const hidden = await renderer.render(snapshot, {
    view,
    display: { timeContext: 'hidden', subtitle: 'Custom period' },
  })
  assert.doesNotMatch(hidden, /2024-01-01 01:02:03 GMT/)
  assert.match(hidden, /Custom period/)
  assert.match(hidden, /42\.00/)
  assert.equal(JSON.stringify(snapshot), original)
})

test('hiding time context preserves category comparison and authored endpoint labels', () => {
  const t = translator('en-US')
  const ordinary = comparedScalar({ current: 1, baseline: 2, absolute: -1, relative: -0.5 })
  assert.equal(
    headerContext(t, { ...ordinary, frameDisplay: { timeContext: 'hidden' } }, [], 0),
    'west ⇄ east',
  )
  const temporal = comparedIntervalMonth()
  assert.equal(headerContext(t, temporal, [], 0), '2025-06 ⇄ 2025-05')
  assert.equal(
    headerContext(t, { ...temporal, frameDisplay: { timeContext: 'hidden' } }, [], 0),
    undefined,
  )
  const facts = temporal.frame.sections.interpretation
  if (facts.status !== 'captured') throw new Error('expected captured interpretation')
  const alias = facts.comparisons[0]!.alias
  assert.equal(
    headerContext(
      t,
      {
        ...temporal,
        frameDisplay: {
          timeContext: 'hidden',
          comparisonLabels: [{ ...(alias ? { alias } : {}), current: 'June', baseline: 'May' }],
        },
      },
      [],
      0,
    ),
    'June ⇄ May',
  )
})

test('comparison endpoint labels bind to a saved alias and preserve the endpoint values', async (t) => {
  if (skipBrowserTest(t)) return
  const snapshot = comparedScalar({ current: 120, baseline: 100, absolute: 20, relative: 0.2 })
  const display = { comparisonLabels: [{ alias: 'prior', current: 'June', baseline: 'May' }] }
  const resolved = resolveFrameView(snapshot)
  assert.equal(resolved.ok, true)
  if (!resolved.ok) return
  assert.equal(validateFrameDisplay(snapshot, resolved.view, display), undefined)
  const html = await renderer.render(snapshot, { display })
  assert.match(html, /June/)
  assert.match(html, /May/)
  assert.match(html, /120\.00/)
  assert.match(html, /100\.00/)
  assert.equal(
    validateFrameDisplay(snapshot, resolved.view, {
      comparisonLabels: [{ alias: 'missing', current: 'June', baseline: 'May' }],
    }),
    '/display/comparisonLabels',
  )
})

test('anonymous comparison labels require exactly one saved null alias', async (t) => {
  if (skipBrowserTest(t)) return
  const snapshot = comparedScalar({ current: 120, baseline: 100, absolute: 20, relative: 0.2 })
  const facts = snapshot.frame.sections.interpretation
  if (facts.status !== 'captured') throw new Error('expected captured interpretation')
  facts.comparisons[0]!.alias = null
  const display = { comparisonLabels: [{ current: 'June', baseline: 'May' }] }
  assert.equal(frameDisplaySchema.safeParse(display).success, true)
  const resolved = resolveFrameView(snapshot)
  if (!resolved.ok) throw new Error('expected comparison view')
  assert.equal(validateFrameDisplay(snapshot, resolved.view, display), undefined)
  const html = await renderer.render(snapshot, { display })
  assert.match(html, /June/)
  assert.match(html, /May/)
  assert.equal(
    validateFrameDisplay(snapshot, resolved.view, {
      comparisonLabels: [...display.comparisonLabels, ...display.comparisonLabels],
    }),
    '/display/comparisonLabels',
  )
  facts.comparisons.push(structuredClone(facts.comparisons[0]!))
  assert.equal(validateFrameDisplay(snapshot, resolved.view, display), '/display/comparisonLabels')
  facts.comparisons = []
  assert.equal(validateFrameDisplay(snapshot, resolved.view, display), '/display/comparisonLabels')
})

test('currency display accepts a compound saved unit and preserves its precision and label', async (t) => {
  if (skipBrowserTest(t)) return
  const snapshot = frame({
    values: [{ name: 'efficiency', type: 'decimal', values: ['9007199254740993.125'] }],
  })
  snapshot.data.columns[0]!.unit = 'USD/mile'
  const original = JSON.stringify(snapshot)
  const display = {
    formats: [{ value: 'efficiency', format: 'currency' as const, decimals: 1 }],
  }
  const view = { chart: 'metric' as const }
  const resolved = resolveFrameView(snapshot, view)
  assert.equal(resolved.ok, true)
  if (!resolved.ok) return
  assert.equal(validateFrameDisplay(snapshot, resolved.view, display), undefined)
  const html = await renderer.render(snapshot, { view, display })
  assert.match(html, /9,007,199,254,740,993\.1 USD\/mile/)
  assert.equal(JSON.stringify(snapshot), original)
})

test('bar focus uses the exact saved axis key while preserving data point identity', async (t) => {
  if (skipBrowserTest(t)) return
  const snapshot = frame({
    axes: [timeAxis(3)],
    values: [{ name: 'v', values: [1, 2, 3] }],
  })
  const view = { chart: 'bar' as const }
  const display = { highlight: { axis: 'month', key: [months(3)[1]!] } }
  const resolved = resolveFrameView(snapshot, view)
  assert.equal(resolved.ok, true)
  if (!resolved.ok) return
  assert.equal(validateFrameDisplay(snapshot, resolved.view, display), undefined)
  const html = await renderer.render(snapshot, { view, display, askPoint: true })
  assert.equal((html.match(/data-highlighted="true"/g) ?? []).length, 1)
  assert.match(html, /data-frame-point="1:v"/)
  assert.equal(
    validateFrameDisplay(snapshot, resolved.view, {
      highlight: { axis: 'month', key: ['missing'] },
    }),
    '/display/highlight',
  )
})

test('display references reject invalid formats, aliases and previews', () => {
  assert.equal(
    frameDisplaySchema.safeParse({ formats: [{ value: 'v', format: 'percent', decimals: 7 }] })
      .success,
    false,
  )
  const snapshot = frame({ axes: [categoryAxis(3)], values: [{ name: 'v', values: [1, 2, 3] }] })
  const resolved = resolveFrameView(snapshot, { chart: 'table' })
  assert.equal(resolved.ok, true)
  if (!resolved.ok) return
  assert.equal(
    validateFrameDisplay(snapshot, resolved.view, {
      formats: [{ value: 'unknown', format: 'percent' }],
    }),
    '/display/formats',
  )
  assert.equal(
    validateFrameDisplay(snapshot, resolved.view, {
      formats: [{ value: 'v', format: 'currency' }],
    }),
    undefined,
  )
  assert.equal(
    validateFrameDisplay(snapshot, resolved.view, {
      recordPreview: { coordinates: ['region', 'region'], values: ['v'], limit: 2, label: 'Route' },
    }),
    '/display/recordPreview',
  )
})

test('record previews require distinct saved coordinates and observation values', () => {
  const snapshot = frame({
    axes: [categoryAxis(3), { ...categoryAxis(3), name: 'destination' }],
    values: [{ name: 'trips', values: [1, 2, 3] }],
  })
  const resolved = resolveFrameView(snapshot, { chart: 'table' })
  assert.equal(resolved.ok, true)
  if (!resolved.ok) return
  const recordPreview = {
    coordinates: ['region', 'destination'],
    values: ['trips'],
    limit: 2,
    label: 'Route',
  }
  assert.equal(validateFrameDisplay(snapshot, resolved.view, { recordPreview }), undefined)
  assert.equal(
    validateFrameDisplay(snapshot, resolved.view, {
      recordPreview: { ...recordPreview, values: ['destination'] },
    }),
    '/display/recordPreview',
  )
})

test('header time context preserves fixed instants and counts full calendar keys', () => {
  const t = translator('en-US')
  const fixed = frame({
    values: [
      {
        name: 'v',
        values: [1],
        context: {
          kind: 'observation',
          subject: null,
          window: null,
          time: {
            kind: 'fixed',
            start: '2024-01-01T01:02:03Z',
            end: '2025-01-01T03:04:05Z',
            timezone: 'UTC',
          },
        },
      },
    ],
  })
  assert.match(
    headerContext(t, fixed, ['v']) ?? '',
    /^2024-01-01 01:02:03 GMT(?:\+00:00)? – 2025-01-01 03:04:05 GMT(?:\+00:00)?$/,
  )

  const multi = frame({ axes: [timeAxis(2)], values: [{ name: 'v', values: [1, 2] }] })
  const axis = multi.frame.axes[0]!
  const key = structuredClone(axis.keys[0]!)
  key.slotId = 'second'
  axis.keys.push(key)
  multi.frame.coordinates[key.slotId] = {
    ...multi.frame.coordinates[axis.keys[0]!.slotId]!,
    values: ['a', 'b'],
  }
  multi.frame.coordinates[axis.keys[0]!.slotId]!.values[1] =
    multi.frame.coordinates[axis.keys[0]!.slotId]!.values[0]!
  assert.equal(headerContext(t, multi, ['v']), 'month · 2')
})
