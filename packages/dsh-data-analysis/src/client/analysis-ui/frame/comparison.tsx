import { useEffect, useId, useRef, useState } from 'react'
import type { FrameClassification } from '../../../presentation/contracts/frame-view.ts'
import type { FrameComparison } from '../../../presentation/contracts/snapshot.ts'
import { useCopy } from '../../i18n/context.tsx'
import type { Translator } from '../../i18n/copy.ts'
import {
  type DomainPoint,
  DomainPointList,
  DomainPointMark,
  uniquelyBound,
} from './domain-point-selection.tsx'
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
  dotsOverlap,
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

/** Enclosing flags describe outer operations; only this comparison's endpoint flags gate its changes. */
function bothPresent(s: Snapshot, row: number, roles: ComparisonRoles): boolean {
  const presence = roles.comparison.presence
  return present(s, row, presence?.current) && present(s, row, presence?.baseline)
}

function point(
  s: Snapshot,
  row: number | undefined,
  name: string | undefined,
  required: (string | undefined)[],
  label: string,
): DomainPoint | undefined {
  if (row === undefined || !name || !uniquelyBound(s, name) || cellOf(s, row, name) === null)
    return undefined
  if (required.some((field) => field && cellOf(s, row, field) !== true)) return undefined
  return {
    row,
    field: name,
    label: `${label} · ${valueName(s, undefined, name)}: ${exact(cellOf(s, row, name), columnOf(s, name)?.column)}`,
  }
}

function visibleCell(s: Snapshot, row: number, roles: ComparisonRoles, name: string) {
  const presence = roles.comparison.presence
  if (name === roles.current && !present(s, row, presence?.current)) return null
  if (name === roles.baseline && !present(s, row, presence?.baseline)) return null
  if ((name === roles.absolute || name === roles.relative) && !bothPresent(s, row, roles))
    return null
  return cellOf(s, row, name)
}

export interface ComparisonTableSection {
  /** Index into interpretation.comparisons. */
  index: number
  rows: ComparisonRoles[]
}
/**
 * One row per comparison group with a current data column, in Frame order.
 * Groups sharing a current value collapse; multiple comparisons keep their endpoint pair.
 */
export function comparisonTableSections(s: Snapshot): ComparisonTableSection[] {
  const comparisons = interpretationOf(s)?.comparisons ?? []
  return comparisons.map((comparison, index) => {
    const rows: ComparisonRoles[] = []
    for (const group of comparison.groups) {
      const roles = comparisonRoles(s, index, group.name)
      if (!roles?.current || !columnOf(s, roles.current)) continue
      if (rows.some((row) => row.current === roles.current)) continue
      rows.push(roles)
    }
    return { index, rows }
  })
}

/** Transposed comparison table: one row per group, reading only the single saved row. */
export function ComparisonTable({
  snapshot: s,
  classification: c,
}: {
  snapshot: Snapshot
  classification: FrameClassification
}) {
  const t = useCopy()
  const [showExact, setShowExact] = useState(false)
  const [scrollable, setScrollable] = useState(false)
  const scrollRef = useRef<HTMLElement>(null)
  const hintId = useId()
  useEffect(() => {
    const region = scrollRef.current
    if (!region) return
    const update = () => setScrollable(region.scrollWidth > region.clientWidth + 1)
    const observer = new ResizeObserver(update)
    observer.observe(region)
    const table = region.querySelector('table')
    if (table) observer.observe(table)
    update()
    return () => observer.disconnect()
  }, [])
  const sections = comparisonTableSections(s).filter((section) => section.rows.length > 0)
  const head = sections[0]
  const ends = endpointLabels(t, s, head?.index ?? 0)
  const row = 0
  const side = (name: string | undefined, presence: string | undefined) => {
    if (!name) return <td className="pr-numeric">—</td>
    const column = columnOf(s, name)?.column
    const value = cellOf(s, row, name)
    if (!present(s, row, presence)) return <td className="pr-numeric">—</td>
    return (
      <td className="pr-numeric" title={value === null ? undefined : exact(value, column)}>
        {showExact ? exact(value, column) : compact(t.locale, value, column)}
      </td>
    )
  }
  const change = (roles: ComparisonRoles, kind: 'delta' | 'percent') => {
    const name = kind === 'delta' ? roles.absolute : roles.relative
    const column = name ? columnOf(s, name)?.column : undefined
    const value = name ? visibleCell(s, row, roles, name) : null
    const text =
      kind === 'delta'
        ? signed(t.locale, value, column)
        : percent(t.locale, name && bothPresent(s, row, roles) ? valueAt(s, row, name) : null, true)
    return (
      <td className="pr-numeric" title={value === null ? undefined : exact(value, column)}>
        {showExact && value !== null
          ? kind === 'percent'
            ? `${text} (${exact(value, column)} × 100)`
            : exact(value, column)
          : text}
      </td>
    )
  }
  const dataRows = (rows: ComparisonRoles[]) =>
    rows.map((roles) => (
      <tr key={roles.current}>
        <th scope="row">{valueName(s, c, roles.current!)}</th>
        {side(roles.current, roles.comparison.presence?.current)}
        {side(roles.baseline, roles.comparison.presence?.baseline)}
        {change(roles, 'delta')}
        {change(roles, 'percent')}
      </tr>
    ))
  return (
    <>
      <div className="fv-table-bar fv-comparison-toolbar">
        {scrollable && (
          <span
            id={hintId}
            className="fv-scroll-hint"
            title={t('marivo.presentation.ui-frame-scroll-hint')}
          >
            <span className="fv-sr-only">{t('marivo.presentation.ui-frame-scroll-hint')}</span>
          </span>
        )}
        <button
          type="button"
          aria-pressed={showExact}
          onClick={() => setShowExact((value) => !value)}
        >
          {t('marivo.presentation.ui-frame-exact-values')}
        </button>
      </div>
      <section
        ref={scrollRef}
        className="pr-table fv-comparison-table"
        data-table-layout="comparison"
        aria-label={t('marivo.presentation.ui-frame-comparison-table')}
        aria-describedby={scrollable ? hintId : undefined}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll the overflow region.
        tabIndex={0}
      >
        <table aria-label={t('marivo.presentation.ui-frame-comparison-table')}>
          <thead>
            <tr>
              <th scope="col">{t('marivo.presentation.ui-frame-comparison-metric')}</th>
              <th scope="col">{ends.current}</th>
              <th scope="col">{ends.baseline}</th>
              <th scope="col">{t('marivo.presentation.ui-frame-comparison-delta')}</th>
              <th scope="col">{t('marivo.presentation.ui-frame-comparison-delta-percent')}</th>
            </tr>
          </thead>
          {sections.length > 1 ? (
            sections.map((section) => {
              const sectionEnds = endpointLabels(t, s, section.index)
              return (
                <tbody key={section.index}>
                  <tr className="fv-comparison-section">
                    <th scope="rowgroup" colSpan={5}>
                      {`${sectionEnds.current} ⇄ ${sectionEnds.baseline}`}
                    </th>
                  </tr>
                  {dataRows(section.rows)}
                </tbody>
              )
            })
          ) : (
            <tbody>{dataRows(sections[0]?.rows ?? [])}</tbody>
          )}
        </table>
      </section>
    </>
  )
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
    const value = visibleCell(s, row, roles, name)
    items.push({
      key: name,
      value:
        kind === 'p'
          ? percent(t.locale, bothPresent(s, row, roles) ? valueAt(s, row, name) : null, true)
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
  const counts = new Map<number, number>()
  for (const row of rows) counts.set(tickOf(row), (counts.get(tickOf(row)) ?? 0) + 1)
  const selectionAt = (
    i: number,
    field: string | undefined,
    side: 'current' | 'baseline' | 'delta',
  ) => {
    if ((counts.get(i) ?? 0) !== 1) return undefined
    const requirements = [
      ...(presence?.enclosing ?? []),
      ...(side !== 'baseline' ? [presence?.current] : []),
      ...(side !== 'current' ? [presence?.baseline] : []),
    ]
    return point(s, byTick.get(i), field, requirements, ticks[i]?.label ?? '')
  }
  const series = (name: string | undefined, side: string | undefined) =>
    ticks.map((_, i) => {
      const row = byTick.get(i)
      return row === undefined || !name || !present(s, row, side) ? null : valueAt(s, row, name)
    })
  const current = series(roles.current, presence?.current)
  const baseline = series(roles.baseline, presence?.baseline)
  const delta = ticks.map((_, i) => {
    const row = byTick.get(i)
    return row === undefined || !roles.absolute || !bothPresent(s, row, roles)
      ? null
      : valueAt(s, row, roles.absolute)
  })
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
        .map(
          (n) => `${valueName(s, undefined, n)}: ${exact(visibleCell(s, row, roles, n), col(n))}`,
        ),
    ].join('\n')
  }
  const label = summary(
    t,
    `${ends.current} · ${ends.baseline}`,
    ticks.map((tick, i) => {
      const row = byTick.get(i)
      const v = (n?: string) =>
        row === undefined || !n ? '—' : compact(t.locale, visibleCell(s, row, roles, n), col(n))
      return `${tick.label} ${v(roles.current)} / ${v(roles.baseline)}`
    }),
  )
  const selections = ticks
    .flatMap((_, i) => [
      selectionAt(i, roles.current, 'current'),
      selectionAt(i, roles.baseline, 'baseline'),
      selectionAt(i, roles.absolute, 'delta'),
    ])
    .filter((item): item is DomainPoint => item !== undefined)
  return (
    <>
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
                  <DomainPointMark point={selectionAt(i, roles.baseline, 'baseline')}>
                    <Dot
                      x={x(i)}
                      y={y(baseline[i]!)}
                      fill={color(0)}
                      hollow
                      size={
                        current[i] !== null &&
                        current[i] !== undefined &&
                        dotsOverlap(y(baseline[i]!), y(current[i]!))
                          ? 6.5
                          : 2.5
                      }
                      title={tip(i)}
                    />
                  </DomainPointMark>
                )}
                {current[i] !== null && current[i] !== undefined && (
                  <DomainPointMark point={selectionAt(i, roles.current, 'current')}>
                    <Dot
                      x={x(i)}
                      y={y(current[i]!)}
                      fill={color(0)}
                      hollow={tick.incomplete}
                      size={3}
                      title={tip(i)}
                    />
                  </DomainPointMark>
                )}
              </g>
            ))}
            {roles.absolute && (
              <g data-strip="delta">
                <line x1={left} x2={right} y1={dy(0)} y2={dy(0)} className="fv-axis" />
                {delta.map((v, i) =>
                  v === null ? null : (
                    <DomainPointMark
                      key={ticks[i]!.key}
                      point={selectionAt(i, roles.absolute, 'delta')}
                    >
                      <Bar
                        at={x(i) - Math.min(band * 0.3, 6)}
                        breadth={Math.max(Math.min(band * 0.6, 12), 1)}
                        from={dy(0)}
                        to={dy(v)}
                        fill={NEUTRAL}
                        title={tip(i)}
                      />
                    </DomainPointMark>
                  ),
                )}
              </g>
            )}
          </>
        )}
      </ChartFrame>
      <DomainPointList points={selections} />
    </>
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
  const selectionAt = (
    row: number,
    field: string | undefined,
    side: 'current' | 'baseline' | 'delta',
  ) =>
    point(
      s,
      row,
      field,
      [
        ...(presence?.enclosing ?? []),
        ...(side !== 'baseline' ? [presence?.current] : []),
        ...(side !== 'current' ? [presence?.baseline] : []),
      ],
      membersLabel(s, axes, row),
    )
  const selections = rows
    .flatMap((row) =>
      delta
        ? [selectionAt(row, roles.absolute, 'delta')]
        : [
            selectionAt(row, roles.current, 'current'),
            selectionAt(row, roles.baseline, 'baseline'),
          ],
    )
    .filter((item): item is DomainPoint => item !== undefined)
  const top = 4
  const height = top + rows.length * rowH + 4
  const endW = 96
  const col = (name?: string) => (name ? columnOf(s, name)?.column : undefined)
  const get = (row: number, name?: string, side?: string) =>
    name && present(s, row, side) ? valueAt(s, row, name) : null
  const values = delta
    ? rows.map((row) => (bothPresent(s, row, roles) ? get(row, roles.absolute) : null))
    : rows.flatMap((row) => [
        get(row, roles.current, presence?.current),
        get(row, roles.baseline, presence?.baseline),
      ])
  const x = linear(extent(values, delta), [LABEL_W, W - endW])
  const endText = (row: number) =>
    !bothPresent(s, row, roles)
      ? '—'
      : roles.relative
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
          .map(
            (n) => `${valueName(s, undefined, n)}: ${exact(visibleCell(s, row, roles, n), col(n))}`,
          ),
      )
      .join('\n')
  const label = summary(
    t,
    `${ends.current} · ${ends.baseline}`,
    rows.map((row) => `${membersLabel(s, axes, row)} ${endText(row)}`),
  )
  return (
    <>
      <ChartFrame
        label={label}
        height={height}
        rowLabels={rows.map((row, ri) => ({
          label: membersLabel(s, axes, row),
          y: top + ri * rowH + rowH / 2 + 4,
        }))}
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
              const d = bothPresent(s, row, roles) ? get(row, roles.absolute) : null
              const overlap = cur !== null && base !== null && dotsOverlap(x(cur), x(base))
              return (
                <g key={row} data-row={member}>
                  <title>{tip(row)}</title>
                  <text className="fv-row-label" x={LABEL_W - 8} y={cy + 4} textAnchor="end">
                    {truncate(member)}
                  </text>
                  {delta ? (
                    d !== null && (
                      <DomainPointMark point={selectionAt(row, roles.absolute, 'delta')}>
                        <Bar
                          horizontal
                          at={cy - 7}
                          breadth={14}
                          from={x(0)}
                          to={x(d)}
                          fill={NEUTRAL}
                        />
                      </DomainPointMark>
                    )
                  ) : (
                    <>
                      {cur !== null && base !== null && (
                        <line x1={x(base)} x2={x(cur)} y1={cy} y2={cy} className="fv-stem" />
                      )}
                      {base !== null && (
                        <DomainPointMark point={selectionAt(row, roles.baseline, 'baseline')}>
                          <Dot
                            x={x(base)}
                            y={cy}
                            fill={color(0)}
                            hollow
                            size={overlap ? 6.5 : 4.5}
                          />
                        </DomainPointMark>
                      )}
                      {cur !== null && (
                        <DomainPointMark point={selectionAt(row, roles.current, 'current')}>
                          <Dot x={x(cur)} y={cy} fill={color(0)} size={overlap ? 3 : 4.5} />
                        </DomainPointMark>
                      )}
                    </>
                  )}
                  <text x={W - endW + 10} y={cy + 4} className="fv-strong">
                    {delta && roles.relative && bothPresent(s, row, roles)
                      ? `${signed(t.locale, roles.absolute ? cellOf(s, row, roles.absolute) : null, col(roles.absolute))}  ${endText(row)}`
                      : endText(row)}
                  </text>
                </g>
              )
            })}
          </>
        )}
      </ChartFrame>
      <DomainPointList points={selections} />
    </>
  )
}
