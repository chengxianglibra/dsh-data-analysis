import { useEffect, useId, useRef, useState } from 'react'
import type { FrameClassification } from '../../../presentation/contracts/frame-view.ts'
import type { FrameComparison } from '../../../presentation/contracts/snapshot.ts'
import { useCopy } from '../../i18n/context.tsx'
import type { Translator } from '../../i18n/copy.ts'
import { DatasetTable } from '../../presentation/table.tsx'
import { Button } from '../../ui/primitives/button.tsx'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../ui/primitives/table.tsx'
import { NEUTRAL, summary } from '../charts/recharts.tsx'
import { type DomainPoint, uniquelyBound } from './domain-point-selection.tsx'
import {
  axisOf,
  cellOf,
  columnOf,
  compact,
  displayFrameCell,
  endpointLabels,
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
import { SavedDeltaStrip, SavedLinePlot, SavedRowPlot, type SavedSeries } from './plots.tsx'
import { DataTable } from './table.tsx'
import type { MainViewProps } from './types.ts'

type Group = FrameComparison['groups'][number]
function formattedCell(
  s: Snapshot,
  locale: Translator['locale'],
  name: string,
  value: ReturnType<typeof cellOf>,
) {
  const column = columnOf(s, name)?.column
  return column ? displayFrameCell(s, locale, value, column) : '—'
}

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
  locale: Translator['locale'],
): DomainPoint | undefined {
  if (row === undefined || !name || !uniquelyBound(s, name) || cellOf(s, row, name) === null)
    return undefined
  if (required.some((field) => field && cellOf(s, row, field) !== true)) return undefined
  return {
    row,
    field: name,
    label: `${label} · ${valueName(s, undefined, name)}: ${formattedCell(s, locale, name, cellOf(s, row, name))}`,
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
  reference = false,
}: {
  snapshot: Snapshot
  classification: FrameClassification
  reference?: boolean
}) {
  const t = useCopy()
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
    if (!name) return <TableCell className="pr-numeric text-right tabular-nums">—</TableCell>
    const column = columnOf(s, name)?.column
    const value = cellOf(s, row, name)
    if (!present(s, row, presence))
      return <TableCell className="pr-numeric text-right tabular-nums">—</TableCell>
    return (
      <TableCell className="pr-numeric text-right tabular-nums">
        {compact(t.locale, value, column)}
      </TableCell>
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
    return <TableCell className="pr-numeric text-right tabular-nums">{text}</TableCell>
  }
  const dataRows = (rows: ComparisonRoles[]) =>
    rows.map((roles) => (
      <TableRow key={roles.current}>
        <TableHead scope="row">{valueName(s, c, roles.current!)}</TableHead>
        {side(roles.current, roles.comparison.presence?.current)}
        {side(roles.baseline, roles.comparison.presence?.baseline)}
        {change(roles, 'delta')}
        {change(roles, 'percent')}
      </TableRow>
    ))
  return (
    <>
      <div className={reference ? 'fv-sr-only' : 'fv-table-bar fv-comparison-toolbar'}>
        {scrollable && (
          <span
            id={hintId}
            className={reference ? undefined : 'fv-scroll-hint'}
            title={t('marivo.presentation.ui-frame-scroll-hint')}
          >
            <span className="fv-sr-only">{t('marivo.presentation.ui-frame-scroll-hint')}</span>
          </span>
        )}
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
        <Table aria-label={t('marivo.presentation.ui-frame-comparison-table')}>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">
                {t('marivo.presentation.ui-frame-comparison-metric')}
              </TableHead>
              <TableHead scope="col" className="pr-numeric text-right tabular-nums">
                {ends.current}
              </TableHead>
              <TableHead scope="col" className="pr-numeric text-right tabular-nums">
                {ends.baseline}
              </TableHead>
              <TableHead scope="col" className="pr-numeric text-right tabular-nums">
                {t('marivo.presentation.ui-frame-comparison-delta')}
              </TableHead>
              <TableHead scope="col" className="pr-numeric text-right tabular-nums">
                {t('marivo.presentation.ui-frame-comparison-delta-percent')}
              </TableHead>
            </TableRow>
          </TableHeader>
          {sections.length > 1 ? (
            sections.map((section) => {
              const sectionEnds = endpointLabels(t, s, section.index)
              return (
                <TableBody key={section.index}>
                  <TableRow className="fv-comparison-section">
                    <TableHead scope="rowgroup" colSpan={5}>
                      {`${sectionEnds.current} ⇄ ${sectionEnds.baseline}`}
                    </TableHead>
                  </TableRow>
                  {dataRows(section.rows)}
                </TableBody>
              )
            })
          ) : (
            <TableBody>{dataRows(sections[0]?.rows ?? [])}</TableBody>
          )}
        </Table>
      </section>
    </>
  )
}

/** Saved comparison roles grouped by metric and endpoint, with coordinates retained. */
export function ComparisonDetail({ snapshot: s }: { snapshot: Snapshot }) {
  const t = useCopy()
  const coordinates = s.frame.layout
    .filter((item) => item.kind === 'coordinate')
    .map((item) => item.name)
  return (
    <div className="fv-comparison-details">
      {comparisonTableSections(s).flatMap((section) =>
        section.rows.map((roles) => {
          const ends = endpointLabels(t, s, section.index)
          const fields = [roles.current, roles.baseline, roles.absolute, roles.relative]
          const labels = [
            ends.current,
            ends.baseline,
            t('marivo.presentation.ui-frame-comparison-delta'),
            t('marivo.presentation.ui-frame-comparison-delta-percent'),
          ]
          const columns = [
            ...coordinates.flatMap((name) => {
              const column = columnOf(s, name)?.column
              return column ? [column] : []
            }),
            ...fields.flatMap((name, i) => {
              const column = name ? columnOf(s, name)?.column : undefined
              return column ? [{ ...column, label: labels[i]! }] : []
            }),
          ]
          const rows = s.data.rows.map((_, row) =>
            columns.map((column) =>
              coordinates.includes(column.id)
                ? cellOf(s, row, column.id)
                : visibleCell(s, row, roles, column.id),
            ),
          )
          return (
            <section key={`${section.index}:${roles.group.name}`}>
              <h4>{`${valueName(s, undefined, roles.current!)} · ${ends.current} ⇄ ${ends.baseline}`}</h4>
              <DatasetTable
                data={{ ...s.data, columns, rows }}
                caption=""
                hideRowCount
                hideExactTitle
                display={(value, column) => displayFrameCell(s, t.locale, value, column)}
              />
            </section>
          )
        }),
      )}
    </div>
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
      title: valueName(s, undefined, name),
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
    <dl className="fv-numbers flex flex-wrap gap-x-6 gap-y-2">
      {items.map((item) => (
        <div className="grid gap-1" key={item.key} data-number={item.key}>
          <dd className="text-2xl font-semibold tabular-nums" title={item.title}>
            {item.value}
          </dd>
          <dt className="text-xs text-muted-foreground">{item.label ?? ' '}</dt>
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
          <Button
            variant={i === active ? 'secondary' : 'outline'}
            size="sm"
            key={i}
            aria-pressed={i === active}
            onClick={() => onSelect(i)}
          >
            {ends.baseline}
          </Button>
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

/** Saved current/baseline trajectories, with an independent saved-Δ strip. */
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
  const counts = new Map<number, number>()
  for (const row of rows) counts.set(tickOf(row), (counts.get(tickOf(row)) ?? 0) + 1)
  const presence = roles.comparison.presence
  const ends = endpointLabels(t, s, index)
  const selectionAt = (
    i: number,
    field: string | undefined,
    side: 'current' | 'baseline' | 'delta',
  ) =>
    counts.get(i) === 1
      ? point(
          s,
          byTick.get(i),
          field,
          [
            ...(presence?.enclosing ?? []),
            ...(side !== 'baseline' ? [presence?.current] : []),
            ...(side !== 'current' ? [presence?.baseline] : []),
          ],
          ticks[i]?.label ?? '',
          t.locale,
        )
      : undefined
  const tip = (i: number) => {
    const row = byTick.get(i)
    return [
      ticks[i]?.title ?? '',
      ...[roles.current, roles.baseline, roles.absolute, roles.relative]
        .filter((name): name is string => !!name)
        .map(
          (name) =>
            `${valueName(s, undefined, name)}: ${formattedCell(s, t.locale, name, row === undefined ? null : visibleCell(s, row, roles, name))}`,
        ),
    ].join('\n')
  }
  const make = (
    name: string | undefined,
    side: 'current' | 'baseline' | 'delta',
    label: string,
  ): SavedSeries => ({
    key: side,
    label,
    color: side === 'delta' ? NEUTRAL : side === 'baseline' ? '#6a55a0' : '#126c74',
    hollow: side === 'baseline',
    dashed: side === 'baseline',
    values: ticks.map((_, i) => {
      const row = byTick.get(i)
      if (
        row === undefined ||
        !name ||
        (side === 'delta' ? !bothPresent(s, row, roles) : !present(s, row, presence?.[side]))
      )
        return null
      return valueAt(s, row, name)
    }),
    exact: tip,
    point: (i) => selectionAt(i, name, side),
  })
  const label = summary(
    t,
    `${ends.current} · ${ends.baseline}`,
    ticks.map((_, i) => tip(i)),
  )
  return (
    <>
      <SavedLinePlot
        label={label}
        ticks={ticks}
        series={[
          make(roles.current, 'current', ends.current),
          make(roles.baseline, 'baseline', ends.baseline),
        ]}
        height={height - (roles.absolute ? 64 : 0)}
        legend={!small}
      />
      {roles.absolute && (
        <SavedDeltaStrip
          label={label}
          ticks={ticks}
          series={make(roles.absolute, 'delta', valueName(s, undefined, roles.absolute))}
        />
      )}
    </>
  )
}
/** Saved endpoints connected by Recharts reference segments, or a saved Δ bar. */
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
  const axes = tokens.map((token) => axisOf(s, token)).filter((axis) => axis !== undefined)
  const rows = rowsOf(s)
  const labels = rows.map((row) => membersLabel(s, axes, row))
  const presence = roles.comparison.presence
  const ends = endpointLabels(t, s, index)
  const get = (row: number, name?: string, side?: string) =>
    name && present(s, row, side) ? valueAt(s, row, name) : null
  const tip = (row: number) =>
    [
      labels[row] ?? '',
      ...[roles.current, roles.baseline, roles.absolute, roles.relative]
        .filter((name): name is string => !!name)
        .map(
          (name) =>
            `${valueName(s, undefined, name)}: ${formattedCell(s, t.locale, name, visibleCell(s, row, roles, name))}`,
        ),
    ].join('\n')
  const make = (
    name: string | undefined,
    side: 'current' | 'baseline' | 'delta',
    label: string,
  ): SavedSeries => ({
    key: side,
    label,
    values: rows.map((row) =>
      side === 'delta'
        ? bothPresent(s, row, roles)
          ? get(row, name)
          : null
        : get(row, name, presence?.[side]),
    ),
    color: side === 'delta' ? NEUTRAL : side === 'baseline' ? '#6a55a0' : '#126c74',
    hollow: side === 'baseline',
    exact: tip,
    point: (row) =>
      point(
        s,
        row,
        name,
        [
          ...(presence?.enclosing ?? []),
          ...(side !== 'baseline' ? [presence?.current] : []),
          ...(side !== 'current' ? [presence?.baseline] : []),
        ],
        labels[row] ?? '',
        t.locale,
      ),
  })
  const current = make(roles.current, 'current', ends.current)
  const baseline = make(roles.baseline, 'baseline', ends.baseline)
  const endLabels = rows.map((row) =>
    !bothPresent(s, row, roles)
      ? '—'
      : roles.relative
        ? percent(t.locale, valueAt(s, row, roles.relative), true)
        : signed(
            t.locale,
            roles.absolute ? cellOf(s, row, roles.absolute) : null,
            roles.absolute ? columnOf(s, roles.absolute)?.column : undefined,
          ),
  )
  return (
    <SavedRowPlot
      label={summary(t, `${ends.current} · ${ends.baseline}`, rows.map(tip))}
      labels={labels}
      series={
        delta
          ? [
              make(
                roles.absolute,
                'delta',
                roles.absolute ? valueName(s, undefined, roles.absolute) : '',
              ),
            ]
          : [baseline, current]
      }
      bars={delta}
      endLabels={endLabels}
      links={
        delta
          ? undefined
          : rows.flatMap((row) => {
              const from = baseline.values[row]
              const to = current.values[row]
              return from == null || to == null ? [] : [{ from, to, index: row }]
            })
      }
    />
  )
}
