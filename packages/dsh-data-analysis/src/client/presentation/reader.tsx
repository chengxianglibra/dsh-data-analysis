import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { parsePresentationDocument } from '../../presentation/contracts/index.ts'
import {
  defaultSelection,
  editedInteraction,
  filterSummary,
  interactionRows,
} from '../../presentation/contracts/interaction.ts'
import type { PresentationBlock, PresentationDocument } from '../../presentation/contracts/types.ts'
import { useCopy } from './../i18n/context.tsx'
import { ReportCopyProvider, useActionCopy } from '../i18n/context.tsx'
import { ChartExplorer } from './chart-explorer.tsx'
import { ChartRenderer } from './chart-renderer.tsx'
import { type ChartExploration, exploredChartBlock, initialChartExploration } from './chart-view.ts'
import { type PresentationContext, presentationCellLabel } from './context-reference.ts'
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
import { blockSources, SourceList } from './sources.tsx'
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
  const t = useActionCopy()

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
    ...(onExplore ? [{ label: t('marivo.presentation.explore-chart'), run: onExplore }] : []),
    ...(onSource ? [{ label: t('marivo.presentation.datasource'), run: onSource }] : []),
    {
      label: t(askDsh ? 'marivo.presentation.add-to-question' : 'marivo.presentation.copy-context'),
      run: onContext,
      disabled: contextDisabled,
    },
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
        aria-label={t('marivo.presentation.more-cell-actions')}
        title={t('marivo.presentation.more-actions')}
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
        <div
          className="pr-cell-menu-popup"
          role="menu"
          aria-label={t('marivo.presentation.cell-actions')}
        >
          {actions.map((action) => (
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              key={t(action.label)}
              aria-label={t(action.label)}
              aria-disabled={action.disabled || undefined}
              aria-describedby={action.disabled ? disabledReasonId : undefined}
              onClick={() => {
                if (action.disabled) return
                setOpen(false)
                trigger.current?.focus()
                action.run(trigger.current!)
              }}
            >
              {t(action.label)}
              {action.disabled && (
                <small id={disabledReasonId}>
                  {t('marivo.presentation.save-or-cancel-edits-first')}
                </small>
              )}
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
  const t = useCopy()

  if (block.kind === 'markdown') return <Markdown text={block.text} />
  if (block.kind === 'source')
    return (
      <>
        <h2>{t('marivo.presentation.datasource')}</h2>
        <SourceList document={document} block={block} />
      </>
    )
  const dataset = datasetById(document, block.datasetId)
  const metric =
    block.kind === 'metric' ? selectMetric(t.locale, dataset.data, block, rowIndices) : undefined
  return (
    <>
      {block.kind === 'metric' && metric ? (
        <>
          <h2>{t(block.label)}</h2>
          <p
            className="pr-metric-value"
            data-metric-value="true"
            title={
              metric.value === null
                ? t('marivo.presentation.missing-value')
                : valueWithUnit(t.locale, metric.value, metric.column)
            }
          >
            {t(metricText(t.locale, metric.value, metric.column))}
          </p>
          {block.description && <p className="pr-muted">{t(block.description)}</p>}
          {metric.comparisons.length > 0 && (
            <div className="pr-metric-comparisons">
              {metric.comparisons.map((comparison) => (
                <div className="pr-metric-comparison" key={t(comparison.label)}>
                  <span className="pr-muted">{t(comparison.label)}</span>
                  {comparison.reference && (
                    <span>
                      {t('marivo.presentation.reference-value')} {comparison.reference.text}
                    </span>
                  )}
                  {(comparison.delta || comparison.relative) && (
                    <span className={`pr-metric-change pr-metric-change-${comparison.tone}`}>
                      {comparison.sign === undefined
                        ? t('marivo.presentation.change-unavailable')
                        : comparison.sign === 0
                          ? t('marivo.presentation.unchanged')
                          : comparison.sign === 1
                            ? t('marivo.presentation.increase')
                            : t('marivo.presentation.decrease')}
                      {comparison.delta && (
                        <span>
                          {t('marivo.presentation.change')} {comparison.delta.text}
                        </span>
                      )}
                      {comparison.relative && (
                        <span>
                          {t('marivo.presentation.relative-change')} {comparison.relative.text}
                        </span>
                      )}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          {dataset.data.truncated && (
            <p className="pr-notice">{t(datasetScope(t.locale, dataset.data))}</p>
          )}
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
          caption={t('marivo.presentation.data-table')}
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

export interface ReaderViewState {
  chosen: Record<string, string>
  tableSorts: Record<string, TableSort | undefined>
  explorations: Record<string, ChartExploration>
}
export type ReaderViewMemory = Map<string, ReaderViewState>

function ReaderContents({
  document: savedDocument,
  mode,
  editing,
  onOpenSemanticRef,
  onAskDsh,
  exportActions,
  viewMemory,
  closeSourceOnNavigate = false,
}: {
  document: PresentationDocument
  mode: ReaderMode
  editing?: ReaderEditing
  onOpenSemanticRef?: OpenSemanticRef
  onAskDsh?: (context: PresentationContext) => void
  exportActions?: ReaderExportActions
  viewMemory?: ReaderViewMemory
  closeSourceOnNavigate?: boolean
}) {
  const t = useCopy()
  const actionCopy = useActionCopy()

  const document = editing
    ? {
        ...savedDocument,
        ...editing.edits,
        interaction: editedInteraction(savedDocument, editing.edits.blocks),
      }
    : savedDocument
  const memoryKey = `${savedDocument.workspaceId}/${savedDocument.reportId}/${savedDocument.buildId}/${mode}`
  const restored = viewMemory?.get(memoryKey)
  const readerRoot = useRef<HTMLElement>(null)
  const [tableSorts, setTableSorts] = useState<Record<string, TableSort | undefined>>(
    restored?.tableSorts ?? {},
  )
  const [contextError, setContextError] = useState<string>()
  const [exportStatus, setExportStatus] = useState<{ error?: boolean; message: string }>()
  const interaction = document.interaction
  const [chosen, setChosen] = useState<Record<string, string>>(
    () => restored?.chosen ?? (interaction ? defaultSelection(interaction) : {}),
  )
  const selection = mode === 'static' && interaction ? defaultSelection(interaction) : chosen
  const rowsFor = (block: PresentationBlock) => interactionRows(interaction, selection, block)
  const summaryFor = (block: PresentationBlock) =>
    interaction?.blockIds.includes(block.id) ? filterSummary(interaction, selection) : undefined

  const [sourceCell, setSourceCell] = useState<{ block: PresentationBlock; trigger: HTMLElement }>()
  const [explorations, setExplorations] = useState<Record<string, ChartExploration>>(
    restored?.explorations ?? {},
  )
  const [explorerCell, setExplorerCell] = useState<{ id: string; trigger: HTMLElement }>()
  useEffect(() => {
    viewMemory?.set(memoryKey, { chosen, tableSorts, explorations })
  }, [viewMemory, memoryKey, chosen, tableSorts, explorations])
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
        .filter((entry) => !['truncated', 'source_unavailable'].includes(entry.code))
        .map((entry) =>
          entry.code === 'finding_unavailable'
            ? 'marivo.presentation.finding-unavailable'
            : entry.message,
        ),
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
        contextDisabled={!!editing}
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
              cellMenu(() => {
                try {
                  const context = followUpContext(
                    document,
                    savedBlock,
                    state,
                    selection,
                    Object.hasOwn(tableSorts, savedBlock.id)
                      ? tableSorts[savedBlock.id]
                      : undefined,
                  )
                  onAskDsh({ label: presentationCellLabel(savedBlock), context })
                  setContextError(undefined)
                } catch (error) {
                  setContextError(error instanceof Error ? error.message : String(error))
                }
              })
            ) : (
              <CopyContext
                getText={() =>
                  followUpContext(
                    document,
                    savedBlock,
                    state,
                    selection,
                    Object.hasOwn(tableSorts, savedBlock.id)
                      ? tableSorts[savedBlock.id]
                      : undefined,
                  )
                }
              >
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
          <p className="pr-notice">{t('marivo.presentation.datasource-unavailable')}</p>
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
      lang={document.locale}
      ref={readerRoot}
      className="pr-reader"
      data-presentation-reader="true"
      data-mode={mode}
    >
      {contextError && (
        <p role="alert" className="pr-notice">
          {actionCopy(contextError)}
        </p>
      )}
      <header className="pr-header">
        <div className="pr-title-row">
          {editing ? (
            <label className="pr-report-title-editor">
              {actionCopy('marivo.presentation.report-title')}
              <input
                aria-label={actionCopy('marivo.presentation.report-title')}
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
                  if (exportActions.publishing) {
                    void exportActions.publishing.publishView(result.bytes)
                    return
                  }
                  savePresentationHtml(result.bytes, result.filename)
                  setExportStatus({
                    message:
                      'marivo.presentation.current-view-exported-including-all-saved-rows-matching-the',
                  })
                } catch (error) {
                  setExportStatus({
                    error: true,
                    message:
                      error instanceof Error
                        ? error.message
                        : 'marivo.presentation.export-failed-please-retry',
                  })
                }
              }}
            />
          )}
        </div>
        {exportStatus && (
          <p className="pr-interactive pr-muted" role={exportStatus.error ? 'alert' : 'status'}>
            {actionCopy(exportStatus.message)}
          </p>
        )}
        <p className="pr-muted">
          {t('marivo.presentation.version')} {document.buildId} {t('marivo.presentation.generated')}{' '}
          <time dateTime={document.generatedAt}>
            {t(snapshotDate(t.locale, document.generatedAt))}
          </time>
        </p>
      </header>
      {diagnostics.length > 0 && (
        <aside className="pr-diagnostics" aria-label={t('marivo.presentation.presentation-notes')}>
          <ul>
            {diagnostics.map((message) => (
              <li key={t(message)}>{t(message)}</li>
            ))}
          </ul>
        </aside>
      )}
      {!document.blocks.length && (
        <p className="pr-empty">
          {t('marivo.presentation.this-report-has-no-cells-its-data-and-sources')}
        </p>
      )}
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
              <section
                className="pr-fixed-region pr-blocks"
                key={key}
                aria-label={t('marivo.presentation.fixed-content')}
              >
                <p className="pr-region-label">
                  {t('marivo.presentation.original-snapshot-unaffected-by-filters')}
                </p>
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
                  <p className="pr-muted">
                    {t(
                      'marivo.presentation.these-metrics-charts-and-tables-update-together-with-the',
                    )}
                  </p>
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
      {sourceCell && sourceBlock && (
        <SourceDialog
          key={sourceCell.block.id}
          document={document}
          block={sourceBlock}
          rowIndices={rowsFor(sourceBlock)}
          filterKey={summaryFor(sourceBlock)}
          filterSummary={summaryFor(sourceBlock)}
          restoreFocusTo={sourceCell.trigger}
          onClose={() => setSourceCell(undefined)}
          onOpenSemanticRef={
            onOpenSemanticRef
              ? (ref) => {
                  onOpenSemanticRef(ref)
                  if (closeSourceOnNavigate) setSourceCell(undefined)
                }
              : undefined
          }
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
  viewMemory,
  closeSourceOnNavigate = false,
}: {
  document: PresentationDocument
  mode?: ReaderMode
  editing?: ReaderEditing
  onOpenSemanticRef?: OpenSemanticRef
  onAskDsh?: (context: PresentationContext) => void
  exportActions?: ReaderExportActions
  viewMemory?: ReaderViewMemory
  closeSourceOnNavigate?: boolean
}) {
  const parsed = useMemo(() => parsePresentationDocument(document), [document])
  return (
    <ReportCopyProvider locale={parsed.locale}>
      <ReaderContents
        key={`${parsed.workspaceId}/${parsed.reportId}/${parsed.buildId}/${mode}/${editing ? 'edit' : 'read'}`}
        document={parsed}
        mode={mode}
        editing={editing}
        onOpenSemanticRef={mode === 'interactive' ? onOpenSemanticRef : undefined}
        onAskDsh={mode === 'interactive' ? onAskDsh : undefined}
        exportActions={exportActions}
        viewMemory={viewMemory}
        closeSourceOnNavigate={closeSourceOnNavigate}
      />
    </ReportCopyProvider>
  )
}
