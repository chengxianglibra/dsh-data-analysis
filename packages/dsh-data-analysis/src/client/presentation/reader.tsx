import { useMemo } from 'react'
import { parsePresentationDocument } from '../../presentation/contracts/index.ts'
import type { PresentationBlock, PresentationDocument } from '../../presentation/contracts/types.ts'
import { ChartRenderer } from './chart-renderer.tsx'
import { CopyContext } from './copy-context.tsx'
import { Markdown } from './markdown.tsx'
import {
  columnLabel,
  datasetById,
  datasetScope,
  followUpContext,
  type ReaderMode,
  selectedSources,
  selectMetric,
  valueWithUnit,
} from './model.ts'
import { Sources } from './sources.tsx'
import { DatasetTable } from './table.tsx'

function Block({
  block,
  document,
  mode,
}: {
  block: PresentationBlock
  document: PresentationDocument
  mode: ReaderMode
}) {
  if (block.kind === 'markdown') return <Markdown text={block.text} />
  if (block.kind === 'source')
    return <Sources sources={selectedSources(document, block.sourceIds)} mode={mode} />
  const dataset = datasetById(document, block.datasetId)
  const metric = block.kind === 'metric' ? selectMetric(dataset.data, block) : undefined
  return (
    <>
      {block.kind === 'metric' && metric ? (
        <>
          <h2>{block.label}</h2>
          <p
            className="pr-metric-value"
            data-metric-value="true"
            title={metric.value === null ? '缺失值' : undefined}
          >
            {valueWithUnit(metric.value, metric.column)}
          </p>
          <p className="pr-muted">
            保存数据第 {block.rowIndex + 1} 行 · {columnLabel(metric.column)}
          </p>
          {dataset.data.truncated && <p className="pr-notice">{datasetScope(dataset.data)}</p>}
        </>
      ) : block.kind === 'chart' ? (
        <ChartRenderer document={document} dataset={dataset} block={block} mode={mode} />
      ) : block.kind === 'table' ? (
        <DatasetTable data={dataset.data} columns={block.columns} mode={mode} caption="数据表" />
      ) : null}
      <Sources
        sources={selectedSources(document, dataset.sourceIds)}
        mode={mode}
        origin={dataset.origin}
      />
      {mode === 'interactive' && block.kind !== 'chart' && (
        <CopyContext text={followUpContext(document, block)} />
      )}
    </>
  )
}

function ReaderContents({ document, mode }: { document: PresentationDocument; mode: ReaderMode }) {
  const shownSources = new Set<string>()
  for (const block of document.blocks) {
    if (block.kind === 'source')
      block.sourceIds.forEach((id) => {
        shownSources.add(id)
      })
    else if ('datasetId' in block)
      datasetById(document, block.datasetId).sourceIds.forEach((id) => {
        shownSources.add(id)
      })
  }
  const remaining = document.sources.filter((source) => !shownSources.has(source.id))
  return (
    <article className="pr-reader" data-presentation-reader="true" data-mode={mode}>
      <header className="pr-header">
        <p className="pr-eyebrow">MARIVO · 分析快照</p>
        <h1>{document.title}</h1>
        <p className="pr-muted">
          生成时间：<time dateTime={document.generatedAt}>{document.generatedAt}</time>
        </p>
        {mode === 'interactive' && <CopyContext text={followUpContext(document)} />}
      </header>
      {document.diagnostics.length > 0 && (
        <aside className="pr-diagnostics" aria-label="展示说明">
          <h2>展示说明</h2>
          <ul>
            {document.diagnostics.map((entry, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: Immutable snapshot facts can repeat and carry no separate identifier.
              <li key={`${index}-${entry.code}`}>{entry.message}</li>
            ))}
          </ul>
        </aside>
      )}
      <div className="pr-blocks">
        {document.blocks.map((block) => (
          <section
            className={`pr-block pr-block-${block.kind}`}
            key={block.id}
            data-block-id={block.id}
            data-block-kind={block.kind}
          >
            <Block block={block} document={document} mode={mode} />
          </section>
        ))}
      </div>
      {remaining.length > 0 && <Sources sources={remaining} mode={mode} />}
      <footer className="pr-footer">
        {mode === 'static' ? (
          <p>
            快照标识 · Build ID: {document.buildId} · Workspace: {document.workspaceId}
          </p>
        ) : (
          <details>
            <summary>快照标识</summary>
            <p>
              Build ID: {document.buildId} · Workspace: {document.workspaceId}
            </p>
          </details>
        )}
      </footer>
    </article>
  )
}

export function PresentationReader({
  document,
  mode = 'interactive',
}: {
  document: PresentationDocument
  mode?: ReaderMode
}) {
  const parsed = useMemo(() => parsePresentationDocument(document), [document])
  return (
    <ReaderContents
      key={`${parsed.workspaceId}/${parsed.buildId}/${mode}`}
      document={parsed}
      mode={mode}
    />
  )
}
