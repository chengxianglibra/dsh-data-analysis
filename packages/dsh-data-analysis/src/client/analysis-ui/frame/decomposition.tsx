import type { FrameDecomposition } from '../../../presentation/contracts/snapshot.ts'
import { useCopy } from '../../i18n/context.tsx'
import type { Translator } from '../../i18n/copy.ts'
import { type DomainPoint, DomainPointMark, uniquelyBound } from './domain-point-selection.tsx'
import {
  type Chip,
  cellOf,
  columnOf,
  compact,
  exact,
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
import {
  Bar,
  ChartFrame,
  color,
  Diamond,
  END_W,
  extent,
  LABEL_W,
  Legend,
  linear,
  type MainViewProps,
  NEUTRAL,
  summary,
  truncate,
  W,
} from './svg.tsx'

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
  s: Snapshot,
  row: number,
  field: string | undefined,
  label: string,
): DomainPoint | undefined {
  if (!field || !uniquelyBound(s, field) || cellOf(s, row, field) === null) return undefined
  return {
    row,
    field,
    label: `${label} · ${valueName(s, undefined, field)}: ${exact(cellOf(s, row, field), columnOf(s, field)?.column)}`,
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
  return (name: string, row: number) =>
    facts.relative
      ? percent(t.locale, valueAt(s, row, name), false)
      : compact(t.locale, cellOf(s, row, name), columnOf(s, name)?.column)
}

/** Header number: the parent's saved `total` (single parent only). */
export function decompositionTotal(t: Translator, s: Snapshot, facts: DecompositionFacts) {
  const groups = parentGroups(s, facts)
  if (!facts.total || groups.length !== 1) return undefined
  const { row, value } = firstCell(s, groups[0]!.rows, facts.total)
  return {
    key: facts.total,
    value: formatter(t, s, facts)(facts.total, row),
    title: `${valueName(s, undefined, facts.total)}: ${exact(value, columnOf(s, facts.total)?.column)}`,
    label: valueName(s, undefined, facts.total),
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
                    color: 'var(--pr-text)',
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
                    <span title={exact(total.value, columnOf(s, facts.total)?.column)}>
                      {' · '}
                      {format(facts.total, total.row)}
                    </span>
                  )}
                </h4>
              )}
              {view.style === 'share' && facts.share ? (
                <>
                  <ShareTrack
                    snapshot={s}
                    classification={c}
                    values={[facts.share]}
                    rows={g.rows}
                    labelOf={labelOf}
                  />
                </>
              ) : view.style === 'effects' ? (
                <Effects t={t} s={s} facts={facts} rows={g.rows} labelOf={labelOf} />
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
/** Every saved decomposition output of a row, exact; detail-only columns live here. */
function tip(s: Snapshot, row: number, label: string, facts: DecompositionFacts) {
  return [label]
    .concat(
      facts.item.outputs
        .filter((o) => o.fieldKind === 'value')
        .map(
          (o) =>
            `${valueName(s, undefined, o.name)}: ${exact(cellOf(s, row, o.name), columnOf(s, o.name)?.column)}`,
        ),
    )
    .join('\n')
}

/**
 * Floating contributions in Frame row order and the total from 0. Floating
 * offsets are layout only; restricted scope drops the closing connector and
 * leaves a gap before the total.
 */
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
  const rowH = 24
  // A missing contribution cannot be treated as zero when connecting the total.
  const detached = facts.restricted || rows.some((row) => valueAt(s, row, name) === null)
  const gap = detached ? 16 : 0
  const totalRow = facts.total ? firstCell(s, rows, facts.total) : undefined
  const totalValue = totalRow && facts.total ? valueAt(s, totalRow.row, facts.total) : null
  const height = 4 + rows.length * rowH + (facts.total ? rowH + gap : 0) + 4
  const spans: ({ from: number; to: number } | null)[] = []
  let level = 0
  for (const row of rows) {
    const v = valueAt(s, row, name)
    if (v === null) spans.push(null)
    else {
      spans.push({ from: level, to: level + v })
      level += v
    }
  }
  const x = linear(
    extent([...spans.flatMap((sp) => (sp ? [sp.from, sp.to] : [])), totalValue], true),
    [LABEL_W, W - END_W],
  )
  const label = summary(t, valueName(s, undefined, name), [
    ...rows.map((row) => `${labelOf(row)} ${format(name, row)}`),
    ...(facts.total && totalRow
      ? [`${valueName(s, undefined, facts.total)} ${format(facts.total, totalRow.row)}`]
      : []),
  ])
  const totalY = 4 + rows.length * rowH + gap

  return (
    <>
      <ChartFrame
        label={label}
        height={height}
        rowLabels={[
          ...rows.map((row, i) => ({ label: labelOf(row), y: 4 + i * rowH + 16 })),
          ...(facts.total && totalRow
            ? [{ label: valueName(s, undefined, facts.total), y: totalY + 16, strong: true }]
            : []),
        ]}
      >
        {() => (
          <>
            <line x1={x(0)} x2={x(0)} y1={2} y2={height - 2} className="fv-axis" />
            {rows.map((row, i) => {
              const sp = spans[i]
              const y0 = 4 + i * rowH
              const member = labelOf(row)
              const next = spans[i + 1]
              return (
                <g key={row} data-row={member}>
                  <text className="fv-row-label" x={LABEL_W - 8} y={y0 + 16} textAnchor="end">
                    {truncate(member)}
                  </text>
                  {sp && (
                    <>
                      <DomainPointMark point={point(s, row, name, member)}>
                        <Bar
                          horizontal
                          at={y0 + 4}
                          breadth={16}
                          from={x(sp.from)}
                          to={x(sp.to)}
                          fill={color(0)}
                          title={tip(s, row, member || parent, facts)}
                        />
                      </DomainPointMark>
                      <text
                        x={Math.max(x(sp.from), x(sp.to)) + 4}
                        y={y0 + 16}
                        className="fv-strong"
                      >
                        {format(name, row)}
                      </text>
                    </>
                  )}
                  {!sp && (
                    <text x={W - END_W + 10} y={y0 + 16} className="fv-strong">
                      —
                    </text>
                  )}
                  {sp && next && (
                    <line
                      x1={x(sp.to)}
                      x2={x(sp.to)}
                      y1={y0 + 20}
                      y2={y0 + rowH + 4}
                      className="fv-connector"
                      data-mark="connector"
                    />
                  )}
                  {sp && i === rows.length - 1 && facts.total && !detached && (
                    <line
                      x1={x(sp.to)}
                      x2={x(sp.to)}
                      y1={y0 + 20}
                      y2={totalY + 4}
                      className="fv-connector"
                      data-mark="connector-total"
                    />
                  )}
                </g>
              )
            })}
            {facts.total && totalRow && (
              <g data-row="total" data-mark-total={detached ? 'detached' : 'closed'}>
                <text
                  x={LABEL_W - 8}
                  y={totalY + 16}
                  textAnchor="end"
                  className="fv-strong fv-row-label"
                >
                  {truncate(valueName(s, undefined, facts.total))}
                </text>
                {totalValue !== null && (
                  <Bar
                    horizontal
                    at={totalY + 4}
                    breadth={16}
                    from={x(0)}
                    to={x(totalValue)}
                    fill={NEUTRAL}
                    title={tip(s, totalRow.row, parent, facts)}
                  />
                )}
                <text
                  x={Math.max(x(0), totalValue === null ? x(0) : x(totalValue)) + 4}
                  y={totalY + 16}
                  className="fv-strong"
                >
                  {format(facts.total, totalRow.row)}
                </text>
              </g>
            )}
          </>
        )}
      </ChartFrame>
    </>
  )
}

/** One diverging segmented bar per group; ◆ marks the saved contribution. */
function Effects({ t, s, facts, rows, labelOf }: PartProps) {
  const rowH = 24
  const height = 4 + rows.length * rowH + 4
  const stacks = rows.map((row) => {
    let pos = 0
    let neg = 0
    return facts.effects.map((e, i) => {
      const v = valueAt(s, row, e.name)
      if (v === null) return null
      const from = v >= 0 ? pos : neg
      if (v >= 0) pos += v
      else neg += v
      return { from, to: from + v, color: color(i) }
    })
  })
  const contributions = rows.map((row) =>
    facts.contribution ? valueAt(s, row, facts.contribution) : null,
  )
  const x = linear(
    extent(
      [...stacks.flat().flatMap((seg) => (seg ? [seg.from, seg.to] : [])), ...contributions],
      true,
    ),
    [LABEL_W, W - END_W],
  )
  const fmt = formatter(t, s, facts)
  const label = summary(
    t,
    facts.contribution ? valueName(s, undefined, facts.contribution) : '',
    rows.map(
      (row) =>
        `${labelOf(row)} ${facts.effects.map((e) => fmt(e.name, row)).join(' / ')}${facts.contribution ? ` ◆ ${fmt(facts.contribution, row)}` : ''}`,
    ),
  )

  return (
    <>
      <ChartFrame
        label={label}
        height={height}
        rowLabels={rows.map((row, i) => ({ label: labelOf(row), y: 4 + i * rowH + 16 }))}
      >
        {() => (
          <>
            <line x1={x(0)} x2={x(0)} y1={2} y2={height - 2} className="fv-axis" />
            {rows.map((row, i) => {
              const y0 = 4 + i * rowH
              const member = labelOf(row)
              const d = contributions[i] ?? null
              return (
                <g key={row} data-row={member}>
                  <title>{tip(s, row, member, facts)}</title>
                  <text className="fv-row-label" x={LABEL_W - 8} y={y0 + 16} textAnchor="end">
                    {truncate(member)}
                  </text>
                  {stacks[i]!.map((seg, si) =>
                    seg ? (
                      <DomainPointMark
                        key={facts.effects[si]!.role}
                        point={point(s, row, facts.effects[si]!.name, member)}
                      >
                        <Bar
                          horizontal
                          at={y0 + 5}
                          breadth={14}
                          from={x(seg.from)}
                          to={x(seg.to)}
                          fill={seg.color}
                        />
                      </DomainPointMark>
                    ) : null,
                  )}
                  {d !== null && (
                    <DomainPointMark point={point(s, row, facts.contribution, member)}>
                      <Diamond x={x(d)} y={y0 + 12} />
                    </DomainPointMark>
                  )}
                  {facts.contribution && (
                    <text x={W - END_W + 10} y={y0 + 16} className="fv-strong">
                      {fmt(facts.contribution, row)}
                    </text>
                  )}
                </g>
              )
            })}
          </>
        )}
      </ChartFrame>
    </>
  )
}
