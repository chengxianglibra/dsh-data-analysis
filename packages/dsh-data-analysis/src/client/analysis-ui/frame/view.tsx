import { useEffect, useId, useMemo, useRef, useState } from 'react'
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
import { displayCell } from '../../presentation/display.ts'
import { DatasetTable } from '../../presentation/table.tsx'
import { Button } from '../../ui/primitives/button.tsx'
import { CardContent } from '../../ui/primitives/card.tsx'
import { Popover, PopoverAnchor, PopoverContent } from '../../ui/primitives/popover.tsx'
import { MetricGroup, ResultCard, ResultHeader } from '../components/result.tsx'
import { useAnalysisResources } from '../context.tsx'
import { AlignmentView } from './alignment.tsx'
import {
  ComparisonDetail,
  ComparisonTable,
  ComparisonView,
  comparisonRoles,
  comparisonTableSections,
  Numbers,
} from './comparison.tsx'
import {
  DecompositionView,
  decompositionChips,
  decompositionOf,
  decompositionTitle,
  decompositionTotal,
} from './decomposition.tsx'
import { FrameIcon } from './frame-icon.tsx'
import { Dialog, FrameIconButton, IconRow } from './icons.tsx'
import {
  type Chip,
  cellOf,
  columnOf,
  contextChips,
  displayFrameCell,
  endpointLabels,
  interpretationOf,
  isNumeric,
  type Snapshot,
  valueName,
} from './model.ts'
import {
  CorrelationPlot,
  HBarChart,
  Heatmap,
  PieChart,
  ShareView,
  TimeChart,
} from './observation.tsx'
import { FrameSelectionContext } from './selection-context.tsx'
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
  const t = useCopy()
  const data = membersData(snapshot)
  const ref = useFrozenColumns(data.columns.length > 1 ? 1 : 0)
  return (
    <div
      ref={ref}
      className="fv-frozen"
      data-frozen={data.columns.length > 1 ? 1 : undefined}
      style={{ maxHeight: height ?? 520, overflow: 'auto' }}
    >
      <DatasetTable
        data={data}
        caption=""
        hideRowCount
        hideExactTitle
        display={(value, column) => displayCell(t.locale, value, column)}
      />
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
  const t = useCopy()
  const common = { snapshot, classification, height }
  switch (view.chart) {
    case 'table':
      return view.layout === 'comparison' ? (
        <ComparisonTable snapshot={snapshot} classification={classification} />
      ) : (
        <DataTable
          snapshot={snapshot}
          columns={view.columns}
          height={height}
          frozen={keyColumns(snapshot, classification)}
          selectionFields={
            classification.class === 'observation' ? classification.primaryValues : undefined
          }
        />
      )
    case 'members':
      return <MembersTable snapshot={snapshot} height={height} />
    case 'metric':
      return (
        <MetricGroup
          items={view.values.map((name) => {
            const column = columnOf(snapshot, name)?.column
            const value = cellOf(snapshot, 0, name)
            return {
              key: name,
              value: column ? displayFrameCell(snapshot, t.locale, value, column) : String(value),
              label: view.values.length > 1 ? valueName(snapshot, classification, name) : undefined,
            }
          })}
        />
      )
    case 'line':
    case 'area':
    case 'bar':
    case 'interval-bar':
      return <TimeChart {...common} view={view} />
    case 'hbar':
      return <HBarChart {...common} view={view} />
    case 'heatmap':
      return <Heatmap {...common} view={view} />
    case 'pie':
      return <PieChart {...common} view={view} />
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

function title(
  t: Translator,
  s: Snapshot,
  c: FrameClassification,
  view: ResolvedFrameView,
  fallback?: string,
) {
  if (view.chart === 'table' && view.layout === 'comparison') {
    const section = comparisonTableSections(s).find((item) => item.rows.length)
    if (section) {
      const ends = endpointLabels(t, s, section.index)
      return `${ends.current} ⇄ ${ends.baseline}`
    }
  }
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
  const displayed =
    view.chart === 'metric'
      ? view.values
      : view.chart === 'heatmap'
        ? [view.value]
        : view.chart === 'line' ||
            view.chart === 'area' ||
            view.chart === 'bar' ||
            view.chart === 'interval-bar' ||
            view.chart === 'hbar'
          ? [...view.values, ...view.broadcast]
          : c.primaryValues
  const names = displayed.filter((n) => columnOf(s, n))
  return names.length
    ? names
        .slice(0, 3)
        .map((n) => valueName(s, c, n))
        .join(' · ') + (names.length > 3 ? ' …' : '')
    : fallback
}

function chartLabel(t: Translator, s: Snapshot, view: ResolvedFrameView): string {
  let kind: string = view.chart
  if (view.chart === 'metric' && view.values.length === 1) {
    const name = view.values[0]!
    const column = columnOf(s, name)?.column
    if (interpretationOf(s)?.valueContexts[name]?.kind === 'share') kind = 'percent'
    else if (column?.unit === 'USD' && isNumeric(column)) kind = 'currency'
    else if (isNumeric(column)) kind = 'number'
  } else if (view.chart === 'members') kind = 'table'
  else if (view.chart === 'hbar' || view.chart === 'interval-bar') kind = 'bar'
  return t(`marivo.presentation.ui-chart-kind-${kind}`)
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
          value: column ? displayFrameCell(s, t.locale, value, column) : String(value),
          title: name,
          label: symbol,
        },
      ]
      const count = view.counts[name]
      if (count) {
        const n = cellOf(s, 0, count)
        const countColumn = columnOf(s, count)?.column
        items.push({
          key: count,
          value: countColumn ? displayFrameCell(s, t.locale, n, countColumn) : '—',
          title: count,
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
  const { askPoint, candidate } = useAnalysisResources()
  const inlineData = display?.dataTable === 'visible'
  const [dataState, setDataState] = useState({ inline: inlineData, open: inlineData })
  const dataOpen = dataState.inline === inlineData ? dataState.open : inlineData
  const [selection, setSelection] = useState<{ snapshot: Snapshot; row: number; field: string }>()
  const [status, setStatus] = useState<'pending' | 'added' | 'failed'>()
  const requestRevision = useRef(0)
  useEffect(
    () => () => {
      requestRevision.current++
    },
    [],
  )
  const selected = !candidate && selection?.snapshot === s ? selection : undefined
  const menuRef = useRef<HTMLDivElement>(null)
  const originRef = useRef<HTMLElement | SVGElement | null>(null)
  const originScopeRef = useRef<Element | null>(null)
  const modalRequestFocus = useRef(false)
  const closeReason = useRef<'escape' | 'tab' | 'outside'>('outside')
  const originPointRef = useRef<{ row: number; field: string }>()
  const scopeId = useId()
  const restorePointOrigin = () => {
    const point = originPointRef.current
    const scope = originScopeRef.current?.isConnected
      ? originScopeRef.current
      : document.querySelector(`[data-frame-scope="${scopeId}"]`)
    const original = originRef.current
    if (original?.isConnected) {
      original.focus()
      return
    }
    if (!scope || !point) return
    const target = [
      ...scope.querySelectorAll<HTMLElement | SVGElement>('[data-frame-point], .pr-cell-select'),
    ].find(
      (node) =>
        node.getAttribute('data-frame-point') === `${point.row}:${point.field}` ||
        (node.closest('[data-row-index]')?.getAttribute('data-row-index') === String(point.row) &&
          node.closest('[data-column-id]')?.getAttribute('data-column-id') === point.field),
    )
    target?.focus()
    if (target) originRef.current = target
  }
  useEffect(() => {
    if (!selected || (status !== 'added' && status !== 'failed')) return
    const origin = originRef.current
    if (origin?.isConnected && origin.closest('[role="dialog"], dialog[open]'))
      menuRef.current?.querySelector('button')?.focus()
  }, [selected, status])
  const pointPosition = useRef({ x: 0, y: 0 })
  const virtualAnchor = useRef({
    getBoundingClientRect: () =>
      new DOMRect(pointPosition.current.x, pointPosition.current.y, 0, 0),
  })
  const selectable = useMemo(
    () =>
      !candidate && askPoint && resourceName
        ? {
            select(row: number, field: string) {
              if (status === 'pending') return
              const index = s.data.columns.findIndex((column) => column.id === field)
              if (!Number.isInteger(row) || row < 0 || row >= s.data.rows.length || index < 0)
                return
              if (s.data.rows[row]?.[index] == null) return
              modalRequestFocus.current = false
              closeReason.current = 'outside'
              originPointRef.current = { row, field }
              originScopeRef.current =
                originRef.current?.closest('[role="dialog"], [data-frame-scope]') ?? null
              requestRevision.current++
              setStatus(undefined)
              setSelection({ snapshot: s, row, field })
            },
          }
        : undefined,
    [askPoint, candidate, resourceName, s, status],
  )
  const compactDensity = display?.density === 'compact'
  const name = title(t, s, c, view, resourceName)
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
  const allColumns = s.data.columns.map((col) => col.id)
  const mainIsTable =
    view.chart === 'table' ||
    view.chart === 'members' ||
    (view.chart === 'comparison' && view.style === 'table') ||
    (view.chart === 'alignment' && (view.style === 'table' || view.pairs.length === 0))
  const showData = (!compactDensity || showMain) && !mainIsTable
  const dataLabel = t('marivo.presentation.ui-frame-data-table')
  const pointMenu = selected && (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) setSelection(undefined)
      }}
    >
      <PopoverAnchor virtualRef={virtualAnchor} />
      <PopoverContent
        className="fv-point-menu w-auto"
        ref={menuRef}
        role="menu"
        align="start"
        side="bottom"
        sticky="always"
        collisionPadding={8}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (closeReason.current === 'escape') requestAnimationFrame(restorePointOrigin)
        }}
        onFocusOutside={(event) => {
          const target = event.target
          const origin = originRef.current
          if (
            modalRequestFocus.current ||
            (target instanceof Element && (target === origin || target === origin?.closest('svg')))
          ) {
            event.preventDefault()
            if (modalRequestFocus.current)
              requestAnimationFrame(() => menuRef.current?.querySelector('button')?.focus())
          }
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          menuRef.current?.querySelector('button')?.focus()
        }}
        onEscapeKeyDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
          closeReason.current = 'escape'
          setSelection(undefined)
          restorePointOrigin()
          requestAnimationFrame(restorePointOrigin)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Tab') {
            closeReason.current = 'tab'
            setSelection(undefined)
            restorePointOrigin()
          }
        }}
      >
        <Button
          variant="ghost"
          size="sm"
          type="button"
          role="menuitem"
          aria-disabled={status === 'pending' || undefined}
          aria-busy={status === 'pending' || undefined}
          onClick={() => {
            if (status === 'pending' || !askPoint || !resourceName) return
            const revision = ++requestRevision.current
            modalRequestFocus.current = !!originRef.current?.closest('[role="dialog"],dialog[open]')
            setStatus('pending')
            void askPoint({ resourceName, row: selected.row, field: selected.field }).then(
              () => {
                if (requestRevision.current === revision) setStatus('added')
              },
              () => {
                if (requestRevision.current === revision) setStatus('failed')
              },
            )
          }}
        >
          {t('marivo.presentation.ui-frame-ask-point')}
        </Button>
        {status && status !== 'pending' && (
          <p role="status">
            {t(
              status === 'added'
                ? 'marivo.presentation.ui-frame-ask-added'
                : 'marivo.presentation.ui-frame-ask-failed',
            )}
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
  const dataTable =
    c.class === 'comparison' ? (
      s.data.rows.length === 1 ? (
        <ComparisonTable snapshot={s} classification={c} reference />
      ) : (
        <ComparisonDetail snapshot={s} />
      )
    ) : (
      <DataTable
        snapshot={s}
        frozen={keyColumns(s, c)}
        selectionFields={c.class === 'observation' ? c.primaryValues : undefined}
        reference
      />
    )
  return (
    <FrameSelectionContext.Provider value={selectable}>
      <ResultCard
        data-frame-scope={scopeId}
        data-resource={resourceName}
        data-resource-kind="frame"
        data-frame-class={c.class}
        data-frame-shape={c.shape}
        data-frame-view={view.chart}
        data-density={compactDensity ? 'compact' : 'full'}
        onClickCapture={(event) => {
          if ((event.target as Element).closest('.fv-point-menu')) return
          const target = event.target as Element
          const origin = target.closest('button, [role=button]')
          if (origin instanceof HTMLElement || origin instanceof SVGElement)
            originRef.current = origin
          const rect = target.getBoundingClientRect()
          const x = event.clientX || rect.left
          const y = event.clientY || rect.bottom
          pointPosition.current = {
            x: Math.max(8, Math.min(x, window.innerWidth - 180)),
            y: Math.max(8, Math.min(y, window.innerHeight - 100)),
          }
        }}
        onKeyDownCapture={(event) => {
          if (
            (event.key === 'Enter' || event.key === ' ') &&
            !(event.target instanceof Element && event.target.closest('.fv-point-menu'))
          ) {
            const target = event.target
            if (target instanceof HTMLElement || target instanceof SVGElement)
              originRef.current = target
            ;(target as Element).scrollIntoView({ block: 'nearest', inline: 'nearest' })
            const rect = (target as Element).getBoundingClientRect()
            pointPosition.current = { x: rect.left, y: rect.bottom }
          }
        }}
      >
        <ResultHeader
          title={name}
          actions={
            <div className="fv-header-actions">
              <span className="fv-chart-tag">{chartLabel(t, s, view)}</span>
              {!compactDensity && !candidate && (
                <CopyData
                  data={s.data}
                  columns={view.chart === 'table' ? view.columns : allColumns}
                />
              )}
            </div>
          }
        >
          {!compactDensity && chips.length > 0
            ? chips.map((chip) => chip.label).join(' · ')
            : undefined}
        </ResultHeader>
        <CardContent className="space-y-4 min-w-0">
          {compactDensity && decomposition?.restricted && (
            <p className="au-result-status" role="status">
              {t('marivo.presentation.ui-frame-restricted-scope')}
            </p>
          )}
          {!s.coverage.complete && (
            <p className="au-result-status" role="status">
              {t('marivo.presentation.ui-capture-range', {
                p0: s.coverage.capturedRows,
                p1: s.coverage.totalRows,
              })}
            </p>
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
          {!(showData && !inlineData && dataOpen) && pointMenu}
          <IconRow
            snapshot={s}
            view={view}
            codeRef={codeRef}
            compact={compactDensity}
            dataControl={
              showData ? (
                <FrameIconButton
                  kind="data"
                  label={dataLabel}
                  tip={dataLabel}
                  expanded={inlineData ? dataOpen : undefined}
                  hasPopup={inlineData ? undefined : 'dialog'}
                  onOpen={
                    candidate
                      ? undefined
                      : () => setDataState({ inline: inlineData, open: !dataOpen })
                  }
                >
                  <FrameIcon kind="table" />
                  <span className="fv-data-label">{dataLabel} ↗</span>
                </FrameIconButton>
              ) : undefined
            }
          />
          {showData && inlineData && dataOpen && (
            <div className="fv-data-reference">{dataTable}</div>
          )}
          {showData && !inlineData && (
            <Dialog
              title={dataLabel}
              open={dataOpen}
              onClose={() => setDataState({ inline: false, open: false })}
            >
              <div className="fv-data-reference">{dataTable}</div>
              {pointMenu}
            </Dialog>
          )}
        </CardContent>
      </ResultCard>
    </FrameSelectionContext.Provider>
  )
}
