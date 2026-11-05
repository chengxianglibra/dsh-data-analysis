import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { resolveDatasetView } from '../../presentation/contracts/dataset-view.ts'
import type { FrameDisplay, FrameView } from '../../presentation/contracts/frame-view.ts'
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
import { Alert, AlertDescription } from '../ui/primitives/alert.tsx'
import { CardContent } from '../ui/primitives/card.tsx'
import { Skeleton } from '../ui/primitives/skeleton.tsx'
import { datasetChartModel } from './charts/dataset-model.ts'
import { Heatmap, TimeChart } from './charts/observation.tsx'
import { DataActions, MetricGroup, ResultCard, ResultHeader } from './components/result.tsx'
import { useAnalysisResources } from './context.tsx'
import { FrameIcon } from './frame/frame-icon.tsx'
import { CoverageIcon, Dialog, FrameIconButton, PythonIcon } from './frame/icons.tsx'
import { CopyData } from './frame/table.tsx'
import { AnalysisFrame } from './frame/view.tsx'

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

/** Keep the same scroll affordance as Frame tables while retaining Dataset formatting. */
function DatasetDisplayTable({
  data,
  columns,
  height,
  caption,
  reference = false,
}: {
  data: TypedDataset
  columns?: string[]
  height?: number
  caption: string
  reference?: boolean
}) {
  const t = useCopy()
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
      <div ref={ref} style={{ maxHeight: height ?? 520, overflow: 'auto' }}>
        <DatasetTable
          data={data}
          columns={columns}
          caption={caption}
          scrollDescription={scrollable ? hintId : undefined}
          hideRowCount
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
}: Omit<AnalysisViewProps, 'ref'> & { resourceName?: string; kind: AnalysisSnapshot['kind'] }) {
  const t = useCopy()
  const { readResource, candidate } = useAnalysisResources()
  const resource = resourceName ? readResource(resourceName) : undefined
  if (resource?.kind !== 'snapshot' || resource.snapshot.kind !== kind)
    return (
      <Alert role={candidate ? 'status' : 'alert'} variant={candidate ? 'default' : 'destructive'}>
        <AlertDescription>
          {t(
            candidate
              ? 'marivo.presentation.ui-resource-pending'
              : 'marivo.presentation.ui-resource-unavailable',
          )}
        </AlertDescription>
        {candidate && <Skeleton className="h-24 w-full" />}
      </Alert>
    )
  const snapshot = resource.snapshot
  if (isFrameSnapshotV2(snapshot))
    return (
      <AnalysisFrame
        snapshot={snapshot}
        view={view}
        display={display}
        resourceName={resourceName}
        codeRef={resource.binding.codeRef}
      />
    )
  return (
    <DatasetDataView
      resourceName={resourceName}
      snapshot={snapshot}
      binding={resource.binding}
      view={view}
      height={display?.height}
    />
  )
}

/** Dataset snapshots use column mappings and the shared plot components. */
function DatasetDataView({
  resourceName,
  snapshot,
  binding,
  view,
  height,
}: {
  resourceName?: string
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
  const { candidate, readCode } = useAnalysisResources()
  const codeRef = binding.codeRef
  const codeKey = codeRef ? JSON.stringify([codeRef.executionId, codeRef.sha256]) : undefined
  const currentCode = code.kind !== 'idle' && code.key === codeKey ? code : undefined
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
  const resolution = useMemo(() => {
    const explicit = resolveDatasetView(snapshot, view)
    return explicit.ok || !candidate ? explicit : resolveDatasetView(snapshot)
  }, [snapshot, view, candidate])
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
      <Alert variant="destructive">
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
  const chartKind =
    resolved?.chart === 'metric' && metricColumn
      ? metricColumn.unit === 'USD' && ['float64', 'int64', 'decimal'].includes(metricColumn.type)
        ? 'currency'
        : ['float64', 'int64', 'decimal'].includes(metricColumn.type)
          ? 'number'
          : 'metric'
      : resolved?.chart
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
  return (
    <ResultCard
      data-resource={resourceName}
      data-resource-kind={kind}
      data-dataset-view={resolved?.chart}
    >
      <ResultHeader
        title={title}
        actions={
          <div className="fv-header-actions">
            <span className="fv-chart-tag">
              {t(`marivo.presentation.ui-chart-kind-${chartKind}`)}
            </span>
            {!candidate && <CopyData data={data} columns={columns} />}
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
                value: formatCell(data.rows[0]![data.columns.indexOf(metricColumn)]!, metricColumn),
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
          <FrameIconButton
            kind="data"
            label={t('marivo.presentation.ui-frame-data-table')}
            tip={t('marivo.presentation.ui-frame-data-table')}
            hasPopup="dialog"
            onOpen={candidate ? undefined : () => setDataOpen(true)}
          >
            <FrameIcon kind="table" />
          </FrameIconButton>
          {!snapshot.coverage.complete && <CoverageIcon snapshot={snapshot} />}
          {!candidate && (
            <>
              <FrameIconButton
                kind="source"
                label={t('marivo.presentation.ui-dataset-source')}
                tip={t('marivo.presentation.ui-dataset-source')}
                hasPopup="dialog"
                onOpen={() => setSourceOpen(true)}
              >
                <FrameIcon kind="source" />
              </FrameIconButton>
              <PythonIcon
                snapshot={{ source: { sessionId: binding.sessionId } }}
                codeRef={codeRef}
              />
            </>
          )}
        </DataActions>
        <Dialog
          title={t('marivo.presentation.ui-frame-data-table')}
          open={dataOpen}
          onClose={() => setDataOpen(false)}
        >
          <div className="fv-data-reference">
            <DatasetDisplayTable data={data} caption={resourceName ?? ''} reference />
          </div>
        </Dialog>
        <Dialog
          title={t('marivo.presentation.ui-dataset-source')}
          open={sourceOpen}
          onClose={() => setSourceOpen(false)}
        >
          <div className="au-source">
            <p>{t('marivo.presentation.ui-captured-at', { p0: snapshot.fetchedAt })}</p>
            <p>
              {t('marivo.presentation.ui-capture-range', {
                p0: snapshot.coverage.capturedRows,
                p1: snapshot.coverage.totalRows,
              })}
            </p>
            <p>{t('marivo.presentation.ui-business-unknown')}</p>
            <section>
              <p>
                <strong>{t('marivo.presentation.ui-dataset-source-python')}</strong>
              </p>
              {currentCode?.kind === 'ok' ? (
                <pre>
                  <code>{currentCode.text}</code>
                </pre>
              ) : (
                <p>
                  {t(
                    codeStatus === 'missing'
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
                <p>{t('marivo.presentation.ui-dataset-source-datasources-unavailable')}</p>
              )}
            </section>
            <p>{t('marivo.presentation.ui-dataset-source-sql-unavailable')}</p>
            <p>{t('marivo.presentation.ui-dataset-source-file-unavailable')}</p>
            <p>{t('marivo.presentation.ui-dataset-source-warnings-unavailable')}</p>
            <dl>
              <dt>Session</dt>
              <dd>{binding.sessionId}</dd>
              <dt>Call</dt>
              <dd>{binding.callId}</dd>
              <dt>codeRef.executionId</dt>
              <dd>{binding.codeRef?.executionId}</dd>
              <dt>codeRef.sha256</dt>
              <dd>{binding.codeRef?.sha256}</dd>
            </dl>
          </div>
        </Dialog>
      </CardContent>
    </ResultCard>
  )
}
