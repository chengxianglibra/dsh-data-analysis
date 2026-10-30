import { useState } from 'react'
import type { FrameComparison } from '../../../presentation/contracts/snapshot.ts'
import { useCopy } from '../../i18n/context.tsx'
import type { Translator } from '../../i18n/copy.ts'
import {
  axisOf,
  cellOf,
  columnOf,
  compact,
  endpointLabels,
  exact,
  groupRows,
  interpretationOf,
  membersLabel,
  percent,
  rowsOf,
  type Snapshot,
  signed,
  timeTicks,
  valueAt,
  valueName,
} from './model.ts'
import {
  Bar,
  ChartFrame,
  color,
  Dot,
  extent,
  LABEL_W,
  Legend,
  linear,
  linePath,
  type MainViewProps,
  NEUTRAL,
  summary,
  truncate,
  W,
  XTicks,
} from './svg.tsx'
import { DataTable } from './table.tsx'

type Group = FrameComparison['groups'][number]
export interface ComparisonRoles {
  comparison: FrameComparison
  group: Group
  current?: string
  baseline?: string
  absolute?: string
  relative?: string
}
export function comparisonRoles(
  s: Snapshot,
  index: number,
  groupName: string,
): ComparisonRoles | undefined {
  const comparison = interpretationOf(s)?.comparisons[index]
  const group = comparison?.groups.find((g) => g.name === groupName)
  if (!comparison || !group) return undefined
  const role = (r: Group['values'][number]['role']) => group.values.find((v) => v.role === r)?.name
  return {
    comparison,
    group,
    current: role('current'),
    baseline: role('baseline'),
    absolute: role('absolute'),
    relative: role('relative'),
  }
}
/** `false` only when the saved presence column says that side is absent. */
function present(s: Snapshot, row: number, name: string | undefined): boolean {
  return !name || cellOf(s, row, name) !== false
}

/** Header numbers: current, baseline, Δ, Δ% from one saved row; absent roles are omitted. */
export function ComparisonNumbers({
  snapshot: s,
  roles,
  index,
  row = 0,
}: {
  snapshot: Snapshot
  roles: ComparisonRoles
  index: number
  row?: number
}) {
  const t = useCopy()
  const ends = endpointLabels(t, s, index)
  const presence = roles.comparison.presence
  const items: { key: string; value: string; title: string; label?: string }[] = []
  const add = (name: string | undefined, label: string | undefined, kind: 'v' | 'd' | 'p') => {
    if (!name) return
    const column = columnOf(s, name)?.column
    const value = cellOf(s, row, name)
    items.push({
      key: name,
      value:
        kind === 'p'
          ? percent(t.locale, valueAt(s, row, name), true)
          : kind === 'd'
            ? signed(t.locale, value, column)
            : compact(t.locale, value, column),
      title: `${valueName(s, undefined, name)}: ${exact(value, column)}`,
      label,
    })
  }
  if (present(s, row, presence?.current)) add(roles.current, ends.current, 'v')
  if (present(s, row, presence?.baseline)) add(roles.baseline, ends.baseline, 'v')
  add(roles.absolute, undefined, 'd')
  add(roles.relative, undefined, 'p')
  return <Numbers items={items} />
}
export function Numbers({
  items,
}: {
  items: { key: string; value: string; title: string; label?: string }[]
}) {
  if (items.length === 0) return null
  return (
    <dl className="fv-numbers">
      {items.map((item) => (
        <div key={item.key} data-number={item.key}>
          <dd title={item.title}>{item.value}</dd>
          <dt>{item.label ?? ' '}</dt>
        </div>
      ))}
    </dl>
  )
}

/** Comparisons sharing this group's current value: the alias segmented control. */
export function siblingComparisons(s: Snapshot, roles: ComparisonRoles): number[] {
  const comparisons = interpretationOf(s)?.comparisons ?? []
  return comparisons.flatMap((c, i) =>
    c.groups.some((g) => g.values.some((v) => v.role === 'current' && v.name === roles.current))
      ? [i]
      : [],
  )
}
function groupFor(s: Snapshot, index: number, current: string | undefined, fallback: string) {
  const comparison = interpretationOf(s)?.comparisons[index]
  return (
    comparison?.groups.find((g) => g.values.some((v) => v.role === 'current' && v.name === current))
      ?.name ?? fallback
  )
}

/**
 * Comparison block: alias control, header numbers for a single saved row, then
 * the main view. `body: false` keeps only the numbers (compact density).
 */
export function ComparisonView(
  props: MainViewProps<'comparison'> & { numbers?: boolean; body?: boolean; control?: boolean },
) {
  const { snapshot: s, view, numbers = false, body = true, control = true } = props
  const t = useCopy()
  const initial = comparisonRoles(s, view.comparison, view.group)
  const siblings = initial ? siblingComparisons(s, initial) : []
  const [selected, setSelected] = useState(view.comparison)
  const index = siblings.includes(selected) ? selected : view.comparison
  const roles =
    comparisonRoles(s, index, groupFor(s, index, initial?.current, view.group)) ?? initial
  if (!roles) return null
  return (
    <div className="fv-comparison">
      {control && siblings.length > 1 && (
        <AliasControl t={t} s={s} items={siblings} active={index} onSelect={setSelected} />
      )}
      {numbers && <ComparisonNumbers snapshot={s} roles={roles} index={index} />}
      {body && <ComparisonBody {...props} roles={roles} index={index} />}
    </div>
  )
}
function AliasControl({
  t,
  s,
  items,
  active,
  onSelect,
}: {
  t: Translator
  s: Snapshot
  items: number[]
  active: number
  onSelect: (i: number) => void
}) {
  return (
    <fieldset className="fv-segments" aria-label={t('marivo.presentation.ui-frame-alias')}>
      {items.map((i) => {
        const ends = endpointLabels(t, s, i)
        return (
          <button type="button" key={i} aria-pressed={i === active} onClick={() => onSelect(i)}>
            {ends.baseline}
          </button>
        )
      })}
    </fieldset>
  )
}

function ComparisonBody({
  snapshot: s,
  classification: c,
  view,
  height,
  roles,
  index,
}: MainViewProps<'comparison'> & { roles: ComparisonRoles; index: number }) {
  switch (view.style) {
    case 'numbers':
      return null
    case 'line':
      return (
        <CompareLine
          s={s}
          roles={roles}
          index={index}
          axis={c.timeAxis}
          rows={rowsOf(s)}
          height={height}
        />
      )
    case 'dumbbell':
    case 'delta':
      return (
        <CompareRows
          s={s}
          roles={roles}
          index={index}
          axes={c.categoryAxes}
          delta={view.style === 'delta'}
        />
      )
    case 'small-multiples': {
      const category = c.categoryAxes
        .map((token) => axisOf(s, token))
        .filter((a) => a !== undefined)
      return (
        <div className="fv-multiples">
          {groupRows(s, category).map((g) => (
            <section key={g.key} data-multiple={g.label}>
              <h4>{g.label}</h4>
              <CompareLine
                s={s}
                roles={roles}
                index={index}
                axis={c.timeAxis}
                rows={g.rows}
                height={160}
                compact
              />
            </section>
          ))}
        </div>
      )
    }
    default: {
      const names = [
        ...s.frame.layout.filter((l) => l.kind === 'coordinate').map((l) => l.name),
        ...[roles.current, roles.baseline, roles.absolute, roles.relative].filter(
          (n): n is string => !!n,
        ),
      ]
      return <DataTable snapshot={s} columns={names} />
    }
  }
}

/** Current solid line, same-hue dashed baseline at current positions, Δ strip below. */
function CompareLine({
  s,
  roles,
  index,
  axis: token,
  rows,
  height = 260,
  compact: small,
}: {
  s: Snapshot
  roles: ComparisonRoles
  index: number
  axis?: string
  rows: number[]
  height?: number
  compact?: boolean
}) {
  const t = useCopy()
  const binding = roles.comparison.binding
  const axis = axisOf(s, token ?? (binding.kind !== 'ordinary' ? binding.axisToken : undefined))
  if (!axis) return null
  const { ticks, tickOf } = timeTicks(t, s, axis)
  const byTick = new Map(rows.map((row) => [tickOf(row), row]))
  const presence = roles.comparison.presence
  const ends = endpointLabels(t, s, index)
  const series = (name: string | undefined, side: string | undefined) =>
    ticks.map((_, i) => {
      const row = byTick.get(i)
      return row === undefined || !name || !present(s, row, side) ? null : valueAt(s, row, name)
    })
  const current = series(roles.current, presence?.current)
  const baseline = series(roles.baseline, presence?.baseline)
  const delta = series(roles.absolute, undefined)
  const strip = roles.absolute ? (small ? 36 : 52) : 0
  const plotBottom = height - strip - 26
  const top = 12
  const left = 8
  const right = W - (small ? 16 : 70)
  const band = (right - left) / Math.max(ticks.length, 1)
  const x = (i: number) => left + band * (i + 0.5)
  const y = linear(extent([...current, ...baseline]), [plotBottom, top])
  const dDomain = extent(delta, true)
  const stripTop = plotBottom + 24
  const dy = linear(dDomain, [stripTop + strip - 6, stripTop])
  const points = (values: (number | null)[]) =>
    values.map((v, i) => (v === null ? null : { x: x(i), y: y(v) }))
  const col = (name?: string) => (name ? columnOf(s, name)?.column : undefined)
  const tip = (i: number) => {
    const row = byTick.get(i)
    if (row === undefined) return ticks[i]!.title
    return [
      ticks[i]!.title,
      ...[roles.current, roles.baseline, roles.absolute, roles.relative]
        .filter((n): n is string => !!n)
        .map((n) => `${valueName(s, undefined, n)}: ${exact(cellOf(s, row, n), col(n))}`),
    ].join('\n')
  }
  const label = summary(
    t,
    `${ends.current} · ${ends.baseline}`,
    ticks.map((tick, i) => {
      const row = byTick.get(i)
      const v = (n?: string) =>
        row === undefined || !n ? '—' : compact(t.locale, cellOf(s, row, n), col(n))
      return `${tick.label} ${v(roles.current)} / ${v(roles.baseline)}`
    }),
  )
  return (
    <ChartFrame
      label={label}
      height={height}
      legend={
        small ? undefined : (
          <Legend
            items={[
              { label: ends.current, color: color(0), shape: 'line' },
              { label: ends.baseline, color: color(0), shape: 'dashed' },
            ]}
          />
        )
      }
    >
      {() => (
        <>
          <line x1={left} x2={right} y1={plotBottom} y2={plotBottom} className="fv-axis" />
          <XTicks ticks={ticks} x={x} y={plotBottom} />
          <path
            d={linePath(points(baseline))}
            className="fv-line"
            data-dashed=""
            style={{ stroke: color(0) }}
          />
          <path d={linePath(points(current))} className="fv-line" style={{ stroke: color(0) }} />
          {ticks.map((tick, i) => (
            <g key={tick.key}>
              {baseline[i] !== null && baseline[i] !== undefined && (
                <Dot
                  x={x(i)}
                  y={y(baseline[i]!)}
                  fill={color(0)}
                  hollow
                  size={2.5}
                  title={tip(i)}
                />
              )}
              {current[i] !== null && current[i] !== undefined && (
                <Dot
                  x={x(i)}
                  y={y(current[i]!)}
                  fill={color(0)}
                  hollow={tick.incomplete}
                  size={3}
                  title={tip(i)}
                />
              )}
            </g>
          ))}
          {roles.absolute && (
            <g data-strip="delta">
              <line x1={left} x2={right} y1={dy(0)} y2={dy(0)} className="fv-axis" />
              {delta.map((v, i) =>
                v === null ? null : (
                  <Bar
                    // biome-ignore lint/suspicious/noArrayIndexKey: Tick position is the identity.
                    key={i}
                    at={x(i) - Math.min(band * 0.3, 6)}
                    breadth={Math.max(Math.min(band * 0.6, 12), 1)}
                    from={dy(0)}
                    to={dy(v)}
                    fill={NEUTRAL}
                    title={tip(i)}
                  />
                ),
              )}
            </g>
          )}
        </>
      )}
    </ChartFrame>
  )
}

/** Dumbbell (hollow baseline → filled current, Δ% at row end) or the Δ diverging bar. */
function CompareRows({
  s,
  roles,
  index,
  axes: tokens,
  delta,
}: {
  s: Snapshot
  roles: ComparisonRoles
  index: number
  axes: string[]
  delta: boolean
}) {
  const t = useCopy()
  const axes = tokens.map((token) => axisOf(s, token)).filter((a) => a !== undefined)
  const rows = rowsOf(s)
  const presence = roles.comparison.presence
  const ends = endpointLabels(t, s, index)
  const rowH = 24
  const top = 4
  const height = top + rows.length * rowH + 4
  const endW = 96
  const col = (name?: string) => (name ? columnOf(s, name)?.column : undefined)
  const get = (row: number, name?: string, side?: string) =>
    name && present(s, row, side) ? valueAt(s, row, name) : null
  const values = delta
    ? rows.map((row) => get(row, roles.absolute))
    : rows.flatMap((row) => [
        get(row, roles.current, presence?.current),
        get(row, roles.baseline, presence?.baseline),
      ])
  const x = linear(extent(values, delta), [LABEL_W, W - endW])
  const endText = (row: number) =>
    roles.relative
      ? percent(t.locale, valueAt(s, row, roles.relative), true)
      : signed(
          t.locale,
          roles.absolute ? cellOf(s, row, roles.absolute) : null,
          col(roles.absolute),
        )
  const tip = (row: number) =>
    [membersLabel(s, axes, row)]
      .concat(
        [roles.current, roles.baseline, roles.absolute, roles.relative]
          .filter((n): n is string => !!n)
          .map((n) => `${valueName(s, undefined, n)}: ${exact(cellOf(s, row, n), col(n))}`),
      )
      .join('\n')
  const label = summary(
    t,
    `${ends.current} · ${ends.baseline}`,
    rows.map((row) => `${membersLabel(s, axes, row)} ${endText(row)}`),
  )
  return (
    <ChartFrame
      label={label}
      height={height}
      legend={
        delta ? undefined : (
          <Legend
            items={[
              { label: ends.baseline, color: color(0), shape: 'hollow' },
              { label: ends.current, color: color(0), shape: 'dot' },
            ]}
          />
        )
      }
    >
      {() => (
        <>
          {delta && <line x1={x(0)} x2={x(0)} y1={top} y2={height - 4} className="fv-axis" />}
          {rows.map((row, ri) => {
            const cy = top + ri * rowH + rowH / 2
            const member = membersLabel(s, axes, row)
            const cur = get(row, roles.current, presence?.current)
            const base = get(row, roles.baseline, presence?.baseline)
            const d = get(row, roles.absolute)
            return (
              <g key={row} data-row={member}>
                <title>{tip(row)}</title>
                <text x={LABEL_W - 8} y={cy + 4} textAnchor="end">
                  {truncate(member)}
                </text>
                {delta ? (
                  d !== null && (
                    <Bar horizontal at={cy - 7} breadth={14} from={x(0)} to={x(d)} fill={NEUTRAL} />
                  )
                ) : (
                  <>
                    {cur !== null && base !== null && (
                      <line x1={x(base)} x2={x(cur)} y1={cy} y2={cy} className="fv-stem" />
                    )}
                    {base !== null && <Dot x={x(base)} y={cy} fill={color(0)} hollow size={4.5} />}
                    {cur !== null && <Dot x={x(cur)} y={cy} fill={color(0)} size={4.5} />}
                  </>
                )}
                <text x={W - endW + 10} y={cy + 4} className="fv-strong">
                  {delta && roles.relative
                    ? `${signed(t.locale, roles.absolute ? cellOf(s, row, roles.absolute) : null, col(roles.absolute))}  ${endText(row)}`
                    : endText(row)}
                </text>
              </g>
            )
          })}
        </>
      )}
    </ChartFrame>
  )
}
