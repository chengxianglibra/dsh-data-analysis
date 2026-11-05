import type { FrameClassification } from '../../../presentation/contracts/frame-view.ts'
import type { Cell } from '../../../presentation/contracts/types.ts'
import { useCopy } from '../../i18n/context.tsx'
import { cellText, columnLabel } from '../../presentation/model.ts'
import { Button } from '../../ui/primitives/button.tsx'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../ui/primitives/table.tsx'
import { useSelectableFramePoint } from './domain-point-selection.tsx'
import { cellOf, columnOf, displayFrameCell, type Snapshot } from './model.ts'
import { useFrameSelection } from './selection-context.tsx'

export interface RecordsPreviewSpec {
  coordinates: string[]
  values: string[]
  limit: number
  label: string
}

/** The first saved rows with explicitly chosen coordinates joined for reading. */
export function RecordsPreview({
  snapshot: s,
  classification,
  preview,
  height,
}: {
  snapshot: Snapshot
  classification: FrameClassification
  preview: RecordsPreviewSpec
  height?: number
}) {
  const t = useCopy()
  const selection = useFrameSelection()
  const selectablePoint = useSelectableFramePoint(s)
  const coordinates = preview.coordinates.map((name) => columnOf(s, name)?.column)
  const values = preview.values.map((name) => columnOf(s, name)?.column)
  // The report contract validates these references; this also keeps a streamed
  // candidate with an incomplete resource from displaying invented columns.
  if (
    classification.class !== 'observation' ||
    coordinates.some((column) => !column) ||
    values.some((column) => !column)
  )
    return null
  const visibleRows = s.data.rows.slice(0, preview.limit)
  const occurrences = new Map<string, number>()
  const rows = visibleRows.map((row, rowIndex) => {
    const identity = JSON.stringify(row)
    const occurrence = occurrences.get(identity) ?? 0
    occurrences.set(identity, occurrence + 1)
    return { rowIndex, key: `${identity}:${occurrence}` }
  })
  const timestampAxis = s.frame.axes.find((axis) => axis.variant && 'timezone' in axis.variant)
  const timezone =
    timestampAxis?.variant && 'timezone' in timestampAxis.variant
      ? timestampAxis.variant.timezone
      : 'UTC'
  const display = (row: number, name: string): string => {
    const column = columnOf(s, name)!.column
    const value: Cell = cellOf(s, row, name)
    return value === ''
      ? t(cellText(t.locale, value, column))
      : displayFrameCell(s, t.locale, value, column, timezone)
  }
  return (
    <div className="fv-records-preview">
      {(!s.coverage.complete || s.data.truncated) && (
        <p role="status">{t('marivo.presentation.ui-frame-data-truncated')}</p>
      )}
      {s.data.rows.length === 0 ? (
        <p role="status">{t('marivo.presentation.no-data')}</p>
      ) : (
        <div className="fv-records-scroll" style={{ maxHeight: height, overflow: 'auto' }}>
          <Table aria-label={preview.label}>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{preview.label}</TableHead>
                {values.map((column) => (
                  <TableHead key={column!.id} scope="col" className="pr-numeric">
                    {columnLabel(column!)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ key, rowIndex }) => (
                <TableRow key={key} data-row-index={rowIndex}>
                  <TableCell>
                    {preview.coordinates.map((name) => display(rowIndex, name)).join(' → ')}
                  </TableCell>
                  {preview.values.map((name) => {
                    const value = cellOf(s, rowIndex, name)
                    const column = columnOf(s, name)!.column
                    const text = display(rowIndex, name)
                    return (
                      <TableCell
                        key={name}
                        data-column-id={name}
                        data-cell-null={value === null ? 'true' : undefined}
                        className="pr-numeric"
                        aria-label={
                          value === null ? t('marivo.presentation.missing-value') : undefined
                        }
                      >
                        {selection && value !== null && selectablePoint(rowIndex, name) ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            type="button"
                            className="pr-cell-select"
                            data-frame-point={`${rowIndex}:${name}`}
                            aria-label={`${t('marivo.presentation.ui-frame-select-point')}: ${column.label}, ${text}`}
                            onClick={() => selection.select(rowIndex, name)}
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
      )}
      {visibleRows.length < s.data.rows.length && (
        <p className="fv-records-more">
          {t('marivo.presentation.ui-frame-records-preview', {
            shown: visibleRows.length.toLocaleString(t.locale),
            total: s.data.rows.length.toLocaleString(t.locale),
          })}
        </p>
      )}
    </div>
  )
}
