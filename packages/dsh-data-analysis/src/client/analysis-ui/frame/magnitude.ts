import type { Cell } from '../../../presentation/contracts/types.ts'
import { compareDecimalText } from '../../presentation/model.ts'

/** Compare saved numeric magnitudes without reducing Decimal or int64 to a float. */
export function compareMagnitude(a: Cell, b: Cell): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1
  const unsigned = (value: Cell) => String(value).replace(/^[+-]/, '')
  return -compareDecimalText(unsigned(a), unsigned(b))
}

/** A shared linear scale with room for both signs, including when one side is empty. */
export function divergingScale(values: (number | null)[]) {
  let negative = 0
  let positive = 0
  for (const value of values) {
    if (value === null) continue
    if (value < 0) negative = Math.max(negative, -value)
    else positive = Math.max(positive, value)
  }
  const magnitude = Math.max(negative, positive)
  if (magnitude === 0) return { zero: 50, width: (_value: number) => 0 }
  const n = negative / magnitude
  const p = positive / magnitude
  const fraction = Math.min(0.8, Math.max(0.2, n / (n + p)))
  const span = Math.max(n / fraction, p / (1 - fraction))
  return {
    zero: fraction * 100,
    width: (value: number) => (Math.abs(value / magnitude) / span) * 100,
  }
}
