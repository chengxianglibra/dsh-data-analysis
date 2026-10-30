import { useMemo } from 'react'
import {
  type FrameClassification,
  type FrameDisplay,
  type FrameView as FrameViewSpec,
  type ResolvedFrameView,
  resolveFrameView,
} from '../../../presentation/contracts/frame-view.ts'
import type { TypedDataset } from '../../../presentation/contracts/types.ts'
import type { PythonCodeRef } from '../../../python-execution-contracts.ts'
import { useCopy } from '../../i18n/context.tsx'
import type { Translator } from '../../i18n/copy.ts'
import { DatasetTable } from '../../presentation/table.tsx'
import { useAnalysisResources } from '../context.tsx'
import { AlignmentView } from './alignment.tsx'
import { ComparisonView, comparisonRoles, Numbers } from './comparison.tsx'
import {
  DecompositionView,
  decompositionChips,
  decompositionOf,
  decompositionTitle,
  decompositionTotal,
} from './decomposition.tsx'
import { IconRow } from './icons.tsx'
import {
  type Chip,
  cellOf,
  columnOf,
  compact,
  contextChips,
  exact,
  interpretationOf,
  type Snapshot,
  valueName,
} from './model.ts'
import {
  CorrelationPlot,
  HBarChart,
  Heatmap,
  MetricCards,
  ShareView,
  TimeChart,
} from './observation.tsx'
import { CopyData, DataTable, useFrozenColumns } from './table.tsx'

export interface FrameShellProps {
  snapshot: Snapshot
  classification: FrameClassification
  view: ResolvedFrameView
  display?: FrameDisplay
  resourceName?: string
  codeRef?: PythonCodeRef
}

/** Saved v2 Frame: resolution is the only source of class, shape and chosen view. */
export function AnalysisFrame({
  snapshot,
  view,
  ...rest
}: Omit<FrameShellProps, 'classification' | 'view'> & { view?: FrameViewSpec }) {
  const t = useCopy()
  const { candidate } = useAnalysisResources()
  const resolution = useMemo(() => {
    const explicit = resolveFrameView(snapshot, view)
    // Saved views were validated before saving; only a streaming candidate may fall back to auto.
    return explicit.ok || !candidate ? explicit : resolveFrameView(snapshot)
  }, [snapshot, view, candidate])
  if (!resolution.ok) return <p role="alert">{t('marivo.presentation.ui-resource-unavailable')}</p>
  return (
    <FrameShell
      snapshot={snapshot}
      classification={resolution.classification}
      view={resolution.view}
      {...rest}
    />
  )
}

/** Leading coordinate columns of the saved layout: the record keys kept in view. */
function keyColumns(s: Snapshot, c: FrameClassification): number {
  if (c.shape !== 'records') return 0
  const first = s.frame.layout.findIndex((l) => l.kind !== 'coordinate')
  return first < 0 ? s.frame.layout.length : first
}

function MembersTable({ snapshot, height }: { snapshot: Snapshot; height?: number }) {
  const data = membersData(snapshot)
  const ref = useFrozenColumns(data.columns.length > 1 ? 1 : 0)
  return (
    <div
      ref={ref}
      className="fv-frozen"
      data-frozen={data.columns.length > 1 ? 1 : undefined}
      style={{ maxHeight: height ?? 520, overflow: 'auto' }}
    >
      <DatasetTable data={data} caption="" />
    </div>
  )
}

/** Composite member keys, one column per key slot, read from the saved coordinates. */
function membersData(s: Snapshot): TypedDataset {
  const keys = s.frame.axes.flatMap((a) => a.keys)
  const columns = keys.flatMap((k) => {
    const coordinate = s.frame.coordinates[k.slotId]
    return coordinate ? [coordinate] : []
  })
  return {
    ...s.data,
    columns: columns.map((c) => c.column),
    rows: s.data.rows.map((_, i) => columns.map((c) => c.values[i] ?? null)),
  }
}

export function MainView({
  snapshot,
  classification,
  view,
  height,
}: {
  snapshot: Snapshot
  classification: FrameClassification
  view: ResolvedFrameView
  height?: number
}) {
  const common = { snapshot, classification, height }
  switch (view.chart) {
    case 'table':
      return (
        <DataTable
          snapshot={snapshot}
          columns={view.columns}
          height={height}
          frozen={keyColumns(snapshot, classification)}
        />
      )
    case 'members':
      return <MembersTable snapshot={snapshot} height={height} />
    case 'metric':
      return <MetricCards {...common} view={view} />
    case 'line':
    case 'area':
    case 'bar':
    case 'interval-bar':
      return <TimeChart {...common} view={view} />
    case 'hbar':
      return <HBarChart {...common} view={view} />
    case 'heatmap':
      return <Heatmap {...common} view={view} />
    case 'comparison':
      return <ComparisonView {...common} view={view} />
    case 'decomposition':
      return <DecompositionView {...common} view={view} />
    case 'correlation':
      return <CorrelationPlot {...common} view={view} />
    case 'alignment':
      return <AlignmentView {...common} view={view} />
    case 'share':
      return <ShareView {...common} view={view} />
  }
}

function title(s: Snapshot, c: FrameClassification, view: ResolvedFrameView, fallback?: string) {
  if (view.chart === 'comparison') {
    const roles = comparisonRoles(s, view.comparison, view.group)
    if (roles?.current) return valueName(s, c, roles.current)
  }
  if (view.chart === 'decomposition') {
    const facts = decompositionOf(s, view.decomposition)
    if (facts) return decompositionTitle(s, facts)
  }
  if (view.chart === 'correlation') {
    // Captured operands name what was correlated; derived inputs show their value origins.
    const context = interpretationOf(s)?.valueContexts[view.values[0] ?? '']
    if (context?.kind === 'pair_statistic') {
      const operand = (input: typeof context.x) =>
        input.kind === 'named'
          ? input.name
          : input.origins.map((o) => o.path.split('.').at(-1)).join(' · ')
      return `${operand(context.x)} ↔ ${operand(context.y)}`
    }
  }
  if (c.class === 'members') return s.frame.axes.map((a) => a.name).join(' · ') || fallback
  const names = c.primaryValues.filter((n) => columnOf(s, n))
  return names.length
    ? names
        .slice(0, 3)
        .map((n) => valueName(s, c, n))
        .join(' · ') + (names.length > 3 ? ' …' : '')
    : fallback
}

type NumberItem = Parameters<typeof Numbers>[0]['items'][number]
/** Header numbers per class; every number is a saved cell or saved count. */
function headerNumbers(
  t: Translator,
  s: Snapshot,
  c: FrameClassification,
  view: ResolvedFrameView,
): NumberItem[] {
  if (view.chart === 'decomposition') {
    const facts = decompositionOf(s, view.decomposition)
    const total = facts && decompositionTotal(t, s, facts)
    return total ? [total] : []
  }
  if (view.chart === 'correlation' && s.frame.axes.length === 0 && s.data.rows.length === 1) {
    const contexts = interpretationOf(s)?.valueContexts ?? {}
    return view.values.flatMap((name) => {
      const context = contexts[name]
      const symbol =
        context?.kind === 'pair_statistic' && context.statistic === 'spearman' ? 'ρ' : 'r'
      const value = cellOf(s, 0, name)
      const column = columnOf(s, name)?.column
      const items: NumberItem[] = [
        {
          key: name,
          value: compact(t.locale, value, column),
          title: `${name}: ${exact(value, column)}`,
          label: symbol,
        },
      ]
      const count = view.counts[name]
      if (count) {
        const n = cellOf(s, 0, count)
        items.push({
          key: count,
          value: n === null ? '—' : String(n),
          title: `${count}: ${exact(n, columnOf(s, count)?.column)}`,
          label: 'n',
        })
      }
      return items
    })
  }
  if (c.class === 'members')
    return [
      {
        key: 'members',
        value: s.coverage.totalRows.toLocaleString(t.locale),
        title: String(s.coverage.totalRows),
        label: t('marivo.presentation.ui-frame-members'),
      },
    ]
  return []
}

export function FrameShell({
  snapshot: s,
  classification: c,
  view,
  display,
  resourceName,
  codeRef,
}: FrameShellProps) {
  const t = useCopy()
  const compactDensity = display?.density === 'compact'
  const name = title(s, c, view, resourceName)
  const decomposition =
    view.chart === 'decomposition' ? decompositionOf(s, view.decomposition) : undefined
  const chips: Chip[] = [
    ...contextChips(t, s, c.primaryValues),
    ...(decomposition ? decompositionChips(decomposition) : []),
  ].filter((chip, i, all) => all.findIndex((x) => x.label === chip.label) === i)
  const numbers = headerNumbers(t, s, c, view)
  // A single-row comparison carries its own header numbers next to the alias control.
  const comparisonNumbers = view.chart === 'comparison' && s.data.rows.length === 1
  const hasNumbers = numbers.length > 0 || comparisonNumbers
  const showMain = !compactDensity || !hasNumbers
  const tableAsMain = view.chart === 'table' || view.chart === 'members'
  const allColumns = s.data.columns.map((col) => col.id)
  return (
    <section
      className="fv au-data"
      data-resource={resourceName}
      data-resource-kind="frame"
      data-frame-class={c.class}
      data-frame-shape={c.shape}
      data-frame-view={view.chart}
      data-density={compactDensity ? 'compact' : 'full'}
    >
      <div className="fv-head">
        <h3 className="fv-title">{name}</h3>
        {!compactDensity && (
          <span>
            <CopyData data={s.data} columns={view.chart === 'table' ? view.columns : allColumns} />
          </span>
        )}
      </div>
      {!compactDensity && s.frame.description && <p className="fv-desc">{s.frame.description}</p>}
      {!compactDensity && chips.length > 0 && (
        <ul className="fv-chips">
          {chips.map((chip) => (
            <li key={chip.label} title={chip.title}>
              {chip.label}
            </li>
          ))}
        </ul>
      )}
      {numbers.length > 0 && <Numbers items={numbers} />}
      {view.chart === 'comparison' ? (
        <ComparisonView
          snapshot={s}
          classification={c}
          view={view}
          height={display?.height}
          numbers={comparisonNumbers}
          body={showMain}
          control={!compactDensity}
        />
      ) : (
        showMain && (
          <MainView snapshot={s} classification={c} view={view} height={display?.height} />
        )
      )}
      {!compactDensity && !tableAsMain && (
        <details className="fv-table" open={display?.dataTable === 'visible'}>
          <summary>{t('marivo.presentation.ui-frame-data-table')}</summary>
          <DataTable snapshot={s} frozen={keyColumns(s, c)} />
        </details>
      )}
      <IconRow snapshot={s} view={view} codeRef={codeRef} compact={compactDensity} />
    </section>
  )
}
