import { chartColumns } from '../../presentation/contracts/charts.ts'
import type {
  PresentationBlock,
  PresentationDocument,
  SourceSnapshot,
} from '../../presentation/contracts/types.ts'
import { columnIndex, columnLabel, datasetById, selectedSources, snapshotDate } from './model.ts'
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
  return Number.isNaN(Date.parse(value)) ? (
    value
  ) : (
    <time dateTime={value} title={value}>
      {snapshotDate(value)}
    </time>
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
  const { createdAt, semanticGroups, issues, notices } = sourceOverviewFacts(source)
  if (
    source.status === 'available' &&
    !createdAt &&
    !semanticGroups.length &&
    !issues.length &&
    !notices.length
  )
    return null
  return (
    <section className="pr-source-card" data-source-id={source.id}>
      {number !== undefined && <h3>来源 {number}</h3>}
      {source.status === 'unavailable' && <p className="pr-notice">{source.reason}</p>}
      {createdAt && (
        <dl className="pr-source-overview-grid">
          <div>
            <dt>来源创建时间</dt>
            <dd>
              <SavedTime value={createdAt} />
            </dd>
          </div>
        </dl>
      )}
      {semanticGroups.map((group) => (
        <div className="pr-source-semantic-group" key={group.kind}>
          <h4 className="pr-source-overview-label">{semanticKindLabel(group.kind)}</h4>
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
                      title="查看当前语义定义"
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
          <h4 className="pr-source-overview-label">数据问题</h4>
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
        <p className="pr-notice" key={notice}>
          {notice}
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
            <dt>指标</dt>
            <dd>{block.label}</dd>
          </div>
        )}
        {dataset && (
          <>
            <div>
              <dt>数据集</dt>
              <dd>{dataset.id}</dd>
            </div>
            <div>
              <dt>字段</dt>
              <dd>
                <ul className="pr-source-fields">
                  {[...new Set(columnIds)].map((id) => (
                    <li key={id}>
                      {columnLabel(dataset.data.columns[columnIndex(dataset.data, id)]!)}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          </>
        )}
        <div>
          <dt>报告生成时间</dt>
          <dd>
            <SavedTime value={document.generatedAt} />
          </dd>
        </div>
      </dl>
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
  if (
    !blockSources(document, block).length &&
    !(block ? 'datasetId' in block : document.blocks.some((item) => 'datasetId' in item))
  )
    return null
  return (
    <details className="pr-source-summary">
      <summary>数据来源</summary>
      <SourceOverview document={document} block={block} />
      <SourceCodeSummary document={document} block={block} />
    </details>
  )
}
