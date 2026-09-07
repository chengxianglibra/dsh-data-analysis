import { useEffect, useMemo, useRef, useState } from 'react'
import { parsePresentationDocument } from '../../presentation/contracts/index.ts'
import type { PresentationBlock, PresentationDocument } from '../../presentation/contracts/types.ts'
import { ChartRenderer } from './chart-renderer.tsx'
import { CopyContext } from './copy-context.tsx'
import { MoreIcon } from './icons.tsx'
import { Markdown } from './markdown.tsx'
import {
  datasetById,
  datasetScope,
  followUpContext,
  metricText,
  type ReaderMode,
  selectMetric,
  snapshotDate,
  valueWithUnit,
} from './model.ts'
import { SourceDialog } from './source-dialog.tsx'
import { blockSources, SourceSummary } from './sources.tsx'
import { DatasetTable } from './table.tsx'

function CellMenu({
  onSource,
  onCopy,
}: {
  onSource?: (trigger: HTMLElement) => void
  onCopy: (trigger: HTMLElement) => void
}) {
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const focusIndex = useRef(0)
  const actions = [
    ...(onSource ? [{ label: '数据源', run: onSource }] : []),
    { label: '复制上下文', run: onCopy },
  ]
  useEffect(() => {
    if (!open) return
    container.current
      ?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
      [focusIndex.current]?.focus()
    const owner = container.current!.ownerDocument
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false)
    }
    owner.addEventListener('pointerdown', dismiss)
    return () => owner.removeEventListener('pointerdown', dismiss)
  }, [open])
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Delegate keyboard and focus events from the native menu buttons.
    <div
      className="pr-cell-menu"
      ref={container}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          setOpen(false)
          trigger.current?.focus()
        } else if (event.key === 'Tab') {
          setOpen(false)
        } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault()
          const items = [
            ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
          ]
          const active = items.indexOf(
            event.currentTarget.ownerDocument.activeElement as HTMLButtonElement,
          )
          focusIndex.current =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? actions.length - 1
                : event.key === 'ArrowUp'
                  ? active <= 0
                    ? actions.length - 1
                    : active - 1
                  : (active + 1) % actions.length
          if (!open) setOpen(true)
          else items[focusIndex.current]?.focus()
        }
      }}
    >
      <button
        type="button"
        className="pr-icon-button"
        ref={trigger}
        aria-label="cell 更多操作"
        title="更多操作"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          focusIndex.current = 0
          setOpen(!open)
        }}
      >
        <MoreIcon />
      </button>
      {open && (
        <div className="pr-cell-menu-popup" role="menu" aria-label="cell 操作">
          {actions.map((action) => (
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              key={action.label}
              onClick={() => {
                setOpen(false)
                trigger.current?.focus()
                action.run(trigger.current!)
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

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
    return (
      <>
        <h2>数据源</h2>
        <p className="pr-muted">{block.sourceIds.length} 个来源</p>
      </>
    )
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
            title={metric.value === null ? '缺失值' : valueWithUnit(metric.value, metric.column)}
          >
            {metricText(metric.value, metric.column)}
          </p>
          {dataset.data.truncated && <p className="pr-notice">{datasetScope(dataset.data)}</p>}
        </>
      ) : block.kind === 'chart' ? (
        <ChartRenderer dataset={dataset} block={block} mode={mode} />
      ) : block.kind === 'table' ? (
        <DatasetTable
          data={dataset.data}
          columns={block.columns}
          mode={mode}
          caption="数据表"
          showScope={dataset.data.truncated}
        />
      ) : null}
    </>
  )
}

/** Group adjacent metrics without changing the authored block order. */
function blockGroups(blocks: PresentationBlock[]): PresentationBlock[][] {
  const groups: PresentationBlock[][] = []
  for (const block of blocks) {
    const previous = groups.at(-1)
    if (block.kind === 'metric' && previous?.[0]?.kind === 'metric') previous.push(block)
    else groups.push([block])
  }
  return groups
}

function ReaderContents({ document, mode }: { document: PresentationDocument; mode: ReaderMode }) {
  const [sourceCell, setSourceCell] = useState<{ block: PresentationBlock; trigger: HTMLElement }>()
  // Known snapshot diagnostics have concise, contextual presentations below.
  const diagnostics = [
    ...new Set(
      document.diagnostics
        .filter(
          (entry) =>
            !['definition_unavailable', 'truncated', 'source_unavailable'].includes(entry.code),
        )
        .map((entry) => entry.message),
    ),
  ]
  const renderBlock = (block: PresentationBlock) => (
    <section
      className={`pr-block pr-block-${block.kind}`}
      key={block.id}
      data-block-id={block.id}
      data-block-kind={block.kind}
    >
      {mode === 'interactive' && (
        <div className="pr-cell-toolbar pr-interactive">
          <CopyContext text={followUpContext(document, block)}>
            {(copy) => (
              <CellMenu
                onCopy={copy}
                onSource={
                  block.kind === 'markdown'
                    ? undefined
                    : (trigger) => setSourceCell({ block, trigger })
                }
              />
            )}
          </CopyContext>
        </div>
      )}
      <Block block={block} document={document} mode={mode} />
      {blockSources(document, block).some((source) => source.status === 'unavailable') && (
        <p className="pr-notice">数据源不可用</p>
      )}
    </section>
  )
  return (
    <article className="pr-reader" data-presentation-reader="true" data-mode={mode}>
      <header className="pr-header">
        <h1>{document.title}</h1>
        <p className="pr-muted">
          生成于 <time dateTime={document.generatedAt}>{snapshotDate(document.generatedAt)}</time>
        </p>
      </header>
      {diagnostics.length > 0 && (
        <aside className="pr-diagnostics" aria-label="展示说明">
          <ul>
            {diagnostics.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </aside>
      )}
      <div className="pr-blocks">
        {blockGroups(document.blocks).map((group) =>
          group[0]!.kind === 'metric' ? (
            <div className="pr-metric-group" key={group[0]!.id}>
              {group.map(renderBlock)}
            </div>
          ) : (
            renderBlock(group[0]!)
          ),
        )}
      </div>
      {mode === 'static' && document.sources.length > 0 && <SourceSummary document={document} />}
      {sourceCell && (
        <SourceDialog
          key={sourceCell.block.id}
          document={document}
          block={sourceCell.block}
          restoreFocusTo={sourceCell.trigger}
          onClose={() => setSourceCell(undefined)}
        />
      )}
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
