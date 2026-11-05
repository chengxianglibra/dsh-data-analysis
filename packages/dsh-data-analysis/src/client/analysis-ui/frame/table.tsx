import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useCopy } from '../../i18n/context.tsx'
import { DatasetTable } from '../../presentation/table.tsx'
import { useSelectableFramePoint } from './domain-point-selection.tsx'
import { displayFrameCell, type Snapshot } from './model.ts'
import { useFrameSelection } from './selection-context.tsx'
import { MAX_FROZEN } from './styles.ts'

/**
 * Keeps the leading `count` columns visible while scrolling. Offsets are CSS variables
 * measured from the header, so sorting and paging inside DatasetTable keep them.
 */
export function useFrozenColumns(count: number) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const root = ref.current
    const header = root?.querySelector('thead tr')
    if (!root || !header || count < 1) return
    const cells = [...header.children].slice(0, Math.min(count, MAX_FROZEN)) as HTMLElement[]
    const update = () => {
      let left = 0
      cells.forEach((cell, i) => {
        root.style.setProperty(`--fv-k${i}`, `${left}px`)
        left += cell.offsetWidth
      })
    }
    update()
    const observer = new ResizeObserver(update)
    for (const cell of cells) observer.observe(cell)
    return () => observer.disconnect()
  }, [count])
  return ref
}

/** First time-axis timezone in Frame order; Frames without one use UTC. */
function timezoneOf(snapshot: Snapshot): string {
  for (const axis of snapshot.frame.axes) {
    const variant = axis.variant
    if (variant?.kind === 'calendar' || variant?.kind === 'interval') return variant.timezone
  }
  return 'UTC'
}

/** Readable saved cells; copying retains the saved spelling. */
export function DataTable({
  snapshot,
  columns,
  height,
  frozen = 0,
  selectionFields,
  reference = false,
}: {
  snapshot: Snapshot
  columns?: string[]
  height?: number
  frozen?: number
  selectionFields?: readonly string[]
  reference?: boolean
}) {
  const t = useCopy()
  const selection = useFrameSelection()
  const selectablePoint = useSelectableFramePoint(snapshot)
  const [scrollable, setScrollable] = useState(false)
  const hintId = useId()
  const data = snapshot.data
  const timezone = timezoneOf(snapshot)
  const known = (columns ?? data.columns.map((c) => c.id)).filter((id) =>
    data.columns.some((c) => c.id === id),
  )
  const visible = known.length ? known : data.columns.map((c) => c.id)
  const ref = useFrozenColumns(frozen)
  useEffect(() => {
    const region = ref.current?.querySelector<HTMLElement>('.pr-table-scroll')
    if (!region) return
    const update = () => setScrollable(region.scrollWidth > region.clientWidth + 1)
    const observer = new ResizeObserver(update)
    observer.observe(region)
    const table = region.querySelector('table')
    if (table) observer.observe(table)
    update()
    return () => observer.disconnect()
  }, [ref])
  return (
    <>
      <div className={reference ? 'fv-sr-only' : 'fv-table-bar fv-comparison-toolbar'}>
        {scrollable && (
          <span
            id={hintId}
            className={reference ? undefined : 'fv-scroll-hint'}
            title={t('marivo.presentation.ui-frame-scroll-hint')}
          >
            <span className="fv-sr-only">{t('marivo.presentation.ui-frame-scroll-hint')}</span>
          </span>
        )}
      </div>
      <div
        ref={ref}
        className={frozen ? 'fv-frozen' : undefined}
        data-frozen={frozen ? Math.min(frozen, MAX_FROZEN) : undefined}
        style={{ maxHeight: height ?? 520, overflow: 'auto' }}
      >
        <DatasetTable
          data={data}
          columns={visible}
          caption=""
          scrollDescription={scrollable ? hintId : undefined}
          selectCell={selection?.select}
          selectableColumns={
            new Set(
              selectionFields ??
                snapshot.frame.fields
                  .filter((field) => field.role === 'value')
                  .map((field) => field.id),
            )
          }
          selectableCell={selectablePoint}
          hideRowCount
          hideExactTitle
          display={(value, column) => displayFrameCell(snapshot, t.locale, value, column, timezone)}
        />
      </div>
    </>
  )
}
