import { useEffect, useId, useRef, useState } from 'react'
import type { PresentationBlock, PresentationDocument } from '../../presentation/contracts/types.ts'
import { CloseIcon } from './icons.tsx'
import { chartTitle, datasetById } from './model.ts'
import { SourceOverview } from './sources.tsx'
import { DatasetTable } from './table.tsx'

export function SourceDialog({
  document,
  block,
  onClose,
  restoreFocusTo,
}: {
  document: PresentationDocument
  block: PresentationBlock
  onClose: () => void
  restoreFocusTo?: HTMLElement | null
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const backdropPointer = useRef(false)
  const [tab, setTab] = useState<'overview' | 'preview'>('overview')
  const id = useId()
  const dataset = 'datasetId' in block ? datasetById(document, block.datasetId) : undefined
  const columns =
    block.kind === 'chart'
      ? [...new Set([block.x, ...block.y])]
      : block.kind === 'table'
        ? block.columns
        : undefined
  const title =
    block.kind === 'metric'
      ? block.label
      : block.kind === 'chart' && dataset
        ? chartTitle(dataset.data, block)
        : block.kind === 'table'
          ? '数据表'
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
            {title && <p className="pr-source-dialog-context">{title}</p>}
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
        {dataset && (
          <div className="pr-source-tabs" role="tablist" aria-label="数据源视图">
            {(['overview', 'preview'] as const).map((item) => (
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
                  const next =
                    event.key === 'Home'
                      ? 'overview'
                      : event.key === 'End'
                        ? 'preview'
                        : event.key === 'ArrowLeft' || event.key === 'ArrowRight'
                          ? tab === 'overview'
                            ? 'preview'
                            : 'overview'
                          : undefined
                  if (!next) return
                  event.preventDefault()
                  setTab(next)
                  event.currentTarget.parentElement
                    ?.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)
                    ?.focus()
                }}
              >
                {item === 'overview' ? '概要' : '数据预览'}
              </button>
            ))}
          </div>
        )}
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: Keep overflowing source details scrollable by keyboard. */}
        <div className="pr-source-dialog-body" tabIndex={0}>
          {dataset ? (
            <div
              id={`${id}-overview`}
              role="tabpanel"
              aria-labelledby={`${id}-overview-tab`}
              hidden={tab !== 'overview'}
            >
              <SourceOverview document={document} block={block} />
            </div>
          ) : (
            <SourceOverview document={document} block={block} />
          )}
          {dataset && (
            <div
              id={`${id}-preview`}
              role="tabpanel"
              aria-labelledby={`${id}-preview-tab`}
              hidden={tab !== 'preview'}
            >
              <DatasetTable
                data={dataset.data}
                columns={columns}
                mode="interactive"
                caption={title ?? '数据预览'}
                showScope={dataset.data.truncated}
              />
            </div>
          )}
        </div>
      </div>
    </dialog>
  )
}
