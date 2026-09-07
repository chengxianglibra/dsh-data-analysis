import { useMemo, useState } from 'react'
import type { TypedDataset } from '../../presentation/contracts/types.ts'
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
  showScope = true,
  rowIndices,
}: {
  data: TypedDataset
  columns?: string[]
  mode: ReaderMode
  caption: string
  showScope?: boolean
  rowIndices?: readonly number[]
}) {
  const [sort, setSort] = useState<{
    columnId: string
    direction: 'ascending' | 'descending'
  }>()
  const [page, setPage] = useState(0)
  const indices = columns?.map((id) => columnIndex(data, id)) ?? data.columns.map((_, i) => i)
  const numericColumns = new Set(
    data.columns
      .filter((column) => ['float64', 'int64', 'decimal'].includes(column.type))
      .map((column) => column.id),
  )
  const sorted = useMemo(() => {
    const selected = rowIndices ? new Set(rowIndices) : undefined
    return sortedRowIndices(data, sort).filter((index) => !selected || selected.has(index))
  }, [data, sort, rowIndices])
  const pages = Math.max(1, Math.ceil(sorted.length / TABLE_PAGE_SIZE))
  const activePage = Math.min(page, pages - 1)
  const shown =
    mode === 'static'
      ? (rowIndices ?? data.rows.map((_, i) => i))
      : sorted.slice(activePage * TABLE_PAGE_SIZE, (activePage + 1) * TABLE_PAGE_SIZE)
  return (
    <div className="pr-table">
      {showScope && (
        <p className={data.truncated ? 'pr-notice' : 'pr-muted'}>{datasetScope(data)}</p>
      )}
      {rowIndices && rowIndices.length !== data.rows.length && (
        <p className="pr-muted">
          当前过滤：{rowIndices.length} / {data.rows.length} 条快照观测
        </p>
      )}
      <div className="pr-table-scroll" tabIndex={data.rows.length ? 0 : undefined}>
        <table>
          <caption>{caption}</caption>
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
                        aria-label={`按 ${column.label} 排序`}
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
                      aria-label={value === null ? '缺失值' : value === '' ? '空字符串' : undefined}
                    >
                      {cellText(value, column)}
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
            上一页
          </button>
          <span aria-live="polite">
            第 {activePage + 1} / {pages} 页 · 每页 {TABLE_PAGE_SIZE} 行
          </span>
          <button
            type="button"
            disabled={activePage === pages - 1}
            onClick={() => setPage(activePage + 1)}
          >
            下一页
          </button>
        </div>
      )}
    </div>
  )
}
