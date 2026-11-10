import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { resolveDatasetView } from '../../presentation/contracts/dataset-view.ts'
import { validateFrameDisplay } from '../../presentation/contracts/frame-display.ts'
import {
  type FrameDisplay,
  type FrameView,
  resolveFrameView,
} from '../../presentation/contracts/frame-view.ts'
import { formatCell } from '../../presentation/contracts/index.ts'
import {
  type AnalysisSnapshot,
  type DatasetSnapshot,
  isFrameSnapshotV2,
} from '../../presentation/contracts/snapshot.ts'
import type { TypedDataset } from '../../presentation/contracts/types.ts'
import type { PythonExecutionDatasource } from '../../python-execution-contracts.ts'
import { useCopy } from '../i18n/context.tsx'
import { DatasetTable } from '../presentation/table.tsx'
import { FishLogo } from '../ui/fish-logo.tsx'
import { Alert, AlertDescription } from '../ui/primitives/alert.tsx'
import { Button } from '../ui/primitives/button.tsx'
import { CardContent } from '../ui/primitives/card.tsx'
import { Popover, PopoverAnchor, PopoverContent } from '../ui/primitives/popover.tsx'
import { Skeleton } from '../ui/primitives/skeleton.tsx'
import { datasetChartModel } from './charts/dataset-model.ts'
import { Heatmap, TimeChart } from './charts/observation.tsx'
import { ChartSelectionContext, useChartSelection } from './charts/selection-context.tsx'
import { DataActions, MetricGroup, ResultCard, ResultHeader } from './components/result.tsx'
import { type ComponentIdentity, useAnalysisResources } from './context.tsx'
import { useFocusAfterAsk } from './focus-after-ask.ts'
import { FrameIcon } from './frame/frame-icon.tsx'
import { CoverageIcon, Dialog, FrameIconButton } from './frame/icons.tsx'
import { AnalysisFrame } from './frame/view.tsx'
import { useReportReading } from './reading-state.tsx'
import { ResourceAskButton } from './resource-ask-button.tsx'

export interface AnalysisViewProps {
  ref?: string
  view?: FrameView
  display?: FrameDisplay
}

type CodeState =
  | { kind: 'idle' }
  | { kind: 'loading' | 'failed' | 'mismatch'; key: string }
  | {
      kind: 'ok'
      key: string
      text: string
      datasources?: PythonExecutionDatasource[]
    }

/** Retain exact Dataset formatting and an accessible description of local overflow. */
function DatasetDisplayTable({
  data,
  columns,
  height,
  caption,
}: {
  data: TypedDataset
  columns?: string[]
  height?: number
  caption: string
}) {
  const t = useCopy()
  const selection = useChartSelection()
  const ref = useRef<HTMLDivElement>(null)
  const [scrollable, setScrollable] = useState(false)
  const hintId = useId()
  useEffect(() => {
    const region = ref.current?.querySelector<HTMLElement>('.pr-table-scroll')
    if (!region) return
    const update = () => setScrollable(region.scrollWidth > region.clientWidth + 1)
    const observer = new ResizeObserver(update)
    observer.observe(region)
    const table = region.querySelector('table')
    if (table) observer.observe(table)
    update()
    return () => observer.disconnect()
  }, [])
  return (
    <>
      <div className="fv-sr-only">
        {scrollable && <span id={hintId}>{t('marivo.presentation.ui-frame-scroll-hint')}</span>}
      </div>
      <div ref={ref} style={{ maxHeight: height ?? 520, overflow: 'auto' }}>
        <DatasetTable
          data={data}
          columns={columns}
          caption={caption}
          scrollDescription={scrollable ? hintId : undefined}
          hideRowCount
          selectCell={selection?.select}
          selectableColumns={
            selection ? new Set(columns ?? data.columns.map((c) => c.id)) : undefined
          }
        />
      </div>
    </>
  )
}

export function AnalysisDataView({
  resourceName,
  view,
  display,
  kind,
  component,
  configuration,
}: Omit<AnalysisViewProps, 'ref'> & {
  resourceName?: string
  kind: AnalysisSnapshot['kind']
  component?: ComponentIdentity
  configuration?: 'pending' | 'invalid'
}) {
  const t = useCopy()
  const { readResource, candidate, isStreaming, removedResourceNames } = useAnalysisResources()
  const resource = resourceName ? readResource(resourceName) : undefined
  const removed = Boolean(resourceName && removedResourceNames?.includes(resourceName))
  const snapshot =
    resource?.kind === 'snapshot' && resource.snapshot.kind === kind ? resource.snapshot : undefined
  const resolution =
    snapshot && !configuration
      ? isFrameSnapshotV2(snapshot)
        ? resolveFrameView(snapshot, view)
        : resolveDatasetView(snapshot, view)
      : undefined
  const valid =
    snapshot &&
    resolution?.ok &&
    (!isFrameSnapshotV2(snapshot) || !validateFrameDisplay(snapshot, resolution.view, display))
  const ready =
    valid && resource?.kind === 'snapshot'
      ? { resource, resourceName, view, display, component }
      : undefined
  const reading = useReportReading()
  const previous = useRef<{ reading: typeof reading; value: NonNullable<typeof ready> }>()
  useLayoutEffect(() => {
    if (ready) previous.current = { reading, value: ready }
    else if (!candidate || removed) previous.current = undefined
  })
  // Retain the exact prior snapshot AND configuration while a replacement arrives.
  // Explicit removal and saved-reader failures never resurrect old content.
  const visible =
    ready ??
    (candidate && !removed && previous.current && previous.current.reading === reading
      ? previous.current.value
      : undefined)
  if (!visible) {
    if (candidate && isStreaming && !removed)
      return (
        <div role="status" aria-label={t('marivo.presentation.ui-resource-pending')}>
          <Skeleton className="h-24 w-full" />
        </div>
      )
    return (
      <Alert role="alert" variant="destructive">
        <AlertDescription>{t('marivo.presentation.ui-resource-unavailable')}</AlertDescription>
      </Alert>
    )
  }
  if (isFrameSnapshotV2(visible.resource.snapshot))
    return (
      <AnalysisFrame
        snapshot={visible.resource.snapshot}
        component={visible.component}
        view={visible.view}
        display={visible.display}
        resourceName={visible.resourceName}
        codeRef={visible.resource.binding.codeRef}
      />
    )
  return (
    <DatasetDataView
      resourceName={visible.resourceName}
      component={visible.component}
      snapshot={visible.resource.snapshot}
      binding={visible.resource.binding}
      view={visible.view}
      height={visible.display?.height}
    />
  )
}

/** Dataset snapshots use column mappings and the shared plot components. */
function DatasetDataView({
  resourceName,
  component,
  snapshot,
  binding,
  view,
  height,
}: {
  resourceName?: string
  component?: ComponentIdentity
  snapshot: DatasetSnapshot
  binding: {
    sessionId?: string
    callId?: string
    codeRef?: { executionId: string; sha256: string }
  }
  view?: FrameView
  height?: number
}) {
  const t = useCopy()
  const [dataOpen, setDataOpen] = useState(false)
  const [sourceOpen, setSourceOpen] = useState(false)
  const [code, setCode] = useState<CodeState>({ kind: 'idle' })
  const [copied, setCopied] = useState<{ key: string; message: string }>()
  const { candidate, offline, readCode, askDataset, askResource } = useAnalysisResources()
  const [selected, setSelected] = useState<{
    snapshot: DatasetSnapshot
    resource: string
    row: number
    field: string
  }>()
  const [askStatus, setAskStatus] = useState<'pending' | 'failed'>()
  const focusAfterAsk = useFocusAfterAsk()
  const revision = useRef(0)
  const identity = useRef({ snapshot, resourceName })
  if (identity.current.snapshot !== snapshot || identity.current.resourceName !== resourceName) {
    revision.current++
    identity.current = { snapshot, resourceName }
  }
  useEffect(() => {
    if (identity.current.snapshot !== snapshot || identity.current.resourceName !== resourceName)
      return
    setSelected(undefined)
    setAskStatus(undefined)
  }, [snapshot, resourceName])
  const originRef = useRef<HTMLElement | SVGElement | null>(null)
  const originScope = useRef<Element | null>(null)
  const originPoint = useRef<{ row: number; field: string }>()
  const menuRef = useRef<HTMLDivElement>(null)
  const modalRequestFocus = useRef(false)
  const closeReason = useRef<'escape' | 'tab' | 'outside'>('outside')
  const scopeId = useId()
  const position = useRef({ x: 0, y: 0 })
  const virtualAnchor = useRef({
    getBoundingClientRect: () => new DOMRect(position.current.x, position.current.y, 0, 0),
  })
  const activeSelection =
    !candidate && selected?.snapshot === snapshot && selected.resource === resourceName
      ? selected
      : undefined
  useEffect(
    () => () => {
      revision.current++
    },
    [],
  )
  const restoreOrigin = () => {
    const point = originPoint.current
    const scope = originScope.current?.isConnected
      ? originScope.current
      : document.querySelector(`[data-dataset-scope="${scopeId}"]`)
    if (originRef.current?.isConnected) return originRef.current.focus()
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
  const restoreOriginLater = () => {
    const current = revision.current
    requestAnimationFrame(() => {
      if (revision.current === current) restoreOrigin()
    })
  }
  useEffect(() => {
    if (!activeSelection || askStatus !== 'failed') return
    if (
      originRef.current?.isConnected &&
      originRef.current.closest('[role="dialog"], dialog[open]')
    )
      menuRef.current?.querySelector('button')?.focus()
  }, [activeSelection, askStatus])
  const selectable = useMemo(
    () =>
      !candidate && askDataset && resourceName
        ? {
            select(row: number, field: string) {
              if (askStatus === 'pending') return
              const index = snapshot.data.columns.findIndex((column) => column.id === field)
              if (
                !Number.isInteger(row) ||
                row < 0 ||
                row >= snapshot.data.rows.length ||
                index < 0 ||
                snapshot.data.rows[row]?.[index] == null
              )
                return
              modalRequestFocus.current = false
              closeReason.current = 'outside'
              originPoint.current = { row, field }
              originScope.current =
                originRef.current?.closest('[role="dialog"], [data-dataset-scope]') ?? null
              revision.current++
              setAskStatus(undefined)
              setSelected({ snapshot, resource: resourceName, row, field })
            },
          }
        : undefined,
    [askDataset, candidate, resourceName, snapshot, askStatus],
  )
  const codeRef = binding.codeRef
  const codeKey = codeRef ? JSON.stringify([codeRef.executionId, codeRef.sha256]) : undefined
  const currentKey = useRef(codeKey)
  currentKey.current = codeKey
  const currentCode = code.kind !== 'idle' && code.key === codeKey ? code : undefined
  const copyCode = async (text: string, key: string) => {
    const ok = await Promise.resolve()
      .then(() => navigator.clipboard.writeText(text))
      .then(() => true)
      .catch(() => false)
    if (currentKey.current === key)
      setCopied({
        key,
        message: ok ? 'marivo.presentation.copied' : 'marivo.presentation.ui-copy-failed',
      })
  }
  useEffect(() => {
    if (!sourceOpen || !codeRef || !codeKey || !readCode) return
    const controller = new AbortController()
    setCode((current) =>
      current.kind === 'ok' && current.key === codeKey
        ? current
        : { kind: 'loading', key: codeKey },
    )
    readCode(codeRef, controller.signal)
      .then((record) => {
        if (controller.signal.aborted) return
        if (!record) return setCode({ kind: 'failed', key: codeKey })
        setCode(
          record.sha256 === codeRef.sha256
            ? {
                kind: 'ok',
                key: codeKey,
                text: record.text,
                datasources: record.datasources,
              }
            : { kind: 'mismatch', key: codeKey },
        )
      })
      .catch(() => {
        if (!controller.signal.aborted) setCode({ kind: 'failed', key: codeKey })
      })
    return () => controller.abort()
  }, [sourceOpen, codeRef, codeKey, readCode])
  const resolution = useMemo(() => resolveDatasetView(snapshot, view), [snapshot, view])
  const resolved = resolution.ok ? resolution.view : undefined
  const chart =
    resolved && resolved.chart !== 'table' && resolved.chart !== 'metric' ? resolved : undefined
  const model = useMemo(
    () =>
      datasetChartModel(
        snapshot.data,
        chart
          ? chart.chart === 'heatmap'
            ? [chart.x, chart.y]
            : [chart.axis, ...(chart.series ? [chart.series] : [])]
          : [],
      ),
    [snapshot, chart],
  )
  if (!resolution.ok)
    return (
      <Alert role="alert" variant="destructive">
        <AlertDescription>{t('marivo.presentation.ui-resource-unavailable')}</AlertDescription>
      </Alert>
    )
  const kind = snapshot.kind
  const data = snapshot.data
  const columns =
    (resolved?.chart === 'table' ? resolved.columns : undefined) ?? data.columns.map((c) => c.id)
  const metricColumn =
    resolved?.chart === 'metric' ? data.columns.find((c) => c.id === resolved.values[0]) : undefined
  const metric = metricColumn && snapshot.coverage.complete && data.rowCount === 1
  const titleFields =
    resolved?.chart === 'metric'
      ? resolved.values
      : resolved?.chart === 'heatmap'
        ? [resolved.value]
        : resolved?.chart === 'line' || resolved?.chart === 'area' || resolved?.chart === 'bar'
          ? resolved.values
          : []
  const titleNames = titleFields.flatMap((name) => {
    const column = data.columns.find((item) => item.id === name)
    return column ? [column.label] : []
  })
  const title = titleNames.length
    ? titleNames.slice(0, 3).join(' · ') + (titleNames.length > 3 ? ' …' : '')
    : resourceName
  const codeStatus =
    currentCode?.kind === 'ok'
      ? 'ready'
      : !codeRef
        ? 'missing'
        : !readCode
          ? 'read-failed'
          : currentCode?.kind === 'mismatch'
            ? 'mismatch'
            : currentCode?.kind === 'failed'
              ? 'read-failed'
              : 'loading'
  const pointMenu = activeSelection && (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) setSelected(undefined)
      }}
    >
      <PopoverAnchor virtualRef={virtualAnchor} />
      <PopoverContent
        className="fv-point-menu w-auto !gap-0 !bg-transparent !p-0 !shadow-none !ring-0"
        ref={menuRef}
        role="menu"
        align="start"
        side="top"
        sticky="always"
        collisionPadding={8}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (closeReason.current === 'escape') restoreOriginLater()
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
          setSelected(undefined)
          restoreOrigin()
          restoreOriginLater()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Tab') {
            closeReason.current = 'tab'
            setSelected(undefined)
            restoreOrigin()
          }
        }}
      >
        <Button
          variant="outline"
          size="default"
          type="button"
          role="menuitem"
          aria-disabled={askStatus === 'pending' || undefined}
          aria-busy={askStatus === 'pending' || undefined}
          onClick={() => {
            if (askStatus === 'pending' || !askDataset || !resourceName) return
            const request = ++revision.current
            modalRequestFocus.current = !!originRef.current?.closest('[role="dialog"],dialog[open]')
            setAskStatus('pending')
            void askDataset({
              resourceName,
              row: activeSelection.row,
              field: activeSelection.field,
            }).then(
              (focus) => {
                if (revision.current !== request) return
                setAskStatus(undefined)
                if (!menuRef.current) return
                focusAfterAsk.prepare(
                  focus ?? undefined,
                  menuRef.current.contains(document.activeElement),
                )
                modalRequestFocus.current = false
                setSelected(undefined)
                if (dataOpen) setDataOpen(false)
                else requestAnimationFrame(focusAfterAsk.finish)
              },
              () => {
                if (revision.current === request) setAskStatus('failed')
              },
            )
          }}
        >
          {t('marivo.presentation.ui-frame-ask-point')}
          <FishLogo size={18} />
        </Button>
        {askStatus && askStatus !== 'pending' && (
          <p role="status">{t('marivo.presentation.ui-dataset-ask-failed')}</p>
        )}
      </PopoverContent>
    </Popover>
  )
  return (
    <ChartSelectionContext.Provider value={selectable}>
      <ResultCard
        data-dataset-scope={scopeId}
        data-resource={resourceName}
        data-resource-kind={kind}
        data-dataset-view={resolved?.chart}
        onClickCapture={(event) => {
          if ((event.target as Element).closest('.fv-point-menu')) return
          const target = event.target as Element
          const origin = target.closest('button, [role=button]')
          if (origin instanceof HTMLElement || origin instanceof SVGElement)
            originRef.current = origin
          const rect = target.getBoundingClientRect()
          position.current = {
            x: Math.max(0, Math.min(event.clientX || rect.right, window.innerWidth)),
            y: Math.max(0, Math.min(event.clientY || rect.top, window.innerHeight)),
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
            position.current = { x: rect.right, y: rect.top }
          }
        }}
      >
        <ResultHeader
          title={title}
          actions={
            <div className="fv-header-actions">
              {!candidate && askResource && resourceName && component && (
                <ResourceAskButton
                  component={component}
                  resourceName={resourceName}
                  snapshot={snapshot}
                  ask={askResource}
                />
              )}
            </div>
          }
        />
        <CardContent className="space-y-4 min-w-0">
          {!snapshot.coverage.complete && (
            <p className="au-result-status" role="status">
              {t('marivo.presentation.ui-capture-range', {
                p0: snapshot.coverage.capturedRows,
                p1: snapshot.coverage.totalRows,
              })}
            </p>
          )}
          {chart ? (
            chart.chart === 'heatmap' ? (
              <Heatmap model={model} view={chart} height={height} />
            ) : (
              <TimeChart model={model} view={chart} height={height} />
            )
          ) : metric ? (
            <MetricGroup
              items={[
                {
                  key: metricColumn.id,
                  value:
                    selectable && data.rows[0]![data.columns.indexOf(metricColumn)] != null ? (
                      <button
                        type="button"
                        className="pr-cell-select"
                        data-frame-point={`0:${metricColumn.id}`}
                        aria-label={`${t('marivo.presentation.ui-frame-select-point')}: ${metricColumn.label}, ${formatCell(data.rows[0]![data.columns.indexOf(metricColumn)]!, metricColumn)}`}
                        onClick={() => selectable.select(0, metricColumn.id)}
                      >
                        {formatCell(
                          data.rows[0]![data.columns.indexOf(metricColumn)]!,
                          metricColumn,
                        )}
                      </button>
                    ) : (
                      formatCell(data.rows[0]![data.columns.indexOf(metricColumn)]!, metricColumn)
                    ),
                  unit: metricColumn.unit,
                },
              ]}
            />
          ) : (
            <DatasetDisplayTable
              data={data}
              columns={columns}
              height={height}
              caption={resourceName ?? ''}
            />
          )}
          <DataActions>
            {(chart || metric) && (
              <FrameIconButton
                kind="data"
                label={t('marivo.presentation.ui-frame-data-table')}
                tip={t('marivo.presentation.ui-frame-data-table')}
                hasPopup="dialog"
                onOpen={() => setDataOpen(true)}
              >
                <FrameIcon kind="table" />
              </FrameIconButton>
            )}
            {!snapshot.coverage.complete && <CoverageIcon snapshot={snapshot} />}
            {!candidate && (
              <FrameIconButton
                kind="source"
                label={t('marivo.presentation.ui-dataset-source')}
                tip={t('marivo.presentation.ui-dataset-source')}
                hasPopup="dialog"
                onOpen={() => setSourceOpen(true)}
              >
                <FrameIcon kind="source" />
              </FrameIconButton>
            )}
          </DataActions>
          <Dialog
            title={t('marivo.presentation.ui-frame-data-table')}
            open={dataOpen}
            onClose={() => setDataOpen(false)}
            onAfterClose={focusAfterAsk.finish}
          >
            <div className="fv-data-reference">
              <DatasetDisplayTable data={data} caption={resourceName ?? ''} />
            </div>
            {pointMenu}
          </Dialog>
          <Dialog
            title={t('marivo.presentation.ui-dataset-source')}
            open={sourceOpen}
            onClose={() => setSourceOpen(false)}
          >
            <div className="au-source">
              <p>{t('marivo.presentation.ui-captured-at', { p0: snapshot.fetchedAt })}</p>
              <section>
                <p>
                  <strong>{t('marivo.presentation.ui-dataset-source-python')}</strong>
                </p>
                {currentCode?.kind === 'ok' ? (
                  <>
                    <div className="au-source-code">
                      <pre className="fv-code rounded-lg bg-muted p-3 text-xs">
                        <code>{currentCode.text}</code>
                      </pre>
                      <div className="au-source-copy">
                        <FrameIconButton
                          kind="copy-code"
                          label={t('marivo.presentation.copy-code')}
                          tip={t('marivo.presentation.copy-code')}
                          onOpen={() => void copyCode(currentCode.text, currentCode.key)}
                        >
                          <FrameIcon kind="copy" />
                        </FrameIconButton>
                      </div>
                    </div>
                    {copied && copied.key === codeKey && (
                      <span role="status">{t(copied.message)}</span>
                    )}
                  </>
                ) : (
                  <p>
                    {t(
                      offline
                        ? 'marivo.presentation.ui-dataset-source-python-offline'
                        : codeStatus === 'missing'
                          ? 'marivo.presentation.ui-dataset-source-python-missing'
                          : codeStatus === 'mismatch'
                            ? 'marivo.presentation.ui-dataset-source-python-mismatch'
                            : codeStatus === 'read-failed'
                              ? 'marivo.presentation.ui-dataset-source-python-read-failed'
                              : 'marivo.presentation.ui-dataset-source-python-loading',
                    )}
                  </p>
                )}
              </section>
              <section>
                <p>
                  <strong>{t('marivo.presentation.ui-dataset-source-datasources')}</strong>
                </p>
                {currentCode?.kind === 'ok' && currentCode.datasources?.length ? (
                  <ul>
                    {currentCode.datasources.map((datasource) => (
                      <li key={datasource.name}>
                        <code>{datasource.name}</code>
                        {datasource.backend ? ` · ${datasource.backend}` : ''}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>
                    {t(
                      offline
                        ? 'marivo.presentation.ui-dataset-source-datasources-offline'
                        : 'marivo.presentation.ui-dataset-source-datasources-unavailable',
                    )}
                  </p>
                )}
              </section>
              {!offline && (
                <details className="fv-dev">
                  <summary>{t('marivo.presentation.ui-frame-developer')}</summary>
                  <dl>
                    <dt>Session</dt>
                    <dd>{binding.sessionId}</dd>
                    <dt>Call</dt>
                    <dd>{binding.callId}</dd>
                    <dt>codeRef.executionId</dt>
                    <dd>{binding.codeRef?.executionId}</dd>
                    <dt>codeRef.sha256</dt>
                    <dd>{binding.codeRef?.sha256 ?? '—'}</dd>
                  </dl>
                </details>
              )}
            </div>
          </Dialog>
          {!dataOpen && pointMenu}
        </CardContent>
      </ResultCard>
    </ChartSelectionContext.Provider>
  )
}
