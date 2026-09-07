import { useId, useState } from 'react'
import type { Cell, DocumentDataset } from '../../presentation/contracts/types.ts'
import { chartFilterValues } from './chart-view.ts'
import { cellText } from './model.ts'

export type DatasetFilters = Record<string, Cell[]>
export function DatasetFilterControls({
  dataset,
  filters,
  onChange,
}: {
  dataset: DocumentDataset
  filters: DatasetFilters
  onChange: (filters: DatasetFilters) => void
}) {
  const id = useId()
  const [columnId, setColumnId] = useState(dataset.data.columns[0]?.id ?? '')
  const column =
    dataset.data.columns.find((entry) => entry.id === columnId) ?? dataset.data.columns[0]
  if (!column) return null
  const values = chartFilterValues(dataset.data, column.id)
  const selected = Object.hasOwn(filters, column.id) ? filters[column.id]! : values
  return (
    <details className="pr-dataset-filters pr-interactive">
      <summary>联动筛选 · {dataset.id}</summary>
      <p className="pr-muted">仅筛选当前快照，同一数据集的图表与表格同步；不保存、不重算。</p>
      <label htmlFor={`${id}-column`}>筛选字段</label>
      <select
        id={`${id}-column`}
        value={column.id}
        onChange={(event) => setColumnId(event.target.value)}
      >
        {dataset.data.columns.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.label}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-values`}>保留值（可多选）</label>
      <select
        id={`${id}-values`}
        multiple
        size={Math.min(6, Math.max(2, values.length))}
        value={values.flatMap((value, index) =>
          selected.some((item) => JSON.stringify(item) === JSON.stringify(value))
            ? [String(index)]
            : [],
        )}
        onChange={(event) => {
          const indices = new Set(
            [...event.target.selectedOptions].map((option) => Number(option.value)),
          )
          onChange({ ...filters, [column.id]: values.filter((_, index) => indices.has(index)) })
        }}
      >
        {values.map((value, index) => (
          <option key={JSON.stringify(value)} value={String(index)}>
            {value === null ? '缺失值 (null)' : value === '' ? '空字符串' : cellText(value, column)}
          </option>
        ))}
      </select>
      {Object.entries(filters).map(([field, selected]) => (
        <p key={field}>
          {dataset.data.columns.find((entry) => entry.id === field)?.label}：保留 {selected.length}{' '}
          个值
        </p>
      ))}
      <button type="button" onClick={() => onChange({})}>
        清除联动筛选
      </button>
    </details>
  )
}
