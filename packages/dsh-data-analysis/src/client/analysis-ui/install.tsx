import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionGenerationState } from '@deepseek-ai/dsh-client-connection/client'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { PanelRightOpenIcon } from 'lucide-react'
import {
  type ComponentType,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { analysisRecordId } from '../../presentation/contracts/analysis-document.ts'
import type { PresentationReceipt } from '../../presentation/contracts/types.ts'
import type { SemanticRef } from '../../semantic-reference/contracts.ts'
import { useCopy } from '../i18n/context.tsx'
import { localized } from '../i18n/host.tsx'
import {
  ANALYSIS_SURFACE_NODE_KEY,
  analysisDraftForNode,
  analysisSurfacesForNode,
} from '../presentation/delivery.ts'
import type { PresentationRpc } from '../presentation/delivery-model.ts'
import { Button, IconButton } from '../ui/controls.tsx'
import { UIStyleSheet } from '../ui/theme.ts'
import { analysisToolDelivery } from './candidate.ts'
import { savedCodeReader } from './candidate-view.tsx'
import type { AnalysisResourceContext } from './context.tsx'
import { ReportView } from './report-view.tsx'
import type { ReportViewState, ReportViews } from './report-views.ts'
export function installAnalysisTool(
  ctx: Context,
  rpc: PresentationRpc,
  open: (sessionId: string, receipt: PresentationReceipt) => void,
  connection: ConnectionGenerationState,
  views: ReportViews,
  move: (view: ReportViewState) => void,
  openSemantic: (sessionId: string, workspaceId: string, ref: SemanticRef) => void,
  askDataset: (
    sessionId: string,
    workspaceId: string,
    recordId: string,
    selection: Parameters<NonNullable<AnalysisResourceContext['askDataset']>>[0],
    signal: AbortSignal,
  ) => Promise<undefined | (() => void)>,
  askPoint: (
    sessionId: string,
    workspaceId: string,
    recordId: string,
    selection: Parameters<NonNullable<AnalysisResourceContext['askPoint']>>[0],
    signal: AbortSignal,
  ) => Promise<undefined | (() => void)>,
  askResource: (
    sessionId: string,
    workspaceId: string,
    recordId: string,
    selection: Parameters<NonNullable<AnalysisResourceContext['askResource']>>[0],
    signal: AbortSignal,
  ) => Promise<undefined | (() => void)>,
  NextSteps?: ComponentType<{ sessionId: string; turn: number }>,
) {
  const subscribe = (fn: () => void) => connection.subscribe(fn)
  const getGeneration = () => connection.getSnapshot()
  const subscribeWorkspaces = (fn: () => void) => ctx.workspaces.list.subscribe(fn)
  const getWorkspaces = () => ctx.workspaces.list.getSnapshot()
  const Body = localized(
    ctx,
    function ReportBody({
      viewId,
      sessionId,
      inTab = false,
    }: {
      viewId: string
      sessionId: string
      inTab?: boolean
    }) {
      const t = useCopy()
      const generation = useSyncExternalStore(subscribe, getGeneration)
      const workspaces = useSyncExternalStore(subscribeWorkspaces, getWorkspaces)
      useSyncExternalStore(views.subscribe, views.getSnapshot)
      const view = views.get(viewId)
      const [error, setError] = useState(false)
      const lifetime = useRef<AbortController | null>(null)
      const allowed =
        view &&
        view.sessionId === sessionId &&
        view.generation === generation &&
        workspaces.phase === 'ready' &&
        workspaces.state !== 'error' &&
        workspaces.items.filter((w) => w.sessionIds.some((id) => id === sessionId)).length === 1 &&
        workspaces.items.some(
          (w) =>
            w.workspaceId === view.workspaceId &&
            w.path === view.workspacePath &&
            w.sessionIds.some((id) => id === sessionId),
        )
      const saved = view?.saved
      useEffect(() => {
        if (!allowed || !saved) return
        const controller = new AbortController()
        lifetime.current = controller
        return () => {
          controller.abort()
          lifetime.current = null
        }
      }, [allowed, saved])
      const actionSignal = () => {
        if (!lifetime.current) throw new Error('input-unavailable')
        return lifetime.current.signal
      }
      if (!allowed) return <p role="alert">{t('marivo.presentation.ui-read-failed')}</p>
      if (!inTab && view.tabId) return null
      const receipt = view.saved?.receipt
      const recordId = receipt ? analysisRecordId(receipt.reportId, receipt.buildId) : undefined
      const actions: Omit<AnalysisResourceContext, 'readResource'> =
        receipt && recordId
          ? {
              openSemanticRef: (ref) => openSemantic(sessionId, view.workspaceId, ref),
              readCode: savedCodeReader(rpc, { sessionId }, receipt),
              askPoint: (selection) =>
                askPoint(sessionId, view.workspaceId, recordId, selection, actionSignal()),
              askDataset: (selection) =>
                askDataset(sessionId, view.workspaceId, recordId, selection, actionSignal()),
              askResource: (selection, signal) =>
                askResource(
                  sessionId,
                  view.workspaceId,
                  recordId,
                  selection,
                  AbortSignal.any([signal, actionSignal()]),
                ),
            }
          : {}
      return (
        <section
          className="mv-ui"
          data-analysis-view={viewId}
          data-analysis-placement={inTab ? 'sidebar' : 'chat'}
        >
          <UIStyleSheet />
          {!inTab && (
            <div
              className="mv-report-toolbar"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '1rem',
                position: 'sticky',
                top: 0,
                zIndex: 1,
                background: 'var(--background)',
                padding: '.5rem',
              }}
            >
              <span>
                {view.candidate?.title ??
                  view.document?.title ??
                  receipt?.title ??
                  t('marivo.presentation.ui-draft-tab')}
              </span>
              <IconButton
                variant="ghost"
                type="button"
                label={t('marivo.presentation.ui-view-sidebar')}
                onClick={() => {
                  try {
                    move(view)
                    setError(false)
                  } catch {
                    setError(true)
                  }
                }}
              >
                <PanelRightOpenIcon aria-hidden="true" />
              </IconButton>
            </div>
          )}
          {error && <p role="alert">{t('marivo.presentation.ui-read-failed')}</p>}
          <ReportView view={view} views={views} rpc={rpc} actions={actions} />
        </section>
      )
    },
  )
  const Tool = localized(ctx, function AnalysisToolView(props: ToolCallViewProps) {
    const t = useCopy()
    useSyncExternalStore(views.subscribe, views.getSnapshot)
    const delivery = analysisToolDelivery(props.block)
    const view =
      views.forCall(props.sessionId, props.block.callId) ??
      (delivery &&
        views
          .forTurn(props.sessionId, delivery.turn)
          .find((view) => view.saved?.receipt.buildId === delivery.receipt.buildId))
    if (view?.tabId) return null
    return delivery ? (
      <Button variant="outline" onClick={() => open(props.sessionId, delivery.receipt)}>
        {t('marivo.presentation.ui-open-tab')}
      </Button>
    ) : 'kind' in props.block && props.block.isError ? (
      <p role="alert">{t('marivo.presentation.ui-failed')}</p>
    ) : null
  })
  ctx.slots.inject('tool.call.toolview', () =>
    ctx.slots.register(
      { name: 'tool.call.toolview', key: 'marivo_present', locale: 'marivo.presentation' },
      (props: ToolCallViewProps) => <Tool {...props} />,
    ),
  )
  const Surface = localized(
    ctx,
    function AnalysisSurfaceNode(
      props: Pick<ChatNodeViewProps<'marivo-analysis-surface'>, 'node' | 'sessionId'>,
    ) {
      const generation = useSyncExternalStore(subscribe, getGeneration)
      const workspaces = useSyncExternalStore(subscribeWorkspaces, getWorkspaces)
      useSyncExternalStore(views.subscribe, views.getSnapshot)
      const deliveries = useMemo(
        () => analysisSurfacesForNode(props.node, props.sessionId),
        [props.node, props.sessionId],
      )
      const draft = useMemo(
        () => analysisDraftForNode(props.node, props.sessionId),
        [props.node, props.sessionId],
      )
      const owner = workspaces.items.filter((w) => w.sessionIds.includes(props.sessionId))
      const workspace =
        owner.length === 1 && workspaces.phase === 'ready' && workspaces.state !== 'error'
          ? owner[0]
          : undefined
      useEffect(() => {
        if (!generation || !workspace) return
        for (const delivery of deliveries) {
          if (delivery.receipt.workspaceId !== workspace.workspaceId) continue
          const callId = props.node.data.deliveries.find(
            (item) => item.delivery.receipt.buildId === delivery.receipt.buildId,
          )?.callId
          views.accept(
            delivery,
            callId ?? delivery.draftId ?? delivery.receipt.buildId,
            generation,
            workspace.path,
          )
        }
        if (draft && draft.workspaceId === workspace.workspaceId) {
          const callId = props.node.data.drafts?.find(
            (item) => item.delivery.draftId === draft.draftId,
          )?.callId
          views.accept(draft, callId ?? draft.draftId, generation, workspace.path)
        }
      }, [deliveries, draft, generation, workspace, props.node])
      const active = views
        .forTurn(props.sessionId, props.node.data.turn)
        .filter(
          (view) =>
            view.generation === generation &&
            view.workspaceId === workspace?.workspaceId &&
            view.workspacePath === workspace?.path &&
            (view.saved
              ? deliveries.some((d) => d.receipt.buildId === view.saved?.receipt.buildId)
              : props.node.data.boundary === null),
        )
      return (
        <>
          {active.map((view) => (
            <Body key={view.id} viewId={view.id} sessionId={props.sessionId} />
          ))}
          {NextSteps && <NextSteps sessionId={props.sessionId} turn={props.node.data.turn} />}
        </>
      )
    },
  )
  ctx.slots.inject('conversation.chat.node', () =>
    ctx.slots.register(
      {
        name: 'conversation.chat.node',
        key: ANALYSIS_SURFACE_NODE_KEY,
        locale: 'marivo.presentation',
      },
      (props: Pick<ChatNodeViewProps<'marivo-analysis-surface'>, 'node' | 'sessionId'>) => (
        <Surface {...props} />
      ),
    ),
  )
  return { ReportBody: Body }
}
