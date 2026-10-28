import { useState } from 'react'
import { formatCell } from '../../presentation/contracts/index.ts'
import type { AnalysisSnapshot } from '../../presentation/contracts/snapshot.ts'
import { useCopy } from '../i18n/context.tsx'
import { DatasetTable } from '../presentation/table.tsx'
import { useAnalysisResources } from './context.tsx'

export interface AnalysisViewProps {
  ref?: string
  view?:
    | { chart: 'auto' }
    | { chart: 'table'; columns?: string[] }
    | { chart: 'metric'; encoding: { value: string } }
  display?: { height?: number }
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
  const [selected, setSelected] = useState<string[]>()
  const [copy, setCopy] = useState<string>()
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
  const snapshot = resource.snapshot,
    data = snapshot.data
  const columns =
    selected ??
    (view?.chart === 'table' ? view.columns : undefined) ??
    data.columns.map((c) => c.id)
  const valueFields =
    snapshot.kind === 'frame' ? snapshot.frame.fields.filter((f) => f.role === 'value') : []
  const autoColumn =
    snapshot.kind === 'frame'
      ? snapshot.frame.axes.length === 0 && valueFields.length === 1
        ? data.columns.find((c) => c.id === valueFields[0]!.id)
        : undefined
      : data.columns.length === 1
        ? data.columns[0]
        : undefined
  const metricColumn =
    view?.chart === 'metric'
      ? data.columns.find((c) => c.id === view.encoding.value)
      : (!view || view.chart === 'auto') && snapshot.coverage.complete && data.rowCount === 1
        ? autoColumn
        : undefined
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
    <section className="au-data" data-resource={resourceName} data-resource-kind={kind}>
      <div className="au-data-heading">
        <strong>{resourceName}</strong>
        <button type="button" onClick={() => void copyRows()}>
          {t('marivo.presentation.ui-copy-data')}
        </button>
      </div>
      {copy && <p role="status">{t(copy)}</p>}
      {metric ? (
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
          <div style={{ maxHeight: display?.height ?? 520, overflow: 'auto' }}>
            <DatasetTable
              data={data}
              columns={columns}
              mode="interactive"
              caption={resourceName ?? ''}
              hideCaption
            />
          </div>
        </>
      )}
      {metric && <p className="pr-muted">{t('marivo.presentation.ui-complete-single-row')}</p>}
      <details className="au-source">
        <summary>
          {t(
            kind === 'frame'
              ? 'marivo.presentation.ui-frame-source'
              : 'marivo.presentation.ui-dataset-source',
          )}
        </summary>
        <p>{t('marivo.presentation.ui-captured-at', { p0: snapshot.fetchedAt })}</p>
        <p>
          {t('marivo.presentation.ui-capture-range', {
            p0: snapshot.coverage.capturedRows,
            p1: snapshot.coverage.totalRows,
          })}
        </p>
        <p>{t('marivo.presentation.ui-business-unknown')}</p>
        {snapshot.kind === 'frame' ? (
          <>
            <dl>
              <dt>Session</dt>
              <dd>{snapshot.source.sessionId}</dd>
              <dt>Artifact</dt>
              <dd>{snapshot.source.artifactId}</dd>
            </dl>
            <p>{snapshot.frame.axes.map((a) => `${a.name} (${a.role})`).join(' · ')}</p>
            <pre>
              {JSON.stringify(
                {
                  fields: snapshot.frame.fields,
                  layout: snapshot.frame.layout,
                  axes: snapshot.frame.axes,
                  coordinates: snapshot.frame.coordinates,
                },
                null,
                2,
              )}
            </pre>
            <p>{t('marivo.presentation.ui-metadata-not-captured')}</p>
          </>
        ) : (
          <>
            <p>{t('marivo.presentation.ui-dataframe-source-not-captured')}</p>
            <dl>
              <dt>Session</dt>
              <dd>{resource.binding.sessionId}</dd>
              <dt>Call</dt>
              <dd>{resource.binding.callId}</dd>
              <dt>codeRef.executionId</dt>
              <dd>{resource.binding.codeRef?.executionId}</dd>
              <dt>codeRef.sha256</dt>
              <dd>{resource.binding.codeRef?.sha256}</dd>
            </dl>
          </>
        )}
      </details>
    </section>
  )
}
