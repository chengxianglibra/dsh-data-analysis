import { useEffect, useId, useRef, useState } from 'react'
import type { FrameDecomposition } from '../../../presentation/contracts/snapshot.ts'
import { useCopy } from '../../i18n/context.tsx'
import type { Translator } from '../../i18n/copy.ts'
import { compareDecimalText } from '../../presentation/model.ts'
import { color, Legend, NEUTRAL, summary } from '../charts/recharts.tsx'
import { type DomainPoint, uniquelyBound } from './domain-point-selection.tsx'
import { compareMagnitude, divergingScale } from './magnitude.ts'
import {
  type Chip,
  cellOf,
  columnOf,
  displayFrameCell,
  endpointLabels,
  firstCell,
  fixedLabel,
  groupRows,
  interpretationOf,
  membersLabel,
  percent,
  type Snapshot,
  valueAt,
  valueName,
} from './model.ts'
import { ShareTrack } from './observation.tsx'
import { type SavedBarSeries, SavedRowPlot } from './plots.tsx'
import { useFrameSelection } from './selection-context.tsx'
import type { MainViewProps } from './types.ts'

type Role = FrameDecomposition['outputs'][number]['role']
const EFFECTS = ['effect_within', 'effect_mix', 'effect_entry_exit', 'effect_additive'] as const

export function decompositionOf(s: Snapshot, index: number) {
  const item = interpretationOf(s)?.decompositions[index]
  if (!item) return undefined
  const role = (r: Role) => item.outputs.find((o) => o.fieldKind === 'value' && o.role === r)?.name
  const parentTokens = item.groups.flatMap((g) => (g.kind === 'axis' ? [g.axisToken] : []))
  const parents = s.frame.axes.filter((a) => parentTokens.includes(a.token))
  const details = s.frame.axes.filter((a) => !parentTokens.includes(a.token))
  return {
    item,
    contribution: role('contribution'),
    total: role('total'),
    share: role('share'),
    current: role('current'),
    baseline: role('baseline'),
    currentPresence: item.outputs
      .filter((o) => o.fieldKind === 'presence' && o.role === 'current_present')
      .map((o) => o.name),
    baselinePresence: item.outputs
      .filter((o) => o.fieldKind === 'presence' && o.role === 'baseline_present')
      .map((o) => o.name),
    effects: EFFECTS.flatMap((r) => {
      const name = role(r)
      return name ? [{ role: r, name }] : []
    }),
    parents,
    details,
    restricted: item.rowScope === 'restricted',
    relative: item.target.kind === 'relative',
    change: item.target.kind !== 'level',
  }
}
export type DecompositionFacts = NonNullable<ReturnType<typeof decompositionOf>>

function point(
  t: Translator,
  s: Snapshot,
  facts: DecompositionFacts,
  row: number,
  field: string | undefined,
  label: string,
): DomainPoint | undefined {
  if (!field || !uniquelyBound(s, field) || cellOf(s, row, field) === null) return undefined
  return {
    row,
    field,
    label: `${label} · ${valueName(s, undefined, field)}: ${formatter(t, s, facts)(field, row)}`,
  }
}

/** Target name; change targets are prefixed with Δ. */
export function decompositionTitle(s: Snapshot, facts: DecompositionFacts): string {
  const target = facts.item.target
  const name = target.kind === 'level' ? target.name : target.group
  const column = columnOf(s, name)?.column
  const label = column ? valueName(s, undefined, name) : name
  return facts.change ? `Δ ${label}` : label
}
/** Fixed groups are constants of the decomposition and become context chips. */
export function decompositionChips(facts: DecompositionFacts): Chip[] {
  return facts.item.groups.flatMap((g) =>
    g.kind === 'fixed' ? [{ label: fixedLabel(g.fixed), title: g.fixed.name }] : [],
  )
}
export function parentGroups(s: Snapshot, facts: DecompositionFacts) {
  return groupRows(s, facts.parents)
}

/** Saved cell at a row; relative targets are fractions shown ×100. */
function formatter(t: Translator, s: Snapshot, facts: DecompositionFacts) {
  return (name: string, row: number) => {
    const role = facts.item.outputs.find((output) => output.name === name)?.role
    if (
      facts.relative &&
      (role === 'contribution' ||
        role === 'total' ||
        role === 'observed_total' ||
        EFFECTS.some((effect) => effect === role))
    )
      return percent(t.locale, valueAt(s, row, name), false, cellOf(s, row, name))
    const column = columnOf(s, name)?.column
    return column ? displayFrameCell(s, t.locale, cellOf(s, row, name), column) : '—'
  }
}

/** Header number: the parent's saved `total` (single parent only). */
export function decompositionTotal(t: Translator, s: Snapshot, facts: DecompositionFacts) {
  const groups = parentGroups(s, facts)
  if (!facts.total || groups.length !== 1) return undefined
  const { row } = firstCell(s, groups[0]!.rows, facts.total)
  return {
    key: facts.total,
    value: formatter(t, s, facts)(facts.total, row),
    title: valueName(s, undefined, facts.total),
    label: valueName(s, undefined, facts.total),
  }
}

/** A relative total belongs to this change only when the saved decomposition identity is unique. */
export function decompositionRelativeTotal(t: Translator, s: Snapshot, facts: DecompositionFacts) {
  const target = facts.item.target
  if (target.kind !== 'absolute') return undefined
  const matching = (interpretationOf(s)?.decompositions ?? []).filter(
    (item) =>
      item.target.kind === 'relative' &&
      item.target.comparison === target.comparison &&
      item.target.group === target.group &&
      item.rowScope === facts.item.rowScope &&
      JSON.stringify(item.groups) === JSON.stringify(facts.item.groups),
  )
  if (matching.length !== 1) return undefined
  const item = matching[0]!
  const totals = item.outputs.filter(
    (output) => output.fieldKind === 'value' && output.role === 'total',
  )
  if (totals.length !== 1) return undefined
  const name = totals[0]!.name
  const groups = parentGroups(s, facts)
  if (groups.length !== 1 || groups[0]!.rows.length === 0) return undefined
  const values = groups[0]!.rows.map((row) => cellOf(s, row, name))
  const first = values[0]
  if (
    first == null ||
    values.some((value) => value === null || compareDecimalText(String(value), String(first)) !== 0)
  )
    return undefined
  const numeric = valueAt(s, groups[0]!.rows[0]!, name)
  if (numeric === null) return undefined
  return {
    key: name,
    value: percent(t.locale, numeric, false, first),
    title: valueName(s, undefined, name),
    label: t('marivo.presentation.ui-frame-comparison-change-rate'),
  }
}

export function DecompositionView({
  snapshot: s,
  classification: c,
  view,
}: MainViewProps<'decomposition'>) {
  const t = useCopy()
  const facts = decompositionOf(s, view.decomposition)
  if (!facts) return null
  const groups = parentGroups(s, facts)
  const format = formatter(t, s, facts)
  const labelOf = (row: number) => membersLabel(s, facts.details, row)
  return (
    <div className="fv-decomposition">
      {view.style === 'effects' && (
        <Legend
          items={[
            ...facts.effects.map((e, i) => ({
              label: t(`marivo.presentation.ui-frame-${e.role.replaceAll('_', '-')}`),
              color: color(i),
            })),
            ...(facts.contribution
              ? [
                  {
                    label: valueName(s, c, facts.contribution),
                    color: 'var(--foreground)',
                    shape: 'diamond' as const,
                  },
                ]
              : []),
          ]}
        />
      )}
      <div className="fv-parents">
        {groups.map((g) => {
          const total = facts.total ? firstCell(s, g.rows, facts.total) : undefined
          return (
            <section key={g.key} className="fv-parent" data-parent={g.label}>
              {groups.length > 1 && (
                <h4>
                  {g.label}
                  {facts.total && total && (
                    <span>
                      {' · '}
                      {format(facts.total, total.row)}
                    </span>
                  )}
                </h4>
              )}
              {view.style === 'share' && facts.share ? (
                <ShareTrack
                  snapshot={s}
                  classification={c}
                  values={[facts.share]}
                  rows={g.rows}
                  labelOf={labelOf}
                />
              ) : view.style === 'effects' ? (
                <Effects t={t} s={s} facts={facts} rows={g.rows} labelOf={labelOf} />
              ) : facts.change && facts.contribution && facts.current && facts.baseline ? (
                <AttributionRows t={t} s={s} facts={facts} rows={g.rows} labelOf={labelOf} />
              ) : (
                <Waterfall
                  t={t}
                  s={s}
                  facts={facts}
                  rows={g.rows}
                  labelOf={labelOf}
                  parent={g.label}
                  format={format}
                />
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}

interface PartProps {
  t: Translator
  s: Snapshot
  facts: DecompositionFacts
  rows: number[]
  labelOf: (row: number) => string
}

/** A saved change and its endpoints: visual geometry never supplies a displayed value. */
function AttributionRows({ t, s, facts, rows, labelOf }: PartProps) {
  const selection = useFrameSelection()
  const region = useRef<HTMLElement>(null)
  const [scrollable, setScrollable] = useState(false)
  const hintId = useId()
  const contribution = facts.contribution!
  const current = facts.current!
  const baseline = facts.baseline!
  const ends =
    facts.item.target.kind === 'level'
      ? undefined
      : endpointLabels(t, s, facts.item.target.comparison)
  const sorted = [...rows].sort(
    (a, b) => compareMagnitude(cellOf(s, a, contribution), cellOf(s, b, contribution)) || a - b,
  )
  const scale = divergingScale(rows.map((row) => valueAt(s, row, contribution)))
  const format = formatter(t, s, facts)
  const fieldLabel = (name: string) =>
    name === contribution
      ? t('marivo.presentation.ui-frame-contribution')
      : name === facts.share
        ? t('marivo.presentation.ui-frame-contribution-share')
        : valueName(s, undefined, name)
  useEffect(() => {
    const element = region.current
    if (!element) return
    const update = () => setScrollable(element.scrollWidth > element.clientWidth + 1)
    const observer = new ResizeObserver(update)
    observer.observe(element)
    const table = element.querySelector('table')
    if (table) observer.observe(table)
    update()
    return () => observer.disconnect()
  }, [])
  const shown = (row: number, name: string, presence?: string[]) => {
    if (presence?.some((field) => cellOf(s, row, field) === false))
      return <span className="fv-decomposition-value">—</span>
    const cell = cellOf(s, row, name)
    const isContribution = name === contribution
    const positive = isContribution && cell !== null && compareDecimalText(String(cell), '0') > 0
    const value = `${positive ? '+' : ''}${format(name, row)}`
    const selected =
      selection && (!presence || (presence.length === 1 && cellOf(s, row, presence[0]!) === true))
        ? point(t, s, facts, row, name, labelOf(row))
        : undefined
    return selected ? (
      <button
        type="button"
        className="pr-cell-select fv-decomposition-value"
        data-frame-point={`${row}:${name}`}
        aria-label={`${labelOf(row)} · ${fieldLabel(name)}: ${value}`}
        onClick={() => selection!.select(row, name)}
      >
        {value}
      </button>
    ) : (
      <span className="fv-decomposition-value">{value}</span>
    )
  }
  return (
    <section
      ref={region}
      className="fv-decomposition-details"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: The detailed rows can scroll horizontally.
      tabIndex={0}
      aria-label={decompositionTitle(s, facts)}
      aria-describedby={scrollable ? hintId : undefined}
      data-decomposition-rows="attribution"
    >
      <table className="fv-decomposition-table">
        <thead>
          <tr>
            <th scope="col">{facts.details.map((axis) => axis.name).join(' · ')}</th>
            <th scope="col">{ends?.baseline ?? valueName(s, undefined, baseline)}</th>
            <th scope="col">{ends?.current ?? valueName(s, undefined, current)}</th>
            <th scope="col">{fieldLabel(contribution)}</th>
            {facts.share && <th scope="col">{fieldLabel(facts.share)}</th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const numeric = valueAt(s, row, contribution)
            const width = numeric === null ? 0 : scale.width(numeric)
            return (
              <tr key={row}>
                <th scope="row">{labelOf(row)}</th>
                <td>
                  <span className="fv-decomposition-field-label" aria-hidden="true">
                    {ends?.baseline ?? valueName(s, undefined, baseline)}
                  </span>
                  {shown(row, baseline, facts.baselinePresence)}
                </td>
                <td>
                  <span className="fv-decomposition-field-label" aria-hidden="true">
                    {ends?.current ?? valueName(s, undefined, current)}
                  </span>
                  {shown(row, current, facts.currentPresence)}
                </td>
                <td
                  data-contribution-sign={
                    numeric === null
                      ? 'missing'
                      : numeric < 0
                        ? 'negative'
                        : numeric > 0
                          ? 'positive'
                          : 'zero'
                  }
                >
                  <span className="fv-decomposition-field-label" aria-hidden="true">
                    {fieldLabel(contribution)}
                  </span>
                  <span className="fv-decomposition-contribution">
                    <span className="fv-decomposition-track" aria-hidden="true">
                      <span className="fv-decomposition-zero" style={{ left: `${scale.zero}%` }} />
                      {numeric !== null && (
                        <span
                          className={
                            numeric < 0 ? 'fv-decomposition-negative' : 'fv-decomposition-positive'
                          }
                          style={
                            numeric < 0
                              ? { right: `${100 - scale.zero}%`, width: `${width}%` }
                              : { left: `${scale.zero}%`, width: `${width}%` }
                          }
                        />
                      )}
                    </span>
                    {shown(row, contribution)}
                  </span>
                </td>
                {facts.share && (
                  <td>
                    <span className="fv-decomposition-field-label" aria-hidden="true">
                      {fieldLabel(facts.share)}
                    </span>
                    {shown(row, facts.share)}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
      {scrollable && (
        <p className="fv-sr-only" id={hintId}>
          {t('marivo.presentation.ui-frame-scroll-hint')}
        </p>
      )}
    </section>
  )
}
/** Every saved decomposition output of a row; detail-only columns live here. */
function tip(t: Translator, s: Snapshot, row: number, label: string, facts: DecompositionFacts) {
  return [label]
    .concat(
      facts.item.outputs
        .filter((o) => o.fieldKind === 'value')
        .map((o) => `${valueName(s, undefined, o.name)}: ${formatter(t, s, facts)(o.name, row)}`),
    )
    .join('\n')
}

/** Floating offsets are geometry only. Every number shown comes from a saved output. */
function Waterfall({
  t,
  s,
  facts,
  rows,
  labelOf,
  parent,
  format,
}: PartProps & { parent: string; format: (name: string, row: number) => string }) {
  const name = facts.contribution
  if (!name) return null
  const detached = facts.restricted || rows.some((row) => valueAt(s, row, name) === null)
  const total = facts.total ? firstCell(s, rows, facts.total) : undefined
  const labels = rows.map((row) =>
    valueAt(s, row, name) === null ? `${labelOf(row)} —` : labelOf(row),
  )
  const ranges: ([number, number] | null)[] = []
  let level = 0
  for (const row of rows) {
    const value = valueAt(s, row, name)
    if (value === null) ranges.push(null)
    else {
      ranges.push([level, level + value])
      level += value
    }
  }
  const totalIndex = labels.length + (detached ? 1 : 0)
  if (facts.total && total) {
    if (detached) {
      labels.push('')
      ranges.push(null)
    }
    labels.push(valueName(s, undefined, facts.total))
    const value = valueAt(s, total.row, facts.total)
    ranges.push(value === null ? null : [0, value])
  }
  const series: SavedBarSeries[] = [
    {
      key: 'contribution',
      fillAt: (index) => {
        if (index === totalIndex) return color(0)
        const value = rows[index] === undefined ? null : valueAt(s, rows[index]!, name)
        return value === null || value === 0
          ? 'var(--foreground)'
          : value > 0
            ? 'var(--mv-up)'
            : 'var(--mv-down)'
      },
      label: valueName(s, undefined, name),
      values: ranges.map((range) => range?.[1] ?? null),
      ranges,
      color: color(0),
      exact: (index) =>
        index < rows.length
          ? tip(t, s, rows[index]!, labelOf(rows[index]!) || parent, facts)
          : facts.total && total && index === totalIndex
            ? tip(t, s, total.row, parent, facts)
            : '',
      point: (index) =>
        index < rows.length
          ? point(t, s, facts, rows[index]!, name, labelOf(rows[index]!))
          : undefined,
    },
  ]
  const label = summary(t, valueName(s, undefined, name), [
    ...rows.map((row) => `${labelOf(row)} ${format(name, row)}`),
    ...(facts.total && total
      ? [`${valueName(s, undefined, facts.total)} ${format(facts.total, total.row)}`]
      : []),
  ])
  return (
    <SavedRowPlot
      label={label}
      labels={labels}
      series={series}
      bars
      connectors={ranges.flatMap((range, index) => {
        const next = ranges[index + 1]
        return range && next && index < rows.length && (index + 1 < rows.length || !detached)
          ? [
              {
                from: { x: range[1], y: index },
                to: { x: range[1], y: index + 1 },
                total: index + 1 === totalIndex,
              },
            ]
          : []
      })}
      totalState={detached ? 'detached' : 'closed'}
    />
  )
}
/** Saved effects occupy their geometric diverging spans; saved contribution is the diamond. */
function Effects({ t, s, facts, rows, labelOf }: PartProps) {
  const spans = rows.map((row) => {
    let positive = 0
    let negative = 0
    return facts.effects.map((effect) => {
      const value = valueAt(s, row, effect.name)
      if (value === null) return null
      const from = value >= 0 ? positive : negative
      if (value >= 0) positive += value
      else negative += value
      return [from, from + value] as [number, number]
    })
  })
  const series: SavedBarSeries[] = facts.effects.map((effect, index) => ({
    key: effect.name,
    label: t(`marivo.presentation.ui-frame-${effect.role.replaceAll('_', '-')}`),
    values: rows.map((row) => valueAt(s, row, effect.name)),
    ranges: spans.map((row) => row[index] ?? null),
    exact: (index) => tip(t, s, rows[index]!, labelOf(rows[index]!), facts),
    point: (index) => point(t, s, facts, rows[index]!, effect.name, labelOf(rows[index]!)),
    color: color(index),
  }))
  if (facts.contribution) {
    const name = facts.contribution
    series.push({
      key: name,
      label: valueName(s, undefined, name),
      values: rows.map((row) => valueAt(s, row, name)),
      exact: (index) => tip(t, s, rows[index]!, labelOf(rows[index]!), facts),
      point: (index) => point(t, s, facts, rows[index]!, name, labelOf(rows[index]!)),
      diamond: true,
      color: NEUTRAL,
    })
  }
  const fmt = formatter(t, s, facts)
  const label = summary(
    t,
    facts.contribution ? valueName(s, undefined, facts.contribution) : '',
    rows.map(
      (row) =>
        `${labelOf(row)} ${facts.effects.map((effect) => fmt(effect.name, row)).join(' / ')}${facts.contribution ? ` ◆ ${fmt(facts.contribution, row)}` : ''}`,
    ),
  )
  return <SavedRowPlot label={label} labels={rows.map(labelOf)} series={series} bars overlayBars />
}
