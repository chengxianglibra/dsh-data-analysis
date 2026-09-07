import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { DocumentDataset } from '../../presentation/contracts/types.ts'
import {
  type ChartBlock,
  chartRows,
  chartTitle,
  columnIndex,
  columnLabel,
  datasetScope,
  formatAxisTick,
  formatCategoryTick,
  type ReaderMode,
  valueWithUnit,
} from './model.ts'
import { DatasetTable } from './table.tsx'

const COLORS = Array.from({ length: 6 }, (_, index) => `var(--pr-chart-${index + 1})`)

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
  dataset,
  block,
  mode,
}: {
  dataset: DocumentDataset
  block: ChartBlock
  mode: ReaderMode
}) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
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
      {dataset.data.truncated && <p className="pr-notice">{datasetScope(dataset.data)}</p>}
      {block.numericMode === 'approximate' && <p className="pr-notice">近似绘图</p>}
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
            margin: { top: 8, right: 0, bottom: 8, left: 8 },
          }
          const axisTitle =
            shown.length === 1
              ? columnLabel(shown[0]!.column)
              : (unit ?? shown.map((entry) => entry.column.label).join('、'))
          const axes = (
            <>
              <CartesianGrid stroke="var(--pr-chart-grid)" vertical={false} />
              <XAxis
                dataKey="rowIndex"
                type="category"
                tickFormatter={(value: number) => formatCategoryTick(rows[value]?.xLabel ?? '')}
                tick={{ fill: 'var(--pr-chart-muted)', fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                height={40}
                tickMargin={2}
                label={{
                  value: formatCategoryTick(columnLabel(xColumn)),
                  position: 'insideBottom',
                  offset: -4,
                  textAnchor: 'middle',
                  fill: 'var(--pr-text)',
                  fontSize: 12,
                  fontWeight: 500,
                }}
                interval="preserveStartEnd"
                minTickGap={24}
              />
              <YAxis
                tickFormatter={formatAxisTick}
                tick={{ fill: 'var(--pr-chart-muted)', fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                tickMargin={4}
                width="auto"
                domain={['auto', 'auto']}
                label={{
                  value: formatCategoryTick(axisTitle),
                  angle: -90,
                  position: 'insideLeft',
                  offset: 0,
                  textAnchor: 'middle',
                  fill: 'var(--pr-text)',
                  fontSize: 12,
                  fontWeight: 500,
                }}
              />
              {/* Include zero before Recharts computes nice ticks, including all-negative series. */}
              <ReferenceLine y={0} ifOverflow="extendDomain" stroke="var(--pr-chart-grid)" />
              <Tooltip
                cursor={
                  block.chart === 'bar'
                    ? { fill: 'var(--pr-chart-hover)', stroke: 'none' }
                    : { stroke: 'var(--pr-chart-grid)' }
                }
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
              {!numeric ? (
                <p className="pr-empty">所选系列均为 null，没有可绘制数值。</p>
              ) : (
                <figure className="pr-chart" aria-label={`${title}，${unit ?? '未声明单位'}`}>
                  <ResponsiveContainer width="100%" height={320} minWidth={0}>
                    {block.chart === 'line' ? (
                      <LineChart {...shared}>
                        {axes}
                        {shown.map((entry) => (
                          <Line
                            key={entry.id}
                            name={columnLabel(entry.column)}
                            dataKey={entry.key}
                            type="monotone"
                            stroke={entry.color}
                            strokeWidth={2}
                            dot={({ cx, cy, index }) => {
                              // Keep isolated observations visible without decorating every point.
                              const isolated =
                                typeof index === 'number' &&
                                rows[index]?.[entry.key] !== null &&
                                (index === 0 || rows[index - 1]?.[entry.key] === null) &&
                                (index === rows.length - 1 || rows[index + 1]?.[entry.key] === null)
                              return isolated ? (
                                <circle
                                  cx={cx}
                                  cy={cy}
                                  r={3}
                                  fill={entry.color}
                                  stroke="var(--pr-bg)"
                                />
                              ) : (
                                <g />
                              )
                            }}
                            activeDot={{ r: 4, stroke: 'var(--pr-bg)', strokeWidth: 2 }}
                            connectNulls={false}
                            isAnimationActive={false}
                          />
                        ))}
                      </LineChart>
                    ) : (
                      <BarChart {...shared} barCategoryGap="24%" barGap={4}>
                        {axes}
                        {shown.map((entry) => (
                          <Bar
                            key={entry.id}
                            name={columnLabel(entry.column)}
                            dataKey={entry.key}
                            fill={entry.color}
                            maxBarSize={48}
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
      {series.length > 1 && (
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
      )}
    </>
  )
}
