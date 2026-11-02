import { useMemo, useState } from 'react'
import { resolveDatasetView } from '../../presentation/contracts/dataset-view.ts'
import type { FrameDisplay, FrameView } from '../../presentation/contracts/frame-view.ts'
import { formatCell } from '../../presentation/contracts/index.ts'
import {
  type AnalysisSnapshot,
  type DatasetSnapshot,
  isFrameSnapshotV2,
} from '../../presentation/contracts/snapshot.ts'
import { useCopy } from '../i18n/context.tsx'
import { DatasetTable } from '../presentation/table.tsx'
import { datasetChartModel } from './charts/dataset-model.ts'
import { Heatmap, TimeChart } from './charts/observation.tsx'
import { useAnalysisResources } from './context.tsx'
import { FrameIcon } from './frame/frame-icon.tsx'
import { Dialog, FrameIconButton } from './frame/icons.tsx'
import { AnalysisFrame } from './frame/view.tsx'

export interface AnalysisViewProps {
  ref?: string
  view?: FrameView
  display?: FrameDisplay
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
      <p role={candidate ? 'status' : 'alert'}>
        {t(
          candidate
            ? 'marivo.presentation.ui-resource-pending'
            : 'marivo.presentation.ui-resource-unavailable',
        )}
      </p>
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
  const [selected, setSelected] = useState<string[]>()
  const [copy, setCopy] = useState<string>()
  const [dataOpen, setDataOpen] = useState(false)
  const { candidate } = useAnalysisResources()
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
  if (!resolution.ok) return <p role="alert">{t('marivo.presentation.ui-resource-unavailable')}</p>
  const kind = snapshot.kind
  const data = snapshot.data
  const columns =
    selected ??
    (resolved?.chart === 'table' ? resolved.columns : undefined) ??
    data.columns.map((c) => c.id)
  const metricColumn =
    resolved?.chart === 'metric' ? data.columns.find((c) => c.id === resolved.values[0]) : undefined
  const metric = metricColumn && snapshot.coverage.complete && data.rowCount === 1
  const copyRows = async () => {
    const indices = columns.map((id) => data.columns.findIndex((c) => c.id === id))
    const quote = (value: string) =>
      /[\t\r\n"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
    const text = [
      indices.map((i) => data.columns[i]!.label),
      ...data.rows.map((row) => indices.map((i) => formatCell(row[i]!, data.columns[i]!))),
    ]
      .map((row) => row.map(quote).join('\t'))
      .join('\n')
    const ok = await Promise.resolve()
      .then(() => navigator.clipboard.writeText(text))
      .then(() => true)
      .catch(() => false)
    setCopy(ok ? 'marivo.presentation.copied' : 'marivo.presentation.ui-copy-failed')
  }
  return (
    <section
      className={chart ? 'fv au-data' : 'au-data'}
      data-resource={resourceName}
      data-resource-kind={kind}
      data-dataset-view={resolved?.chart}
    >
      <div className="au-data-heading">
        <strong>{resourceName}</strong>
        <button type="button" onClick={() => void copyRows()}>
          {t('marivo.presentation.ui-copy-data')}
        </button>
      </div>
      {copy && <p role="status">{t(copy)}</p>}
      {chart ? (
        <>
          {chart.chart === 'heatmap' ? (
            <Heatmap model={model} view={chart} height={height} />
          ) : (
            <TimeChart model={model} view={chart} height={height} />
          )}
          <FrameIconButton
            kind="data"
            label={t('marivo.presentation.ui-frame-data-table')}
            tip={t('marivo.presentation.ui-frame-data-table')}
            hasPopup="dialog"
            onOpen={() => setDataOpen(true)}
          >
            <FrameIcon kind="table" />
          </FrameIconButton>
          <Dialog
            title={t('marivo.presentation.ui-frame-data-table')}
            open={dataOpen}
            onClose={() => setDataOpen(false)}
          >
            <DatasetTable data={data} caption={resourceName ?? ''} />
          </Dialog>
        </>
      ) : metric ? (
        <div className="au-metric">
          <span>{metricColumn.label}</span>
          <strong>
            {formatCell(data.rows[0]![data.columns.indexOf(metricColumn)]!, metricColumn)}
          </strong>
          {metricColumn.unit && <span>{metricColumn.unit}</span>}
        </div>
      ) : (
        <>
          <details className="au-columns">
            <summary>{t('marivo.presentation.ui-columns')}</summary>
            <div>
              {data.columns.map((column) => (
                <label key={column.id}>
                  <input
                    type="checkbox"
                    checked={columns.includes(column.id)}
                    disabled={columns.length === 1 && columns.includes(column.id)}
                    onChange={(event) =>
                      setSelected(
                        event.target.checked
                          ? data.columns
                              .filter((c) => c.id === column.id || columns.includes(c.id))
                              .map((c) => c.id)
                          : columns.filter((id) => id !== column.id),
                      )
                    }
                  />
                  {column.label}
                </label>
              ))}
            </div>
          </details>
          <div style={{ maxHeight: height ?? 520, overflow: 'auto' }}>
            <DatasetTable data={data} columns={columns} caption={resourceName ?? ''} />
          </div>
        </>
      )}
      {metric && <p className="pr-muted">{t('marivo.presentation.ui-complete-single-row')}</p>}
      <details className="au-source">
        <summary>{t('marivo.presentation.ui-dataset-source')}</summary>
        <p>{t('marivo.presentation.ui-captured-at', { p0: snapshot.fetchedAt })}</p>
        <p>
          {t('marivo.presentation.ui-capture-range', {
            p0: snapshot.coverage.capturedRows,
            p1: snapshot.coverage.totalRows,
          })}
        </p>
        <p>{t('marivo.presentation.ui-business-unknown')}</p>
        <p>{t('marivo.presentation.ui-dataframe-source-not-captured')}</p>
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
      </details>
    </section>
  )
}
