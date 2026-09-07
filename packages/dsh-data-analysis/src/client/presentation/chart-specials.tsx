import { type ReactNode, useState } from 'react'
import type { DocumentDataset } from '../../presentation/contracts/types.ts'
import {
  CHART_COLORS,
  chartCoordinate,
  domainTicks,
  donutPath,
  drawingDomain,
  drawingScale,
  shareIntervals,
  showValueLabels,
} from './chart-geometry.ts'
import { ExactTooltip, exactChartDescription } from './chart-tooltip.tsx'
import {
  type ChartBlock,
  cellText,
  columnIndex,
  columnLabel,
  formatAxisTick,
  formatCategoryTick,
  valueWithUnit,
} from './model.ts'

const WIDTH = 720
const LEFT = 148
const RIGHT = 686
const TOP = 22
const BOTTOM = 270

export const SPECIAL_CHARTS = new Set([
  'histogram',
  'boxPlot',
  'heatmap',
  'pie',
  'funnel',
  'waterfall',
  'leaderboard',
])

export function SpecialChart({
  dataset,
  block,
  rowIndices,
  visible,
  title,
}: {
  dataset: DocumentDataset
  block: ChartBlock
  rowIndices: readonly number[]
  visible: ReadonlySet<string>
  title: string
}) {
  const [active, setActive] = useState<number | null>(null)
  const data = dataset.data
  const bindings = block.bindings ?? {}
  const field = block.y[0]!
  const coordinate = (row: number, id: string) => chartCoordinate(data, block, row, id)
  const raw = (row: number, id: string) => data.rows[row]![columnIndex(data, id)]!
  const label = (row: number, id = block.x) =>
    cellText(raw(row, id), data.columns[columnIndex(data, id)]!)
  const exact = (row: number, id = field) =>
    valueWithUnit(raw(row, id), data.columns[columnIndex(data, id)]!)
  const color = (row: number) => CHART_COLORS[row % CHART_COLORS.length]!
  const references = block.options?.referenceLines ?? []
  const values = (ids: string[]) =>
    data.rows.flatMap((_, row) => ids.map((id) => coordinate(row, id)))
  const valueLabels = showValueLabels(block, rowIndices.length * visible.size)
  const allVisibleFields = block.y.filter((id) => visible.has(id))
  const mark = (row: number, suffix = '') => ({
    'data-chart-mark': `${block.chart}${suffix}`,
    'data-source-row-index': row,
    tabIndex: 0,
    role: 'img',
    'aria-label': exactChartDescription(dataset, block, row, visible)
      .map((entry) => `${entry.label}: ${entry.value}`)
      .join('；'),
    onMouseEnter: () => setActive(row),
    onMouseLeave: () => setActive(null),
    onFocus: () => setActive(row),
    onBlur: () => setActive(null),
  })
  const referenceValues = (axis: 'x' | 'y') =>
    references.filter((reference) => reference.axis === axis).map((reference) => reference.value)
  const horizontalAxis = (domain: [number, number], y: number, caption: string) => {
    const scale = drawingScale(domain, LEFT, RIGHT)
    return (
      <g>
        {domainTicks(domain).map((value) => (
          <g key={value}>
            <line
              x1={scale(value)}
              x2={scale(value)}
              y1={TOP}
              y2={y}
              stroke="var(--pr-chart-grid)"
            />
            <text className="pr-axis-tick" x={scale(value)} y={y + 18} textAnchor="middle">
              {formatAxisTick(value)}
            </text>
          </g>
        ))}
        <text x={(LEFT + RIGHT) / 2} y={y + 42} textAnchor="middle">
          {formatCategoryTick(caption)}
        </text>
        {references
          .filter((reference) => reference.axis === 'x')
          .map((reference) => (
            <g
              key={`${reference.axis}:${reference.value}:${reference.label ?? ''}`}
              data-reference-line="x"
            >
              <line
                x1={scale(reference.value)}
                x2={scale(reference.value)}
                y1={TOP}
                y2={y}
                stroke="var(--pr-chart-muted)"
                strokeDasharray="5 5"
              />
              <text x={scale(reference.value)} y={TOP - 7} textAnchor="middle">
                {formatCategoryTick(reference.label ?? formatAxisTick(reference.value))}
              </text>
            </g>
          ))}
      </g>
    )
  }
  const verticalAxis = (domain: [number, number], caption: string) => {
    const scale = drawingScale(domain, BOTTOM, TOP)
    return (
      <g>
        {domainTicks(domain).map((value) => (
          <g key={value}>
            <line
              x1={LEFT}
              x2={RIGHT}
              y1={scale(value)}
              y2={scale(value)}
              stroke="var(--pr-chart-grid)"
            />
            <text className="pr-axis-tick" x={LEFT - 10} y={scale(value) + 4} textAnchor="end">
              {formatAxisTick(value)}
            </text>
          </g>
        ))}
        <text
          x={14}
          y={(TOP + BOTTOM) / 2}
          transform={`rotate(-90,14,${(TOP + BOTTOM) / 2})`}
          textAnchor="middle"
        >
          {formatCategoryTick(caption)}
        </text>
        {references
          .filter((reference) => reference.axis === 'y')
          .map((reference) => (
            <g
              key={`${reference.axis}:${reference.value}:${reference.label ?? ''}`}
              data-reference-line="y"
            >
              <line
                x1={LEFT}
                x2={RIGHT}
                y1={scale(reference.value)}
                y2={scale(reference.value)}
                stroke="var(--pr-chart-muted)"
                strokeDasharray="5 5"
              />
              <text x={RIGHT} y={scale(reference.value) - 6} textAnchor="end">
                {formatCategoryTick(reference.label ?? formatAxisTick(reference.value))}
              </text>
            </g>
          ))}
      </g>
    )
  }
  const axisCaption = columnLabel(data.columns[columnIndex(data, field)]!)
  const categoryCaption = columnLabel(data.columns[columnIndex(data, block.x)]!)
  let height = 320
  let drawing: ReactNode

  if (block.chart === 'histogram') {
    const start = bindings.binStart!
    const end = bindings.binEnd!
    const xDomain = drawingDomain([...values([start, end]), ...referenceValues('x')])
    const yDomain = drawingDomain([...values([field]), ...referenceValues('y')])
    const sx = drawingScale(xDomain, LEFT, RIGHT)
    const sy = drawingScale(yDomain, BOTTOM, TOP)
    drawing = (
      <>
        {verticalAxis(yDomain, axisCaption)}
        {domainTicks(xDomain).map((value) => (
          <text
            key={value}
            className="pr-axis-tick"
            x={sx(value)}
            y={BOTTOM + 20}
            textAnchor="middle"
          >
            {formatAxisTick(value)}
          </text>
        ))}
        <text x={(LEFT + RIGHT) / 2} y={BOTTOM + 44} textAnchor="middle">
          {categoryCaption}
        </text>
        {rowIndices.map((row) => {
          const a = coordinate(row, start)
          const b = coordinate(row, end)
          const frequency = coordinate(row, field)
          if (a === null || b === null || frequency === null) return null
          return (
            <g key={row} {...mark(row)}>
              <title>{`${label(row)}: ${exact(row)}`}</title>
              <rect
                x={sx(a)}
                y={Math.min(sy(0), sy(frequency))}
                width={Math.max(0, sx(b) - sx(a))}
                height={Math.abs(sy(0) - sy(frequency))}
                fill={CHART_COLORS[0]}
                stroke="var(--pr-bg)"
                strokeWidth={1}
              />
              {valueLabels && (
                <text
                  className="pr-chart-label"
                  x={(sx(a) + sx(b)) / 2}
                  y={sy(frequency) - 7}
                  textAnchor="middle"
                >
                  {formatCategoryTick(exact(row))}
                </text>
              )}
            </g>
          )
        })}
        {references
          .filter((reference) => reference.axis === 'x')
          .map((reference) => (
            <g
              key={`${reference.axis}:${reference.value}:${reference.label ?? ''}`}
              data-reference-line="x"
            >
              <line
                x1={sx(reference.value)}
                x2={sx(reference.value)}
                y1={TOP}
                y2={BOTTOM}
                stroke="var(--pr-chart-muted)"
                strokeDasharray="5 5"
              />
              <text x={sx(reference.value)} y={TOP - 7} textAnchor="middle">
                {formatCategoryTick(reference.label ?? formatAxisTick(reference.value))}
              </text>
            </g>
          ))}
      </>
    )
  } else if (block.chart === 'boxPlot') {
    const fields = [bindings.minimum!, bindings.q1!, field, bindings.q3!, bindings.maximum!]
    const domain = drawingDomain([...values(fields), ...referenceValues('x')])
    const sx = drawingScale(domain, LEFT, RIGHT)
    const band = 46
    const bottom = TOP + Math.max(rowIndices.length, 1) * band
    height = bottom + 52
    drawing = (
      <>
        {horizontalAxis(domain, bottom, axisCaption)}
        {rowIndices.map((row, index) => {
          const points = fields.map((id) => coordinate(row, id))
          const y = TOP + index * band + band / 2
          return (
            <g key={row} {...mark(row)}>
              <title>{`${label(row)}: ${exactChartDescription(dataset, block, row)
                .map((entry) => `${entry.label} ${entry.value}`)
                .join('；')}`}</title>
              <text x={LEFT - 12} y={y + 4} textAnchor="end">
                {formatCategoryTick(label(row))}
              </text>
              {points.every((point) => point !== null) && (
                <>
                  <line
                    data-box-part="whisker"
                    x1={sx(points[0]!)}
                    x2={sx(points[4]!)}
                    y1={y}
                    y2={y}
                    stroke={color(row)}
                    strokeWidth={2}
                  />
                  {[
                    { id: 'minimum', value: points[0]! },
                    { id: 'maximum', value: points[4]! },
                  ].map((point) => (
                    <line
                      key={point.id}
                      data-box-part="cap"
                      x1={sx(point.value)}
                      x2={sx(point.value)}
                      y1={y - 8}
                      y2={y + 8}
                      stroke={color(row)}
                      strokeWidth={2}
                    />
                  ))}
                  <rect
                    data-box-part="box"
                    x={sx(points[1]!)}
                    y={y - 12}
                    width={sx(points[3]!) - sx(points[1]!)}
                    height={24}
                    fill={color(row)}
                    fillOpacity={0.25}
                    stroke={color(row)}
                    strokeWidth={2}
                  />
                  <line
                    data-box-part="median"
                    x1={sx(points[2]!)}
                    x2={sx(points[2]!)}
                    y1={y - 12}
                    y2={y + 12}
                    stroke={color(row)}
                    strokeWidth={3}
                  />
                  {valueLabels && (
                    <text
                      className="pr-chart-label"
                      x={sx(points[2]!)}
                      y={y - 17}
                      textAnchor="middle"
                    >
                      {formatCategoryTick(exact(row))}
                    </text>
                  )}
                </>
              )}
              {points.some((point) => point === null) && (
                <text className="pr-axis-tick" x={LEFT} y={y + 4}>
                  —
                </text>
              )}
            </g>
          )
        })}
      </>
    )
  } else if (block.chart === 'heatmap') {
    const cellWidth = (RIGHT - LEFT) / Math.max(1, allVisibleFields.length)
    const cellHeight = 40
    height = Math.max(130, TOP + rowIndices.length * cellHeight + 74)
    // Color scale belongs to the full saved matrix so filtering does not change its meaning.
    const domain = drawingDomain(values(block.y))
    const intensity = drawingScale(domain, 0.12, 1)
    drawing = (
      <>
        {allVisibleFields.map((id, index) => (
          <text
            key={id}
            x={LEFT + (index + 0.5) * cellWidth}
            y={TOP + rowIndices.length * cellHeight + 20}
            textAnchor="middle"
          >
            {formatCategoryTick(columnLabel(data.columns[columnIndex(data, id)]!))}
          </text>
        ))}
        {rowIndices.map((row, index) => (
          <g key={row}>
            <text x={LEFT - 12} y={TOP + (index + 0.5) * cellHeight + 4} textAnchor="end">
              {formatCategoryTick(label(row))}
            </text>
            {allVisibleFields.map((id, series) => {
              const value = coordinate(row, id)
              const x = LEFT + series * cellWidth
              const y = TOP + index * cellHeight
              return (
                <g key={id} {...mark(row, `:${id}`)}>
                  <title>{`${label(row)} · ${data.columns[columnIndex(data, id)]!.label}: ${exact(row, id)}`}</title>
                  <rect
                    x={x + 1}
                    y={y + 1}
                    width={cellWidth - 2}
                    height={cellHeight - 2}
                    fill={value === null ? 'var(--pr-soft)' : CHART_COLORS[0]}
                    fillOpacity={value === null ? 1 : intensity(value)}
                  />
                  {(valueLabels || value === null) && (
                    <text
                      className="pr-chart-label"
                      x={x + cellWidth / 2}
                      y={y + cellHeight / 2 + 4}
                      textAnchor="middle"
                    >
                      {formatCategoryTick(exact(row, id))}
                    </text>
                  )}
                </g>
              )
            })}
          </g>
        ))}
        <text className="pr-axis-tick" x={LEFT} y={height - 8}>
          {formatAxisTick(domain[0])} → {formatAxisTick(domain[1])}
        </text>
      </>
    )
  } else if (block.chart === 'pie') {
    const intervals = shareIntervals(data.rows.map((_, row) => coordinate(row, bindings.share!)))
    height = Math.max(320, rowIndices.length * 30 + 44)
    drawing = (
      <>
        <circle cx={165} cy={155} r={86} fill="none" stroke="var(--pr-soft)" strokeWidth={40} />
        {rowIndices.map((row, index) => {
          const interval = intervals[row]
          const value = coordinate(row, field)
          return (
            <g
              key={row}
              {...mark(row)}
              data-share-start={interval?.start}
              data-share-end={interval?.end}
            >
              <title>{`${label(row)}: ${exact(row)} · ${exact(row, bindings.share!)}`}</title>
              {interval && value !== null && (
                <path
                  d={donutPath(interval.start, interval.end, 165, 155)}
                  fill={color(row)}
                  stroke="var(--pr-bg)"
                  strokeWidth={1}
                />
              )}
              <rect x={314} y={TOP + index * 30} width={10} height={10} rx={2} fill={color(row)} />
              <text x={334} y={TOP + index * 30 + 10}>
                {formatCategoryTick(label(row))}
                {valueLabels ? ` · ${formatCategoryTick(exact(row))}` : ''} ·{' '}
                {formatCategoryTick(exact(row, bindings.share!))}
              </text>
            </g>
          )
        })}
      </>
    )
  } else if (block.chart === 'funnel') {
    const band = 48
    height = Math.max(130, TOP + rowIndices.length * band + 22)
    drawing = rowIndices.map((row, index) => {
      const share = coordinate(row, bindings.share!)
      const value = coordinate(row, field)
      const nextShare = row + 1 < data.rows.length ? coordinate(row + 1, bindings.share!) : share
      const center = (LEFT + RIGHT) / 2
      const topWidth = (share ?? 0) * (RIGHT - LEFT)
      const bottomWidth = (nextShare ?? share ?? 0) * (RIGHT - LEFT)
      const y = TOP + index * band
      return (
        <g key={row} {...mark(row)}>
          <title>{`${label(row)}: ${exact(row)} · ${exact(row, bindings.share!)}`}</title>
          <text x={LEFT - 12} y={y + 24} textAnchor="end">
            {formatCategoryTick(label(row))}
          </text>
          {share !== null && value !== null && (
            <path
              d={`M ${center - topWidth / 2} ${y} L ${center + topWidth / 2} ${y} L ${center + bottomWidth / 2} ${y + band - 4} L ${center - bottomWidth / 2} ${y + band - 4} Z`}
              fill={color(row)}
              fillOpacity={0.6}
            />
          )}
          <text className="pr-chart-label" x={center} y={y + 24} textAnchor="middle">
            {share === null || value === null
              ? '—'
              : `${valueLabels ? `${formatCategoryTick(exact(row))} · ` : ''}${formatCategoryTick(exact(row, bindings.share!))}`}
          </text>
        </g>
      )
    })
  } else if (block.chart === 'waterfall') {
    const domain = drawingDomain([
      ...values([bindings.start!, bindings.end!]),
      ...referenceValues('y'),
    ])
    const sy = drawingScale(domain, BOTTOM, TOP)
    const band = (RIGHT - LEFT) / Math.max(1, rowIndices.length)
    drawing = (
      <>
        {verticalAxis(domain, axisCaption)}
        <text x={(LEFT + RIGHT) / 2} y={BOTTOM + 44} textAnchor="middle">
          {categoryCaption}
        </text>
        {rowIndices.map((row, index) => {
          const start = coordinate(row, bindings.start!)
          const end = coordinate(row, bindings.end!)
          const value = coordinate(row, field)
          const role = raw(row, bindings.role!)
          const x = LEFT + (index + 0.2) * band
          const previous = rowIndices[index - 1]
          const previousEnd = previous === undefined ? null : coordinate(previous, bindings.end!)
          const connectorTarget = role === 'delta' ? start : end
          const connected =
            role !== 'start' &&
            previous !== undefined &&
            previous === row - 1 &&
            raw(previous, bindings.role!) !== null &&
            previousEnd !== null &&
            previousEnd === connectorTarget
          return (
            <g key={row} {...mark(row)} data-waterfall-role={role}>
              <title>{`${label(row)}: ${exact(row)}`}</title>
              {start !== null && end !== null && value !== null && role !== null && (
                <>
                  {connected && (
                    <line
                      x1={x - band * 0.4}
                      x2={x}
                      y1={sy(previousEnd!)}
                      y2={sy(previousEnd!)}
                      data-waterfall-connector="true"
                      stroke="var(--pr-chart-muted)"
                      strokeDasharray="3 3"
                    />
                  )}
                  <rect
                    x={x}
                    y={Math.min(sy(start), sy(end))}
                    width={band * 0.6}
                    height={Math.abs(sy(start) - sy(end))}
                    fill={
                      role === 'delta'
                        ? value < 0
                          ? CHART_COLORS[4]
                          : CHART_COLORS[2]
                        : CHART_COLORS[0]
                    }
                  />
                  {valueLabels && (
                    <text
                      className="pr-chart-label"
                      x={x + band * 0.3}
                      y={Math.min(sy(start), sy(end)) - 7}
                      textAnchor="middle"
                    >
                      {formatCategoryTick(exact(row))}
                    </text>
                  )}
                </>
              )}
              <text className="pr-axis-tick" x={x + band * 0.3} y={BOTTOM + 20} textAnchor="middle">
                {formatCategoryTick(label(row))}
              </text>
            </g>
          )
        })}
      </>
    )
  } else {
    const domain = drawingDomain([...values([field]), ...referenceValues('x')])
    const sx = drawingScale(domain, LEFT, RIGHT)
    const band = 40
    const bottom = TOP + Math.max(1, rowIndices.length) * band
    height = bottom + 52
    drawing = (
      <>
        {horizontalAxis(domain, bottom, axisCaption)}
        {rowIndices.map((row, index) => {
          const value = coordinate(row, field)
          const y = TOP + index * band + 5
          return (
            <g key={row} {...mark(row)}>
              <title>{`${label(row)}: ${exact(row)} · ${exact(row, bindings.rank!)}`}</title>
              <text x={LEFT - 12} y={y + 19} textAnchor="end">
                {formatCategoryTick(`${label(row, bindings.rank!)}. ${label(row)}`)}
              </text>
              {value !== null && (
                <>
                  <rect
                    x={Math.min(sx(0), sx(value))}
                    y={y}
                    width={Math.abs(sx(value) - sx(0))}
                    height={28}
                    fill={CHART_COLORS[0]}
                  />
                  {valueLabels && (
                    <text
                      className="pr-chart-label"
                      x={sx(value) + (value < 0 ? -6 : 6)}
                      y={y + 19}
                      textAnchor={value < 0 ? 'end' : 'start'}
                    >
                      {formatCategoryTick(exact(row))}
                    </text>
                  )}
                </>
              )}
            </g>
          )
        })}
      </>
    )
  }
  return (
    <figure className="pr-special-frame" aria-label={title} data-chart-type={block.chart}>
      <div className="pr-special-scroll">
        <svg
          className="pr-special-chart"
          viewBox={`0 0 ${WIDTH} ${height}`}
          role="img"
          aria-label={title}
        >
          <title>{title}</title>
          {drawing}
        </svg>
      </div>
      {active !== null && rowIndices.includes(active) && (
        <div className="pr-special-tooltip">
          <ExactTooltip dataset={dataset} block={block} rowIndex={active} visible={visible} />
        </div>
      )}
    </figure>
  )
}
