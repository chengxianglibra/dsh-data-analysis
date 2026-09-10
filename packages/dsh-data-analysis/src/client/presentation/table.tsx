import { useEffect, useMemo, useState } from 'react'
import type { TypedDataset } from '../../presentation/contracts/types.ts'
import { useCopy } from './../i18n/context.tsx'
import type { TableSort } from './export-view.ts'
import {
  cellText,
  columnIndex,
  columnLabel,
  datasetScope,
  type ReaderMode,
  sortedRowIndices,
  TABLE_PAGE_SIZE,
} from './model.ts'

export function DatasetTable({
  data,
  columns,
  mode,
  caption,
  hideCaption = false,
  showScope = true,
  showSelectionCount = true,
  rowIndices,
  filterKey,
  sort: controlledSort,
  onSortChange,
}: {
  data: TypedDataset
  columns?: string[]
  mode: ReaderMode
  caption: string
  hideCaption?: boolean
  showScope?: boolean
  showSelectionCount?: boolean
  rowIndices?: readonly number[]
  filterKey?: string
  sort?: TableSort
  onSortChange?: (sort: TableSort) => void
}) {
  const t = useCopy()

  const [localSort, setLocalSort] = useState<TableSort>()
  const sort = onSortChange ? controlledSort : localSort
  const setSort = onSortChange ?? setLocalSort
  const [page, setPage] = useState(0)
  const indices = columns?.map((id) => columnIndex(data, id)) ?? data.columns.map((_, i) => i)
  const numericColumns = new Set(
    data.columns
      .filter((column) => ['float64', 'int64', 'decimal'].includes(column.type))
      .map((column) => column.id),
  )
  const sorted = useMemo(() => {
    const selected = rowIndices ? new Set(rowIndices) : undefined
    return sort
      ? sortedRowIndices(t.locale, data, sort).filter((index) => !selected || selected.has(index))
      : [...(rowIndices ?? sortedRowIndices(t.locale, data))]
  }, [data, sort, rowIndices, t.locale])
  const rowSelectionKey = `${filterKey ?? ''}/${rowIndices?.join(',') ?? ''}`
  useEffect(() => {
    void rowSelectionKey
    setPage(0)
  }, [rowSelectionKey])
  const pages = Math.max(1, Math.ceil(sorted.length / TABLE_PAGE_SIZE))
  const activePage = Math.min(page, pages - 1)
  const shown =
    mode === 'static'
      ? (rowIndices ?? data.rows.map((_, i) => i))
      : sorted.slice(activePage * TABLE_PAGE_SIZE, (activePage + 1) * TABLE_PAGE_SIZE)
  return (
    <div className="pr-table">
      {showScope && (
        <p className={data.truncated ? 'pr-notice' : 'pr-muted'}>
          {t(datasetScope(t.locale, data))}
        </p>
      )}
      {showSelectionCount && rowIndices && rowIndices.length !== data.rows.length && (
        <p className="pr-muted">
          {t('marivo.presentation.filtered-rows', { p0: data.rows.length, p1: rowIndices.length })}
        </p>
      )}
      <div className="pr-table-scroll" tabIndex={data.rows.length ? 0 : undefined}>
        <table aria-label={t(hideCaption ? caption : undefined)}>
          {!hideCaption && <caption>{t(caption)}</caption>}
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
                    aria-sort={
                      mode === 'interactive' && sort?.columnId === column.id
                        ? sort.direction
                        : 'none'
                    }
                  >
                    {mode === 'static' ? (
                      columnLabel(column)
                    ) : (
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
                    )}
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
                  return (
                    <td
                      key={column.id}
                      data-column-id={column.id}
                      data-cell-null={value === null ? 'true' : undefined}
                      className={numericColumns.has(column.id) ? 'pr-numeric' : undefined}
                      aria-label={
                        value === null
                          ? t('marivo.presentation.missing-value')
                          : value === ''
                            ? t('marivo.presentation.empty-string')
                            : undefined
                      }
                    >
                      {t(cellText(t.locale, value, column))}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {mode === 'interactive' && pages > 1 && (
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
