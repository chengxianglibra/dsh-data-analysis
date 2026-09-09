import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { parsePresentationDocument } from '../../presentation/contracts/index.ts'
import {
  defaultSelection,
  editedInteraction,
  filterSummary,
  interactionRows,
} from '../../presentation/contracts/interaction.ts'
import type { PresentationBlock, PresentationDocument } from '../../presentation/contracts/types.ts'
import { ChartExplorer } from './chart-explorer.tsx'
import { ChartRenderer } from './chart-renderer.tsx'
import { type ChartExploration, exploredChartBlock, initialChartExploration } from './chart-view.ts'
import { CopyContext } from './copy-context.tsx'
import { savePresentationHtml } from './download.ts'
import { CellEditor, type ReaderEditing } from './editor-controls.tsx'
import { ExportMenu, type ReaderExportActions } from './export-menu.tsx'
import { exportCurrentView, type TableSort } from './export-view.ts'
import { GlobalFilterControls } from './global-filters.tsx'
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
import type { OpenSemanticRef } from './source-facts.ts'
import { blockSources, SourceSummary } from './sources.tsx'
import { DatasetTable } from './table.tsx'

function CellMenu({
  onSource,
  onContext,
  askDsh,
  contextDisabled,
  onExplore,
}: {
  onSource?: (trigger: HTMLElement) => void
  onContext: (trigger: HTMLElement) => void
  askDsh?: boolean
  contextDisabled?: boolean
  onExplore?: (trigger: HTMLElement) => void
}) {
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const focusIndex = useRef(0)
  const disabledReasonId = useId()
  const actions: {
    label: string
    run: (trigger: HTMLElement) => void
    disabled?: boolean
  }[] = [
    ...(onExplore ? [{ label: '探索图表', run: onExplore }] : []),
    ...(onSource ? [{ label: '数据源', run: onSource }] : []),
    { label: askDsh ? 'Ask DSH' : '复制上下文', run: onContext, disabled: contextDisabled },
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
              aria-label={action.label}
              aria-disabled={action.disabled || undefined}
              aria-describedby={action.disabled ? disabledReasonId : undefined}
              onClick={() => {
                if (action.disabled) return
                setOpen(false)
                trigger.current?.focus()
                action.run(trigger.current!)
              }}
            >
              {action.label}
              {action.disabled && <small id={disabledReasonId}>请先保存或取消编辑</small>}
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
  exploration,
  onExplorationChange,
  rowIndices,
  filterKey,
  tableSort,
  onTableSortChange,
}: {
  block: PresentationBlock
  document: PresentationDocument
  mode: ReaderMode
  exploration?: ChartExploration
  onExplorationChange?: (state: ChartExploration) => void
  rowIndices?: readonly number[]
  filterKey?: string
  tableSort?: TableSort
  onTableSortChange?: (sort: TableSort) => void
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
  const metric = block.kind === 'metric' ? selectMetric(dataset.data, block, rowIndices) : undefined
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
          {block.description && <p className="pr-muted">{block.description}</p>}
          {metric.comparisons.length > 0 && (
            <div className="pr-metric-comparisons">
              {metric.comparisons.map((comparison) => (
                <div className="pr-metric-comparison" key={comparison.label}>
                  <span className="pr-muted">{comparison.label}</span>
                  {comparison.reference && <span>参考值 {comparison.reference.text}</span>}
                  {(comparison.delta || comparison.relative) && (
                    <span className={`pr-metric-change pr-metric-change-${comparison.tone}`}>
                      {comparison.sign === undefined
                        ? '变化不可用'
                        : comparison.sign === 0
                          ? '持平'
                          : comparison.sign === 1
                            ? '↑ 上升'
                            : '↓ 下降'}
                      {comparison.delta && <span>变化 {comparison.delta.text}</span>}
                      {comparison.relative && <span>变化率 {comparison.relative.text}</span>}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          {dataset.data.truncated && <p className="pr-notice">{datasetScope(dataset.data)}</p>}
        </>
      ) : block.kind === 'chart' ? (
        <ChartRenderer
          dataset={dataset}
          block={block}
          mode={mode}
          hidden={exploration?.hidden ?? []}
          onHiddenChange={
            onExplorationChange
              ? (hidden) =>
                  onExplorationChange({
                    ...(exploration ?? initialChartExploration(block)),
                    hidden,
                  })
              : undefined
          }
          rowIndices={rowIndices}
        />
      ) : block.kind === 'table' ? (
        <DatasetTable
          data={dataset.data}
          columns={block.columns}
          mode={mode}
          caption="数据表"
          sort={tableSort}
          onSortChange={onTableSortChange}
          filterKey={filterKey}
          rowIndices={rowIndices}
          showScope={dataset.data.truncated}
          showSelectionCount={dataset.data.truncated}
        />
      ) : null}
    </>
  )
}

/** Group adjacent cards/charts within one region, preserving authored order at every width. */
function blockGroups(blocks: PresentationBlock[]): PresentationBlock[][] {
  const groups: PresentationBlock[][] = []
  for (const block of blocks) {
    const previous = groups.at(-1)
    if ((block.kind === 'metric' || block.kind === 'chart') && previous?.[0]?.kind === block.kind)
      previous.push(block)
    else groups.push([block])
  }
  return groups
}

function ReaderContents({
  document: savedDocument,
  mode,
  editing,
  onOpenSemanticRef,
  onAskDsh,
  exportActions,
}: {
  document: PresentationDocument
  mode: ReaderMode
  editing?: ReaderEditing
  onOpenSemanticRef?: OpenSemanticRef
  onAskDsh?: (context: string) => void
  exportActions?: ReaderExportActions
}) {
  const document = editing
    ? {
        ...savedDocument,
        ...editing.edits,
        interaction: editedInteraction(savedDocument, editing.edits.blocks),
      }
    : savedDocument
  const readerRoot = useRef<HTMLElement>(null)
  const [tableSorts, setTableSorts] = useState<Record<string, TableSort | undefined>>({})
  const [exportStatus, setExportStatus] = useState<{ error?: boolean; message: string }>()
  const interaction = document.interaction
  const [chosen, setChosen] = useState<Record<string, string>>(() =>
    interaction ? defaultSelection(interaction) : {},
  )
  const selection = mode === 'static' && interaction ? defaultSelection(interaction) : chosen
  const rowsFor = (block: PresentationBlock) => interactionRows(interaction, selection, block)
  const summaryFor = (block: PresentationBlock) =>
    interaction?.blockIds.includes(block.id) ? filterSummary(interaction, selection) : undefined

  const [sourceCell, setSourceCell] = useState<{ block: PresentationBlock; trigger: HTMLElement }>()
  const [explorations, setExplorations] = useState<Record<string, ChartExploration>>({})
  const [explorerCell, setExplorerCell] = useState<{ id: string; trigger: HTMLElement }>()
  const updateExploration = (id: string, state: ChartExploration) => {
    const saved = document.blocks.find((block) => block.id === id)
    if (saved?.kind !== 'chart') return
    if (
      editing &&
      !editing.disabled &&
      JSON.stringify(state.view) !== JSON.stringify(initialChartExploration(saved).view)
    ) {
      const block = exploredChartBlock(saved, state)
      editing.onChange({
        ...editing.edits,
        blocks: editing.edits.blocks.map((entry) => (entry.id === id ? block : entry)),
      })
    }
    setExplorations((previous) => ({ ...previous, [id]: state }))
  }
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
  const renderBlock = (savedBlock: PresentationBlock) => {
    const local =
      savedBlock.kind === 'chart' && Object.hasOwn(explorations, savedBlock.id)
        ? explorations[savedBlock.id]
        : undefined
    const view =
      savedBlock.kind === 'chart'
        ? editing
          ? initialChartExploration(savedBlock).view
          : (local?.view ?? initialChartExploration(savedBlock).view)
        : undefined
    const state =
      savedBlock.kind === 'chart' && view
        ? {
            ...(local ?? initialChartExploration(savedBlock)),
            view,
            preparedViewId:
              editing && local && JSON.stringify(local.view) !== JSON.stringify(view)
                ? undefined
                : local?.preparedViewId,
          }
        : undefined
    const block = savedBlock.kind === 'chart' ? exploredChartBlock(savedBlock, state) : savedBlock
    const rows = rowsFor(block)
    const cellMenu = (onContext: (trigger: HTMLElement) => void) => (
      <CellMenu
        onContext={onContext}
        askDsh={!!onAskDsh}
        contextDisabled={!!onAskDsh && !!editing}
        onExplore={
          savedBlock.kind === 'chart'
            ? (trigger) => setExplorerCell({ id: savedBlock.id, trigger })
            : undefined
        }
        onSource={
          block.kind === 'markdown'
            ? undefined
            : (trigger) => setSourceCell({ block: savedBlock, trigger })
        }
      />
    )
    return (
      <section
        className={`pr-block pr-block-${block.kind}`}
        key={block.id}
        data-block-id={block.id}
        data-block-kind={block.kind}
        data-chart-layout={block.kind === 'chart' && block.chart === 'pie' ? 'wide' : undefined}
      >
        {mode === 'interactive' && (
          <div className="pr-cell-toolbar pr-interactive">
            {onAskDsh ? (
              cellMenu(() => onAskDsh(followUpContext(document, savedBlock, state, selection)))
            ) : (
              <CopyContext text={followUpContext(document, savedBlock, state, selection)}>
                {cellMenu}
              </CopyContext>
            )}
          </div>
        )}
        {editing && <CellEditor block={savedBlock} document={savedDocument} editing={editing} />}
        <Block
          block={block}
          document={document}
          mode={mode}
          exploration={state}
          onExplorationChange={
            block.kind === 'chart' && mode === 'interactive'
              ? (next) => updateExploration(block.id, next)
              : undefined
          }
          rowIndices={rows}
          filterKey={summaryFor(block)}
          tableSort={Object.hasOwn(tableSorts, block.id) ? tableSorts[block.id] : undefined}
          onTableSortChange={(sort) =>
            setTableSorts((previous) => ({ ...previous, [block.id]: sort }))
          }
        />
        {savedBlock.kind === 'chart' && block.kind === 'chart' && explorerCell?.id === block.id && (
          <ChartExplorer
            block={savedBlock}
            data={
              rows
                ? {
                    ...datasetById(document, block.datasetId).data,
                    rows: rows.map(
                      (index) => datasetById(document, block.datasetId).data.rows[index]!,
                    ),
                  }
                : datasetById(document, block.datasetId).data
            }
            state={state ?? initialChartExploration(savedBlock)}
            onChange={(next) => updateExploration(block.id, next)}
            onClose={() => setExplorerCell(undefined)}
            restoreFocusTo={explorerCell.trigger}
          />
        )}
        {blockSources(document, block).some((source) => source.status === 'unavailable') && (
          <p className="pr-notice">数据源不可用</p>
        )}
      </section>
    )
  }
  const sourceSaved =
    sourceCell && document.blocks.find((block) => block.id === sourceCell.block.id)
  const sourceLocal =
    sourceSaved?.kind === 'chart' && Object.hasOwn(explorations, sourceSaved.id)
      ? explorations[sourceSaved.id]
      : undefined
  const sourceState =
    sourceSaved?.kind === 'chart'
      ? {
          ...(sourceLocal ?? initialChartExploration(sourceSaved)),
          view: editing
            ? initialChartExploration(sourceSaved).view
            : (sourceLocal?.view ?? initialChartExploration(sourceSaved).view),
        }
      : undefined
  const sourceBlock =
    sourceSaved?.kind === 'chart' ? exploredChartBlock(sourceSaved, sourceState) : sourceSaved
  return (
    <article
      ref={readerRoot}
      className="pr-reader"
      data-presentation-reader="true"
      data-mode={mode}
    >
      <header className="pr-header">
        {mode === 'interactive' && exportActions && (
          <ExportMenu
            actions={exportActions}
            editing={!!editing}
            onExport={() => {
              if (editing || exportActions.disabled || !readerRoot.current) return
              try {
                const result = exportCurrentView(readerRoot.current, savedDocument, {
                  selection,
                  explorations,
                  tableSorts,
                })
                savePresentationHtml(result.bytes, result.filename)
                setExportStatus({ message: '已导出当前视图（包含筛选后的全部已保存行）' })
              } catch (error) {
                setExportStatus({
                  error: true,
                  message: error instanceof Error ? error.message : '导出失败，请重试。',
                })
              }
            }}
          />
        )}
        {exportStatus && (
          <p className="pr-interactive pr-muted" role={exportStatus.error ? 'alert' : 'status'}>
            {exportStatus.message}
          </p>
        )}
        {editing ? (
          <label className="pr-report-title-editor">
            报告标题
            <input
              aria-label="报告标题"
              disabled={editing.disabled}
              value={document.title}
              onChange={(event) =>
                editing.onChange({ ...editing.edits, title: event.target.value })
              }
            />
          </label>
        ) : (
          <h1>{document.title}</h1>
        )}
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
      {!document.blocks.length && <p className="pr-empty">这份报告尚无 cell。数据与来源仍保留。</p>}
      <div className="pr-blocks">
        {(() => {
          const renderGroups = (blocks: PresentationBlock[]) =>
            blockGroups(blocks).map((group) =>
              group[0]!.kind === 'metric' || group[0]!.kind === 'chart' ? (
                <div
                  className={group[0]!.kind === 'metric' ? 'pr-metric-group' : 'pr-chart-row'}
                  key={group[0]!.id}
                >
                  {group.map(renderBlock)}
                </div>
              ) : (
                renderBlock(group[0]!)
              ),
            )
          if (!interaction) return renderGroups(document.blocks)
          const start = document.blocks.findIndex((block) => block.id === interaction.blockIds[0])
          const end = start + interaction.blockIds.length
          const fixed = (blocks: PresentationBlock[], key: string) =>
            blocks.length > 0 && (
              <section className="pr-fixed-region pr-blocks" key={key} aria-label="固定内容">
                <p className="pr-region-label">原始快照 · 不随筛选变化</p>
                {renderGroups(blocks)}
              </section>
            )
          return (
            <>
              {fixed(document.blocks.slice(0, start), 'before')}
              {start > 0 && <hr className="pr-region-divider" />}
              <section className="pr-interaction-region" aria-label={interaction.title}>
                <header className="pr-interaction-header">
                  <h2>{interaction.title}</h2>
                  <p className="pr-muted">以下指标、图表与表格随筛选同步更新</p>
                  {mode === 'interactive' && (
                    <GlobalFilterControls
                      interaction={interaction}
                      selection={selection}
                      onChange={setChosen}
                    />
                  )}
                  <p className="pr-filter-status" role="status">
                    {filterSummary(interaction, selection)}
                  </p>
                </header>
                <div className="pr-blocks">{renderGroups(document.blocks.slice(start, end))}</div>
              </section>
              {end < document.blocks.length && <hr className="pr-region-divider" />}
              {fixed(document.blocks.slice(end), 'after')}
            </>
          )
        })()}
      </div>
      {mode === 'static' && <SourceSummary document={document} />}
      {sourceCell && sourceBlock && (
        <SourceDialog
          key={sourceCell.block.id}
          document={document}
          block={sourceBlock}
          explored={!!sourceState}
          rowIndices={rowsFor(sourceBlock)}
          filterKey={summaryFor(sourceBlock)}
          filterSummary={summaryFor(sourceBlock)}
          restoreFocusTo={sourceCell.trigger}
          onClose={() => setSourceCell(undefined)}
          onOpenSemanticRef={onOpenSemanticRef}
        />
      )}
    </article>
  )
}

export function PresentationReader({
  document,
  mode = 'interactive',
  editing,
  onOpenSemanticRef,
  onAskDsh,
  exportActions,
}: {
  document: PresentationDocument
  mode?: ReaderMode
  editing?: ReaderEditing
  onOpenSemanticRef?: OpenSemanticRef
  onAskDsh?: (context: string) => void
  exportActions?: ReaderExportActions
}) {
  const parsed = useMemo(() => parsePresentationDocument(document), [document])
  return (
    <ReaderContents
      key={`${parsed.workspaceId}/${parsed.reportId}/${parsed.buildId}/${mode}/${editing ? 'edit' : 'read'}`}
      document={parsed}
      mode={mode}
      editing={editing}
      onOpenSemanticRef={mode === 'interactive' ? onOpenSemanticRef : undefined}
      onAskDsh={mode === 'interactive' ? onAskDsh : undefined}
      exportActions={exportActions}
    />
  )
}
