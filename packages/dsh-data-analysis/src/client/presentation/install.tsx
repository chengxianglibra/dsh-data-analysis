// @ts-nocheck -- Host slot and hook contracts are supplied by DSH's runtime module table.

import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useCopy } from './../i18n/context.tsx'
import { installCopy, localized } from '../i18n/host.tsx'
import { WorkspaceHeaderAction } from '../workspace-header-action.tsx'
import { appendPresentationContext } from './ask-dsh.ts'
import { catalogStyles, ReportCatalogView, ReportHistoryPanel } from './catalog.tsx'
import { ReportCatalogModel } from './catalog-model.ts'
import {
  marivoPresentationDeliveryDefinition,
  PRESENTATION_TURN_DATA_KEY,
  presentationDeliveryIdentity,
  presentationsForNode,
} from './delivery.ts'
import { PresentationDeliveryModel, reportKey } from './delivery-model.ts'
import { HostPresentationReader } from './host-entry.tsx'
import { installPresentationReferenceSource } from './reference-source.ts'

export const deliveryStyles = `
.pd-cards{display:grid;gap:10px;margin-top:12px}.pd-card{border:1px solid var(--dsw-alias-border-l2,#dce5e5);border-radius:10px;padding:14px;color:var(--dsw-alias-label-primary,#1d3036);background:var(--dsw-alias-bg-module-platform,#f4f7f7)}
.pd-card h3{margin:0 0 7px;font-size:15px}.pd-card p{margin:7px 0;white-space:pre-wrap;overflow-wrap:anywhere}.pd-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.pd-actions button{font:inherit;padding:6px 12px;border:1px solid var(--dsw-alias-border-l2,#dce5e5);border-radius:6px;background:var(--dsw-alias-bg-base,#fff);color:inherit;cursor:pointer}.pd-actions button:disabled{opacity:.55;cursor:wait}.pd-actions button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#087c71);outline-offset:3px}
.pd-muted{font-size:12px;color:var(--dsw-alias-label-secondary,#5b7076)}.pd-error{color:var(--dsw-alias-state-warn-label,#805b20);overflow-wrap:anywhere}.pd-dialog{position:fixed;inset:0;width:80vw;height:92vh;max-height:96vh;max-width:none;box-sizing:border-box;padding:0;border:1px solid var(--dsw-alias-border-l2,#dce5e5);border-radius:12px;color:var(--dsw-alias-label-primary,#1d3036);background:var(--dsw-alias-bg-base,#fff);overflow:auto;pointer-events:auto}.pd-dialog::backdrop{background:#0008}.pd-toolbar{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l2,#dce5e5);background:var(--dsw-alias-bg-base,#fff)}.pd-status{padding:12px 20px}.pd-toolbar strong{overflow-wrap:anywhere}.pd-reader{padding:8px}
@media(max-width:600px){.pd-dialog{height:100dvh;max-height:100dvh;border-radius:0}.pd-toolbar{flex-wrap:wrap}.pd-catalog-toolbar{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center}.pd-catalog-toolbar>.pd-actions{display:contents}.pd-catalog-toolbar>.pd-actions>button:first-child{grid-column:2;grid-row:1}.pd-catalog-toolbar>.pd-actions>label{grid-column:1;grid-row:2}.pd-catalog-toolbar>.pd-actions>button:last-child{grid-column:2;grid-row:2}}
`

export function PresentationCards({ matched, sessionId, workspaces, model }) {
  const t = useCopy()

  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot)
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
                {t('marivo.presentation.open-analysis')}
              </button>
              <button
                type="button"
                disabled={selected && state.downloading}
                onClick={() => void model.download(delivery, sessionId, workspaceId)}
              >
                {selected && state.downloading
                  ? t('marivo.presentation.downloading')
                  : t('marivo.presentation.download-html')}
              </button>
              <span className="pd-muted">
                {t('marivo.presentation.saved-data-and-source-snapshots-available-offline')}
              </span>
            </div>
            {selected && state.downloadError && (
              <p role="alert" className="pd-error">
                {t(state.downloadError)}
              </p>
            )}
            {selected && state.notice && (
              <p role="status" className="pd-muted">
                {t(state.notice)}
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
  onAskDsh,
  catalog,
  sessions,
  onOpenSession,
  workspaces,
}) {
  const t = useCopy()

  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot)
  const library = useSyncExternalStore(
    catalog?.subscribe ?? (() => () => {}),
    catalog?.getSnapshot ?? (() => undefined),
  )
  const opened = state.open || library?.open
  const listScroll = useRef(0)
  const openedWorkspace = useRef(null)
  const [askError, setAskError] = useState('')
  const dialog = useRef(null)
  useEffect(() => {
    if (!state.open || !state.document) setAskError('')
  }, [state.document, state.open])
  const closeReader = () => {
    if (state.saving) return
    if (
      model.dirty &&
      !window.confirm(t('marivo.presentation.there-are-unsaved-edits-discard-them-and-close-the'))
    )
      return
    model.close()
    catalog?.close()
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
    if (workspaceUnavailable && !model.getSnapshot().reportTarget) model.unavailable()
  }, [model, workspaceUnavailable])
  useEffect(() => {
    if (!opened) return undefined
    const opener = document.activeElement,
      element = dialog.current
    // Measure the Host conversation surface, excluding its navigation and details columns.
    const analysisArea = document.querySelector('[data-conversation-scroll]')
    const updateGeometry = () => {
      const bounds = analysisArea?.getBoundingClientRect()
      const narrow = window.innerWidth <= 850 || (bounds && bounds.width < 600)
      element.style.width = narrow ? '100vw' : bounds ? `${bounds.width * 0.8}px` : '80vw'
      element.style.left = narrow ? '0' : bounds ? `${bounds.left + bounds.width * 0.1}px` : '10vw'
      element.style.right = 'auto'
      element.style.marginLeft = '0'
      element.style.marginRight = '0'
    }
    updateGeometry()
    const resize = new ResizeObserver(updateGeometry)
    if (analysisArea) resize.observe(analysisArea)
    window.addEventListener('resize', updateGeometry)
    element.showModal()
    return () => {
      resize.disconnect()
      window.removeEventListener('resize', updateGeometry)
      element.close()
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [opened])
  useEffect(() => {
    if (!workspaces) return
    const target = state.reportTarget?.workspaceId ?? library?.workspaceId
    const workspace = workspaces.find((w) => w.workspaceId === target)
    if (
      target &&
      (!workspace ||
        (openedWorkspace.current?.id === target && openedWorkspace.current.path !== workspace.path))
    ) {
      model.unavailable()
      catalog?.reset()
      openedWorkspace.current = null
    } else openedWorkspace.current = workspace ? { id: target, path: workspace.path } : null
  }, [workspaces, state.reportTarget?.workspaceId, library?.workspaceId, model, catalog])
  useEffect(() => {
    if (!dialog.current) return
    if (state.open) {
      listScroll.current = dialog.current.scrollTop
      dialog.current.scrollTop = 0
    } else if (library?.open) dialog.current.scrollTop = listScroll.current
  }, [state.open, library?.open])
  if (!opened) return null
  const delivery = state.delivery
  return (
    <dialog
      ref={dialog}
      className="pd-dialog"
      aria-label={
        state.open
          ? t('marivo.presentation.analysis-snapshot')
          : t('marivo.presentation.workspace-reports')
      }
      onCancel={(event) => {
        event.preventDefault()
        closeReader()
      }}
    >
      <style>{deliveryStyles + catalogStyles}</style>
      <header className={`pd-toolbar${!state.open && library?.open ? ' pd-catalog-toolbar' : ''}`}>
        <strong>
          {state.open
            ? (state.resolvedReceipt?.title ??
              delivery?.receipt.title ??
              t('marivo.presentation.opening-report'))
            : t('marivo.presentation.workspace-reports')}
        </strong>
        <div className="pd-actions">
          {!state.open && library?.open && (
            <button type="button" disabled={library.loading} onClick={() => void catalog.refresh()}>
              {t('marivo.presentation.refresh')}
            </button>
          )}
          {!state.open && library?.open && workspaces && (
            <label>
              Workspace{' '}
              <select
                aria-label={t('marivo.presentation.select-report-workspace')}
                value={library.workspaceId}
                onChange={(e) => catalog.show(e.target.value)}
              >
                {workspaces.map((w) => (
                  <option key={w.workspaceId} value={w.workspaceId}>
                    {w.title || w.path || w.workspaceId}
                  </option>
                ))}
              </select>
            </label>
          )}
          {state.open && library?.open && (
            <button
              type="button"
              disabled={state.saving}
              onClick={() => {
                if (
                  model.dirty &&
                  !window.confirm(
                    t('marivo.presentation.there-are-unsaved-edits-discard-them-and-return-to'),
                  )
                )
                  return
                model.close()
                void catalog.refresh()
              }}
            >
              {t('marivo.presentation.back-to-reports')}
            </button>
          )}
          <button
            type="button"
            aria-label={t('marivo.presentation.close-analysis-snapshot')}
            disabled={state.saving}
            onClick={closeReader}
          >
            {t('marivo.presentation.close')}
          </button>
        </div>
      </header>
      {!state.open && library?.open && (
        <ReportCatalogView
          model={catalog}
          reader={model}
          sessions={sessions}
          onOpenSession={onOpenSession}
        />
      )}
      {state.document && (
        <div
          role="toolbar"
          className="pd-actions pd-status pr-interactive"
          aria-label={t('marivo.presentation.report-editing-actions')}
        >
          {state.editing ? (
            <>
              <button
                type="button"
                disabled={state.saving || !state.editing.undo.length}
                onClick={() => model.undoEdit()}
              >
                {t('marivo.presentation.undo')}
              </button>
              <button
                type="button"
                disabled={state.saving || !state.editing.redo.length}
                onClick={() => model.redoEdit()}
              >
                {t('marivo.presentation.redo')}
              </button>
              <button type="button" disabled={state.saving} onClick={() => void model.saveEdit()}>
                {state.saving
                  ? t('marivo.presentation.saving')
                  : t('marivo.presentation.save-edits')}
              </button>
              <button type="button" disabled={state.saving} onClick={() => model.cancelEdit()}>
                {t('marivo.presentation.cancel-edits')}
              </button>
              <span className="pd-muted">
                {model.dirty
                  ? t('marivo.presentation.unsaved-edits')
                  : t('marivo.presentation.edit-mode')}
              </span>
            </>
          ) : (
            <>
              {!state.historical && (
                <button type="button" onClick={() => model.beginEdit()}>
                  {t('marivo.presentation.edit-report')}
                </button>
              )}
              {state.historical && (
                <span className="pd-muted">
                  {t('marivo.presentation.viewing-a-historical-version-read-only')}
                </span>
              )}
              {state.historical && (
                <button type="button" onClick={() => void model.selectVersion()}>
                  {t('marivo.presentation.return-to-current-version')}
                </button>
              )}
            </>
          )}
          <button
            type="button"
            disabled={!!state.editing || state.saving || state.historyLoading}
            aria-expanded={!!state.historyOpen}
            onClick={() => void model.toggleHistory()}
          >
            {state.historyOpen
              ? t('marivo.presentation.collapse-history')
              : t('marivo.presentation.history')}
          </button>
        </div>
      )}
      {state.open && state.editError && (
        <p className="pd-status pd-error" role="alert">
          {t(state.editError)}
        </p>
      )}
      {askError && (
        <p className="pd-status pd-error" role="alert">
          {t(askError)}
        </p>
      )}
      {state.loading && (
        <p className="pd-status" role="status">
          {t('marivo.presentation.loading-the-saved-analysis-snapshot')}
        </p>
      )}
      {state.open && state.error && (
        <p className="pd-status pd-error" role="alert">
          {t(state.error)}
        </p>
      )}
      {state.open && state.downloadError && state.downloadError !== state.error && (
        <p className="pd-status pd-error" role="alert">
          {t(state.downloadError)}
        </p>
      )}
      {state.open && state.notice && (
        <p className="pd-status pd-muted" role="status">
          {t(state.notice)}
        </p>
      )}
      {state.open && state.publicationUrl && (
        <p>
          <a href={state.publicationUrl} target="_blank" rel="noopener noreferrer">
            {t('marivo.presentation.open-published-report')}
          </a>
        </p>
      )}
      <div className="pd-reading-layout">
        {state.open && state.historyOpen && (
          <ReportHistoryPanel
            state={state}
            model={model}
            sessions={sessions}
            onOpenSession={onOpenSession}
          />
        )}
        {state.document && (
          <div className="pd-reader">
            <HostPresentationReader
              document={state.document}
              exportActions={{
                downloadFullReport: () => void model.downloadDisplayed(),
                publishing: state.publishingName
                  ? {
                      name: state.publishingName,
                      publish: () => void model.publishDisplayed(),
                      publishView: (bytes) => model.publishDisplayed(bytes),
                    }
                  : undefined,
                publishingUnavailable: state.publishingUnavailable,
                publishingLoading: state.publishingLoading,
                downloading: state.downloading,
                disabled: !!state.error || state.loading,
              }}
              onAskDsh={
                onAskDsh && delivery
                  ? (context) => {
                      setAskError('')
                      const current = model.getSnapshot()
                      if (current.editing || current.saving) {
                        setAskError('marivo.presentation.save-or-cancel-edits-first')
                        return
                      }
                      if (
                        !current.open ||
                        current.document !== state.document ||
                        current.delivery !== delivery ||
                        current.error ||
                        workspaceUnavailable ||
                        sessionId !== delivery.dshSessionId ||
                        workspaceId !== current.document?.workspaceId
                      ) {
                        setAskError(
                          t('marivo.presentation.the-report-s-session-or-workspace-changed-or-is'),
                        )
                        return
                      }
                      try {
                        onAskDsh(delivery.dshSessionId, current.document.workspaceId, context)
                        model.close()
                      } catch (error) {
                        setAskError(
                          error instanceof Error
                            ? error.message
                            : t(
                                'marivo.presentation.cannot-write-to-the-dsh-input-draft-retry-later',
                              ),
                        )
                      }
                    }
                  : undefined
              }
              onOpenSemanticRef={
                openSemanticObject &&
                (state.reportTarget ||
                  (!workspaceUnavailable &&
                    sessionId === delivery?.dshSessionId &&
                    workspaceId === state.document.workspaceId))
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
      </div>
    </dialog>
  )
}

export function installPresentation(ctx, rpc, openSemanticObject, options = {}) {
  installCopy(ctx)
  installPresentationReferenceSource(ctx)
  const model = new PresentationDeliveryModel(rpc)
  const catalog = new ReportCatalogModel(rpc)
  ctx.effect(() => () => catalog.dispose(), 'dsh-data-analysis: report catalog lifecycle')
  ctx.on('connection/reset', () => catalog.reset())
  if (options.entries !== false)
    ctx.slots.inject('conversation.session.header.actions', () =>
      ctx.slots.register(
        {
          locale: 'marivo.navigation',
          name: 'conversation.session.header.actions',
          id: 'marivo-reports',
          order: 115,
        },
        localized(ctx, function ReportsEntry({ sessionId, useWorkspaces }) {
          const t = useCopy()

          const items = useWorkspaces((s) => s.items)
          const selected = items.find((w) => w.sessionIds.includes(sessionId))?.workspaceId
          return (
            <WorkspaceHeaderAction
              label={t('marivo.presentation.reports')}
              icon="reports"
              disabled={!selected}
              onClick={() => {
                model.close()
                catalog.show(selected)
              }}
            />
          )
        }),
      ),
    )
  ctx.effect(() => () => model.dispose(), 'dsh-data-analysis: presentation reader lifecycle')
  ctx.on('connection/reset', () => model.resetConnection())
  if (options.cards !== false)
    ctx.slots.inject('conversation.chat.node', () => {
      const disposeCards = ctx.slots.register(
        {
          locale: 'marivo.navigation',
          name: 'conversation.chat.node',
          key: PRESENTATION_TURN_DATA_KEY,
        },
        localized(
          ctx,
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
        ),
      )
      // A new Definition can immediately replay existing events. Its keyed renderer
      // must already exist, including when the Host declares this slot after us.
      const disposeDefinition = ctx.uiConversation.events.register(
        marivoPresentationDeliveryDefinition,
      )
      return () => {
        disposeDefinition()
        disposeCards()
      }
    })
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      { locale: 'marivo.navigation', name: 'shell.overlay', id: 'marivo-presentation' },
      localized(ctx, function Overlay({ useSessions, useWorkspaces }) {
        const t = useCopy()

        const sessionId = useSessions((state) => state.current) ?? ''
        const workspaces = useWorkspaces((state) => state.items)
        const sessions = useSessions((state) => state.byId)
        const phase = useWorkspaces((state) => state.phase)
        const error = useWorkspaces((state) => state.state === 'error')
        const workspaceId =
          workspaces.find((item) => item.sessionIds.includes(sessionId))?.workspaceId ?? ''
        return (
          <PresentationOverlay
            model={model}
            catalog={catalog}
            workspaces={workspaces}
            sessions={sessions}
            onOpenSession={(id) => {
              if (
                model.dirty &&
                !window.confirm(
                  t('marivo.presentation.there-are-unsaved-edits-discard-them-and-open-the'),
                )
              )
                return
              model.close()
              catalog.close()
              ctx.sessions.open(id)
            }}
            sessionId={sessionId}
            workspaceId={workspaceId}
            workspaceUnavailable={error || (phase === 'ready' && !workspaceId)}
            openSemanticObject={openSemanticObject}
            onAskDsh={(targetSessionId, targetWorkspaceId, context) =>
              appendPresentationContext(ctx, targetSessionId, targetWorkspaceId, context)
            }
          />
        )
      }),
    ),
  )
  return model
}
