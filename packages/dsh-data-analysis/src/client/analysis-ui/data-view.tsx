import { useId, useMemo, useState } from 'react'
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
import { Button } from '../ui/controls.tsx'
import { Alert, AlertDescription } from '../ui/primitives/alert.tsx'
import { CardContent } from '../ui/primitives/card.tsx'
import { Checkbox } from '../ui/primitives/checkbox.tsx'
import { Field, FieldGroup, FieldLabel } from '../ui/primitives/field.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/primitives/popover.tsx'
import { Skeleton } from '../ui/primitives/skeleton.tsx'
import { datasetChartModel } from './charts/dataset-model.ts'
import { Heatmap, TimeChart } from './charts/observation.tsx'
import { DataActions, MetricGroup, ResultCard, ResultHeader } from './components/result.tsx'
import { useAnalysisResources } from './context.tsx'
import { FrameIcon } from './frame/frame-icon.tsx'
import { Dialog, FrameIconButton } from './frame/icons.tsx'
import { CopyData } from './frame/table.tsx'
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
  const columnGroupId = useId()
  const [selected, setSelected] = useState<string[]>()
  const [dataOpen, setDataOpen] = useState(false)
  const [sourceOpen, setSourceOpen] = useState(false)
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
  if (!resolution.ok)
    return (
      <Alert variant="destructive">
        <AlertDescription>{t('marivo.presentation.ui-resource-unavailable')}</AlertDescription>
      </Alert>
    )
  const kind = snapshot.kind
  const data = snapshot.data
  const columns =
    selected ??
    (resolved?.chart === 'table' ? resolved.columns : undefined) ??
    data.columns.map((c) => c.id)
  const metricColumn =
    resolved?.chart === 'metric' ? data.columns.find((c) => c.id === resolved.values[0]) : undefined
  const metric = metricColumn && snapshot.coverage.complete && data.rowCount === 1
  return (
    <ResultCard
      data-resource={resourceName}
      data-resource-kind={kind}
      data-dataset-view={resolved?.chart}
    >
      <ResultHeader
        title={resourceName}
        actions={!candidate ? <CopyData data={data} columns={columns} /> : undefined}
      />
      <CardContent className="au-result-content">
        {!snapshot.coverage.complete && (
          <Alert className="au-result-status" role="status">
            <AlertDescription>
              {t('marivo.presentation.ui-capture-range', {
                p0: snapshot.coverage.capturedRows,
                p1: snapshot.coverage.totalRows,
              })}
            </AlertDescription>
          </Alert>
        )}
        {chart ? (
          <>
            {chart.chart === 'heatmap' ? (
              <Heatmap model={model} view={chart} height={height} />
            ) : (
              <TimeChart model={model} view={chart} height={height} />
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
            </DataActions>
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
            <MetricGroup
              items={[
                {
                  key: metricColumn.id,
                  label: metricColumn.label,
                  value: formatCell(
                    data.rows[0]![data.columns.indexOf(metricColumn)]!,
                    metricColumn,
                  ),
                  unit: metricColumn.unit,
                },
              ]}
            />
          </div>
        ) : (
          <>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="au-columns">
                  {t('marivo.presentation.ui-columns')}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" aria-label={t('marivo.presentation.ui-columns')}>
                <FieldGroup>
                  {data.columns.map((column) => (
                    <Field key={column.id} orientation="horizontal">
                      <Checkbox
                        id={`${columnGroupId}-${column.id}`}
                        checked={columns.includes(column.id)}
                        disabled={columns.length === 1 && columns.includes(column.id)}
                        onCheckedChange={(checked) =>
                          setSelected(
                            checked === true
                              ? data.columns
                                  .filter((c) => c.id === column.id || columns.includes(c.id))
                                  .map((c) => c.id)
                              : columns.filter((id) => id !== column.id),
                          )
                        }
                      />
                      <FieldLabel htmlFor={`${columnGroupId}-${column.id}`}>
                        {column.label}
                      </FieldLabel>
                    </Field>
                  ))}
                </FieldGroup>
              </PopoverContent>
            </Popover>
            <div style={{ maxHeight: height ?? 520, overflow: 'auto' }}>
              <DatasetTable data={data} columns={columns} caption={resourceName ?? ''} />
            </div>
          </>
        )}
        {!candidate && (
          <Button
            variant="ghost"
            size="sm"
            className="au-source-trigger"
            aria-haspopup="dialog"
            onClick={() => setSourceOpen(true)}
          >
            {t('marivo.presentation.ui-dataset-source')}
          </Button>
        )}
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
          </div>
        </Dialog>
      </CardContent>
    </ResultCard>
  )
}
