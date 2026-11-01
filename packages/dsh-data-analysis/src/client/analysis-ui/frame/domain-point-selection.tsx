import type { ReactNode } from 'react'
import { interpretationOf, type Snapshot } from './model.ts'
import { useFrameSelection } from './selection-context.tsx'

export interface DomainPoint {
  row: number
  field: string
  label: string
}

/** Reused field names across semantic bindings cannot identify one domain fact. */
export function uniquelyBound(s: Snapshot, field: string): boolean {
  const facts = interpretationOf(s)
  if (!facts) return true
  let count = 0
  for (const comparison of facts.comparisons)
    for (const group of comparison.groups)
      count += group.values.filter((value) => value.name === field).length
  for (const alignment of facts.alignments)
    for (const side of [alignment.left, alignment.right]) if (side.values.includes(field)) count++
  for (const decomposition of facts.decompositions)
    count += decomposition.outputs.filter((output) => output.name === field).length
  return count <= 1
}

/** Keep the graphical mark clickable without changing how it is drawn. */
export function DomainPointMark({ point, children }: { point?: DomainPoint; children: ReactNode }) {
  const selection = useFrameSelection()
  if (!point || !selection) return <>{children}</>
  return (
    // biome-ignore lint/a11y/useSemanticElements: SVG marks cannot contain an HTML button; expose keyboard activation directly.
    <g
      role="button"
      tabIndex={0}
      aria-label={point.label}
      data-frame-point={`${point.row}:${point.field}`}
      style={{ cursor: 'pointer' }}
      onClick={() => selection.select(point.row, point.field)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          selection.select(point.row, point.field)
        }
      }}
    >
      {children}
    </g>
  )
}
