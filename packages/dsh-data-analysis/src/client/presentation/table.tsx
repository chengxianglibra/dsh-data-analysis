import { useMemo, useState } from 'react'
import { formatCell } from '../../presentation/contracts/index.ts'
import type { Cell, DatasetColumn, TypedDataset } from '../../presentation/contracts/types.ts'
import { useCopy } from './../i18n/context.tsx'
import {
  cellText,
  columnIndex,
  columnLabel,
  datasetScope,
  sortedRowIndices,
  TABLE_PAGE_SIZE,
} from './model.ts'

interface TableSort {
  columnId: string
  direction: 'ascending' | 'descending'
}

/** Exact saved cells with local sorting and pagination; values are never recomputed. */
export function DatasetTable({
  data,
  columns,
  caption,
  display,
}: {
  data: TypedDataset
  columns?: string[]
  caption: string
  /** Optional readable text; a differing exact value stays reachable via `title`. */
  display?: (value: Exclude<Cell, null>, column: DatasetColumn) => string
}) {
  const t = useCopy()

  const [sort, setSort] = useState<TableSort>()
  const [page, setPage] = useState(0)
  const indices = columns?.map((id) => columnIndex(data, id)) ?? data.columns.map((_, i) => i)
  const numericColumns = new Set(
    data.columns
      .filter((column) => ['float64', 'int64', 'decimal'].includes(column.type))
      .map((column) => column.id),
  )
  const sorted = useMemo(() => sortedRowIndices(t.locale, data, sort), [data, sort, t.locale])
  const pages = Math.max(1, Math.ceil(sorted.length / TABLE_PAGE_SIZE))
  const activePage = Math.min(page, pages - 1)
  const shown = sorted.slice(activePage * TABLE_PAGE_SIZE, (activePage + 1) * TABLE_PAGE_SIZE)
  return (
    <div className="pr-table">
      <p className={data.truncated ? 'pr-notice' : 'pr-muted'}>{t(datasetScope(t.locale, data))}</p>
      <div className="pr-table-scroll" tabIndex={data.rows.length ? 0 : undefined}>
        <table aria-label={t(caption)}>
          <thead>
            <tr>
              {indices.map((index) => {
                const column = data.columns[index]!
                return (
                  <th
                    key={column.id}
                    scope="col"
                    data-column-id={column.id}
                    className={numericColumns.has(column.id) ? 'pr-numeric' : undefined}
                    aria-sort={sort?.columnId === column.id ? sort.direction : 'none'}
                  >
                    <button
                      type="button"
                      aria-label={t('marivo.presentation.sort-by-value', { p0: column.label })}
                      onClick={() => {
                        setSort({
                          columnId: column.id,
                          direction:
                            sort?.columnId === column.id && sort.direction === 'ascending'
                              ? 'descending'
                              : 'ascending',
                        })
                        setPage(0)
                      }}
                    >
                      <span className="pr-column-label">{columnLabel(column)}</span>
                      <span className="pr-sort-indicator" aria-hidden="true">
                        {sort?.columnId === column.id
                          ? sort.direction === 'ascending'
                            ? '↑'
                            : '↓'
                          : '↕'}
                      </span>
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((rowIndex) => (
              <tr key={rowIndex} data-row-index={rowIndex}>
                {indices.map((index) => {
                  const value = data.rows[rowIndex]![index]!
                  const column = data.columns[index]!
                  const exact =
                    value === null || value === '' ? undefined : formatCell(value, column)
                  const text =
                    exact === undefined
                      ? t(cellText(t.locale, value, column))
                      : display
                        ? display(value, column)
                        : exact
                  return (
                    <td
                      key={column.id}
                      data-column-id={column.id}
                      data-cell-null={value === null ? 'true' : undefined}
                      className={numericColumns.has(column.id) ? 'pr-numeric' : undefined}
                      title={exact !== undefined && text !== exact ? exact : undefined}
                      aria-label={
                        value === null
                          ? t('marivo.presentation.missing-value')
                          : value === ''
                            ? t('marivo.presentation.empty-string')
                            : undefined
                      }
                    >
                      {text}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="pr-pagination pr-interactive">
          <button type="button" disabled={activePage === 0} onClick={() => setPage(activePage - 1)}>
            {t('marivo.presentation.previous-page')}
          </button>
          <span aria-live="polite">
            {t('marivo.presentation.page-summary', {
              p0: activePage + 1,
              p1: pages,
              p2: TABLE_PAGE_SIZE,
            })}
          </span>
          <button
            type="button"
            disabled={activePage === pages - 1}
            onClick={() => setPage(activePage + 1)}
          >
            {t('marivo.presentation.next-page')}
          </button>
        </div>
      )}
    </div>
  )
}
