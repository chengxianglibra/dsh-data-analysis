import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { formatCell } from '../../../presentation/contracts/index.ts'
import type { TypedDataset } from '../../../presentation/contracts/types.ts'
import { useCopy } from '../../i18n/context.tsx'
import { displayCell } from '../../presentation/display.ts'
import { DatasetTable } from '../../presentation/table.tsx'
import { FrameIcon } from './frame-icon.tsx'
import { FrameIconButton } from './icons.tsx'
import type { Snapshot } from './model.ts'
import { useFrameSelection } from './selection-context.tsx'
import { MAX_FROZEN } from './styles.ts'

/** Copies the visible columns' exact saved cells as TSV (unchanged legacy behaviour). */
export function CopyData({ data, columns }: { data: TypedDataset; columns: string[] }) {
  const t = useCopy()
  const [status, setStatus] = useState<string>()
  const copyRows = async () => {
    const indices = columns
      .map((id) => data.columns.findIndex((c) => c.id === id))
      .filter((i) => i >= 0)
    const quote = (value: string) =>
      /[\t\r\n"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
    const text = [
      indices.map((i) => data.columns[i]!.label),
      ...data.rows.map((row) => indices.map((i) => formatCell(row[i]!, data.columns[i]!))),
    ]
      .map((row) => row.map(quote).join('\t'))
      .join('\n')
    const ok = await Promise.resolve()
      .then(() => navigator.clipboard.writeText(text))
      .then(() => true)
      .catch(() => false)
    setStatus(ok ? 'marivo.presentation.copied' : 'marivo.presentation.ui-copy-failed')
  }
  return (
    <>
      <FrameIconButton
        kind="copy-data"
        label={t('marivo.presentation.ui-copy-data')}
        tip={t('marivo.presentation.ui-copy-data')}
        onOpen={() => void copyRows()}
      >
        <FrameIcon kind="copy" />
      </FrameIconButton>
      {status && <span role="status">{t(status)}</span>}
    </>
  )
}

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

/** Readable saved cells; copy and tooltips keep the exact saved spelling. */
export function DataTable({
  snapshot,
  columns,
  height,
  frozen = 0,
  selectionFields,
}: {
  snapshot: Snapshot
  columns?: string[]
  height?: number
  frozen?: number
  selectionFields?: readonly string[]
}) {
  const t = useCopy()
  const selection = useFrameSelection()
  const [showExact, setShowExact] = useState(false)
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
      <div className="fv-table-bar fv-comparison-toolbar">
        {scrollable && (
          <span
            id={hintId}
            className="fv-scroll-hint"
            title={t('marivo.presentation.ui-frame-scroll-hint')}
          >
            <span className="fv-sr-only">{t('marivo.presentation.ui-frame-scroll-hint')}</span>
          </span>
        )}
        <button
          type="button"
          aria-pressed={showExact}
          onClick={() => setShowExact((value) => !value)}
        >
          {t('marivo.presentation.ui-frame-exact-values')}
        </button>
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
          selectableColumns={selectionFields ? new Set(selectionFields) : undefined}
          display={
            showExact
              ? undefined
              : (value, column) => displayCell(t.locale, value, column, timezone)
          }
        />
      </div>
    </>
  )
}
