import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { formatCell } from '../../presentation/contracts/index.ts'
import type { Cell, DatasetColumn, TypedDataset } from '../../presentation/contracts/types.ts'
import { useReadingComponent, useReportReading } from '../analysis-ui/reading-state.tsx'
import { useCopy } from './../i18n/context.tsx'
import { Button } from '../ui/controls.tsx'
import { Alert, AlertDescription } from '../ui/primitives/alert.tsx'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/primitives/table.tsx'
import { cellText, columnIndex, datasetScope, sortedRowIndices, TABLE_PAGE_SIZE } from './model.ts'

const COLUMN_TYPE_LABELS: Record<DatasetColumn['type'], string> = {
  string: 'str',
  boolean: 'bool',
  int64: 'i64',
  float64: 'f64',
  decimal: 'decimal',
  date: 'date',
  datetime: 'datetime',
}

/** Saved type, unit and optional Frame aggregation fact for a table header. */
export function ColumnHeading({
  column,
  aggregation,
}: {
  column: DatasetColumn
  aggregation?: string
}) {
  const unit = column.unit?.trim()
  const label = column.label.trimEnd()
  const unitInLabel = unit && (label.endsWith(`(${unit})`) || label.endsWith(`（${unit}）`))
  const metadata = [
    COLUMN_TYPE_LABELS[column.type],
    aggregation,
    unit && unit !== '1' && !unitInLabel ? unit : '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <>
      <span className="pr-column-label">{column.label}</span>
      <span className="pr-column-meta">{metadata}</span>
    </>
  )
}

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
  scrollDescription,
  selectCell,
  selectableColumns,
  selectableCell,
  hideCompleteScope = false,
  hideRowCount = false,
  hideExactTitle = false,
  visibleRowIndices,
  filterSelectionKey,
  aggregationForColumn,
}: {
  data: TypedDataset
  columns?: string[]
  caption: string
  /** Optional readable text; a differing exact value stays reachable via `title`. */
  display?: (value: Exclude<Cell, null>, column: DatasetColumn) => string
  /** Optional description of horizontal scrolling in the containing Frame. */
  scrollDescription?: string
  /** Select a saved row/field without depending on sorting or pagination order. */
  selectCell?: (row: number, field: string) => void
  selectableColumns?: ReadonlySet<string>
  selectableCell?: (row: number, field: string) => boolean
  /** The parent already displays the complete row count. Empty/truncated states remain visible. */
  hideCompleteScope?: boolean
  /** Keep empty and truncated states without displaying row counts. */
  hideRowCount?: boolean
  /** Frame views use the same readable representation throughout. */
  hideExactTitle?: boolean
  /** Original saved row indices to display; undefined keeps the entire snapshot. */
  visibleRowIndices?: readonly number[]
  filterSelectionKey?: string
  aggregationForColumn?: (column: DatasetColumn) => string
}) {
  const t = useCopy()

  const reading = useReportReading()
  const component = useReadingComponent()
  const key = `${component}:${caption}`
  const filterKey = filterSelectionKey ?? visibleRowIndices?.join(',')
  const stored = reading?.tables.get(key)
  const [sort, updateSort] = useState<TableSort | undefined>(() => reading?.tables.get(key)?.sort)
  const [page, updatePage] = useState(() =>
    stored && stored.filterSelectionKey !== filterKey ? 0 : (stored?.page ?? 0),
  )
  const previousFilter = useRef(stored ? stored.filterSelectionKey : filterKey)
  const filterChanged = previousFilter.current !== filterKey
  useLayoutEffect(() => {
    if (previousFilter.current === filterKey) return
    previousFilter.current = filterKey
    updatePage(0)
    reading?.tables.set(key, { page: 0, sort, filterSelectionKey: filterKey })
  }, [filterKey, key, reading, sort])
  const setSort = (value: TableSort) => {
    updateSort(value)
    reading?.tables.set(key, { page: 0, sort: value, filterSelectionKey: filterKey })
  }
  const setPage = (value: number) => {
    updatePage(value)
    reading?.tables.set(key, {
      page: value,
      sort: reading.tables.get(key)?.sort ?? sort,
      filterSelectionKey: filterKey,
    })
  }
  const scroll = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (scroll.current) scroll.current.scrollLeft = reading?.scroll.get(key) ?? 0
  }, [reading, key])
  const indices = columns?.map((id) => columnIndex(data, id)) ?? data.columns.map((_, i) => i)
  const numericColumns = new Set(
    data.columns
      .filter((column) => ['float64', 'int64', 'decimal'].includes(column.type))
      .map((column) => column.id),
  )
  const activeSort = data.columns.some((column) => column.id === sort?.columnId) ? sort : undefined
  const sorted = useMemo(() => {
    const rows = sortedRowIndices(t.locale, data, activeSort)
    if (!visibleRowIndices) return rows
    const visible = new Set(visibleRowIndices)
    return rows.filter((row) => visible.has(row))
  }, [data, activeSort, t.locale, visibleRowIndices])
  const pages = Math.max(1, Math.ceil(sorted.length / TABLE_PAGE_SIZE))
  const activePage = filterChanged ? 0 : Math.min(page, pages - 1)
  const shown = sorted.slice(activePage * TABLE_PAGE_SIZE, (activePage + 1) * TABLE_PAGE_SIZE)
  return (
    <div className="pr-table">
      {((!hideCompleteScope && !hideRowCount) || data.truncated || data.rowCount === 0) && (
        <Alert role="status">
          <AlertDescription>
            {hideRowCount && data.truncated
              ? t('marivo.presentation.ui-frame-data-truncated')
              : t(datasetScope(t.locale, data))}
          </AlertDescription>
        </Alert>
      )}
      <div
        className="pr-table-scroll"
        ref={scroll}
        onScroll={(event) => reading?.scroll.set(key, event.currentTarget.scrollLeft)}
        tabIndex={data.rows.length ? 0 : undefined}
        aria-describedby={scrollDescription}
      >
        <Table aria-label={t(caption)}>
          <TableHeader>
            <TableRow>
              {indices.map((index) => {
                const column = data.columns[index]!
                return (
                  <TableHead
                    key={column.id}
                    scope="col"
                    data-column-id={column.id}
                    className={numericColumns.has(column.id) ? 'pr-numeric' : undefined}
                    aria-sort={sort?.columnId === column.id ? sort.direction : 'none'}
                  >
                    <Button
                      variant="ghost"
                      size="sm"
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
                      <ColumnHeading column={column} aggregation={aggregationForColumn?.(column)} />
                      <span className="pr-sort-indicator" aria-hidden="true">
                        {sort?.columnId === column.id
                          ? sort.direction === 'ascending'
                            ? '↑'
                            : '↓'
                          : '↕'}
                      </span>
                    </Button>
                  </TableHead>
                )
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((rowIndex) => (
              <TableRow key={rowIndex} data-row-index={rowIndex}>
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
                    <TableCell
                      key={column.id}
                      data-column-id={column.id}
                      data-cell-null={value === null ? 'true' : undefined}
                      className={numericColumns.has(column.id) ? 'pr-numeric' : undefined}
                      title={
                        !hideExactTitle && exact !== undefined && text !== exact ? exact : undefined
                      }
                      aria-label={
                        value === null
                          ? t('marivo.presentation.missing-value')
                          : value === ''
                            ? t('marivo.presentation.empty-string')
                            : undefined
                      }
                    >
                      {selectCell &&
                      value !== null &&
                      selectableColumns?.has(column.id) &&
                      (!selectableCell || selectableCell(rowIndex, column.id)) ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          type="button"
                          className="pr-cell-select"
                          aria-label={`${t('marivo.presentation.ui-frame-select-point')}: ${column.label}, ${text}`}
                          onClick={() => selectCell(rowIndex, column.id)}
                        >
                          {text}
                        </Button>
                      ) : (
                        text
                      )}
                    </TableCell>
                  )
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {pages > 1 && (
        <div className="pr-pagination pr-interactive">
          <Button
            variant="outline"
            size="sm"
            type="button"
            aria-label={t('marivo.presentation.previous-page')}
            disabled={activePage === 0}
            onClick={() => setPage(activePage - 1)}
          >
            <ChevronLeftIcon aria-hidden="true" />
          </Button>
          <span aria-live="polite">
            {hideRowCount
              ? t('marivo.presentation.page-only-summary', { p0: activePage + 1, p1: pages })
              : `${(activePage * TABLE_PAGE_SIZE + 1).toLocaleString(t.locale)}–${Math.min((activePage + 1) * TABLE_PAGE_SIZE, sorted.length).toLocaleString(t.locale)} / ${sorted.length.toLocaleString(t.locale)}`}
          </span>
          <Button
            variant="outline"
            size="sm"
            type="button"
            aria-label={t('marivo.presentation.next-page')}
            disabled={activePage === pages - 1}
            onClick={() => setPage(activePage + 1)}
          >
            <ChevronRightIcon aria-hidden="true" />
          </Button>
        </div>
      )}
    </div>
  )
}
