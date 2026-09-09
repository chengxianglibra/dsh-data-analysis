// @ts-nocheck -- Host slot hooks are injected by the runtime module table.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { refKey } from '../../semantic-reference/contracts.ts'
import { DatasourceProperties, installCredentials, TestResult } from '../credentials/install.tsx'
import { credentialStyles } from '../credentials/styles.ts'
import { appendPresentationContext } from '../presentation/ask-dsh.ts'
import { catalogStyles, ReportCatalogView, ReportHistoryPanel } from '../presentation/catalog.tsx'
import {
  marivoPresentationDeliveryDefinition,
  PRESENTATION_TURN_DATA_KEY,
  presentationsForNode,
} from '../presentation/delivery.ts'
import { PresentationDeliveryModel } from '../presentation/delivery-model.ts'
import { HostPresentationReader } from '../presentation/host-entry.tsx'
import { deliveryStyles, installPresentation } from '../presentation/install.tsx'
import { createPluginRpc } from '../rpc.ts'
import { installSemanticBrowser } from '../semantic-browser/install.tsx'
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
const labels = { datasources: '数据源', semantic: '语义层', reports: '报告' }

/** Default browser integration. Layout belongs to Harness; mutable content belongs to occurrences. */
export function installRightTabs(ctx, { diagnostics = false } = {}) {
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
      throw new Error('所属 Session 或 Workspace 已变化，请回到所属会话重新打开。')
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
  const semantic = (sessionId, workspaceId, ref, actions) =>
    navigate(sessionId, { kind: 'semantic', workspaceId, ref }, actions)
  installSemanticReferenceSource(ctx, rpc)
  const fallbackSemantic = installSemanticBrowser(ctx, rpc, { entries: false })
  const credentials = installCredentials(ctx, rpc, { entries: false })
  const editor = installPresentation(
    ctx,
    rpc,
    (workspaceId, ref) => {
      const sessionId = ctx.sessions.list.getSnapshot().current
      if (sessionId && workspaceFor(sessionId) === workspaceId)
        semantic(sessionId, workspaceId, ref)
      else fallbackSemantic(workspaceId, ref)
    },
    {
      entries: false,
      cards: false,
      footer: true,
      openWorkspace: (workspaceId) => {
        const sessionId = ctx.sessions.list.getSnapshot().current
        if (!sessionId || workspaceFor(sessionId) !== workspaceId) return false
        check(sessionId, workspaceId, true)
        ctx.sidebarRight.openTab(directoryKind('reports'), { params: { workspaceId } })
        return true
      },
    },
  )
  let savedBuild: string | undefined,
    wasSaving = false,
    credentialOpen = false
  ctx.effect(() =>
    editor.subscribe(() => {
      const state = editor.getSnapshot()
      if (
        wasSaving &&
        !state.saving &&
        !state.editError &&
        state.document &&
        state.document.buildId !== savedBuild
      )
        changed(state.document.workspaceId, state.document.reportId)
      wasSaving = !!state.saving
      savedBuild = state.document?.buildId
    }),
  )
  ctx.effect(() =>
    credentials.subscribe(() => {
      const state = credentials.getSnapshot()
      if (credentialOpen && !state.open)
        for (const page of pages.values())
          if (page.target.kind === 'datasources' && page.target.workspaceId === state.workspaceId)
            try {
              if (page.getSnapshot().error || page.signal?.aborted) continue
              check(page.sessionId, page.target.workspaceId)
              if (
                ctx.workspaces.list
                  .getSnapshot()
                  .items.find((w) => w.workspaceId === page.target.workspaceId)?.path !==
                page.workspacePath
              )
                throw new Error('workspace-changed')
              void page.refresh()
            } catch {
              page.unavailable('Workspace 已变化或不可用，请重新打开页面。')
            }
      credentialOpen = state.open
    }),
  )
  const edit = async (page) => {
    check(page.sessionId, page.target.workspaceId, true)
    if (editor.dirty || editor.getSnapshot().saving) throw new Error('请先保存或取消现有编辑。')
    await editor.showReport(page.target.workspaceId, page.target.reportId)
    check(page.sessionId, page.target.workspaceId, true)
    const state = editor.getSnapshot()
    if (state.error) throw new Error(state.error)
    if (state.document?.buildId !== page.reader.getSnapshot().document?.buildId) {
      editor.close()
      throw new Error('已有新版本，请刷新 current 后再编辑。')
    }
    editor.beginEdit()
  }
  const ask = (page, context) => {
    check(page.sessionId, page.target.workspaceId, true)
    if (!page.reader.getSnapshot().document || page.getSnapshot().error || page.signal.aborted)
      throw new Error('报告已不可用，请重新打开。')
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
      page = new TabPage(sessionId, target, rpc)
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
  function Contents({ page, tab, panelId, workspaces, sessions }) {
    const state = useSyncExternalStore(page.subscribe, page.getSnapshot)
    const report = useSyncExternalStore(page.reader.subscribe, page.reader.getSnapshot)
    const data = useSyncExternalStore(page.datasources.subscribe, page.datasources.getSnapshot)
    const open = (target) => act(page, () => navigate(page.sessionId, target, tab.actions))
    const source = (ref) =>
      navigate(
        page.sessionId,
        { kind: 'semantic', workspaceId: page.target.workspaceId, ref },
        tab.actions,
      )
    const catalogReader = {
      showReport: (workspaceId, reportId) => open({ kind: 'report', workspaceId, reportId }),
      showHistory: (workspaceId, reportId) =>
        act(page, () =>
          navigate(page.sessionId, { kind: 'report', workspaceId, reportId }, tab.actions, false, {
            history: true,
          }),
        ),
      getSnapshot: () => ({ open: false }),
    }
    const historyModel = {
      selectVersion: (buildId) =>
        open({
          kind: 'report',
          workspaceId: page.target.workspaceId,
          reportId: page.target.reportId,
          ...(buildId ? { buildId } : {}),
        }),
    }
    const context = data.datasources.find((item) => item.token === data.selected)
    return (
      <section
        className="rt-page"
        data-rt-tab={tab.id}
        data-rt-panel={panelId}
        data-rt-kind={page.target.kind}
        data-rt-workspace={page.target.workspaceId}
        data-rt-build={report.document?.buildId}
      >
        <style>{catalogStyles + credentialStyles + rightTabStyles}</style>
        {state.error ? (
          <p role="alert">{state.error}</p>
        ) : (
          <>
            {page.target.kind !== 'report' && page.target.kind !== 'semantic' && (
              <>
                <h2 className="rt-heading">{labels[page.target.kind]}</h2>
                <p className="rt-caption">
                  {workspaces.find((w) => w.workspaceId === page.target.workspaceId)?.title ??
                    page.target.workspaceId}
                </p>
              </>
            )}
            <div className="rt-toolbar">
              <button type="button" onClick={() => void page.refresh()}>
                刷新页面
              </button>
              {page.target.kind === 'report' && (
                <>
                  <strong>
                    {page.target.buildId
                      ? `固定版本 · ${page.target.buildId.slice(0, 8)}`
                      : 'current · 当前版本'}
                  </strong>
                  {!page.target.buildId && (
                    <button
                      type="button"
                      disabled={!report.document || report.loading}
                      onClick={() => act(page, () => edit(page))}
                    >
                      编辑报告
                    </button>
                  )}
                  <button type="button" onClick={() => void page.reader.toggleHistory()}>
                    历史版本
                  </button>
                </>
              )}
            </div>
            {state.newer && (
              <p role="status" className="rt-notice">
                已有新版本，当前阅读内容保持不变。
                <button type="button" onClick={() => void page.refresh()}>
                  查看新版本
                </button>
              </p>
            )}
            {state.notice && <p role="status">{state.notice}</p>}
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
                embedded
                model={page.semantic}
                workspaces={workspaces}
                onOpenObject={source}
                onNavigateKey={
                  'ref' in page.target
                    ? (key) =>
                        act(page, () => {
                          const object = page.semantic
                            .getSnapshot()
                            .views[page.target.workspaceId]?.snapshot?.objects.find(
                              (item) => refKey(item.ref) === key,
                            )
                          if (!object) throw new Error('语义对象不在当前 Catalog 中。')
                          source(object.ref)
                        })
                    : undefined
                }
                onReturnToList={
                  'ref' in page.target
                    ? () =>
                        act(page, () => {
                          check(page.sessionId, page.target.workspaceId)
                          tab.actions.openTab(directoryKind('semantic'), {
                            params: { workspaceId: page.target.workspaceId },
                          })
                        })
                    : undefined
                }
              />
            )}
            {page.target.kind === 'datasources' && (
              <div className="rt-datasource">
                <p className="rt-caption">
                  查看连接属性与凭证配置状态。连接测试和配置修改需要显式操作。
                </p>
                {data.loading && <p role="status">正在读取数据源…</p>}
                {data.error && <p role="alert">{data.error}</p>}
                {!data.loading && !data.error && !data.datasources.length && (
                  <p role="status">此 Workspace 暂无数据源，请打开配置创建数据源。</p>
                )}
                <select
                  disabled={data.loading || !data.datasources.length}
                  aria-label="选择数据源"
                  value={data.selected}
                  onChange={(e) => page.datasources.select(e.target.value)}
                >
                  {data.datasources.map((item) => (
                    <option key={item.token} value={item.token}>
                      {item.name}
                    </option>
                  ))}
                </select>
                {context && (
                  <>
                    <DatasourceProperties context={context} />
                    <p>
                      凭证配置：
                      {context.refs.filter((ref) => context.credentials[ref]?.configured).length}/
                      {context.refs.length}
                    </p>
                    {context.lastTest && (
                      <TestResult result={context.lastTest.result} stale={context.lastTest.stale} />
                    )}
                  </>
                )}
                <button
                  type="button"
                  onClick={() =>
                    act(page, () => {
                      check(page.sessionId, page.target.workspaceId, true)
                      credentials.show(page.target.workspaceId, data.selected)
                    })
                  }
                >
                  配置数据源与凭证
                </button>
              </div>
            )}
            {page.target.kind === 'report' && (
              <>
                {report.loading && <p role="status">正在读取报告…</p>}
                {report.error && <p role="alert">{report.error}</p>}
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
                      downloading: report.downloading,
                      disabled: !!report.error || report.loading,
                    }}
                    onOpenSemanticRef={source}
                    onAskDsh={(context) => ask(page, context)}
                  />
                )}
                {report.downloadError && <p role="alert">{report.downloadError}</p>}
              </>
            )}
          </>
        )}
      </section>
    )
  }
  function Body({ sessionId, useTabInfo, useWorkspaces, useSessions }) {
    const { tab, panel } = useTabInfo()
    const workspaces = useWorkspaces((s) => s.items),
      sessions = useSessions((s) => s.byId)
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
        void owned.navigate(tab.navigation.revision, false, tab.navigation.params?.history === true)
        pageIndex.publish()
      } catch (error) {
        setPage(undefined)
        setError(error.message)
      }
    }, [sessionId, tab])
    return error ? (
      <p role="alert">{error}</p>
    ) : page && page.sessionId === sessionId && page.signal === tab.signal ? (
      <Contents
        page={page}
        tab={tab}
        panelId={panel.id}
        workspaces={workspaces}
        sessions={sessions}
      />
    ) : null
  }
  for (const [page, label] of Object.entries(labels)) {
    const kind = directoryKind(page),
      id = definitionId(kind)
    ctx.effect(() => ctx.sidebarRightTabs.register({ id, kind, title: () => label }))
    ctx.slots.inject('sidebar.right.pane.tab', () =>
      ctx.slots.register({ name: 'sidebar.right.pane.tab', key: id }, Body),
    )
    ctx.slots.inject('conversation.session.header.actions', () =>
      ctx.slots.register(
        {
          name: 'conversation.session.header.actions',
          id,
          order: 100 + Object.keys(labels).indexOf(page) * 5,
        },
        function Entry({ sessionId, useWorkspaces }) {
          const workspaceId = useWorkspaces(
            (s) => s.items.find((w) => w.sessionIds.includes(sessionId))?.workspaceId,
          )
          return (
            <WorkspaceHeaderAction
              label={label}
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
        },
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
        {target.buildId ? target.buildId.slice(0, 8) : 'current'}
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
            ? `${target.reportId.slice(0, 12)} · ${target.buildId ? target.buildId.slice(0, 8) : 'current'}`
            : target.ref.path
        },
      }),
    )
    ctx.slots.inject('sidebar.right.pane.tab.title', () =>
      ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: id }, Title),
    )
    ctx.slots.inject('sidebar.right.pane.tab', () =>
      ctx.slots.register({ name: 'sidebar.right.pane.tab', key: id }, Body),
    )
  }
  function DeliveryCard({ delivery, sessionId }) {
    const { workspaceId, reportId, buildId } = delivery.receipt
    const [model] = useState(() => new PresentationDeliveryModel(rpc))
    const state = useSyncExternalStore(model.subscribe, model.getSnapshot)
    const [error, setError] = useState('')
    useEffect(() => () => model.dispose(), [model])
    const run = async (download = false) => {
      setError('')
      try {
        check(sessionId, workspaceId, true)
        if (!download) navigate(sessionId, { kind: 'report', workspaceId, reportId, buildId })
        else {
          await model.showBuild(workspaceId, reportId, buildId)
          check(sessionId, workspaceId, true)
          if (model.getSnapshot().error) throw new Error(model.getSnapshot().error)
          await model.downloadDisplayed()
        }
      } catch (error) {
        setError(error.message)
      }
    }
    return (
      <section className="pd-card" data-presentation-card={buildId}>
        <h3>{delivery.receipt.title}</h3>
        <p>{delivery.receipt.summary}</p>
        <div className="pd-actions">
          <button type="button" onClick={() => void run()}>
            打开分析
          </button>
          <button
            type="button"
            disabled={state.loading || state.downloading}
            onClick={() => void run(true)}
          >
            {state.downloading ? '正在下载…' : '下载 HTML'}
          </button>
          <span className="pd-muted">保存的数据与来源快照 · 可离线阅读</span>
        </div>
        {(error || state.downloadError) && (
          <p role="alert" className="pd-error">
            {error || state.downloadError}
          </p>
        )}
        {state.notice && (
          <p role="status" className="pd-muted">
            {state.notice}
          </p>
        )}
      </section>
    )
  }
  ctx.slots.inject('conversation.chat.node', () => {
    const stop = ctx.slots.register(
      { name: 'conversation.chat.node', key: PRESENTATION_TURN_DATA_KEY },
      function Cards({ node, sessionId }) {
        const error = useSyncExternalStore(notices.subscribe, notices.getSnapshot)
        return (
          <div className="pd-cards">
            <style>{deliveryStyles}</style>
            {presentationsForNode(node, sessionId).map((delivery) => (
              <DeliveryCard
                key={JSON.stringify([
                  sessionId,
                  delivery.receipt.workspaceId,
                  delivery.receipt.reportId,
                  delivery.receipt.buildId,
                ])}
                delivery={delivery}
                sessionId={sessionId}
              />
            ))}
            {error && (
              <p role="alert" className="pd-error">
                {error}
              </p>
            )}
          </div>
        )
      },
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
          page.unavailable('Workspace 已变化或不可用，请重新打开页面。')
        }
      }
      bind()
    }),
  )
  ctx.effect(() =>
    ctx.connection.generation.subscribe(() => {
      if (ctx.connection.generation.getSnapshot()) return
      stopFeeds()
      for (const page of pages.values()) page.unavailable('Host 连接已中断，请重连后重新打开页面。')
    }),
  )
  ctx.on('connection/reset', () => {
    for (const page of pages.values()) page.unavailable('Host 连接已重置，请重新打开页面。')
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
  return { audit, pages, navigate, changed, editor, credentials, resourceAddress, ask }
}
