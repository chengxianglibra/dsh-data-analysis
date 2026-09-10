import { useEffect, useId, useRef, useState } from 'react'
import { chartColumns } from '../../presentation/contracts/charts.ts'
import type { PresentationBlock, PresentationDocument } from '../../presentation/contracts/types.ts'
import { CloseIcon } from './icons.tsx'
import { datasetById } from './model.ts'
import { SourceCode } from './source-code.tsx'
import { type SourceTab, sourceTabForKey, sourceTabs } from './source-code-model.ts'
import type { OpenSemanticRef } from './source-facts.ts'
import { SourceOverview } from './sources.tsx'
import { DatasetTable } from './table.tsx'

export function SourceDialog({
  document,
  block,
  onClose,
  restoreFocusTo,
  rowIndices,
  filterKey,
  filterSummary,
  onOpenSemanticRef,
}: {
  document: PresentationDocument
  block: PresentationBlock
  onClose: () => void
  restoreFocusTo?: HTMLElement | null
  rowIndices?: readonly number[]
  filterKey?: string
  filterSummary?: string
  onOpenSemanticRef?: OpenSemanticRef
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const backdropPointer = useRef(false)
  const [tab, setTab] = useState<SourceTab>('overview')
  const id = useId()
  const dataset = 'datasetId' in block ? datasetById(document, block.datasetId) : undefined
  const tabs = sourceTabs(Boolean(dataset))
  const columns =
    block.kind === 'chart'
      ? chartColumns(block)
      : block.kind === 'table'
        ? block.columns
        : undefined
  useEffect(() => {
    const element = dialog.current
    if (!element) return undefined
    const opener = restoreFocusTo ?? element.ownerDocument.activeElement
    element.showModal()
    return () => {
      element.close()
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [restoreFocusTo])
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Native dialog Escape dismisses through onCancel.
    <dialog
      ref={dialog}
      className="pr-source-dialog"
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.stopPropagation()
        event.preventDefault()
        onClose()
      }}
      onPointerDown={(event) => {
        backdropPointer.current = event.target === event.currentTarget
      }}
      onClick={(event) => {
        if (backdropPointer.current && event.target === event.currentTarget) onClose()
        backdropPointer.current = false
      }}
    >
      <div className="pr-source-dialog-shell">
        <header className="pr-source-dialog-header">
          <div>
            <h2 className="pr-source-dialog-title" id={`${id}-title`}>
              数据源
            </h2>
          </div>
          <button
            type="button"
            className="pr-source-dialog-close"
            aria-label="关闭数据源"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>
        <div className="pr-source-tabs" role="tablist" aria-label="数据源视图">
          {tabs.map((item) => (
            <button
              type="button"
              role="tab"
              className="pr-source-tab"
              id={`${id}-${item}-tab`}
              key={item}
              data-tab={item}
              aria-selected={tab === item}
              aria-controls={`${id}-${item}`}
              tabIndex={tab === item ? 0 : -1}
              onClick={() => setTab(item)}
              onKeyDown={(event) => {
                const next = sourceTabForKey(tabs, item, event.key)
                if (!next) return
                event.preventDefault()
                setTab(next)
                event.currentTarget.parentElement
                  ?.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)
                  ?.focus()
              }}
            >
              {item === 'overview' ? '概要' : item === 'preview' ? '数据预览' : '相关查询'}
            </button>
          ))}
        </div>
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: Keep overflowing source details scrollable by keyboard. */}
        <div className="pr-source-dialog-body" tabIndex={0}>
          {filterSummary && <p className="pr-muted">当前筛选：{filterSummary}</p>}
          <div
            id={`${id}-overview`}
            role="tabpanel"
            aria-labelledby={`${id}-overview-tab`}
            hidden={tab !== 'overview'}
          >
            <SourceOverview
              document={document}
              block={block}
              onOpenSemanticRef={onOpenSemanticRef}
            />
          </div>
          {dataset && (
            <div
              id={`${id}-preview`}
              role="tabpanel"
              aria-labelledby={`${id}-preview-tab`}
              hidden={tab !== 'preview'}
            >
              <DatasetTable
                data={dataset.data}
                rowIndices={rowIndices}
                filterKey={filterKey}
                columns={columns}
                mode="interactive"
                caption="数据预览"
                hideCaption
                showScope={dataset.data.truncated}
              />
            </div>
          )}
          <div
            id={`${id}-code`}
            role="tabpanel"
            aria-labelledby={`${id}-code-tab`}
            hidden={tab !== 'code'}
          >
            <SourceCode document={document} block={block} interactive />
          </div>
        </div>
      </div>
    </dialog>
  )
}
