import { useLayoutEffect, useRef, useState } from 'react'
import { formatCell } from '../../../presentation/contracts/index.ts'
import type { TypedDataset } from '../../../presentation/contracts/types.ts'
import { useCopy } from '../../i18n/context.tsx'
import { DatasetTable } from '../../presentation/table.tsx'
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
      <button type="button" onClick={() => void copyRows()}>
        {t('marivo.presentation.ui-copy-data')}
      </button>
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

/** Exact saved cells; `frozen` key columns stay visible while scrolling. */
export function DataTable({
  snapshot,
  columns,
  height,
  frozen = 0,
}: {
  snapshot: { data: TypedDataset }
  columns?: string[]
  height?: number
  frozen?: number
}) {
  const data = snapshot.data
  const known = (columns ?? data.columns.map((c) => c.id)).filter((id) =>
    data.columns.some((c) => c.id === id),
  )
  const visible = known.length ? known : data.columns.map((c) => c.id)
  const ref = useFrozenColumns(frozen)
  return (
    <div
      ref={ref}
      className={frozen ? 'fv-frozen' : undefined}
      data-frozen={frozen ? Math.min(frozen, MAX_FROZEN) : undefined}
      style={{ maxHeight: height ?? 520, overflow: 'auto' }}
    >
      <DatasetTable data={data} columns={visible} caption="" />
    </div>
  )
}
