// @ts-nocheck -- Host slot hooks are injected by the runtime module table.

import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { AnalysisCandidates, candidateKey } from '../analysis-ui/candidate.ts'
import { CandidateView, savedCodeReader } from '../analysis-ui/candidate-view.tsx'
import { installAnalysisTool } from '../analysis-ui/install.tsx'
import { SavedAnalysisSurface } from '../analysis-ui/lazy-surface.tsx'
import {
  appendComponentReference,
  installComponentReferenceSource,
} from '../component-reference.ts'
import { credentialChanges } from '../credentials/changes.ts'
import { CredentialPanel, installCredentials } from '../credentials/install.tsx'
import { credentialStyles } from '../credentials/styles.ts'
import { appendDatasetReference, installDatasetReferenceSource } from '../dataset-reference.ts'
import { useCopy } from './../i18n/context.tsx'
import { hostCopy, installCopy, localized } from '../i18n/host.tsx'
import { appendPointReference, installPointReferenceSource } from '../point-reference.ts'
import { catalogStyles, ReportCatalogView, ReportHistoryPanel } from '../presentation/catalog.tsx'
import {
  marivoAnalysisSurfaceDefinition,
  marivoPresentationDeliveryDefinition,
  PRESENTATION_TURN_DATA_KEY,
} from '../presentation/delivery.ts'
import { createPluginRpc } from '../rpc.ts'
import { SemanticBrowserPanel } from '../semantic-browser/panel.tsx'
import { installSemanticReferenceSource } from '../semantic-reference-source.ts'
import { Button } from '../ui/controls.tsx'
import { Alert, AlertDescription } from '../ui/primitives/alert.tsx'
import { WorkspaceHeaderAction } from '../workspace-header-action.tsx'
import { WorkspaceShortcuts, workspaceDirectories } from '../workspace-shortcuts.tsx'
import { DraftReportView } from './draft-report.tsx'
import { LiveDeliveryObserver } from './live-delivery.ts'
import {
  canOpenResource,
  definitionId,
  directoryKind,
  parseResource,
  resourceAddress,
} from './navigation.ts'
import { TabPage } from './page.ts'
import { ReportActions } from './report-actions.tsx'
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
  'uiWorkspace',
]
const labels = workspaceDirectories

/** Default browser integration. Layout belongs to Harness; mutable content belongs to occurrences. */
export function installRightTabs(ctx, { diagnostics = false } = {}) {
  installCopy(ctx)
  const rpc = createPluginRpc(ctx.connection.rpc)
  const pages = new Map()
  const candidates = new AnalysisCandidates()
  const candidateTabs = new Set()
  const draftTabs = new Map()
  const draftListeners = new Set<() => void>()
  const subscribeDrafts = (listener: () => void) => {
    draftListeners.add(listener)
    return () => draftListeners.delete(listener)
  }
  const setDraftTab = (sessionId, draft) => {
    if (draft) draftTabs.set(sessionId, draft)
    else draftTabs.delete(sessionId)
    for (const listener of draftListeners) listener()
  }
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
      !sessionId ||
      !workspaceId ||
      !ctx.connection.generation.getSnapshot() ||
      state.phase !== 'ready' ||
      state.state === 'error' ||
      workspaceFor(sessionId) !== workspaceId ||
      (foreground && !ctx.sessions.list.getSnapshot().byId[sessionId]?.retainedBy.mainView)
    )
      throw new Error('marivo.navigation.the-owning-session-or-workspace-changed-return-to-its')
  }
  const changed = (workspaceId, reportId) => {
    for (const page of pages.values()) void page.publicationChanged(workspaceId, reportId)
  }
  const openDirectory = (sessionId, workspaceId, page) => {
    check(sessionId, workspaceId, true)
    ctx.sidebarRight.openTab(directoryKind(page), { params: { workspaceId } })
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
  installAnalysisTool(
    ctx,
    rpc,
    (sessionId, receipt) =>
      navigate(sessionId, {
        kind: 'report',
        workspaceId: receipt.workspaceId,
        reportId: receipt.reportId,
        buildId: receipt.buildId,
      }),
    ctx.connection.generation,
    candidates,
    (sessionId, workspaceId, ref) => navigate(sessionId, { kind: 'semantic', workspaceId, ref }),
    (sessionId, workspaceId, recordId, selection, signal) =>
      appendDatasetReference(ctx, rpc, { sessionId, workspaceId, recordId, ...selection }, signal),
    (sessionId, workspaceId, recordId, selection, signal) =>
      appendPointReference(
        ctx,
        rpc,
        {
          sessionId,
          workspaceId,
          recordId,
          resourceName: selection.resourceName,
          row: selection.row,
          field: selection.field,
        },
        signal,
      ),
    (sessionId, workspaceId, recordId, selection, signal) =>
      appendComponentReference(
        ctx,
        rpc,
        { sessionId, workspaceId, recordId, ...selection },
        signal,
      ),
  )
  const candidateKind = 'marivo-analysis-candidate'
  const draftKind = 'marivo-analysis-draft'
  const draftTabId = definitionId(draftKind)
  ctx.effect(() =>
    ctx.sidebarRightTabs.register({
      id: draftTabId,
      kind: draftKind,
      multiple: true,
      title: () => hostCopy(ctx)('marivo.presentation.ui-draft-tab'),
    }),
  )
  ctx.slots.inject('sidebar.right.pane.tab', () =>
    ctx.slots.register(
      { name: 'sidebar.right.pane.tab', key: draftTabId, locale: 'marivo.presentation' },
      localized(ctx, function DraftTab({ sessionId, useTabInfo }) {
        const t = useCopy()
        const { tab } = useTabInfo()
        const draft = useSyncExternalStore(subscribeDrafts, () => draftTabs.get(sessionId))
        const generation = useSyncExternalStore(
          (listener) => ctx.connection.generation.subscribe(listener),
          () => ctx.connection.generation.getSnapshot(),
        )
        const workspaces = useSyncExternalStore(
          (listener) => ctx.workspaces.list.subscribe(listener),
          () => ctx.workspaces.list.getSnapshot(),
        )
        const owners = workspaces.items.filter((workspace) =>
          workspace.sessionIds.includes(sessionId),
        )
        const allowed =
          draft &&
          generation &&
          draft.generation === generation &&
          workspaces.phase === 'ready' &&
          workspaces.state !== 'error' &&
          owners.length === 1 &&
          owners[0].workspaceId === draft.delivery.workspaceId &&
          owners[0].path === draft.workspacePath &&
          tab.navigation.params?.draftId === draft.delivery.draftId
        useEffect(() => {
          if (!allowed || !draft.receipt || tab.signal.aborted) return
          const { workspaceId, reportId, buildId } = draft.receipt
          tab.actions.openResource(
            resourceAddress({ kind: 'report', workspaceId, reportId, buildId }),
            {
              replaceTab: true,
              revealIfOpened: false,
            },
          )
        }, [allowed, draft, tab])
        return allowed ? (
          <DraftReportView key={draft.delivery.draftId} delivery={draft.delivery} rpc={rpc} />
        ) : (
          <p role="status">{t('marivo.presentation.ui-draft-unavailable')}</p>
        )
      }),
    ),
  )
  const candidateId = definitionId(candidateKind)
  ctx.effect(() =>
    ctx.sidebarRightTabs.register({
      id: candidateId,
      kind: candidateKind,
      multiple: true,
      title: () => hostCopy(ctx)('marivo.presentation.ui-generating'),
    }),
  )
  ctx.slots.inject('sidebar.right.pane.tab', () =>
    ctx.slots.register(
      { name: 'sidebar.right.pane.tab', key: candidateId, locale: 'marivo.presentation' },
      localized(ctx, function CandidateTab({ sessionId, useTabInfo }) {
        const t = useCopy()
        const { tab } = useTabInfo()
        const callId = tab.navigation.params?.callId
        const candidate = useSyncExternalStore(candidates.subscribe, () =>
          candidates.get(sessionId, tab.navigation.params?.turn, callId),
        )
        const generation = useSyncExternalStore(
          (listener) => ctx.connection.generation.subscribe(listener),
          () => ctx.connection.generation.getSnapshot(),
        )
        const workspaceState = useSyncExternalStore(
          (listener) => ctx.workspaces.list.subscribe(listener),
          () => ctx.workspaces.list.getSnapshot(),
        )
        const owners = workspaceState.items.filter((w) => w.sessionIds.includes(sessionId))
        const allowed =
          candidate &&
          candidate.sessionId === sessionId &&
          candidate.generation === generation &&
          workspaceState.phase === 'ready' &&
          workspaceState.state !== 'error' &&
          owners.length === 1 &&
          owners[0].workspaceId === candidate.workspaceId &&
          tab.navigation.params?.workspaceId === candidate.workspaceId &&
          tab.navigation.params?.turn === candidate.turn
        useEffect(() => {
          if (!allowed || !candidate.delivery || tab.signal.aborted) return
          const receipt = candidate.delivery.receipt
          tab.actions.openResource(
            resourceAddress({
              kind: 'report',
              workspaceId: receipt.workspaceId,
              reportId: receipt.reportId,
              buildId: receipt.buildId,
            }),
            { replaceTab: true, revealIfOpened: false },
          )
        }, [allowed, candidate, tab])
        return allowed ? (
          <CandidateView candidate={candidate} rpc={rpc} />
        ) : (
          <p role="status">{t('marivo.presentation.ui-preparing')}</p>
        )
      }),
    ),
  )
  installSemanticReferenceSource(ctx, rpc)
  installPointReferenceSource(ctx, rpc)
  installComponentReferenceSource(ctx, rpc)
  installDatasetReferenceSource(ctx, rpc)
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
    const pointLifetime = useRef()
    useEffect(() => {
      if (!report.analysisDocument?.recordId || !canAsk || tab.signal.aborted) return
      const controller = new AbortController()
      pointLifetime.current = controller
      return () => {
        pointLifetime.current = undefined
        controller.abort()
      }
    }, [report.analysisDocument?.recordId, canAsk, tab.signal])
    const receipt = report.analysisDocument ? report.resolvedReceipt : undefined
    const readCode = useMemo(
      () =>
        receipt
          ? savedCodeReader(rpc, { workspaceId: page.target.workspaceId }, receipt)
          : undefined,
      [receipt, page.target.workspaceId],
    )
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
        className="mv-ui rt-page bg-background"
        data-rt-tab={tab.id}
        data-rt-panel={panelId}
        data-rt-kind={page.target.kind}
        data-rt-workspace={page.target.workspaceId}
        data-rt-build={report.analysisDocument?.buildId}
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
                    <Button
                      variant="outline"
                      type="button"
                      disabled={catalog.loading}
                      onClick={() => void page.refresh()}
                    >
                      {t('marivo.presentation.refresh')}
                    </Button>
                  )}
                </div>
                <p className="rt-caption">
                  {workspaces.find((w) => w.workspaceId === page.target.workspaceId)?.title ??
                    page.target.workspaceId}
                </p>
              </>
            )}
            {state.newer && (
              <Alert role="status" className="rt-notice">
                <AlertDescription>
                  {t('marivo.navigation.a-newer-version-exists-the-current-view-is-unchanged')}
                  <Button variant="outline" type="button" onClick={() => void page.refresh()}>
                    {t('marivo.navigation.view-new-version')}
                  </Button>
                </AlertDescription>
              </Alert>
            )}
            {state.notice && <p role="status">{t(state.notice)}</p>}
            {page.target.kind === 'reports' && (
              <ReportCatalogView
                model={page.catalog}
                reader={catalogReader}
                sessions={sessions}
                onOpenSession={(id) => ctx.uiWorkspace.openSession(id)}
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
                {report.loading && <p role="status">{t('marivo.navigation.loading-report')}</p>}
                {report.error && (
                  <div role="alert">
                    <p>{t(report.error)}</p>
                    <Button variant="outline" type="button" onClick={() => void page.refresh()}>
                      {t('marivo.navigation.reload-report')}
                    </Button>
                  </div>
                )}
                {report.historyOpen && (
                  <ReportHistoryPanel
                    state={report}
                    model={historyModel}
                    sessions={sessions}
                    onOpenSession={(id) => ctx.uiWorkspace.openSession(id)}
                    onClose={() => void page.reader.toggleHistory()}
                  />
                )}
                {report.analysisDocument && (
                  <div className="rt-report-surface">
                    <div className="rt-toolbar">
                      <ReportActions
                        key={report.analysisDocument.recordId}
                        document={report.analysisDocument}
                        onHistory={() => void page.reader.toggleHistory()}
                        isCurrent={() =>
                          !tab.signal.aborted &&
                          !page.getSnapshot().error &&
                          page.reader.getSnapshot().analysisDocument === report.analysisDocument
                        }
                      />
                    </div>
                    <SavedAnalysisSurface
                      key={report.analysisDocument.recordId}
                      document={report.analysisDocument}
                      openSemanticRef={source}
                      readCode={readCode}
                      askResource={
                        canAsk
                          ? (selection, requestSignal) =>
                              pointLifetime.current
                                ? appendComponentReference(
                                    ctx,
                                    rpc,
                                    {
                                      sessionId: page.sessionId,
                                      workspaceId: page.target.workspaceId,
                                      recordId: report.analysisDocument.recordId,
                                      ...selection,
                                    },
                                    AbortSignal.any([
                                      tab.signal,
                                      pointLifetime.current.signal,
                                      requestSignal,
                                    ]),
                                  )
                                : Promise.reject(new Error('input-unavailable'))
                          : undefined
                      }
                      askDataset={
                        canAsk
                          ? (selection) =>
                              pointLifetime.current
                                ? appendDatasetReference(
                                    ctx,
                                    rpc,
                                    {
                                      sessionId: page.sessionId,
                                      workspaceId: page.target.workspaceId,
                                      recordId: report.analysisDocument.recordId,
                                      ...selection,
                                    },
                                    AbortSignal.any([tab.signal, pointLifetime.current.signal]),
                                  )
                                : Promise.reject(new Error('input-unavailable'))
                          : undefined
                      }
                      askPoint={
                        canAsk
                          ? (selection) =>
                              pointLifetime.current
                                ? appendPointReference(
                                    ctx,
                                    rpc,
                                    {
                                      sessionId: page.sessionId,
                                      workspaceId: page.target.workspaceId,
                                      recordId: report.analysisDocument.recordId,
                                      resourceName: selection.resourceName,
                                      row: selection.row,
                                      field: selection.field,
                                    },
                                    AbortSignal.any([tab.signal, pointLifetime.current.signal]),
                                  )
                                : Promise.reject(new Error('input-unavailable'))
                          : undefined
                      }
                    />
                  </div>
                )}
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
      currentSession = useSessions((s) => s.ids.find((id) => s.byId[id]?.retainedBy.mainView)),
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
  ctx.slots.inject('conversation.input.dock', () =>
    ctx.slots.register(
      {
        locale: 'marivo.navigation',
        name: 'conversation.input.dock',
        id: 'marivo-workspace-shortcuts',
        order: 100,
      },
      localized(
        ctx,
        function HomepageShortcuts({ sessionId, session, useConversation, useWorkspaces }) {
          const conversation = useConversation((value) => value)
          const workspaces = useWorkspaces((value) => value)
          const generation = useSyncExternalStore(
            ctx.connection.generation.subscribe,
            ctx.connection.generation.getSnapshot,
            ctx.connection.generation.getSnapshot,
          )
          const workspaceId = workspaces.items.find((w) =>
            w.sessionIds.includes(sessionId),
          )?.workspaceId
          const disabled =
            !generation ||
            workspaces.phase !== 'ready' ||
            workspaces.state === 'error' ||
            !workspaceId
          return (
            <WorkspaceShortcuts
              key={`${sessionId}:${workspaceId}:${!!generation}`}
              session={sessionId ? session : undefined}
              conversation={conversation}
              disabled={disabled}
              open={(page) => openDirectory(sessionId, workspaceId, page)}
            />
          )
        },
      ),
    ),
  )
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
                  openDirectory(sessionId, workspaceId, page)
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
        {report?.analysisDocument?.title ?? target.reportId.slice(0, 12)} ·{' '}
        {report?.analysisDocument?.buildId.slice(0, 8) ?? target.buildId?.slice(0, 8) ?? '…'}
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
    const surfaceDefinition = ctx.uiConversation.events.register(marivoAnalysisSurfaceDefinition)
    return () => {
      surfaceDefinition()
      definition()
      stop()
    }
  })
  const feeds = new Map()
  let runningSessions = new Map()
  let selected: string | undefined
  const stopFeeds = () => {
    for (const feed of feeds.values()) feed.stop()
    feeds.clear()
    runningSessions.clear()
    selected = undefined
  }
  const bind = () => {
    if (!ctx.connection.generation.getSnapshot()) return stopFeeds()
    const sessions = ctx.sessions.list.getSnapshot()
    const current = sessions.ids.find((id) => sessions.byId[id]?.retainedBy.mainView)
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
    // A Session binding is borrowed and may retire when its last owner leaves.
    // The public list still reports Host run transitions without opening history.
    const nextRunningSessions = new Map()
    const settled = []
    const listedSessions = new Set(sessions.ids)
    for (const workspace of workspaces.items) {
      if (!watchedWorkspaces.has(workspace.workspaceId)) continue
      for (const id of workspace.sessionIds) {
        const row = listedSessions.has(id) ? sessions.byId[id] : undefined
        if (!row) continue
        const previous = runningSessions.get(id)
        nextRunningSessions.set(id, { workspaceId: workspace.workspaceId, running: row.running })
        if (
          previous?.workspaceId === workspace.workspaceId &&
          previous.running &&
          !row.running &&
          !ctx.sessions.binding(id)
        )
          settled.push({ id, workspaceId: workspace.workspaceId })
      }
    }
    runningSessions = nextRunningSessions
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
      let chatBaseline = true
      let readChat = () => {}
      const observer = new LiveDeliveryObserver(
        id,
        (delivery, callId) => {
          readChat()
          const { workspaceId, reportId, buildId } = delivery.receipt
          try {
            check(id, workspaceId)
          } catch (error) {
            if (ctx.sessions.list.getSnapshot().byId[id]?.retainedBy.mainView) fail(error)
            return
          }
          changed(workspaceId, reportId)
          const draft = draftTabs.get(id)
          if (delivery.draftId && draft?.delivery.draftId === delivery.draftId) {
            setDraftTab(id, { ...draft, receipt: delivery.receipt })
            return
          }
          if (delivery.surface === 'tool') return
          // The exact call's temporary tab owns handoff, including an explicit user close.
          if (candidateTabs.has(candidateKey(id, delivery.turn, callId))) return
          // Publication invalidation is Workspace-wide. Foreground navigation
          // alone is gated, and background deliveries are never queued.
          if (!ctx.sessions.list.getSnapshot().byId[id]?.retainedBy.mainView) return
          try {
            navigate(id, { kind: 'report', workspaceId, reportId, buildId }, ctx.sidebarRight, true)
          } catch (error) {
            fail(error)
          }
        },
        (delivery) => {
          const generation = ctx.connection.generation.getSnapshot()
          const workspace = ctx.workspaces.list
            .getSnapshot()
            .items.find((w) => w.workspaceId === delivery.workspaceId)
          const previous = draftTabs.get(id)
          if (!generation || !workspace) return
          const sameDraft =
            previous?.delivery.draftId === delivery.draftId && previous.generation === generation
          try {
            check(id, delivery.workspaceId, !sameDraft)
            setDraftTab(id, { delivery, generation, workspacePath: workspace.path })
            if (!sameDraft) {
              ctx.sidebarRight.openTab(draftKind, { params: { draftId: delivery.draftId } })
              if (diagnostics)
                audit.opens.push({ sessionId: id, draftId: delivery.draftId, automatic: true })
            }
          } catch (error) {
            if (ctx.sessions.list.getSnapshot().byId[id]?.retainedBy.mainView) fail(error)
          }
        },
      )
      let stopChat = () => {}
      if (typeof ctx.uiConversation.binding === 'function') {
        const chat = ctx.uiConversation.binding(binding)?.target('chat')
        if (chat) {
          readChat = () => {
            const generation = ctx.connection.generation.getSnapshot(),
              workspaceId = workspaceFor(id)
            if (!generation || !workspaceId) return
            const snapshot = chat.getSnapshot()
            const roots = (snapshot?.nodes.values() ?? []).filter(
              (node) => node.kind === 'tool-call',
            )

            const baseline = chatBaseline
            for (const node of roots)
              candidates.observe(
                [node.data.root],
                id,
                workspaceId,
                generation,
                (candidate) => {
                  if (
                    baseline ||
                    candidate.surface !== 'tab' ||
                    !candidate.preview ||
                    !['preparing', 'start'].includes(candidate.phase) ||
                    !ctx.sessions.list.getSnapshot().byId[id]?.retainedBy.mainView
                  )
                    return
                  const key = candidateKey(id, candidate.turn, candidate.callId)
                  if (candidateTabs.has(key)) return
                  try {
                    check(id, workspaceId, true)
                    candidateTabs.add(key)
                    ctx.sidebarRight.openTab(candidateKind, {
                      params: { callId: candidate.callId, workspaceId, turn: candidate.turn },
                    })
                    if (diagnostics)
                      audit.opens.push({
                        sessionId: id,
                        candidate: candidate.callId,
                        automatic: true,
                      })
                  } catch (error) {
                    fail(error)
                  }
                },
                'turn' in node.location ? node.location.turn.turn : undefined,
              )
            if (snapshot) chatBaseline = false
          }
          stopChat = chat.subscribe(readChat)
          readChat()
        }
      }
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
        if (settled) {
          readChat()
          candidates.settle(id)
        }
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
          stopChat()
          candidates.revoke(id)
          setDraftTab(id, undefined)
        },
      })
    }
    for (const { id, workspaceId } of settled) {
      try {
        check(id, workspaceId)
        changed(workspaceId)
      } catch {
        /* Revoked context has no publication consumers. */
      }
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
  return { audit, pages, navigate, changed, credentials, resourceAddress }
}
