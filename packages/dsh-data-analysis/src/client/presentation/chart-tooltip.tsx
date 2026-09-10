import { chartColumns } from '../../presentation/contracts/charts.ts'
import type { DocumentDataset, PresentationLocale } from '../../presentation/contracts/types.ts'
import { useCopy } from './../i18n/context.tsx'
import { type ChartBlock, columnIndex, valueWithUnit } from './model.ts'

export function exactChartDescription(
  locale: PresentationLocale,
  dataset: DocumentDataset,
  block: ChartBlock,
  rowIndex: number,
  visible?: ReadonlySet<string>,
) {
  const row = dataset.data.rows[rowIndex]!
  return chartColumns(block)
    .filter((id) => !block.y.includes(id) || !visible || visible.has(id))
    .map((id) => {
      const index = columnIndex(dataset.data, id)
      return {
        id,
        label: dataset.data.columns[index]!.label,
        value: valueWithUnit(locale, row[index]!, dataset.data.columns[index]!),
      }
    })
}

export function ExactTooltip({
  dataset,
  block,
  rowIndex,
  visible,
}: {
  dataset: DocumentDataset
  block: ChartBlock
  rowIndex: number
  visible?: ReadonlySet<string>
}) {
  const t = useCopy()

  if (!dataset.data.rows[rowIndex]) return null
  const fields = exactChartDescription(t.locale, dataset, block, rowIndex, visible)
  return (
    <div className="pr-tooltip" data-chart-tooltip="true" data-source-row-index={rowIndex}>
      <strong>{fields[0]?.value}</strong>
      <dl>
        {fields.slice(1).map((field) => (
          <div key={field.id}>
            <dt>{t(field.label)}</dt>
            <dd>{field.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
