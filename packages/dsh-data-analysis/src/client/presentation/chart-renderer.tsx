import { useMemo, useState } from 'react'
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  Rectangle,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'
import { chartColumns } from '../../presentation/contracts/charts.ts'
import type { DocumentDataset } from '../../presentation/contracts/types.ts'
import { useCopy } from './../i18n/context.tsx'
import {
  CHART_COLORS,
  chartCoordinate,
  numericDrawingAxis,
  pointIsDrawable,
  seriesAppearance,
  showValueLabels,
  stackCoordinates,
} from './chart-geometry.ts'
import { SPECIAL_CHARTS, SpecialChart } from './chart-specials.tsx'
import { ExactTooltip } from './chart-tooltip.tsx'
import {
  type ChartBlock,
  cellText,
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

interface DrawingRow {
  rowIndex: number
  xLabel: string
  [key: string]: number | string | null | [number, number]
}

export function ChartRenderer({
  dataset,
  block,
  mode,
  hidden: controlledHidden,
  onHiddenChange,
  rowIndices,
}: {
  dataset: DocumentDataset
  block: ChartBlock
  mode: ReaderMode
  hidden?: readonly string[]
  onHiddenChange?: (hidden: string[]) => void
  rowIndices?: readonly number[]
}) {
  const t = useCopy()

  const [localHidden, setLocalHidden] = useState<string[]>([])
  const hidden = new Set(controlledHidden ?? localHidden)
  const originalRows = useMemo(
    () => chartRows(t.locale, dataset.data, block, rowIndices),
    [t.locale, dataset.data, block, rowIndices],
  )
  const indices = rowIndices ?? originalRows.map((row) => row.rowIndex)
  const rows: DrawingRow[] = originalRows.map((row) => ({ ...row }))
  const horizontal = block.chart.startsWith('horizontal')
  const stacked = block.chart.toLowerCase().includes('stacked')
  const normalized = block.chart.endsWith('100')
  const area = block.chart === 'area' || block.chart === 'stackedArea'
  const trend = block.chart === 'line' || area || block.chart === 'sparkline'
  const sparkline = block.chart === 'sparkline'
  const series = block.y.map((id, index) => ({
    id,
    index,
    key: `series${index}`,
    ...seriesAppearance(block, id, index),
    column: dataset.data.columns[columnIndex(dataset.data, id)]!,
  }))
  const visible = new Set(block.y.filter((id) => !hidden.has(id)))
  for (const row of rows) {
    const ranges = stacked
      ? stackCoordinates(
          series.map((entry) => (visible.has(entry.id) ? (row[entry.key] as number | null) : null)),
        )
      : []
    for (const entry of series) {
      const value = dataset.data.rows[row.rowIndex]![columnIndex(dataset.data, entry.id)]!
      row[`valueLabel${entry.index}`] =
        value === null ? null : formatCategoryTick(valueWithUnit(t.locale, value, entry.column))
      if (stacked && area) row[entry.key] = ranges[entry.index]!
    }
  }
  const rowByIndex = new Map(rows.map((row) => [row.rowIndex, row]))
  const title = chartTitle(t.locale, dataset.data, block)
  const xColumn = dataset.data.columns[columnIndex(dataset.data, block.x)]!
  const labels = showValueLabels(block, rows.length * visible.size)
  // An explicitly declared unit owns one scale. Stacked inputs are validated to share a unit.
  const groups = new Map<string | undefined, typeof series>()
  for (const entry of series) {
    const entries = groups.get(entry.column.unit) ?? []
    entries.push(entry)
    groups.set(entry.column.unit, entries)
  }
  if (mode === 'static')
    return (
      <>
        <h2>{title}</h2>
        <DatasetTable
          data={dataset.data}
          columns={chartColumns(block)}
          mode={mode}
          caption={t('marivo.presentation.value-exact-data', { p0: title })}
          rowIndices={indices}
        />
      </>
    )
  const tooltip = (shown: typeof series) => (
    <Tooltip
      cursor={
        trend
          ? { stroke: 'var(--pr-chart-grid)' }
          : { fill: 'var(--pr-chart-hover)', stroke: 'none' }
      }
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
  )
  const referenceLines = (xDivisor = 1, yDivisor = 1) =>
    (block.options?.referenceLines ?? []).map((reference) => (
      <ReferenceLine
        key={`${reference.axis}:${reference.value}:${reference.label ?? ''}`}
        {...(reference.axis === 'x'
          ? { x: reference.value / xDivisor }
          : { y: reference.value / yDivisor })}
        ifOverflow="extendDomain"
        stroke="var(--pr-chart-muted)"
        strokeDasharray="5 5"
        label={{
          value: reference.label ?? formatAxisTick(t.locale, reference.value),
          fill: 'var(--pr-text)',
          fontSize: 11,
        }}
      />
    ))
  const renderCartesian = (entries: typeof series, unit: string | undefined) => {
    const shown = entries.filter((entry) => visible.has(entry.id))
    if (!shown.length) return null
    const numeric = rows.some((row) => shown.some((entry) => row[entry.key] !== null))
    const numericAxis = numericDrawingAxis([
      ...rows.flatMap((row) =>
        stacked && !area
          ? stackCoordinates(shown.map((entry) => row[entry.key] as number | null)).flatMap(
              (value) => value ?? [null],
            )
          : shown.flatMap((entry) =>
              Array.isArray(row[entry.key])
                ? (row[entry.key] as [number, number])
                : [row[entry.key] as number | null],
            ),
      ),
      ...(block.options?.referenceLines ?? []).map((reference) => reference.value),
    ])
    const displayRows =
      numericAxis.divisor === 1
        ? rows
        : rows.map((row) => {
            const result = { ...row }
            for (const entry of shown) {
              const value = row[entry.key]
              result[entry.key] = Array.isArray(value)
                ? [value[0] / numericAxis.divisor, value[1] / numericAxis.divisor]
                : value === null
                  ? null
                  : (value as number) / numericAxis.divisor
            }
            return result
          })
    const axisTitle =
      shown.length === 1
        ? columnLabel(shown[0]!.column)
        : (unit ?? shown.map((entry) => entry.column.label).join('、'))
    const axisStyle = { fill: 'var(--pr-chart-muted)', fontSize: 12 }
    const numericFormatter = normalized
      ? (value: number) => `${formatAxisTick(t.locale, value * 100)}%`
      : (value: number) => formatAxisTick(t.locale, value * numericAxis.divisor)
    const categoryFormatter = (value: number) =>
      formatCategoryTick(rowByIndex.get(value)?.xLabel ?? '')
    const numericDomain: [number | string, number | string] = normalized
      ? [0, 1]
      : numericAxis.divisor === 1
        ? ['auto', 'auto']
        : numericAxis.domain
    const axisLabel = (value: string) => ({
      value: formatCategoryTick(value),
      fill: 'var(--pr-text)',
      fontSize: 12,
      fontWeight: 500,
    })
    const axes = (
      <>
        {!sparkline && (
          <CartesianGrid
            stroke="var(--pr-chart-grid)"
            vertical={horizontal}
            horizontal={!horizontal}
          />
        )}
        <XAxis
          dataKey={horizontal ? undefined : 'rowIndex'}
          type={horizontal ? 'number' : 'category'}
          tickFormatter={horizontal ? numericFormatter : categoryFormatter}
          tick={axisStyle}
          tickLine={false}
          axisLine={false}
          height={40}
          tickMargin={2}
          hide={sparkline}
          domain={horizontal ? numericDomain : undefined}
          label={
            sparkline
              ? undefined
              : {
                  ...axisLabel(horizontal ? axisTitle : columnLabel(xColumn)),
                  position: 'insideBottom',
                  offset: -4,
                  textAnchor: 'middle',
                }
          }
          interval="preserveStartEnd"
          minTickGap={24}
        />
        <YAxis
          dataKey={horizontal ? 'rowIndex' : undefined}
          type={horizontal ? 'category' : 'number'}
          tickFormatter={horizontal ? categoryFormatter : numericFormatter}
          tick={axisStyle}
          tickLine={false}
          axisLine={false}
          tickMargin={4}
          width={horizontal ? 112 : 'auto'}
          hide={sparkline}
          domain={horizontal ? undefined : numericDomain}
          label={
            sparkline
              ? undefined
              : {
                  ...axisLabel(horizontal ? columnLabel(xColumn) : axisTitle),
                  angle: -90,
                  position: 'insideLeft',
                  offset: 0,
                  textAnchor: 'middle',
                }
          }
        />
        {!sparkline && (
          <ReferenceLine
            {...(horizontal ? { x: 0 } : { y: 0 })}
            ifOverflow="extendDomain"
            stroke="var(--pr-chart-grid)"
          />
        )}
        {referenceLines(horizontal ? numericAxis.divisor : 1, horizontal ? 1 : numericAxis.divisor)}
        {tooltip(shown)}
      </>
    )
    return (
      <div className="pr-chart-group" key={unit === undefined ? 'no-unit' : `unit:${unit}`}>
        {!numeric ? (
          <p className="pr-empty">
            {t('marivo.presentation.all-selected-series-are-null-there-are-no-values')}
          </p>
        ) : (
          <figure
            className={`pr-chart${sparkline ? ' pr-chart-sparkline' : ''}`}
            aria-label={`${title}, ${unit ?? t('marivo.presentation.undeclared-unit')}`}
            data-chart-type={block.chart}
          >
            <ResponsiveContainer width="100%" height={sparkline ? 128 : 320} minWidth={0}>
              <ComposedChart
                data={displayRows}
                layout={horizontal ? 'vertical' : 'horizontal'}
                stackOffset="sign"
                accessibilityLayer
                margin={{ top: labels ? 26 : 8, right: labels ? 24 : 0, bottom: 8, left: 8 }}
                barCategoryGap="24%"
                barGap={stacked ? 0 : 4}
              >
                {axes}
                {shown.map((entry) => {
                  const valueLabel = labels ? (
                    <LabelList
                      dataKey={`valueLabel${entry.index}`}
                      position={horizontal ? 'right' : 'top'}
                      fill="var(--pr-text)"
                      fontSize={11}
                    />
                  ) : null
                  const dot = ({ cx, cy, index }: { cx?: number; cy?: number; index?: number }) => {
                    if (
                      typeof index !== 'number' ||
                      !pointIsDrawable(rows[index]?.[entry.key], cx, cy)
                    )
                      return <g />
                    const isolated =
                      typeof index === 'number' &&
                      rows[index]?.[entry.key] !== null &&
                      (index === 0 || rows[index - 1]?.[entry.key] === null) &&
                      (index === rows.length - 1 || rows[index + 1]?.[entry.key] === null)
                    const show =
                      block.options?.showPoints === 'always' ||
                      (block.options?.showPoints !== 'never' && isolated)
                    return show ? (
                      <circle
                        cx={cx}
                        cy={cy}
                        r={3}
                        fill={entry.color}
                        stroke="var(--pr-bg)"
                        data-chart-point={entry.id}
                        data-source-row-index={rows[index]?.rowIndex}
                      />
                    ) : (
                      <g />
                    )
                  }
                  if (trend) {
                    const common = {
                      name: columnLabel(entry.column),
                      dataKey: entry.key,
                      type: 'monotone' as const,
                      stroke: entry.color,
                      strokeWidth: 2,
                      strokeDasharray: entry.dash,
                      dot,
                      activeDot:
                        block.options?.showPoints === 'never'
                          ? (false as const)
                          : { r: 4, stroke: 'var(--pr-bg)', strokeWidth: 2 },
                      connectNulls: false,
                      isAnimationActive: false,
                    }
                    return area ? (
                      <Area
                        key={entry.id}
                        {...common}
                        fill={entry.color}
                        fillOpacity={stacked ? 0.55 : 0.18}
                      >
                        {valueLabel}
                      </Area>
                    ) : (
                      <Line key={entry.id} {...common}>
                        {valueLabel}
                      </Line>
                    )
                  }
                  // Null never becomes a painted zero observation, including Recharts stack offsets.
                  return (
                    <Bar
                      key={entry.id}
                      name={columnLabel(entry.column)}
                      dataKey={entry.key}
                      stackId={stacked ? 'authored-values' : undefined}
                      fill={entry.color}
                      maxBarSize={48}
                      isAnimationActive={false}
                      shape={(props: any) =>
                        props.payload?.[entry.key] === null ? (
                          <g />
                        ) : (
                          <Rectangle {...props} data-source-row-index={props.payload?.rowIndex} />
                        )
                      }
                    >
                      {valueLabel}
                    </Bar>
                  )
                })}
              </ComposedChart>
            </ResponsiveContainer>
          </figure>
        )}
      </div>
    )
  }
  const renderScatter = () => {
    const entry = series[0]!
    const bindings = block.bindings ?? {}
    const category = (index: number) =>
      bindings.color
        ? JSON.stringify(dataset.data.rows[index]![columnIndex(dataset.data, bindings.color)]!)
        : ''
    const categories = [...new Set(dataset.data.rows.map((_, index) => category(index)))]
    const points = rows
      .map(
        (row): DrawingRow => ({
          ...row,
          xCoordinate: chartCoordinate(dataset.data, block, row.rowIndex, block.x),
          sizeCoordinate: bindings.size
            ? chartCoordinate(dataset.data, block, row.rowIndex, bindings.size)
            : 1,
          pointLabel: bindings.label
            ? formatCategoryTick(
                cellText(
                  t.locale,
                  dataset.data.rows[row.rowIndex]![columnIndex(dataset.data, bindings.label)]!,
                  dataset.data.columns[columnIndex(dataset.data, bindings.label)]!,
                ),
              )
            : (row.valueLabel0 ?? null),
        }),
      )
      .filter(
        (row) =>
          row.xCoordinate !== null &&
          row[entry.key] !== null &&
          row.sizeCoordinate !== null &&
          (!bindings.size || row.sizeCoordinate !== 0),
      )
    if (!points.length)
      return (
        <p className="pr-empty">
          {t('marivo.presentation.all-selected-coordinates-are-null-there-are-no-values')}
        </p>
      )
    const axis = (coordinate: string, referenceAxis: 'x' | 'y') =>
      numericDrawingAxis([
        ...points.map((row) => row[coordinate] as number),
        ...(block.options?.referenceLines ?? [])
          .filter((reference) => reference.axis === referenceAxis)
          .map((reference) => reference.value),
      ])
    const xAxis = axis('xCoordinate', 'x')
    const yAxis = axis(entry.key, 'y')
    const sizeAxis = numericDrawingAxis(points.map((row) => row.sizeCoordinate as number))
    const displayPoints = points.map((row) => ({
      ...row,
      xCoordinate: (row.xCoordinate as number) / xAxis.divisor,
      [entry.key]: (row[entry.key] as number) / yAxis.divisor,
      sizeCoordinate: (row.sizeCoordinate as number) / sizeAxis.divisor,
    }))
    return (
      <>
        <figure className="pr-chart" aria-label={title} data-chart-type="scatter">
          <ResponsiveContainer width="100%" height={320} minWidth={0}>
            <ScatterChart
              accessibilityLayer
              margin={{ top: labels ? 26 : 8, right: 24, bottom: 8, left: 8 }}
            >
              <CartesianGrid stroke="var(--pr-chart-grid)" />
              <XAxis
                dataKey="xCoordinate"
                type="number"
                name={columnLabel(xColumn)}
                tickFormatter={(value: number) => formatAxisTick(t.locale, value * xAxis.divisor)}
                tick={{ fill: 'var(--pr-chart-muted)', fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                height={40}
                domain={xAxis.divisor === 1 ? ['auto', 'auto'] : xAxis.domain}
                label={{
                  value: formatCategoryTick(columnLabel(xColumn)),
                  position: 'insideBottom',
                  offset: -4,
                  fill: 'var(--pr-text)',
                  fontSize: 12,
                }}
              />
              <YAxis
                dataKey={entry.key}
                type="number"
                name={columnLabel(entry.column)}
                tickFormatter={(value: number) => formatAxisTick(t.locale, value * yAxis.divisor)}
                tick={{ fill: 'var(--pr-chart-muted)', fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                width="auto"
                domain={yAxis.divisor === 1 ? ['auto', 'auto'] : yAxis.domain}
                label={{
                  value: formatCategoryTick(columnLabel(entry.column)),
                  angle: -90,
                  position: 'insideLeft',
                  fill: 'var(--pr-text)',
                  fontSize: 12,
                }}
              />
              <ZAxis
                dataKey="sizeCoordinate"
                range={bindings.size ? [0, 240] : [48, 48]}
                domain={bindings.size ? [0, 'dataMax'] : [0, 1]}
              />
              {referenceLines(xAxis.divisor, yAxis.divisor)}
              {tooltip([entry])}
              <Scatter
                data={displayPoints}
                name={columnLabel(entry.column)}
                fill={entry.color}
                isAnimationActive={false}
              >
                {points.map((row) => (
                  <Cell
                    key={row.rowIndex}
                    data-source-row-index={row.rowIndex}
                    fill={
                      bindings.color
                        ? CHART_COLORS[
                            categories.indexOf(category(row.rowIndex)) % CHART_COLORS.length
                          ]
                        : entry.color
                    }
                  />
                ))}
                {(bindings.label || labels) && (
                  <LabelList
                    dataKey="pointLabel"
                    position="top"
                    fill="var(--pr-text)"
                    fontSize={11}
                  />
                )}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </figure>
        {bindings.color && (
          <section className="pr-color-key" aria-label={t('marivo.presentation.category-colors')}>
            {categories.map((name, index) => (
              <span key={name}>
                <i
                  className="pr-swatch"
                  style={{ background: CHART_COLORS[index % CHART_COLORS.length] }}
                  aria-hidden="true"
                />
                {t(
                  cellText(
                    t.locale,
                    JSON.parse(name),
                    dataset.data.columns[columnIndex(dataset.data, bindings.color!)]!,
                  ),
                )}
              </span>
            ))}
          </section>
        )}
      </>
    )
  }
  return (
    <>
      <h2>{title}</h2>
      {dataset.data.truncated && (
        <p className="pr-notice">{t(datasetScope(t.locale, dataset.data))}</p>
      )}
      {rowIndices && dataset.data.truncated && (
        <p className="pr-muted">
          {t('marivo.presentation.filtered-rows', {
            p0: dataset.data.rows.length,
            p1: rowIndices.length,
          })}
        </p>
      )}
      {block.numericMode === 'approximate' && (
        <p className="pr-notice">{t('marivo.presentation.approximate-plot')}</p>
      )}
      {!rows.length ? (
        <p className="pr-empty">{t('marivo.presentation.no-data-to-plot')}</p>
      ) : !visible.size ? (
        <p className="pr-empty">
          {t('marivo.presentation.all-series-are-hidden-select-a-series-to-show')}
        </p>
      ) : SPECIAL_CHARTS.has(block.chart) ? (
        <SpecialChart
          dataset={dataset}
          block={block}
          rowIndices={indices}
          visible={visible}
          title={title}
        />
      ) : block.chart === 'scatter' ? (
        renderScatter()
      ) : (
        [...groups].map(([unit, entries]) => renderCartesian(entries, unit))
      )}
      {series.length > 1 && (
        <section
          className="pr-legend pr-interactive"
          aria-label={t('marivo.presentation.chart-series')}
        >
          {series.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-label={t('marivo.presentation.show-series-value', { p0: entry.column.label })}
              aria-pressed={!hidden.has(entry.id)}
              onClick={() => {
                const next = new Set(hidden)
                if (next.has(entry.id)) next.delete(entry.id)
                else next.add(entry.id)
                const result = [...next]
                if (onHiddenChange) onHiddenChange(result)
                else setLocalHidden(result)
              }}
            >
              {trend ? (
                <svg width={18} height={10} aria-hidden="true">
                  <line
                    x1={0}
                    x2={18}
                    y1={5}
                    y2={5}
                    stroke={entry.color}
                    strokeWidth={2}
                    strokeDasharray={entry.dash}
                  />
                </svg>
              ) : block.chart === 'heatmap' ? null : (
                <span
                  className="pr-swatch"
                  style={{ background: entry.color }}
                  aria-hidden="true"
                />
              )}
              {columnLabel(entry.column)}
              {block.options?.series?.[entry.id]?.role && (
                <span className="pr-chart-role">{block.options.series[entry.id]!.role}</span>
              )}
            </button>
          ))}
        </section>
      )}
    </>
  )
}
