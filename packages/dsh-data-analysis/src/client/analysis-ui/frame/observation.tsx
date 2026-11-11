import { useId, useState } from 'react'
import { CartesianGrid, ReferenceLine, Scatter, ScatterChart, XAxis, YAxis } from 'recharts'
import type {
  Cell,
  DatasetColumn,
  PresentationLocale,
} from '../../../presentation/contracts/types.ts'
import { useCopy } from '../../i18n/context.tsx'
import { compareDecimalText } from '../../presentation/model.ts'
import {
  HBarChart as SharedHBarChart,
  Heatmap as SharedHeatmap,
  TimeChart as SharedTimeChart,
} from '../charts/observation.tsx'
import {
  ChartFrame,
  color,
  coordinates,
  ExactTooltip,
  Legend,
  MemberTick,
  numericDomain,
  summary,
} from '../charts/recharts.tsx'
import { frameChartModel } from './chart-model.ts'
import { DomainPointMark, uniquelyBound } from './domain-point-selection.tsx'
import {
  axisOf,
  cellOf,
  columnOf,
  displayFrameCell,
  groupRows,
  interpretationOf,
  memberLabel,
  membersLabel,
  percent,
  rowsOf,
  type Snapshot,
  timeTicks,
  valueAt,
  valueName,
} from './model.ts'
import { SavedRowPlot } from './plots.tsx'
import { useFrameSelection } from './selection-context.tsx'
import type { MainViewProps } from './types.ts'

export function TimeChart(props: MainViewProps<'line' | 'area' | 'bar' | 'interval-bar'>) {
  const t = useCopy()
  return (
    <SharedTimeChart
      model={frameChartModel(
        t,
        props.snapshot,
        props.classification,
        props.view.broadcast,
        props.visibleRowIndices,
      )}
      view={props.view}
      height={props.height}
    />
  )
}
export function HBarChart(props: MainViewProps<'hbar'>) {
  const t = useCopy()
  const limit = props.snapshot.frameDisplay?.rowLimit
  return (
    <>
      <SharedHBarChart
        model={frameChartModel(
          t,
          props.snapshot,
          props.classification,
          props.view.broadcast,
          props.visibleRowIndices,
        )}
        view={props.view}
        height={props.height}
      />
      {limit !== undefined && limit < props.snapshot.data.rows.length && (
        <p className="fv-records-more">
          {t('marivo.presentation.ui-frame-records-preview', {
            shown: limit.toLocaleString(t.locale),
            total: props.snapshot.data.rows.length.toLocaleString(t.locale),
          })}
        </p>
      )}
    </>
  )
}
export function Heatmap(props: MainViewProps<'heatmap'>) {
  const t = useCopy()
  return (
    <SharedHeatmap
      model={frameChartModel(t, props.snapshot, props.classification, [], props.visibleRowIndices)}
      view={props.view}
      height={props.height}
    />
  )
}

/** Approximate ratios only after scaling exact decimal spellings to a shared power of ten. */
function categoryShares(cells: Cell[]): number[] | undefined {
  const parsed: { magnitude: bigint; mantissa: number }[] = []
  let largest: bigint | undefined
  for (const value of cells) {
    if (value === null || typeof value === 'boolean') return undefined
    const text = String(value)
    const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text)
    if (!match) return undefined
    const fraction = match[3] ?? ''
    const digits = `${match[2]}${fraction}`.replace(/^0+/, '')
    if (!digits) {
      parsed.push({ magnitude: 0n, mantissa: 0 })
      continue
    }
    if (match[1]) return undefined
    const magnitude = BigInt(digits.length - fraction.length) + BigInt(match[4] ?? '0')
    const mantissa = Number(`${digits[0]}.${digits.slice(1, 16)}`)
    parsed.push({ magnitude, mantissa })
    if (largest === undefined || magnitude > largest) largest = magnitude
  }
  if (largest === undefined) return undefined
  const scaled = parsed.map(({ magnitude, mantissa }) => {
    if (mantissa === 0) return 0
    const difference = magnitude - largest
    return difference < -324n ? 0 : Number(`${mantissa}e${difference}`)
  })
  const total = scaled.reduce((sum, value) => sum + value, 0)
  if (!(total > 0) || !Number.isFinite(total)) return undefined
  return scaled.map((value) => value / total)
}

/** Keep a nonzero saved decimal distinguishable when ordinary two-place display rounds it to zero. */
function categoryValueText(
  s: Snapshot,
  locale: PresentationLocale,
  value: Cell,
  column: DatasetColumn,
): string {
  if (
    column.type === 'decimal' &&
    typeof value === 'string' &&
    Math.abs(Number(value)) < 0.005 &&
    compareDecimalText(value, '0') !== 0 &&
    !s.frameDisplay?.formats?.some((format) => format.value === column.id)
  )
    return value
  return displayFrameCell(s, locale, value, column)
}

/** A positive category can be too small for the approximate geometry, but is not zero. */
function categoryPercent(locale: PresentationLocale, share: number, exact: Cell): string {
  const nonzero = exact !== null && compareDecimalText(String(exact), '0') > 0
  if (nonzero && share < 0.001) {
    const bound = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(0.1)
    return `<${bound}%`
  }
  return percent(locale, share, false)
}

/** A complete categorical distribution, using saved cells without aggregating rows. */
export function PieChart({ snapshot: s, classification: c, view }: MainViewProps<'pie'>) {
  const t = useCopy()
  const [active, setActive] = useState<number | null>(null)
  const axis = axisOf(s, view.axis)
  if (!axis) return null
  const column = columnOf(s, view.value)?.column
  const rows = rowsOf(s).map((row) => ({
    row,
    label: memberLabel(s, axis, row),
    exact: cellOf(s, row, view.value),
  }))
  const shares = categoryShares(rows.map((item) => item.exact))
  if (!shares) return null
  let angle = -Math.PI / 2
  const entries = rows.map((item, index) => {
    const share = shares[index]!
    const start = angle
    angle += (share ?? 0) * 2 * Math.PI
    const text = `${item.label} · ${column ? categoryValueText(s, t.locale, item.exact, column) : '—'}`
    return { ...item, index, share, start, end: angle, text }
  })
  const point = (a: number) => `${150 + 92 * Math.cos(a)},${150 + 92 * Math.sin(a)}`
  return (
    <figure className="fv-chart" data-chart="pie">
      <div className="fv-pie-layout">
        <svg viewBox="0 0 300 300" aria-label={valueName(s, c, view.value)} className="fv-pie-svg">
          {entries.map((item) => {
            if (!item.share) return null
            const shape =
              item.share >= 1 - Number.EPSILON ? (
                <circle
                  cx={150}
                  cy={150}
                  r={92}
                  fill="none"
                  stroke={color(item.index)}
                  strokeWidth={active === item.row ? 64 : 56}
                />
              ) : (
                <path
                  d={`M${point(item.start)} A92,92 0 ${item.end - item.start > Math.PI ? 1 : 0} 1 ${point(item.end)}`}
                  fill="none"
                  stroke={color(item.index)}
                  strokeWidth={active === item.row ? 64 : 56}
                />
              )
            return (
              // biome-ignore lint/a11y/noStaticElementInteractions: Hover/focus changes presentation; DomainPointMark owns selection and keyboard semantics.
              <g
                key={item.row}
                data-pie-row={item.row}
                opacity={active === null || active === item.row ? 1 : 0.38}
                onMouseEnter={() => setActive(item.row)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(item.row)}
                onBlur={() => setActive(null)}
              >
                <DomainPointMark point={{ row: item.row, field: view.value, label: item.text }}>
                  <title>{item.text}</title>
                  {shape}
                </DomainPointMark>
              </g>
            )
          })}
        </svg>
        <ul className="fv-pie-legend">
          {entries.map((item) => (
            <li
              key={item.row}
              style={{
                display: 'grid',
                gridTemplateColumns: '10px 1fr auto',
                gap: '2px 10px',
                alignItems: 'center',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: '50%',
                  background: color(item.index),
                }}
              />
              <span>{item.label}</span>
              <b className="tabular-nums">{categoryPercent(t.locale, item.share, item.exact)}</b>
              <small style={{ gridColumn: '2 / -1', color: 'var(--muted-foreground)' }}>
                {column ? categoryValueText(s, t.locale, item.exact, column) : '—'}
              </small>
            </li>
          ))}
        </ul>
      </div>
    </figure>
  )
}

/** Explicit composition of saved category values; percentages use the shown rows as denominator. */
export function CategoricalComposition({
  snapshot: s,
  classification: c,
  view,
}: MainViewProps<'pie'>) {
  const t = useCopy()
  const selection = useFrameSelection()
  const axis = axisOf(s, view.axis)
  const column = columnOf(s, view.value)?.column
  if (
    !axis ||
    !column ||
    axis.variant.kind !== 'ordinary' ||
    s.frame.axes.length !== 1 ||
    !s.coverage.complete ||
    s.data.truncated ||
    groupRows(s, [axis]).length !== s.data.rows.length
  )
    return null
  const source = rowsOf(s).map((row) => ({
    row,
    exact: cellOf(s, row, view.value),
    label: memberLabel(s, axis, row),
  }))
  const sourceShares = categoryShares(source.map((item) => item.exact))
  if (!sourceShares) return null
  const entries = source.map((item, index) => ({ ...item, index, share: sourceShares[index]! }))
  entries.sort((a, b) => compareDecimalText(String(b.exact), String(a.exact)) || a.row - b.row)
  let offset = 0
  const shareLabel = t('marivo.presentation.ui-frame-calculated-share')
  return (
    <figure className="fv-share-composition" data-chart="category-composition">
      <svg
        className="fv-share-stack"
        viewBox="0 0 1000 20"
        preserveAspectRatio="none"
        aria-label={`${valueName(s, c, view.value)} · ${shareLabel}`}
      >
        {entries.map((item) => {
          const share = item.share
          const start = offset
          offset += share * 1000
          if (share === 0) return null
          const valueText = categoryValueText(s, t.locale, item.exact, column)
          const label = `${item.label} · ${valueName(s, c, view.value)}: ${valueText}`
          return (
            <DomainPointMark
              key={item.row}
              point={
                !c.broadcastValues.includes(view.value) && uniquelyBound(s, view.value)
                  ? { row: item.row, field: view.value, label }
                  : undefined
              }
            >
              <rect
                x={start}
                y={0}
                width={share * 1000}
                height={20}
                fill={color(item.index)}
                stroke="var(--background)"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              >
                <title>{label}</title>
              </rect>
            </DomainPointMark>
          )
        })}
      </svg>
      <ul className="fv-share-list">
        <li className="fv-share-row fv-share-header">
          <span aria-hidden="true" />
          <span />
          <span className="fv-share-values">
            <span>{valueName(s, c, view.value)}</span>
            <span>{shareLabel}</span>
          </span>
        </li>
        {entries.map((item) => {
          const share = item.share
          const valueText = categoryValueText(s, t.locale, item.exact, column)
          const label = `${item.label} · ${valueName(s, c, view.value)}: ${valueText}`
          return (
            <li className="fv-share-row" key={item.row}>
              <span
                className="fv-share-swatch"
                aria-hidden="true"
                style={{ background: color(item.index) }}
              />
              <span>{item.label}</span>
              <span className="fv-share-values tabular-nums">
                <span>
                  {selection &&
                  !c.broadcastValues.includes(view.value) &&
                  uniquelyBound(s, view.value) ? (
                    <button
                      type="button"
                      className="pr-cell-select"
                      data-frame-point={`${item.row}:${view.value}`}
                      aria-label={label}
                      onClick={() => selection.select(item.row, view.value)}
                    >
                      {valueText}
                    </button>
                  ) : (
                    valueText
                  )}
                </span>
                <span>{categoryPercent(t.locale, share, item.exact)}</span>
              </span>
            </li>
          )
        })}
      </ul>
    </figure>
  )
}
/** Saved coefficients on a fixed [-1, 1] domain; no fit or statistic is computed here. */
export function CorrelationPlot({
  snapshot: s,
  classification: c,
  view,
}: MainViewProps<'correlation'>) {
  const t = useCopy()
  const scaleId = `fv-correlation-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const rows = rowsOf(s)
  const labels = rows.map((row) => membersLabel(s, s.frame.axes, row))
  const formatted = (row: number, name: string) => {
    const column = columnOf(s, name)?.column
    return column ? displayFrameCell(s, t.locale, cellOf(s, row, name), column) : '—'
  }
  const tip = (row: number, name: string) =>
    `${labels[row] ?? ''} · ${valueName(s, c, name)}: ${formatted(row, name)}${view.counts[name] ? ` · n ${formatted(row, view.counts[name]!)}` : ''}`
  const label = summary(
    t,
    view.values.map((name) => valueName(s, c, name)).join(' · '),
    rows.map((row) => view.values.map((name) => tip(row, name)).join(' / ')),
  )
  // A single saved coefficient is clearer as a compact scale. Keep the general
  // multi-row/multi-series plot for all other shapes and out-of-range values.
  const single = s.frame.axes.length === 0 && rows.length === 1 && view.values.length === 1
  const singleName = view.values[0]
  const coefficient = singleName ? valueAt(s, 0, singleName) : null
  if (single && singleName && (coefficient === null || Math.abs(coefficient) <= 1)) {
    const marker = coefficient === null ? undefined : 12 + ((coefficient + 1) / 2) * 696
    const countName = view.counts[singleName]
    const count = countName ? cellOf(s, 0, countName) : null
    const validCount =
      (typeof count === 'string' && /^\d+$/.test(count)) ||
      (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0)
    const point =
      validCount && !c.broadcastValues.includes(singleName) && uniquelyBound(s, singleName)
        ? { row: 0, field: singleName, label: tip(0, singleName) }
        : undefined
    return (
      <figure className="fv-chart fv-correlation-scale" data-chart="correlation-scale">
        <svg
          viewBox="0 0 720 60"
          aria-label={label}
          style={{ display: 'block', width: '100%', height: 60 }}
        >
          <defs>
            <linearGradient id={scaleId} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="var(--border)" />
              <stop offset="50%" stopColor="var(--muted)" />
              <stop offset="100%" stopColor="var(--chart-1)" />
            </linearGradient>
          </defs>
          <rect x={12} y={15} width={696} height={8} rx={4} fill={`url(#${scaleId})`} />
          {marker !== undefined && (
            <DomainPointMark point={point}>
              <g>
                <title>{tip(0, singleName)}</title>
                <rect x={marker - 16} y={0} width={32} height={36} fill="transparent" />
                <rect
                  x={marker - 1.5}
                  y={9}
                  width={3}
                  height={20}
                  fill="var(--foreground)"
                  data-mark="filled"
                />
              </g>
            </DomainPointMark>
          )}
          <g fill="var(--muted-foreground)" fontSize={12}>
            <text x={12} y={48} textAnchor="start">
              −1
            </text>
            <text x={360} y={48} textAnchor="middle">
              0
            </text>
            <text x={708} y={48} textAnchor="end">
              +1
            </text>
          </g>
        </svg>
      </figure>
    )
  }
  return (
    <ChartFrame
      label={label}
      height={Math.max(160, rows.length * 28 + 48)}
      legend={
        <Legend
          items={view.values.map((name, index) => ({
            label: valueName(s, c, name),
            color: color(index),
            shape: 'dot',
          }))}
        />
      }
    >
      <ScatterChart
        aria-label={label}
        desc={label}
        margin={{ top: 12, right: 32, bottom: 8, left: 8 }}
        accessibilityLayer
      >
        <CartesianGrid horizontal={false} />
        <XAxis type="number" dataKey="x" domain={[-1, 1]} ticks={[-1, 0, 1]} />
        <YAxis
          type="number"
          dataKey="y"
          domain={[-0.5, Math.max(0.5, rows.length - 0.5)]}
          ticks={rows}
          tick={<MemberTick labels={labels} />}
          reversed
          width={140}
          interval={0}
        />
        <ReferenceLine x={0} stroke="var(--border)" />
        <ExactTooltip textAt={(row) => view.values.map((name) => tip(row, name)).join('\n')} />
        {view.values.map((name, vi) => (
          <Scatter
            key={name}
            name={valueName(s, c, name)}
            data={rows.flatMap((index) => {
              const value = valueAt(s, index, name)
              return value === null ? [] : [{ index, x: value, y: index }]
            })}
            isAnimationActive={false}
            shape={(input) => {
              const p = coordinates(input)
              const row = p?.payload?.index
              if (!p || typeof row !== 'number') return <g />
              return (
                <DomainPointMark point={{ row, field: name, label: tip(row, name) }}>
                  <g>
                    <circle cx={p.cx} cy={p.cy} r={4} fill={color(vi)} data-mark="filled" />
                  </g>
                </DomainPointMark>
              )
            }}
          />
        ))}
      </ScatterChart>
    </ChartFrame>
  )
}
/** Saved shares use a track from 0 to 100%; values outside that range remain visible. */
export function ShareTrack({
  snapshot: s,
  classification: c,
  values,
  rows = rowsOf(s),
  labelOf,
}: Omit<MainViewProps<'share'>, 'view'> & {
  values: string[]
  rows?: number[]
  labelOf?: (row: number) => string
}) {
  const t = useCopy()
  const labels = rows.map((row) => labelOf?.(row) ?? '')
  const text = (index: number, name: string) =>
    `${labels[index] ?? ''} · ${valueName(s, c, name)}: ${percent(t.locale, valueAt(s, rows[index]!, name), false, cellOf(s, rows[index]!, name))}`
  const series = values.map((name) => ({
    key: name,
    label: valueName(s, c, name),
    values: rows.map((row) => valueAt(s, row, name)),
    exact: (index: number) => text(index, name),
    point: (index: number) => ({
      row: rows[index]!,
      field: name,
      label: text(index, name),
    }),
  }))
  const domain = numericDomain([0, 1, ...series.flatMap((line) => line.values)])
  return (
    <SavedRowPlot
      label={summary(
        t,
        values.map((name) => valueName(s, c, name)).join(' · '),
        rows.map(
          (row, index) =>
            `${labels[index]} ${values.map((name) => percent(t.locale, valueAt(s, row, name), false, cellOf(s, row, name))).join(' / ')}`,
        ),
      )}
      labels={labels}
      series={series}
      bars
      domain={domain}
      reference={1}
      tickFormatter={(value) => percent(t.locale, value, false)}
      endLabels={rows.map((row) =>
        values
          .map((name) => percent(t.locale, valueAt(s, row, name), false, cellOf(s, row, name)))
          .join(' · '),
      )}
    />
  )
}

/** A whole can be shown only when the saved share describes this complete axis. */
function compositionOf({ snapshot: s, classification: c, view }: MainViewProps<'share'>) {
  const axis = axisOf(s, view.axis)
  const name = view.values[0]
  if (
    !axis ||
    !name ||
    view.values.length !== 1 ||
    s.frame.axes.length !== 1 ||
    c.categoryAxes.length !== 1 ||
    c.categoryAxes[0] !== axis.token ||
    axis.variant.kind !== 'ordinary' ||
    !s.coverage.complete ||
    s.data.truncated ||
    !s.data.rows.length ||
    s.data.rows.length > 8
  )
    return undefined
  const context = interpretationOf(s)?.valueContexts[name]
  if (
    context?.kind !== 'share' ||
    context.rowScope !== 'complete' ||
    context.groups.length !== 0 ||
    context.along.length !== 1 ||
    context.along[0]?.kind !== 'axis' ||
    context.along[0].axisToken !== axis.token ||
    groupRows(s, [axis]).length !== s.data.rows.length
  )
    return undefined
  const sourceRows = rowsOf(s)
  const sourceValues = sourceRows.map((row) => valueAt(s, row, name))
  if (
    sourceValues.some(
      (value, index) =>
        value === null ||
        value < 0 ||
        (value === 0 && compareDecimalText(String(cellOf(s, sourceRows[index]!, name)), '0') < 0),
    )
  )
    return undefined
  // Sort using the saved scalar, not the float approximation used for geometry.
  // Keep the original row in each entry for point selection and stable ties.
  const entries = sourceRows
    .map((row, index) => ({ row, value: sourceValues[index] }))
    .sort((a, b) => {
      const av = cellOf(s, a.row, name)
      const bv = cellOf(s, b.row, name)
      return av === null || bv === null
        ? a.row - b.row
        : compareDecimalText(String(bv), String(av)) || a.row - b.row
    })
  const rows = entries.map((entry) => entry.row)
  const values = entries.map((entry) => entry.value)
  const total = values.reduce<number>((sum, value) => sum + (value ?? 0), 0)
  // Floating-point shares can differ slightly from one, but an incomplete or
  // restricted decomposition must never be presented as a whole.
  if (!Number.isFinite(total) || Math.abs(total - 1) > 1e-9) return undefined
  const numeratorName = context.numerator.kind === 'named' ? context.numerator.name : undefined
  const numerator =
    numeratorName &&
    columnOf(s, numeratorName) &&
    s.frame.fields.some((field) => field.id === numeratorName && field.role === 'value')
      ? numeratorName
      : undefined
  return { axis, name, rows, values, total, numerator }
}

function ShareComposition({
  snapshot: s,
  classification: c,
  composition,
}: MainViewProps<'share'> & { composition: NonNullable<ReturnType<typeof compositionOf>> }) {
  const t = useCopy()
  const selection = useFrameSelection()
  const { axis, name, rows, values, total } = composition
  const numerator =
    composition.numerator && !c.broadcastValues.includes(composition.numerator)
      ? composition.numerator
      : undefined
  const numeratorColumn = numerator ? columnOf(s, numerator)?.column : undefined
  const describe = (row: number, value: number | null) =>
    `${memberLabel(s, axis, row)} · ${valueName(s, c, name)}: ${percent(t.locale, value, false, cellOf(s, row, name))}`
  let offset = 0
  return (
    <figure className="fv-share-composition" data-chart="share-composition">
      <svg
        className="fv-share-stack"
        viewBox={`0 0 ${total * 1000} 20`}
        preserveAspectRatio="none"
        aria-label={valueName(s, c, name)}
      >
        {rows.map((row, index) => {
          const value = values[index] ?? 0
          const start = offset
          offset += value * 1000
          if (value === 0) return null
          return (
            <DomainPointMark
              key={row}
              point={
                !c.broadcastValues.includes(name) && uniquelyBound(s, name)
                  ? { row, field: name, label: describe(row, value) }
                  : undefined
              }
            >
              <rect
                x={start}
                y={0}
                width={value * 1000}
                height={20}
                fill={color(index)}
                stroke="var(--background)"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              >
                <title>{describe(row, value)}</title>
              </rect>
            </DomainPointMark>
          )
        })}
      </svg>
      <ul className="fv-share-list">
        <li className="fv-share-row fv-share-header">
          <span aria-hidden="true" />
          <span />
          <span className="fv-share-values">
            {numerator && <span>{valueName(s, c, numerator)}</span>}
            <span>{valueName(s, c, name)}</span>
          </span>
        </li>
        {rows.map((row, index) => {
          const value = values[index] ?? null
          const label = memberLabel(s, axis, row)
          const numeratorValue = numerator ? cellOf(s, row, numerator) : null
          const numeratorText = numeratorColumn
            ? displayFrameCell(s, t.locale, numeratorValue, numeratorColumn)
            : undefined
          const select = (
            field: string,
            text: string,
            accessibleLabel: string,
            available: boolean,
          ) =>
            selection &&
            available &&
            !c.broadcastValues.includes(field) &&
            uniquelyBound(s, field) ? (
              <button
                type="button"
                className="pr-cell-select"
                data-frame-point={`${row}:${field}`}
                aria-label={accessibleLabel}
                onClick={() => selection.select(row, field)}
              >
                {text}
              </button>
            ) : (
              text
            )
          return (
            <li className="fv-share-row" key={row}>
              <span
                className="fv-share-swatch"
                aria-hidden="true"
                style={{ background: color(index) }}
              />
              <span>{label}</span>
              <span className="fv-share-values tabular-nums">
                {numerator && numeratorText !== undefined && (
                  <span>
                    {select(
                      numerator,
                      numeratorText,
                      `${label} · ${valueName(s, c, numerator)}: ${numeratorText}`,
                      numeratorValue !== null,
                    )}
                  </span>
                )}
                <span>
                  {select(
                    name,
                    percent(t.locale, value, false, cellOf(s, row, name)),
                    describe(row, value),
                    value !== null,
                  )}
                </span>
              </span>
            </li>
          )
        })}
      </ul>
    </figure>
  )
}

export function ShareView(props: MainViewProps<'share'>) {
  const t = useCopy()
  const s = props.snapshot
  const axis = axisOf(s, props.view.axis)
  const axes = axis ? [axis] : s.frame.axes
  const time = axisOf(s, props.classification.timeAxis)
  const composition = compositionOf(props)
  if (composition) return <ShareComposition {...props} composition={composition} />
  if (time && axis) {
    // One track per period; each period's shares are normalized along the category.
    const { ticks, tickOf } = timeTicks(t, s, time)
    return (
      <div className="fv-parents">
        {groupRows(s, [time]).map((g) => (
          <section key={g.key} className="fv-parent" data-parent={ticks[tickOf(g.rows[0]!)]?.label}>
            <h4>{ticks[tickOf(g.rows[0]!)]?.label ?? g.label}</h4>
            <ShareTrack
              {...props}
              values={props.view.values}
              rows={g.rows}
              labelOf={(row) => memberLabel(s, axis, row)}
            />
          </section>
        ))}
      </div>
    )
  }
  return (
    <ShareTrack
      {...props}
      values={props.view.values}
      labelOf={axes.length ? (row) => membersLabel(props.snapshot, axes, row) : undefined}
    />
  )
}
