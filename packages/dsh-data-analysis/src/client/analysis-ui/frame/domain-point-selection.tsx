import { type ReactNode, useState } from 'react'
import { useCopy } from '../../i18n/context.tsx'
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
    // biome-ignore lint/a11y/useSemanticElements: SVG marks cannot contain an HTML button; equivalent native buttons follow the chart.
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

/** SVG images are atomic to some assistive technologies; provide equivalent native buttons. */
export function DomainPointList({ points }: { points: DomainPoint[] }) {
  const selection = useFrameSelection()
  const t = useCopy()
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(0)
  if (!selection || points.length === 0) return null
  const pages = Math.ceil(points.length / 50)
  const current = Math.min(page, pages - 1)
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{t('marivo.presentation.ui-frame-select-point')}</summary>
      {open && (
        <div
          style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 240, overflow: 'auto' }}
        >
          {points.slice(current * 50, (current + 1) * 50).map((point) => (
            <button
              key={`${point.row}:${point.field}`}
              type="button"
              onClick={() => selection.select(point.row, point.field)}
            >
              {point.label}
            </button>
          ))}
          {pages > 1 && (
            <div>
              <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)}>
                {t('marivo.presentation.previous-page')}
              </button>
              <span>
                {current + 1} / {pages}
              </span>
              <button
                type="button"
                disabled={current === pages - 1}
                onClick={() => setPage(current + 1)}
              >
                {t('marivo.presentation.next-page')}
              </button>
            </div>
          )}
        </div>
      )}
    </details>
  )
}
