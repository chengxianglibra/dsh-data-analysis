import { useEffect, useId, useRef, useState } from 'react'
import type { FrameClassification } from '../../../presentation/contracts/frame-view.ts'
import type { FrameComparison } from '../../../presentation/contracts/snapshot.ts'
import { useCopy } from '../../i18n/context.tsx'
import type { Translator } from '../../i18n/copy.ts'
import { compareDecimalText } from '../../presentation/model.ts'
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
import { useFrameSelection } from './selection-context.tsx'
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

/** Several metrics on one saved row: one headline block per metric, every number a saved cell. */
export function ComparisonGrid({
  snapshot: s,
  classification: c,
  view,
}: MainViewProps<'comparison-grid'>) {
  const blocks = view.groups.flatMap((group) => {
    const roles = comparisonRoles(s, view.comparison, group)
    return roles?.current ? [{ group, roles }] : []
  })
  return (
    <div
      className="fv-comparison-grid"
      data-count={blocks.length}
      style={{ maxWidth: `${blocks.length * 360}px` }}
    >
      {blocks.map(({ group, roles }) => (
        <section className="fv-comparison-grid-item" key={group} data-comparison-group={group}>
          <h4>{kpiLabel(s, c, roles.current!)}</h4>
          <ComparisonKpi snapshot={s} roles={roles} index={view.comparison} />
        </section>
      ))}
    </div>
  )
}

/** Keep a declared unit beside the value rather than repeating it in the title. */
function kpiLabel(s: Snapshot, c: FrameClassification, name: string) {
  const column = columnOf(s, name)?.column
  const unit = column?.unit?.trim()
  const label = valueName(s, c, name)
  if (!unit || unit === '1') return label
  for (const suffix of [` (${unit})`, `（${unit}）`, `(${unit})`]) {
    if (label.endsWith(suffix)) return label.slice(0, -suffix.length).trimEnd()
  }
  return label
}

function ComparisonKpi({
  snapshot: s,
  roles,
  index,
}: {
  snapshot: Snapshot
  roles: ComparisonRoles
  index: number
}) {
  const t = useCopy()
  const ends = endpointLabels(t, s, index)
  const asText = (name: string | undefined) => {
    if (!name) return '—'
    const source = columnOf(s, name)?.column
    if (!source) return '—'
    // A monetary unit is placed beside the value; avoid the currency prefix in its numeric text.
    return displayFrameCell(
      s,
      t.locale,
      visibleCell(s, 0, roles, name),
      source.unit === 'USD' ? { ...source, unit: undefined } : source,
    )
  }
  const change = roles.absolute ? visibleCell(s, 0, roles, roles.absolute) : null
  const changeColumn = roles.absolute ? columnOf(s, roles.absolute)?.column : undefined
  const delta = signed(
    t.locale,
    change,
    changeColumn?.unit === 'USD' ? { ...changeColumn, unit: undefined } : changeColumn,
  )
  const current = asText(roles.current)
  const baseline = asText(roles.baseline)
  const unitFor = (name: string | undefined, value: string) => {
    const unit = name ? columnOf(s, name)?.column.unit?.trim() : undefined
    return value !== '—' && unit && unit !== '1' && !value.endsWith(unit) ? unit : undefined
  }
  const currentUnit = unitFor(roles.current, current)
  const baselineUnit = unitFor(roles.baseline, baseline)
  const deltaUnit = unitFor(roles.absolute, delta)
  const relative =
    roles.relative && bothPresent(s, 0, roles)
      ? percent(t.locale, valueAt(s, 0, roles.relative), true)
      : '—'
  return (
    <dl className="fv-kpi-values">
      <div className="fv-kpi-current">
        <dt>{ends.current}</dt>
        <dd>
          <span className="fv-kpi-value">{current}</span>
          {currentUnit && <span className="fv-kpi-unit">{currentUnit}</span>}
        </dd>
      </div>
      {roles.relative && (
        <div className="fv-kpi-relative">
          <dt>{t('marivo.presentation.ui-frame-comparison-change-rate')}</dt>
          <dd>{relative}</dd>
        </div>
      )}
      {roles.baseline && (
        <div className="fv-kpi-reference">
          <dt>{ends.baseline}</dt>
          <dd>
            {baseline}
            {baselineUnit && <span className="fv-kpi-unit"> {baselineUnit}</span>}
          </dd>
        </div>
      )}
      {roles.absolute && (
        <div className="fv-kpi-reference">
          <dt>{t('marivo.presentation.ui-frame-comparison-change')}</dt>
          <dd>
            {delta}
            {deltaUnit && <span className="fv-kpi-unit"> {deltaUnit}</span>}
          </dd>
        </div>
      )}
    </dl>
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
      {numbers && <ComparisonKpi snapshot={s} roles={roles} index={index} />}
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
        const name = ends.specific ? ends.baseline : interpretationOf(s)?.comparisons[i]?.alias
        return (
          <Button
            variant={i === active ? 'secondary' : 'outline'}
            size="sm"
            key={i}
            aria-pressed={i === active}
            onClick={() => onSelect(i)}
          >
            {name || ends.baseline}
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
          key={index}
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
/** Category comparisons use the saved delta as the default view when available. */
function CompareRows(props: {
  s: Snapshot
  roles: ComparisonRoles
  index: number
  axes: string[]
  delta: boolean
}) {
  const { s, roles, delta } = props
  const t = useCopy()
  const absolute = roles.absolute
  const column = absolute ? columnOf(s, absolute)?.column : undefined
  const hasDelta = !!column && ['int64', 'decimal', 'float64'].includes(column.type)
  const hasPair = !!roles.current && !!roles.baseline
  const hasDrawableDelta =
    !!absolute &&
    hasDelta &&
    rowsOf(s).some(
      (row) =>
        bothPresent(s, row, roles) &&
        valueAt(s, row, absolute) !== null &&
        (!roles.current || valueAt(s, row, roles.current) !== null) &&
        (!roles.baseline || valueAt(s, row, roles.baseline) !== null),
    )
  const [mode, setMode] = useState<'delta' | 'values'>(hasDrawableDelta ? 'delta' : 'values')
  const effective = delta || (hasDelta && !hasPair) ? 'delta' : hasDrawableDelta ? mode : 'values'
  return (
    <>
      {!delta && hasDrawableDelta && hasPair && (
        <fieldset
          className="fv-segments fv-compare-controls"
          aria-label={t('marivo.presentation.ui-frame-comparison-view')}
        >
          <Button
            size="sm"
            variant={effective === 'delta' ? 'secondary' : 'outline'}
            aria-pressed={effective === 'delta'}
            onClick={() => setMode('delta')}
          >
            {t('marivo.presentation.ui-frame-comparison-change')}
          </Button>
          <Button
            size="sm"
            variant={effective === 'values' ? 'secondary' : 'outline'}
            aria-pressed={effective === 'values'}
            onClick={() => setMode('values')}
          >
            {t('marivo.presentation.ui-frame-comparison-values')}
          </Button>
        </fieldset>
      )}
      {effective === 'delta' ? (
        <CompareDelta {...props} />
      ) : (
        <CompareDumbbell {...props} delta={false} />
      )}
    </>
  )
}

function CompareDelta({
  s,
  roles,
  index,
  axes: tokens,
}: {
  s: Snapshot
  roles: ComparisonRoles
  index: number
  axes: string[]
  delta: boolean
}) {
  const t = useCopy()
  const selection = useFrameSelection()
  const [order, setOrder] = useState<'original' | 'absolute' | 'relative'>('absolute')
  const effectiveOrder = order === 'relative' && !roles.relative ? 'absolute' : order
  const axes = tokens.map((token) => axisOf(s, token)).filter((axis) => axis !== undefined)
  const ends = endpointLabels(t, s, index)
  const fields = [roles.current, roles.baseline, roles.absolute, roles.relative]
  const rows = rowsOf(s)
  const sortName = effectiveOrder === 'relative' ? roles.relative : roles.absolute
  if (effectiveOrder !== 'original' && sortName) {
    rows.sort((a, b) => {
      const av = visibleCell(s, a, roles, sortName)
      const bv = visibleCell(s, b, roles, sortName)
      if (av === null || bv === null) return av === bv ? a - b : av === null ? 1 : -1
      const an = valueAt(s, a, sortName)
      const bn = valueAt(s, b, sortName)
      if (an === null || bn === null) return an === bn ? a - b : an === null ? 1 : -1
      const comparison = compareDecimalText(String(av), String(bv))
      return comparison || a - b
    })
  }
  const magnitudes = rows.flatMap((row) => {
    const value =
      roles.absolute && bothPresent(s, row, roles) ? valueAt(s, row, roles.absolute) : null
    return value === null ? [] : [Math.abs(value)]
  })
  const max = magnitudes.reduce((a, b) => Math.max(a, b), 0)
  const text = (row: number, name: string | undefined, kind: 'value' | 'delta' | 'relative') => {
    if (!name) return '—'
    const cell = visibleCell(s, row, roles, name)
    if (kind === 'relative')
      return cell === null ? '—' : percent(t.locale, valueAt(s, row, name), true)
    if (kind === 'delta') return signed(t.locale, cell, columnOf(s, name)?.column)
    return formattedCell(s, t.locale, name, cell)
  }
  const selectable = (
    row: number,
    name: string | undefined,
    label: string,
    side: 'current' | 'baseline' | 'delta',
  ) => {
    const presence = roles.comparison.presence
    const selected = point(
      s,
      row,
      name,
      [
        ...(presence?.enclosing ?? []),
        ...(side !== 'baseline' ? [presence?.current] : []),
        ...(side !== 'current' ? [presence?.baseline] : []),
      ],
      membersLabel(s, axes, row),
      t.locale,
    )
    return selection && selected ? (
      <button
        type="button"
        className="pr-cell-select"
        data-frame-point={`${row}:${name}`}
        aria-label={selected.label}
        onClick={() => selection.select(row, selected.field)}
      >
        {label}
      </button>
    ) : (
      label
    )
  }
  return (
    <div data-comparison-rows="delta">
      <fieldset
        className="fv-segments fv-compare-controls"
        aria-label={t('marivo.presentation.ui-frame-comparison-sort')}
      >
        {(['original', 'absolute', 'relative'] as const)
          .filter((kind) => kind !== 'relative' || roles.relative)
          .map((kind) => (
            <Button
              key={kind}
              size="sm"
              variant={effectiveOrder === kind ? 'secondary' : 'outline'}
              aria-pressed={effectiveOrder === kind}
              onClick={() => setOrder(kind)}
            >
              {kind === 'original'
                ? t('marivo.presentation.ui-frame-comparison-order-original')
                : t(
                    kind === 'absolute'
                      ? 'marivo.presentation.ui-frame-comparison-delta'
                      : 'marivo.presentation.ui-frame-comparison-delta-percent',
                  )}
            </Button>
          ))}
      </fieldset>
      <section
        className="fv-delta-scroll"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll the overflow region.
        tabIndex={0}
        aria-label={t('marivo.presentation.ui-frame-comparison-table')}
      >
        <table className="fv-delta-table">
          <thead>
            <tr>
              <th scope="col">{t('marivo.presentation.ui-frame-comparison-metric')}</th>
              <th scope="col">
                <span className="fv-delta-axis-label">
                  <span>← {t('marivo.presentation.ui-frame-comparison-decrease')}</span>
                  <span>0</span>
                  <span>{t('marivo.presentation.ui-frame-comparison-increase')} →</span>
                </span>
              </th>
              <th scope="col">{ends.baseline}</th>
              <th scope="col">{ends.current}</th>
              <th scope="col">{t('marivo.presentation.ui-frame-comparison-delta')}</th>
              <th scope="col">{t('marivo.presentation.ui-frame-comparison-delta-percent')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const value =
                roles.absolute && bothPresent(s, row, roles)
                  ? valueAt(s, row, roles.absolute)
                  : null
              const width = value === null || max === 0 ? 0 : Math.abs(value / max) * 50
              return (
                <tr key={row}>
                  <th scope="row">{membersLabel(s, axes, row)}</th>
                  <td>
                    <div className="fv-delta-plot" aria-hidden="true">
                      <span className="fv-delta-zero" />
                      <span
                        className={`fv-delta-bar ${value !== null && value > 0 ? 'fv-delta-positive' : ''}`}
                        style={
                          value !== null && value > 0
                            ? { left: '50%', width: `${width}%` }
                            : { right: '50%', width: `${width}%` }
                        }
                      />
                    </div>
                  </td>
                  <td>{selectable(row, fields[1], text(row, fields[1], 'value'), 'baseline')}</td>
                  <td>{selectable(row, fields[0], text(row, fields[0], 'value'), 'current')}</td>
                  <td>{selectable(row, fields[2], text(row, fields[2], 'delta'), 'delta')}</td>
                  <td>{text(row, fields[3], 'relative')}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>
    </div>
  )
}

/** Saved endpoints connected by Recharts reference segments, or a saved Δ bar. */
function CompareDumbbell({
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
