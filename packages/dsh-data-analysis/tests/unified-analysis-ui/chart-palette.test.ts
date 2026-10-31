import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  FRAME_CHART_DARK,
  FRAME_CHART_LIGHT,
  paletteForSeries,
} from '../../src/client/analysis-ui/frame/chart-palette.ts'

/** OpenUI 0.18.1 samples around the midpoint; two entries use a special clamp. */
function sample(colors: string[], count: number): string[] {
  const n = colors.length
  const middle = Math.floor(n / 2)
  if (count === 1) return [colors[middle]!]
  if (count === 2) return [colors[Math.max(middle - 1, 0)]!, colors[Math.min(middle + 1, n - 1)]!]
  const offset = Math.floor((count - 1) / 2)
  return Array.from({ length: count }, (_, i) => colors[(((middle + i - offset) % n) + n) % n]!)
}

test('OpenUI series colors retain the analysis-ui order for light and dark charts', () => {
  for (const palette of [FRAME_CHART_LIGHT, FRAME_CHART_DARK]) {
    assert.equal(new Set(palette).size, 8)
    for (let count = 1; count <= 8; count++) {
      const ordered = Array.from({ length: count }, (_, i) => palette[i % palette.length]!)
      assert.deepEqual(sample(paletteForSeries(ordered), count), ordered)
    }
  }
  assert.deepEqual(paletteForSeries([]), [])
})
