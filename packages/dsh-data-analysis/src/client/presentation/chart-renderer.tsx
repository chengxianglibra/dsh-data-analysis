import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { DocumentDataset, PresentationDocument } from '../../presentation/contracts/types.ts'
import { CopyContext } from './copy-context.tsx'
import {
  type ChartBlock,
  chartRows,
  chartTitle,
  columnIndex,
  columnLabel,
  datasetScope,
  followUpContext,
  formatAxisTick,
  formatCategoryTick,
  type ReaderMode,
  valueWithUnit,
} from './model.ts'
import { DatasetTable } from './table.tsx'

const COLORS = ['#078579', '#526bc6', '#b36722', '#9f56a7', '#b4485d', '#4d812d']

function ExactTooltip({
  dataset,
  block,
  rowIndex,
  visible,
}: {
  dataset: DocumentDataset
  block: ChartBlock
  rowIndex: number
  visible: Set<string>
}) {
  const row = dataset.data.rows[rowIndex]
  if (!row) return null
  const xIndex = columnIndex(dataset.data, block.x)
  return (
    <div className="pr-tooltip" data-chart-tooltip="true">
      <strong>{valueWithUnit(row[xIndex]!, dataset.data.columns[xIndex]!)}</strong>
      <dl>
        {block.y
          .filter((id) => visible.has(id))
          .map((id) => {
            const index = columnIndex(dataset.data, id)
            const column = dataset.data.columns[index]!
            return (
              <div key={id}>
                <dt>{column.label}</dt>
                <dd>{valueWithUnit(row[index]!, column)}</dd>
              </div>
            )
          })}
      </dl>
    </div>
  )
}

export function ChartRenderer({
  document,
  dataset,
  block,
  mode,
}: {
  document: PresentationDocument
  dataset: DocumentDataset
  block: ChartBlock
  mode: ReaderMode
}) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const [selectedRow, setSelectedRow] = useState(0)
  const rows = useMemo(() => chartRows(dataset.data, block), [dataset.data, block])
  const series = block.y.map((id, index) => ({
    id,
    key: `series${index}`,
    color: COLORS[index % COLORS.length]!,
    column: dataset.data.columns[columnIndex(dataset.data, id)]!,
  }))
  const visible = new Set(block.y.filter((id) => !hidden.has(id)))
  // One axis per explicitly declared unit. No unit inference, rescaling or aggregation.
  const groups = new Map<string | undefined, typeof series>()
  for (const entry of series) {
    const entries = groups.get(entry.column.unit) ?? []
    entries.push(entry)
    groups.set(entry.column.unit, entries)
  }
  const title = chartTitle(dataset.data, block)
  const xColumn = dataset.data.columns[columnIndex(dataset.data, block.x)]!
  const exactColumns = [...new Set([block.x, ...block.y])]
  if (mode === 'static')
    return (
      <>
        <h2>{title}</h2>
        {block.numericMode === 'approximate' && (
          <p className="pr-notice">图形为近似编码；以下保留原始精确值。</p>
        )}
        <DatasetTable
          data={dataset.data}
          columns={exactColumns}
          mode={mode}
          caption={`${title} · 精确数据`}
        />
      </>
    )
  return (
    <>
      <h2>{title}</h2>
      <p className={dataset.data.truncated ? 'pr-notice' : 'pr-muted'}>
        {datasetScope(dataset.data)}
      </p>
      {block.numericMode === 'approximate' && (
        <p className="pr-notice">
          近似绘图：图形坐标使用近似数值，tooltip 与精确数据表保留原始值。
        </p>
      )}
      <section className="pr-legend pr-interactive" aria-label="图表系列">
        {series.map((entry) => (
          <button
            key={entry.id}
            type="button"
            aria-label={`显示系列 ${entry.column.label}`}
            aria-pressed={!hidden.has(entry.id)}
            onClick={() => {
              const next = new Set(hidden)
              if (next.has(entry.id)) next.delete(entry.id)
              else next.add(entry.id)
              setHidden(next)
            }}
          >
            <span className="pr-swatch" style={{ background: entry.color }} aria-hidden="true" />
            {columnLabel(entry.column)}
          </button>
        ))}
      </section>
      {!rows.length ? (
        <p className="pr-empty">暂无可绘制数据。</p>
      ) : !visible.size ? (
        <p className="pr-empty">所有系列已隐藏，请选择要显示的系列。</p>
      ) : (
        [...groups].map(([unit, entries]) => {
          const shown = entries.filter((entry) => visible.has(entry.id))
          if (!shown.length) return null
          const numeric = rows.some((row) => shown.some((entry) => row[entry.key] !== null))
          const shared = {
            data: rows,
            accessibilityLayer: true,
            margin: { top: 16, right: 24, bottom: 28, left: 12 },
          }
          const axes = (
            <>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--pr-border)" vertical={false} />
              <XAxis
                dataKey="rowIndex"
                type="category"
                tickFormatter={(value: number) => formatCategoryTick(rows[value]?.xLabel ?? '')}
                tick={{ fill: 'var(--pr-muted)', fontSize: 12 }}
                tickLine={false}
                label={{
                  value: formatCategoryTick(columnLabel(xColumn)),
                  position: 'insideBottom',
                  offset: -18,
                  fill: 'var(--pr-muted)',
                }}
                minTickGap={24}
              />
              <YAxis
                tickFormatter={formatAxisTick}
                tick={{ fill: 'var(--pr-muted)', fontSize: 12 }}
                tickLine={false}
                width={84}
              />
              <Tooltip
                // A narrow plot can be smaller than the exact value tooltip. Anchor
                // to the chart frame so Recharts does not push text outside it.
                position={{ x: 0 }}
                wrapperStyle={{ maxWidth: '100%' }}
                filterNull={false}
                isAnimationActive={false}
                content={({ active, payload }) => {
                  const rowIndex: unknown = payload?.[0]?.payload?.rowIndex
                  return active && typeof rowIndex === 'number' ? (
                    <ExactTooltip
                      dataset={dataset}
                      block={block}
                      rowIndex={rowIndex}
                      visible={new Set(shown.map((entry) => entry.id))}
                    />
                  ) : null
                }}
              />
            </>
          )
          return (
            <div className="pr-chart-group" key={unit === undefined ? 'no-unit' : `unit:${unit}`}>
              <p className="pr-axis-unit">
                纵轴：{unit ?? '未声明单位'}
                {groups.size > 1 ? ' · 不同单位分图展示' : ''}
              </p>
              {!numeric ? (
                <p className="pr-empty">所选系列均为 null，没有可绘制数值。</p>
              ) : (
                <figure className="pr-chart" aria-label={`${title}，${unit ?? '未声明单位'}`}>
                  <ResponsiveContainer width="100%" height={310} minWidth={0}>
                    {block.chart === 'line' ? (
                      <LineChart {...shared}>
                        {axes}
                        {shown.map((entry) => (
                          <Line
                            key={entry.id}
                            name={columnLabel(entry.column)}
                            dataKey={entry.key}
                            type="linear"
                            stroke={entry.color}
                            strokeWidth={2}
                            dot={rows.length < 80}
                            connectNulls={false}
                            isAnimationActive={false}
                          />
                        ))}
                      </LineChart>
                    ) : (
                      <BarChart {...shared}>
                        {axes}
                        {shown.map((entry) => (
                          <Bar
                            key={entry.id}
                            name={columnLabel(entry.column)}
                            dataKey={entry.key}
                            fill={entry.color}
                            isAnimationActive={false}
                          />
                        ))}
                      </BarChart>
                    )}
                  </ResponsiveContainer>
                </figure>
              )}
            </div>
          )
        })
      )}
      {rows.length > 0 && (
        <div className="pr-coordinate pr-interactive">
          <label>
            选择数据坐标
            <select
              aria-label="选择图表数据行"
              value={selectedRow}
              onChange={(event) => setSelectedRow(Number(event.target.value))}
            >
              {rows.map((row) => (
                <option key={row.rowIndex} value={row.rowIndex}>
                  {row.rowIndex + 1}. {row.xLabel}
                </option>
              ))}
            </select>
          </label>
          <ExactTooltip dataset={dataset} block={block} rowIndex={selectedRow} visible={visible} />
          <CopyContext key={selectedRow} text={followUpContext(document, block, selectedRow)} />
        </div>
      )}
      <details className="pr-exact-data">
        <summary>查看精确数据</summary>
        <DatasetTable
          data={dataset.data}
          columns={exactColumns}
          mode={mode}
          caption={`${title} · 精确数据`}
        />
      </details>
    </>
  )
}
