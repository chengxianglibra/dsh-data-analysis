import { chartColumns } from '../../presentation/contracts/charts.ts'
import type {
  PresentationBlock,
  PresentationDocument,
  SourceSnapshot,
} from '../../presentation/contracts/types.ts'
import { useCopy } from './../i18n/context.tsx'
import { columnIndex, datasetById, selectedSources, snapshotDate } from './model.ts'
import { SourceCodeSummary } from './source-code.tsx'
import {
  type OpenSemanticRef,
  semanticKindLabel,
  sourceOverviewFacts,
  sourceSemanticRef,
} from './source-facts.ts'

export function blockSources(document: PresentationDocument, block?: PresentationBlock) {
  if (!block) return document.sources
  if (block.kind === 'source') return selectedSources(document, block.sourceIds)
  if ('datasetId' in block)
    return selectedSources(document, datasetById(document, block.datasetId).sourceIds)
  return []
}

function SavedTime({ value }: { value: string }) {
  const t = useCopy()

  return Number.isNaN(Date.parse(value)) ? (
    value
  ) : (
    <time dateTime={value} title={value}>
      {t(snapshotDate(t.locale, value))}
    </time>
  )
}

/** Reading summary; technical identities and timestamps remain in the source dialog. */
export function SourceList({
  document,
  block,
}: {
  document: PresentationDocument
  block: PresentationBlock
}) {
  const t = useCopy()

  return (
    <ul className="pr-source-reading-list" aria-label={t('marivo.presentation.data-source-list')}>
      {blockSources(document, block).map((source, index) => {
        const { semanticGroups, issues, notices } = sourceOverviewFacts(source)
        const label = source.status === 'available' ? source.label.trim() : ''
        const name =
          label && !label.includes(source.ref.artifactRef)
            ? label
            : t('marivo.presentation.source-value', { p0: index + 1 })
        return (
          <li key={source.id} data-source-id={source.id}>
            <strong>{name}</strong>
            {semanticGroups.map((group) => (
              <p className="pr-muted" key={group.kind}>
                {t(semanticKindLabel(group.kind))}：{group.paths.join('、')}
              </p>
            ))}
            {source.status === 'unavailable' && <p className="pr-notice">{t(source.reason)}</p>}
            {issues.map((issue) => (
              <p className="pr-notice" key={JSON.stringify([issue.kind, issue.severity])}>
                {issue.kind}
                {issue.severity ? ` · ${issue.severity}` : ''}
              </p>
            ))}
            {notices.map((notice) => (
              <p className="pr-notice" key={t(notice)}>
                {t(notice)}
              </p>
            ))}
            {source.status === 'available' && !label && !semanticGroups.length && (
              <p className="pr-muted">{t('marivo.presentation.saved-analysis-results')}</p>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function SourceCard({
  source,
  number,
  onOpenSemanticRef,
}: {
  source: SourceSnapshot
  number?: number
  onOpenSemanticRef?: OpenSemanticRef
}) {
  const t = useCopy()

  const { createdAt, semanticGroups, issues, notices } = sourceOverviewFacts(source)
  return (
    <section className="pr-source-card" data-source-id={source.id}>
      <h3>
        {number !== undefined && t('marivo.presentation.source-value-485', { p0: number })}
        {source.status === 'available' && source.label.trim()
          ? source.label
          : source.ref.artifactRef}
      </h3>
      {source.status === 'unavailable' && <p className="pr-notice">{t(source.reason)}</p>}
      <details className="pr-artifact-details">
        <summary>
          Artifact <span>{source.ref.artifactRef}</span>
        </summary>
        <dl className="pr-source-overview-grid">
          <div>
            <dt>Session ID</dt>
            <dd>{source.ref.sessionId}</dd>
          </div>
          {source.ref.findingId && (
            <div>
              <dt>Finding ID</dt>
              <dd>{source.ref.findingId}</dd>
            </div>
          )}
          {source.status === 'available' &&
            source.facts
              .filter((fact) => ['Artifact kind', '完整行数'].includes(fact.label))
              .map((fact) => (
                <div key={t(fact.label)}>
                  <dt>
                    {fact.label === 'Artifact kind'
                      ? t('marivo.presentation.type')
                      : t('marivo.presentation.rows-488')}
                  </dt>
                  <dd>{fact.value}</dd>
                </div>
              ))}
        </dl>
      </details>
      {createdAt && (
        <dl className="pr-source-overview-grid">
          <div>
            <dt>{t('marivo.presentation.source-created')}</dt>
            <dd>
              <SavedTime value={createdAt} />
            </dd>
          </div>
        </dl>
      )}
      {semanticGroups.map((group) => (
        <div className="pr-source-semantic-group" key={group.kind}>
          <h4 className="pr-source-overview-label">{t(semanticKindLabel(group.kind))}</h4>
          <ul className="pr-source-semantic-list">
            {group.paths.map((semanticPath) => {
              const ref = sourceSemanticRef(group.kind, semanticPath)
              return (
                <li key={semanticPath}>
                  {ref && onOpenSemanticRef ? (
                    <button
                      type="button"
                      className="pr-semantic-link"
                      onClick={() => onOpenSemanticRef(ref)}
                      title={t('marivo.presentation.view-current-semantic-definition')}
                    >
                      {semanticPath}
                    </button>
                  ) : (
                    semanticPath
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ))}
      {issues.length > 0 && (
        <div className="pr-source-issues">
          <h4 className="pr-source-overview-label">{t('marivo.presentation.data-issues')}</h4>
          <ul>
            {issues.map((issue) => (
              <li key={JSON.stringify([issue.kind, issue.severity])}>
                {issue.kind}
                {issue.severity ? ` · ${issue.severity}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
      {notices.map((notice) => (
        <p className="pr-notice" key={t(notice)}>
          {t(notice)}
        </p>
      ))}
    </section>
  )
}

export function SourceOverview({
  document,
  block,
  onOpenSemanticRef,
}: {
  document: PresentationDocument
  block?: PresentationBlock
  onOpenSemanticRef?: OpenSemanticRef
}) {
  const t = useCopy()

  const dataset = block && 'datasetId' in block ? datasetById(document, block.datasetId) : undefined
  const sources = blockSources(document, block)
  const columnIds =
    block?.kind === 'metric'
      ? [block.columnId]
      : block?.kind === 'chart'
        ? chartColumns(block)
        : block?.kind === 'table' && block.columns
          ? block.columns
          : dataset?.data.columns.map((column) => column.id)
  return (
    <div className="pr-source-overview">
      <dl className="pr-source-overview-grid">
        {block?.kind === 'metric' && (
          <div>
            <dt>{t('marivo.presentation.metric')}</dt>
            <dd>{t(block.label)}</dd>
          </div>
        )}
        {dataset && (
          <>
            <div>
              <dt>{t('marivo.presentation.dataset')}</dt>
              <dd>{dataset.id}</dd>
            </div>
            <div>
              <dt>{t('marivo.presentation.data-sources')}</dt>
              <dd>
                {dataset.origin === 'artifact'
                  ? 'Artifact'
                  : t('marivo.presentation.computed-result')}
              </dd>
            </div>
          </>
        )}
        <div>
          <dt>{t('marivo.presentation.report-generated')}</dt>
          <dd>
            <SavedTime value={document.generatedAt} />
          </dd>
        </div>
      </dl>
      {dataset && (
        <section className="pr-source-field-section">
          <h3 className="pr-source-overview-label">{t('marivo.presentation.field')}</h3>
          <div className="pr-table-scroll">
            <table
              className="pr-source-fields"
              aria-label={t('marivo.presentation.dataset-fields')}
            >
              <thead>
                <tr>
                  <th scope="col">{t('marivo.presentation.field-name')}</th>
                  <th scope="col">{t('marivo.presentation.display-name')}</th>
                  <th scope="col">{t('marivo.presentation.type')}</th>
                  <th scope="col">{t('marivo.presentation.unit')}</th>
                </tr>
              </thead>
              <tbody>
                {[...new Set(columnIds)].map((id) => {
                  const column = dataset.data.columns[columnIndex(dataset.data, id)]!
                  return (
                    <tr key={id}>
                      <td>
                        <code>{column.id}</code>
                      </td>
                      <td>{t(column.label)}</td>
                      <td>{column.type}</td>
                      <td>{column.unit ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <div className="pr-source-list">
        {sources.map((source, index) => (
          <SourceCard
            key={source.id}
            source={source}
            onOpenSemanticRef={onOpenSemanticRef}
            number={sources.length > 1 ? index + 1 : undefined}
          />
        ))}
      </div>
    </div>
  )
}

/** Compact native disclosure for reading the saved report without JavaScript. */
export function SourceSummary({
  document,
  block,
}: {
  document: PresentationDocument
  block?: PresentationBlock
}) {
  const t = useCopy()

  if (
    !blockSources(document, block).length &&
    !(block ? 'datasetId' in block : document.blocks.some((item) => 'datasetId' in item))
  )
    return null
  return (
    <details className="pr-source-summary">
      <summary>{t('marivo.presentation.data-sources')}</summary>
      <SourceOverview document={document} block={block} />
      <SourceCodeSummary document={document} block={block} />
    </details>
  )
}
