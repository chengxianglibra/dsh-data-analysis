// @ts-nocheck -- Host slot and hook contracts are supplied by DSH's runtime module table.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import {
  marivoPresentationDeliveryDefinition,
  presentationDeliveryIdentity,
  selectMarivoPresentations,
} from './delivery.ts'
import { PresentationDeliveryModel } from './delivery-model.ts'
import { HostPresentationReader } from './host-entry.tsx'

const deliveryStyles = `
.pd-cards{display:grid;gap:10px;margin-top:12px}.pd-card{border:1px solid var(--dsw-alias-border-l2,#dce5e5);border-radius:10px;padding:14px;color:var(--dsw-alias-label-primary,#1d3036);background:var(--dsw-alias-bg-module-platform,#f4f7f7)}
.pd-card h3{margin:0 0 7px;font-size:15px}.pd-card p{margin:7px 0;white-space:pre-wrap;overflow-wrap:anywhere}.pd-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.pd-actions button{font:inherit;padding:6px 12px;border:1px solid var(--dsw-alias-border-l2,#dce5e5);border-radius:6px;background:var(--dsw-alias-bg-base,#fff);color:inherit;cursor:pointer}.pd-actions button:disabled{opacity:.55;cursor:wait}.pd-actions button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#087c71);outline-offset:3px}
.pd-muted{font-size:12px;color:var(--dsw-alias-label-secondary,#5b7076)}.pd-error{color:var(--dsw-alias-state-warn-label,#805b20);overflow-wrap:anywhere}.pd-dialog{position:fixed;inset:0;width:min(1240px,96vw);height:92vh;max-height:96vh;max-width:96vw;padding:0;border:1px solid var(--dsw-alias-border-l2,#dce5e5);border-radius:12px;color:var(--dsw-alias-label-primary,#1d3036);background:var(--dsw-alias-bg-base,#fff);overflow:auto;pointer-events:auto}.pd-dialog::backdrop{background:#0008}.pd-toolbar{position:sticky;top:0;z-index:5;display:flex;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l2,#dce5e5);background:var(--dsw-alias-bg-base,#fff)}.pd-status{padding:12px 20px}.pd-toolbar strong{overflow-wrap:anywhere}.pd-reader{padding:8px}
@media(max-width:600px){.pd-dialog{width:100vw;max-width:100vw;height:100dvh;max-height:100dvh;border-radius:0}.pd-toolbar{flex-wrap:wrap}}
`

export function PresentationCards({ matched, sessionId, workspaces, model }) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot)
  // The runtime framework supplies sessionId independently of event data.
  const deliveries = matched.filter((delivery) => delivery.dshSessionId === sessionId)
  const workspaceId =
    workspaces.find((item) => item.sessionIds.includes(sessionId))?.workspaceId ?? ''
  if (!deliveries.length) return null
  return (
    <div className="pd-cards">
      <style>{deliveryStyles}</style>
      {deliveries.map((delivery) => {
        const selected =
          state.delivery &&
          presentationDeliveryIdentity(state.delivery) === presentationDeliveryIdentity(delivery)
        return (
          <section
            className="pd-card"
            key={presentationDeliveryIdentity(delivery)}
            data-presentation-card={delivery.receipt.buildId}
          >
            <h3>{delivery.receipt.title}</h3>
            <p>{delivery.receipt.summary}</p>
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
}) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot)
  const dialog = useRef(null)
  useEffect(() => {
    if (state.delivery) model.contextChanged(sessionId, workspaceId)
  }, [model, sessionId, workspaceId, state.delivery])
  useEffect(() => {
    if (workspaceUnavailable && state.delivery) model.unavailable()
  }, [model, workspaceUnavailable, state.delivery])
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
        model.close()
      }}
    >
      <style>{deliveryStyles}</style>
      <header className="pd-toolbar">
        <strong>{delivery.receipt.title}</strong>
        <div className="pd-actions">
          <button
            type="button"
            disabled={state.downloading || !!state.error}
            onClick={() => void model.download(delivery, sessionId, workspaceId)}
          >
            {state.downloading ? '正在下载…' : '下载 HTML'}
          </button>
          <button type="button" aria-label="关闭分析快照" onClick={() => model.close()}>
            关闭
          </button>
        </div>
      </header>
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
          <HostPresentationReader document={state.document} />
        </div>
      )}
    </dialog>
  )
}

export function installPresentation(ctx, rpc) {
  const model = new PresentationDeliveryModel(rpc)
  ctx.effect(() => () => model.dispose(), 'dsh-data-analysis: presentation reader lifecycle')
  ctx.on('connection/reset', () => model.resetConnection())
  ctx.conversationEvents.register(marivoPresentationDeliveryDefinition)
  ctx.slots.inject('conversation.chat.turnTail', () =>
    ctx.slots.register(
      { name: 'conversation.chat.turnTail', select: selectMarivoPresentations },
      function Cards({ matched, sessionId, useWorkspaces }) {
        return (
          <PresentationCards
            matched={matched}
            sessionId={sessionId}
            workspaces={useWorkspaces((state) => state.items)}
            model={model}
          />
        )
      },
    ),
  )
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
          />
        )
      },
    ),
  )
}
