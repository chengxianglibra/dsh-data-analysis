// @ts-nocheck -- Host slot hooks are injected by the runtime module table.

import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { credentialChanges } from '../credentials/changes.ts'
import { CredentialPanel, installCredentials } from '../credentials/install.tsx'
import { credentialStyles } from '../credentials/styles.ts'
import { useCopy } from './../i18n/context.tsx'
import { hostCopy, installCopy, localized } from '../i18n/host.tsx'
import { appendPresentationContext } from '../presentation/ask-dsh.ts'
import { catalogStyles, ReportCatalogView, ReportHistoryPanel } from '../presentation/catalog.tsx'
import {
  marivoPresentationDeliveryDefinition,
  PRESENTATION_TURN_DATA_KEY,
} from '../presentation/delivery.ts'
import { HostPresentationReader } from '../presentation/host-entry.tsx'
import { installPresentationReferenceSource } from '../presentation/reference-source.ts'
import { createPluginRpc } from '../rpc.ts'
import { SemanticBrowserPanel } from '../semantic-browser/panel.tsx'
import { installSemanticReferenceSource } from '../semantic-reference-source.ts'
import { WorkspaceHeaderAction } from '../workspace-header-action.tsx'
import { LiveDeliveryObserver } from './live-delivery.ts'
import {
  canOpenResource,
  definitionId,
  directoryKind,
  parseResource,
  resourceAddress,
} from './navigation.ts'
import { TabPage } from './page.ts'
import { rightTabStyles } from './styles.ts'

export const inject = [
  'connection',
  'remote',
  'slots',
  'locale',
  'uiConversation',
  'inputTriggers',
  'sessions',
  'workspaces',
  'conversation',
  'sidebarRight',
  'sidebarRightTabs',
]
const labels = {
  datasources: 'marivo.credentials.datasources-and-credentials',
  semantic: 'marivo.navigation.semantic-layer',
  reports: 'marivo.presentation.reports',
}

/** Default browser integration. Layout belongs to Harness; mutable content belongs to occurrences. */
export function installRightTabs(ctx, { diagnostics = false } = {}) {
  installCopy(ctx)
  const rpc = createPluginRpc(ctx.connection.rpc)
  const pages = new Map()
  let indexRevision = 0
  const indexListeners = new Set<() => void>()
  const pageIndex = {
    getSnapshot: () => indexRevision,
    subscribe: (listener) => {
      indexListeners.add(listener)
      return () => indexListeners.delete(listener)
    },
    publish: () => {
      indexRevision++
      for (const listener of indexListeners) listener()
    },
  }
  const audit = { opens: [], errors: [], changes: [] }
  let notice = '',
    listeners = new Set()
  const notices = {
    getSnapshot: () => notice,
    subscribe: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
  const fail = (error) => {
    notice = error instanceof Error ? error.message : String(error)
    if (diagnostics) audit.errors.push(notice)
    for (const fn of listeners) fn()
  }
  const workspaceFor = (sessionId) =>
    ctx.workspaces.list.getSnapshot().items.find((w) => w.sessionIds.includes(sessionId))
      ?.workspaceId
  const check = (sessionId, workspaceId, foreground = false) => {
    const state = ctx.workspaces.list.getSnapshot()
    if (
      !ctx.connection.generation.getSnapshot() ||
      state.phase !== 'ready' ||
      state.state === 'error' ||
      workspaceFor(sessionId) !== workspaceId ||
      (foreground && ctx.sessions.list.getSnapshot().current !== sessionId)
    )
      throw new Error('marivo.navigation.the-owning-session-or-workspace-changed-return-to-its')
  }
  const changed = (workspaceId, reportId) => {
    for (const page of pages.values()) void page.publicationChanged(workspaceId, reportId)
  }
  const navigate = (
    sessionId,
    target,
    actions = ctx.sidebarRight,
    automatic = false,
    params = undefined,
  ) => {
    check(sessionId, target.workspaceId, actions === ctx.sidebarRight)
    const address = resourceAddress(target)
    actions.openResource(address, { params })
    if (diagnostics) audit.opens.push({ sessionId, address, automatic })
  }
  installSemanticReferenceSource(ctx, rpc)
  installPresentationReferenceSource(ctx)
  const credentials = installCredentials(ctx, rpc, credentialChanges(ctx))
  ctx.effect(() =>
    credentials.subscribe(() => {
      const state = credentials.getSnapshot()
      for (const page of pages.values())
        if (page.target.kind === 'datasources' && !page.getSnapshot().error)
          page.datasources.syncRequests(page.sessionId, state)
      if (!state.open || !state.requestId) return
      const request = state.requests.find((item) => item.id === state.requestId)
      credentials.close()
      if (!request) return
      try {
        const workspaceId = workspaceFor(request.sessionId)
        check(request.sessionId, workspaceId, true)
        ctx.sidebarRight.openTab(directoryKind('datasources'), {
          params: { workspaceId, requestId: request.id },
        })
      } catch (error) {
        fail(error)
      }
    }),
  )
  const edit = async (page) => {
    check(page.sessionId, page.target.workspaceId, true)
    await page.reader.beginCurrentEdit(() => check(page.sessionId, page.target.workspaceId, true))
  }
  const save = async (page, tab) => {
    check(page.sessionId, page.target.workspaceId, true)
    const before = page.reader.getSnapshot().document?.buildId
    await page.reader.saveEdit()
    const state = page.reader.getSnapshot()
    if (state.editError || !state.document || state.document.buildId === before) return
    check(page.sessionId, page.target.workspaceId)
    page.patch({ newer: undefined, notice: '' })
    changed(page.target.workspaceId, page.target.reportId)
    if (page.target.buildId) {
      // A Build address remains immutable. Adopt current in the same pane/strip position after save.
      tab.actions.openResource(
        resourceAddress({
          kind: 'report',
          workspaceId: page.target.workspaceId,
          reportId: page.target.reportId,
        }),
        { replaceTab: tab.id, revealIfOpened: false },
      )
    }
  }
  const ask = (page, context) => {
    check(page.sessionId, page.target.workspaceId, true)
    if (page.reader.getSnapshot().editing || page.reader.getSnapshot().saving)
      throw new Error('marivo.presentation.save-or-cancel-edits-first')
    if (!page.reader.getSnapshot().document || page.getSnapshot().error || page.signal.aborted)
      throw new Error('marivo.navigation.the-report-is-unavailable-reopen-it')
    appendPresentationContext(ctx, page.sessionId, page.target.workspaceId, context)
  }
  const act = (page, operation) => {
    Promise.resolve()
      .then(operation)
      .catch((error) => page.patch({ notice: error.message }))
  }
  const acquire = (sessionId, tab, target) => {
    check(sessionId, target.workspaceId)
    const key = JSON.stringify([sessionId, tab.id])
    let page = pages.get(key)
    if (
      page &&
      (page.signal !== tab.signal || JSON.stringify(page.target) !== JSON.stringify(target))
    ) {
      page.detachSignal?.()
      page.dispose()
      pages.delete(key)
      page = undefined
    }
    if (!page) {
      page = new TabPage(sessionId, target, rpc, tab.id)
      page.workspacePath = ctx.workspaces.list
        .getSnapshot()
        .items.find((w) => w.workspaceId === target.workspaceId)?.path
      page.signal = tab.signal
      pages.set(key, page)
      pageIndex.publish()
      const owned = page
      const abort = () => {
        owned.dispose()
        if (pages.get(key) === owned) {
          pages.delete(key)
          pageIndex.publish()
        }
      }
      tab.signal.addEventListener('abort', abort, { once: true })
      page.detachSignal = () => tab.signal.removeEventListener('abort', abort)
    }
    return page
  }
  function Contents({ page, tab, panelId, workspaces, sessions, currentSession, workspaceReady }) {
    const t = useCopy()

    const owners = workspaces.filter((workspace) => workspace.sessionIds.includes(page.sessionId))
    const canAsk =
      currentSession === page.sessionId &&
      workspaceReady &&
      owners.length === 1 &&
      owners[0].workspaceId === page.target.workspaceId
    const state = useSyncExternalStore(page.subscribe, page.getSnapshot)
    const report = useSyncExternalStore(page.reader.subscribe, page.reader.getSnapshot)
    const catalog = useSyncExternalStore(page.catalog.subscribe, page.catalog.getSnapshot)
    const open = (target) => act(page, () => navigate(page.sessionId, target, tab.actions))
    const source = (ref) =>
      navigate(
        page.sessionId,
        { kind: 'semantic', workspaceId: page.target.workspaceId, ref },
        tab.actions,
      )
    const catalogReader = {
      showReport: (workspaceId, reportId) => open({ kind: 'report', workspaceId, reportId }),
    }
    const historyModel = {
      selectVersion: (buildId) =>
        open({
          kind: 'report',
          workspaceId: page.target.workspaceId,
          reportId: page.target.reportId,
          ...(buildId && buildId !== report.history?.currentBuildId ? { buildId } : {}),
        }),
    }
    return (
      <section
        className="rt-page"
        data-rt-tab={tab.id}
        data-rt-panel={panelId}
        data-rt-kind={page.target.kind}
        data-rt-workspace={page.target.workspaceId}
        data-rt-build={report.document?.buildId}
        data-rt-current={page.target.kind === 'report' && !page.target.buildId ? 'true' : undefined}
      >
        <style>{catalogStyles + credentialStyles + rightTabStyles}</style>
        {state.error ? (
          <p role="alert">{t(state.error)}</p>
        ) : (
          <>
            {page.target.kind === 'reports' && (
              <>
                <div className="rt-heading-row">
                  <h2 className="rt-heading">{t(labels[page.target.kind])}</h2>
                  {page.target.kind === 'reports' && (
                    <button
                      type="button"
                      disabled={catalog.loading}
                      onClick={() => void page.refresh()}
                    >
                      {t('marivo.presentation.refresh')}
                    </button>
                  )}
                </div>
                <p className="rt-caption">
                  {workspaces.find((w) => w.workspaceId === page.target.workspaceId)?.title ??
                    page.target.workspaceId}
                </p>
              </>
            )}
            {state.newer && (
              <p role="status" className="rt-notice">
                {t('marivo.navigation.a-newer-version-exists-the-current-view-is-unchanged')}
                <button type="button" onClick={() => void page.refresh()}>
                  {t('marivo.navigation.view-new-version')}
                </button>
              </p>
            )}
            {state.notice && <p role="status">{t(state.notice)}</p>}
            {page.target.kind === 'reports' && (
              <ReportCatalogView
                model={page.catalog}
                reader={catalogReader}
                sessions={sessions}
                onOpenSession={(id) => ctx.sessions.open(id)}
              />
            )}
            {page.target.kind === 'semantic' && (
              <SemanticBrowserPanel
                model={page.semantic}
                onAsk={canAsk ? () => page.semantic.addToQuestion(ctx, page.sessionId) : undefined}
                workspaces={workspaces}
              />
            )}
            {page.target.kind === 'datasources' && (
              <CredentialPanel
                model={page.datasources}
                workspaces={workspaces}
                onRefresh={() => void page.refresh()}
              />
            )}
            {page.target.kind === 'report' && (
              <>
                {report.editing && (
                  <div
                    className="rt-toolbar"
                    role="toolbar"
                    aria-label={t('marivo.presentation.report-editing-actions')}
                  >
                    <button
                      type="button"
                      disabled={report.saving || !report.editing.undo.length}
                      onClick={() => page.reader.undoEdit()}
                    >
                      {t('marivo.presentation.undo')}
                    </button>
                    <button
                      type="button"
                      disabled={report.saving || !report.editing.redo.length}
                      onClick={() => page.reader.redoEdit()}
                    >
                      {t('marivo.presentation.redo')}
                    </button>
                    <button
                      type="button"
                      disabled={report.saving}
                      onClick={() => act(page, () => save(page, tab))}
                    >
                      {report.saving
                        ? t('marivo.presentation.saving')
                        : t('marivo.presentation.save-edits')}
                    </button>
                    <button
                      type="button"
                      disabled={report.saving}
                      onClick={() => {
                        if (
                          !page.reader.dirty ||
                          window.confirm(
                            t('marivo.navigation.there-are-unsaved-edits-discard-them'),
                          )
                        )
                          page.reader.cancelEdit()
                      }}
                    >
                      {t('marivo.presentation.cancel-edits')}
                    </button>
                    <span>
                      {page.reader.dirty
                        ? t('marivo.presentation.unsaved-edits')
                        : t('marivo.presentation.edit-mode')}
                    </span>
                  </div>
                )}
                {report.editError && <p role="alert">{t(report.editError)}</p>}
                {report.notice && <p role="status">{t(report.notice)}</p>}
                {report.publicationUrl && (
                  <p>
                    <a href={report.publicationUrl} target="_blank" rel="noopener noreferrer">
                      {t('marivo.presentation.open-published-report')}
                    </a>
                  </p>
                )}
                {report.loading && <p role="status">{t('marivo.navigation.loading-report')}</p>}
                {report.error && (
                  <div role="alert">
                    <p>{t(report.error)}</p>
                    <button type="button" onClick={() => void page.refresh()}>
                      {t('marivo.navigation.reload-report')}
                    </button>
                  </div>
                )}
                {report.historyOpen && (
                  <ReportHistoryPanel
                    state={report}
                    model={historyModel}
                    sessions={sessions}
                    onOpenSession={(id) => ctx.sessions.open(id)}
                  />
                )}
                {report.document && (
                  <HostPresentationReader
                    document={report.document}
                    closeSourceOnNavigate
                    viewMemory={page.viewMemory}
                    exportActions={{
                      downloadFullReport: () => void page.reader.downloadDisplayed(),
                      publishing: report.publishingName
                        ? {
                            name: report.publishingName,
                            publish: () => void page.reader.publishDisplayed(),
                            publishView: (bytes) => page.reader.publishDisplayed(bytes),
                          }
                        : undefined,
                      publishingUnavailable: report.publishingUnavailable,
                      publishingLoading: report.publishingLoading,
                      downloading: report.downloading,
                      disabled: !!report.error || report.loading,
                      report: {
                        version: report.document.buildId,
                        refresh: () => void page.refresh(),
                        edit: () => act(page, () => edit(page)),
                        history: () => void page.reader.toggleHistory(),
                        historical: report.historical || !!state.newer,
                        historyLoading: report.historyLoading,
                        busy: report.saving,
                      },
                    }}
                    editing={
                      report.editing
                        ? {
                            edits: report.editing.edits,
                            onChange: (edits) => page.reader.changeEdits(edits),
                            disabled: report.saving,
                          }
                        : undefined
                    }
                    onOpenSemanticRef={source}
                    onAskDsh={(context) =>
                      act(page, () => {
                        ask(page, context)
                        page.patch({ notice: '' })
                      })
                    }
                  />
                )}
                {report.downloadError && <p role="alert">{t(report.downloadError)}</p>}
              </>
            )}
          </>
        )}
      </section>
    )
  }
  function Body({ sessionId, useTabInfo, useWorkspaces, useSessions }) {
    const t = useCopy()

    const { tab, panel } = useTabInfo()
    const workspaces = useWorkspaces((s) => s.items),
      sessions = useSessions((s) => s.byId),
      currentSession = useSessions((s) => s.current),
      workspaceReady = useWorkspaces((s) => s.phase === 'ready' && s.state !== 'error')
    const [page, setPage] = useState(),
      [error, setError] = useState('')
    useEffect(() => {
      if (tab.signal.aborted) return
      try {
        const directory = Object.keys(labels).find((key) => directoryKind(key) === tab.kind)
        const target = directory
          ? { kind: directory, workspaceId: tab.navigation.params?.workspaceId }
          : parseResource(tab.navigation.address)
        const owned = acquire(sessionId, tab, target)
        setPage(owned)
        setError('')
        void owned
          .navigate(tab.navigation.revision, false, tab.navigation.params?.history === true)
          .then(() => {
            if (target.kind !== 'datasources' || owned.getSnapshot().error || tab.signal.aborted)
              return
            owned.datasources.syncRequests(sessionId, credentials.getSnapshot())
            const requestId = tab.navigation.params?.requestId
            if (owned.datasources.getSnapshot().requests.some((item) => item.id === requestId))
              owned.datasources.openRequest(requestId)
          })
        pageIndex.publish()
      } catch (error) {
        setPage(undefined)
        setError(error.message)
      }
    }, [sessionId, tab])
    return error ? (
      <p role="alert">{t(error)}</p>
    ) : page && page.sessionId === sessionId && page.signal === tab.signal ? (
      <Contents
        page={page}
        tab={tab}
        panelId={panel.id}
        workspaces={workspaces}
        sessions={sessions}
        currentSession={currentSession}
        workspaceReady={workspaceReady}
      />
    ) : null
  }
  for (const [page, label] of Object.entries(labels)) {
    const kind = directoryKind(page),
      id = definitionId(kind)
    ctx.effect(() => ctx.sidebarRightTabs.register({ id, kind, title: () => hostCopy(ctx)(label) }))
    ctx.slots.inject('sidebar.right.pane.tab.title', () =>
      ctx.slots.register(
        { locale: 'marivo.navigation', name: 'sidebar.right.pane.tab.title', key: id },
        localized(ctx, function DirectoryTitle() {
          const t = useCopy()
          return <span>{t(label)}</span>
        }),
      ),
    )
    ctx.slots.inject('sidebar.right.pane.tab', () =>
      ctx.slots.register(
        { locale: 'marivo.navigation', name: 'sidebar.right.pane.tab', key: id },
        localized(ctx, Body),
      ),
    )
    ctx.slots.inject('conversation.session.header.actions', () =>
      ctx.slots.register(
        {
          locale: 'marivo.navigation',
          name: 'conversation.session.header.actions',
          id,
          order: 100 + Object.keys(labels).indexOf(page) * 5,
        },
        localized(ctx, function Entry({ sessionId, useWorkspaces }) {
          const t = useCopy()

          const workspaceId = useWorkspaces(
            (s) => s.items.find((w) => w.sessionIds.includes(sessionId))?.workspaceId,
          )
          return (
            <WorkspaceHeaderAction
              label={t(label)}
              icon={page === 'datasources' ? 'credentials' : page}
              disabled={!workspaceId}
              onClick={() => {
                try {
                  check(sessionId, workspaceId, true)
                  ctx.sidebarRight.openTab(kind, { params: { workspaceId } })
                } catch (error) {
                  fail(error)
                }
              }}
            />
          )
        }),
      ),
    )
  }
  function Title({ sessionId, useTabInfo }) {
    const { tab } = useTabInfo()
    useSyncExternalStore(pageIndex.subscribe, pageIndex.getSnapshot)
    const page = pages.get(JSON.stringify([sessionId, tab.id]))
    const report = useSyncExternalStore(
      page?.reader.subscribe ?? (() => () => {}),
      page?.reader.getSnapshot ?? (() => undefined),
    )
    const target = parseResource(tab.navigation.address)
    return target.kind === 'report' ? (
      <span>
        {report?.document?.title ?? target.reportId.slice(0, 12)} ·{' '}
        {report?.document?.buildId.slice(0, 8) ?? target.buildId?.slice(0, 8) ?? '…'}
        {report?.editing ? ' *' : ''}
      </span>
    ) : (
      <span>{target.ref.path}</span>
    )
  }
  for (const kind of ['report', 'semantic']) {
    const id = definitionId(kind)
    ctx.effect(() =>
      ctx.sidebarRightTabs.register({
        id,
        kind: `marivo-${kind}-resource`,
        patterns: [`dsh-resource://marivo-${kind}/**`],
        canOpen: (address) => canOpenResource(address, kind),
        title: (address) => {
          const target = parseResource(address)
          return target.kind === 'report'
            ? `${target.reportId.slice(0, 12)} · ${target.buildId?.slice(0, 8) ?? '…'}`
            : target.ref.path
        },
      }),
    )
    ctx.slots.inject('sidebar.right.pane.tab.title', () =>
      ctx.slots.register(
        { locale: 'marivo.navigation', name: 'sidebar.right.pane.tab.title', key: id },
        localized(ctx, Title),
      ),
    )
    ctx.slots.inject('sidebar.right.pane.tab', () =>
      ctx.slots.register(
        { locale: 'marivo.navigation', name: 'sidebar.right.pane.tab', key: id },
        localized(ctx, Body),
      ),
    )
  }
  ctx.slots.inject('conversation.chat.node', () => {
    const stop = ctx.slots.register(
      {
        locale: 'marivo.navigation',
        name: 'conversation.chat.node',
        key: PRESENTATION_TURN_DATA_KEY,
      },
      localized(ctx, function ReportDeliveryNode() {
        const t = useCopy()

        const error = useSyncExternalStore(notices.subscribe, notices.getSnapshot)
        return error ? <p role="alert">{t(error)}</p> : null
      }),
    )
    const definition = ctx.uiConversation.events.register(marivoPresentationDeliveryDefinition)
    return () => {
      definition()
      stop()
    }
  })
  const feeds = new Map()
  let selected: string | undefined
  const stopFeeds = () => {
    for (const feed of feeds.values()) feed.stop()
    feeds.clear()
    selected = undefined
  }
  const bind = () => {
    if (!ctx.connection.generation.getSnapshot()) return stopFeeds()
    const current = ctx.sessions.list.getSnapshot().current
    const workspaces = ctx.workspaces.list.getSnapshot()
    if (workspaces.phase !== 'ready' || workspaces.state === 'error') return stopFeeds()
    // Observe only Workspaces with report readers/catalogs, plus the foreground
    // Session. Resolving a binding never opens its history or creates a Session.
    const watchedWorkspaces = new Set(
      [...pages.values()]
        .filter(
          (page) => ['report', 'reports'].includes(page.target.kind) && !page.getSnapshot().error,
        )
        .map((page) => page.target.workspaceId),
    )
    const ids = new Set(
      workspaces.items.flatMap((w) => (watchedWorkspaces.has(w.workspaceId) ? w.sessionIds : [])),
    )
    if (current) ids.add(current)
    for (const [id, feed] of feeds)
      if (
        !ids.has(id) ||
        ctx.sessions.binding(id) !== feed.binding ||
        feed.binding.session.getSnapshot().removed
      ) {
        feed.stop()
        feeds.delete(id)
      }
    for (const id of ids) {
      if (feeds.has(id)) continue
      const binding = ctx.sessions.binding(id)
      if (!binding || binding.session.getSnapshot().removed) continue
      const observer = new LiveDeliveryObserver(id, (delivery) => {
        const { workspaceId, reportId, buildId } = delivery.receipt
        try {
          check(id, workspaceId)
        } catch (error) {
          if (ctx.sessions.list.getSnapshot().current === id) fail(error)
          return
        }
        changed(workspaceId, reportId)
        // Publication invalidation is Workspace-wide. Foreground navigation
        // alone is gated, and background deliveries are never queued.
        if (ctx.sessions.list.getSnapshot().current !== id) return
        try {
          navigate(id, { kind: 'report', workspaceId, reportId, buildId }, ctx.sidebarRight, true)
        } catch (error) {
          fail(error)
        }
      })
      observer.consume(binding.eventSource.getSnapshot(), true)
      const stopFeed = binding.eventSource.subscribe(() => {
        const state = binding.session.getSnapshot()
        const window = binding.eventSource.getSnapshot()
        if (diagnostics)
          audit.changes.push({
            sessionId: id,
            kind: window.change.kind,
            revision: window.revision,
            openState: state.openState,
          })
        observer.consume(window, state.openState !== 'open' || state.removed)
      })
      let running = binding.session.getSnapshot().running
      const stopLifecycle = binding.session.subscribe(() => {
        const state = binding.session.getSnapshot()
        const settled = running && !state.running
        running = state.running
        if (state.removed) {
          feeds.get(id)?.stop()
          feeds.delete(id)
        } else if (settled && state.openState !== 'open') {
          // A cold background Session has no event window. Its public run
          // settlement is a hint to re-read publication facts, never to open.
          const workspaceId = workspaceFor(id)
          try {
            check(id, workspaceId)
            changed(workspaceId)
          } catch {
            /* Revoked context has no publication consumers. */
          }
        }
      })
      feeds.set(id, {
        binding,
        observer,
        stop: () => {
          stopFeed()
          stopLifecycle()
        },
      })
    }
    if (current !== selected) {
      selected = current
      const feed = feeds.get(current)
      if (feed) feed.observer.consume(feed.binding.eventSource.getSnapshot(), true)
      changed(workspaceFor(current))
    }
  }
  ctx.effect(() => {
    const stop = ctx.sessions.list.subscribe(bind)
    const stopPages = pageIndex.subscribe(bind)
    bind()
    return () => {
      stop()
      stopPages()
      stopFeeds()
    }
  })
  ctx.effect(() =>
    ctx.workspaces.list.subscribe(() => {
      for (const page of pages.values()) {
        try {
          check(page.sessionId, page.target.workspaceId)
          if (
            ctx.workspaces.list
              .getSnapshot()
              .items.find((w) => w.workspaceId === page.target.workspaceId)?.path !==
            page.workspacePath
          )
            throw new Error('workspace-changed')
        } catch {
          page.unavailable('marivo.navigation.workspace-changed-or-is-unavailable-reopen-the-page')
        }
      }
      bind()
    }),
  )
  ctx.effect(() =>
    ctx.connection.generation.subscribe(() => {
      if (ctx.connection.generation.getSnapshot()) return
      stopFeeds()
      for (const page of pages.values())
        page.unavailable(
          'marivo.navigation.host-connection-interrupted-reconnect-and-reopen-the-page',
        )
    }),
  )
  ctx.on('connection/reset', () => {
    for (const page of pages.values())
      page.unavailable('marivo.navigation.host-connection-reset-reopen-the-page')
    stopFeeds()
    bind()
  })
  ctx.effect(() => () => {
    for (const page of pages.values()) {
      page.detachSignal?.()
      page.dispose()
    }
    pages.clear()
    pageIndex.publish()
    indexListeners.clear()
    listeners.clear()
  })
  return { audit, pages, navigate, changed, credentials, resourceAddress, ask }
}
