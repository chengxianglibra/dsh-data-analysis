// @ts-nocheck -- Host slot and hook contracts are supplied by DSH's runtime module table.

import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import {
  marivoPresentationDeliveryDefinition,
  PRESENTATION_TURN_DATA_KEY,
  presentationDeliveryIdentity,
  presentationsForNode,
} from './delivery.ts'
import { PresentationDeliveryModel, reportKey } from './delivery-model.ts'
import { HostPresentationReader } from './host-entry.tsx'

const deliveryStyles = `
.pd-cards{display:grid;gap:10px;margin-top:12px}.pd-card{border:1px solid var(--dsw-alias-border-l2,#dce5e5);border-radius:10px;padding:14px;color:var(--dsw-alias-label-primary,#1d3036);background:var(--dsw-alias-bg-module-platform,#f4f7f7)}
.pd-card h3{margin:0 0 7px;font-size:15px}.pd-card p{margin:7px 0;white-space:pre-wrap;overflow-wrap:anywhere}.pd-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.pd-actions button{font:inherit;padding:6px 12px;border:1px solid var(--dsw-alias-border-l2,#dce5e5);border-radius:6px;background:var(--dsw-alias-bg-base,#fff);color:inherit;cursor:pointer}.pd-actions button:disabled{opacity:.55;cursor:wait}.pd-actions button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#087c71);outline-offset:3px}
.pd-muted{font-size:12px;color:var(--dsw-alias-label-secondary,#5b7076)}.pd-error{color:var(--dsw-alias-state-warn-label,#805b20);overflow-wrap:anywhere}.pd-dialog{position:fixed;inset:0;width:96vw;height:92vh;max-height:96vh;max-width:96vw;padding:0;border:1px solid var(--dsw-alias-border-l2,#dce5e5);border-radius:12px;color:var(--dsw-alias-label-primary,#1d3036);background:var(--dsw-alias-bg-base,#fff);overflow:auto;pointer-events:auto}.pd-dialog::backdrop{background:#0008}.pd-toolbar{position:sticky;top:0;z-index:5;display:flex;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l2,#dce5e5);background:var(--dsw-alias-bg-base,#fff)}.pd-status{padding:12px 20px}.pd-toolbar strong{overflow-wrap:anywhere}.pd-reader{padding:8px}
@media(max-width:600px){.pd-dialog{width:100vw;max-width:100vw;height:100dvh;max-height:100dvh;border-radius:0}.pd-toolbar{flex-wrap:wrap}}
`

export function PresentationCards({ matched, sessionId, workspaces, model }) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot)
  // The runtime framework supplies sessionId independently of event data.
  const deliveries = useMemo(
    () => matched.filter((delivery) => delivery.dshSessionId === sessionId),
    [matched, sessionId],
  )
  const workspaceId =
    workspaces.find((item) => item.sessionIds.includes(sessionId))?.workspaceId ?? ''
  useEffect(() => {
    model.contextChanged(sessionId, workspaceId)
    for (const delivery of deliveries) void model.preview(delivery, sessionId, workspaceId)
  }, [model, sessionId, workspaceId, deliveries])
  if (!deliveries.length) return null
  return (
    <div className="pd-cards">
      <style>{deliveryStyles}</style>
      {deliveries.map((delivery) => {
        const current = state.receipts[reportKey(delivery.receipt)] ?? delivery.receipt
        const selected =
          state.delivery &&
          presentationDeliveryIdentity(state.delivery) === presentationDeliveryIdentity(delivery)
        return (
          <section
            className="pd-card"
            key={presentationDeliveryIdentity(delivery)}
            data-presentation-card={delivery.receipt.buildId}
          >
            <h3>{current.title}</h3>
            <p>{current.summary}</p>
            <div className="pd-actions">
              <button
                type="button"
                onClick={() => void model.show(delivery, sessionId, workspaceId)}
              >
                打开分析
              </button>
              <button
                type="button"
                disabled={selected && state.downloading}
                onClick={() => void model.download(delivery, sessionId, workspaceId)}
              >
                {selected && state.downloading ? '正在下载…' : '下载 HTML'}
              </button>
              <span className="pd-muted">保存的数据与来源快照 · 可离线阅读</span>
            </div>
            {selected && state.downloadError && (
              <p role="alert" className="pd-error">
                {state.downloadError}
              </p>
            )}
            {selected && state.notice && (
              <p role="status" className="pd-muted">
                {state.notice}
              </p>
            )}
          </section>
        )
      })}
    </div>
  )
}

export function PresentationOverlay({
  model,
  sessionId,
  workspaceId,
  workspaceUnavailable = false,
  openSemanticObject,
}) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot)
  const dialog = useRef(null)
  const closeReader = () => {
    if (state.saving) return
    if (model.dirty && !window.confirm('存在未保存的编辑。放弃编辑并关闭报告？')) return
    model.close()
  }
  useEffect(() => {
    const beforeUnload = (event) => {
      if (model.dirty) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [model])
  useEffect(() => {
    model.contextChanged(sessionId, workspaceId)
  }, [model, sessionId, workspaceId])
  useEffect(() => {
    if (workspaceUnavailable) model.unavailable()
  }, [model, workspaceUnavailable])
  useEffect(() => {
    if (!state.open) return undefined
    const opener = document.activeElement,
      element = dialog.current
    element.showModal()
    return () => {
      element.close()
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [state.open])
  if (!state.open || !state.delivery) return null
  const delivery = state.delivery
  return (
    <dialog
      ref={dialog}
      className="pd-dialog"
      aria-label="分析快照"
      onCancel={(event) => {
        event.preventDefault()
        closeReader()
      }}
    >
      <style>{deliveryStyles}</style>
      <header className="pd-toolbar">
        <strong>{state.resolvedReceipt?.title ?? delivery.receipt.title}</strong>
        <div className="pd-actions">
          <button
            type="button"
            disabled={state.downloading || !!state.error}
            onClick={() => void model.download(delivery, sessionId, workspaceId, true)}
          >
            {state.downloading ? '正在下载…' : '下载 HTML'}
          </button>
          <button
            type="button"
            aria-label="关闭分析快照"
            disabled={state.saving}
            onClick={closeReader}
          >
            关闭
          </button>
        </div>
      </header>
      {state.document && (
        <div
          role="toolbar"
          className="pd-actions pd-status pr-interactive"
          aria-label="报告编辑操作"
        >
          {state.editing ? (
            <>
              <button
                type="button"
                disabled={state.saving || !state.editing.undo.length}
                onClick={() => model.undoEdit()}
              >
                撤销
              </button>
              <button
                type="button"
                disabled={state.saving || !state.editing.redo.length}
                onClick={() => model.redoEdit()}
              >
                重做
              </button>
              <button type="button" disabled={state.saving} onClick={() => void model.saveEdit()}>
                {state.saving ? '正在保存…' : '保存编辑'}
              </button>
              <button type="button" disabled={state.saving} onClick={() => model.cancelEdit()}>
                取消编辑
              </button>
              <span className="pd-muted">{model.dirty ? '有未保存的编辑' : '编辑模式'}</span>
            </>
          ) : (
            <button type="button" onClick={() => model.beginEdit()}>
              编辑报告
            </button>
          )}
        </div>
      )}
      {state.editError && (
        <p className="pd-status pd-error" role="alert">
          {state.editError}
        </p>
      )}
      {state.loading && (
        <p className="pd-status" role="status">
          正在读取已保存的分析快照…
        </p>
      )}
      {state.error && (
        <p className="pd-status pd-error" role="alert">
          {state.error}
        </p>
      )}
      {state.downloadError && state.downloadError !== state.error && (
        <p className="pd-status pd-error" role="alert">
          {state.downloadError}
        </p>
      )}
      {state.notice && (
        <p className="pd-status pd-muted" role="status">
          {state.notice}
        </p>
      )}
      {state.document && (
        <div className="pd-reader">
          <HostPresentationReader
            document={state.document}
            onOpenSemanticRef={
              openSemanticObject &&
              !workspaceUnavailable &&
              sessionId === delivery.dshSessionId &&
              workspaceId === state.document.workspaceId
                ? (ref) => openSemanticObject(state.document.workspaceId, ref)
                : undefined
            }
            editing={
              state.editing
                ? {
                    edits: state.editing.edits,
                    onChange: (edits) => model.changeEdits(edits),
                    disabled: state.saving,
                  }
                : undefined
            }
          />
        </div>
      )}
    </dialog>
  )
}

export function installPresentation(ctx, rpc, openSemanticObject) {
  const model = new PresentationDeliveryModel(rpc)
  ctx.effect(() => () => model.dispose(), 'dsh-data-analysis: presentation reader lifecycle')
  ctx.on('connection/reset', () => model.resetConnection())
  ctx.slots.inject('conversation.chat.node', () => {
    const disposeCards = ctx.slots.register(
      { name: 'conversation.chat.node', key: PRESENTATION_TURN_DATA_KEY },
      function Cards({
        node,
        sessionId,
        useWorkspaces,
      }: ChatNodeViewProps<typeof PRESENTATION_TURN_DATA_KEY>) {
        return (
          <PresentationCards
            matched={presentationsForNode(node, sessionId)}
            sessionId={sessionId}
            workspaces={useWorkspaces((state) => state.items)}
            model={model}
          />
        )
      },
    )
    // A new Definition can immediately replay existing events. Its keyed renderer
    // must already exist, including when the Host declares this slot after us.
    const disposeDefinition = ctx.conversationEvents.register(marivoPresentationDeliveryDefinition)
    return () => {
      disposeDefinition()
      disposeCards()
    }
  })
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      { name: 'shell.overlay', id: 'marivo-presentation' },
      function Overlay({ useSessions, useWorkspaces }) {
        const sessionId = useSessions((state) => state.current) ?? ''
        const workspaces = useWorkspaces((state) => state.items)
        const phase = useWorkspaces((state) => state.phase)
        const error = useWorkspaces((state) => state.state === 'error')
        const workspaceId =
          workspaces.find((item) => item.sessionIds.includes(sessionId))?.workspaceId ?? ''
        return (
          <PresentationOverlay
            model={model}
            sessionId={sessionId}
            workspaceId={workspaceId}
            workspaceUnavailable={error || (phase === 'ready' && !workspaceId)}
            openSemanticObject={openSemanticObject}
          />
        )
      },
    ),
  )
}
