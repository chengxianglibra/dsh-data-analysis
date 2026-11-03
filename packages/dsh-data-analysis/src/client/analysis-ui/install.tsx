import type { Context } from '@deepseek-ai/cordis'
import type {
  ConnectionGeneration,
  ConnectionGenerationState,
} from '@deepseek-ai/dsh-client-connection/client'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { AnalysisDocument } from '../../presentation/contracts/analysis-document.ts'
import { analysisRecordId } from '../../presentation/contracts/analysis-document.ts'
import type { PresentationReceipt } from '../../presentation/contracts/types.ts'
import type { PresentationDelivery } from '../../presentation/receipt.ts'
import type { SemanticRef } from '../../semantic-reference/contracts.ts'
import { useCopy } from '../i18n/context.tsx'
import { localized } from '../i18n/host.tsx'
import {
  ANALYSIS_SURFACE_NODE_KEY,
  analysisSurfacesForNode,
  presentationDeliveryIdentity,
} from '../presentation/delivery.ts'
import type { PresentationRpc } from '../presentation/delivery-model.ts'
import type { OpenSemanticRef } from '../presentation/source-facts.ts'
import { Button } from '../ui/controls.tsx'
import { UIStyleSheet } from '../ui/theme.ts'
import { type AnalysisCandidates, analysisCandidate, analysisToolDelivery } from './candidate.ts'
import { CandidateView, readSavedAnalysis, savedCodeReader } from './candidate-view.tsx'
import type { AnalysisResourceContext } from './context.tsx'
import { SavedAnalysisSurface } from './lazy-surface.tsx'

function SavedToolView({
  delivery,
  sessionId,
  rpc,
  onOpen,
  onOpenSemanticRef,
  generation,
  allowed,
  onAskPoint,
}: {
  delivery: PresentationDelivery
  sessionId: string
  rpc: PresentationRpc
  onOpen: (receipt: PresentationReceipt) => void
  onOpenSemanticRef: OpenSemanticRef
  generation: ConnectionGeneration | undefined
  allowed: boolean
  onAskPoint: (
    selection: Parameters<NonNullable<AnalysisResourceContext['askPoint']>>[0],
    signal: AbortSignal,
  ) => Promise<void>
}) {
  const t = useCopy()
  const lifetime = useRef<AbortController>()
  useEffect(() => {
    if (!allowed || !generation || delivery.dshSessionId !== sessionId) return
    const controller = new AbortController()
    lifetime.current = controller
    return () => {
      lifetime.current = undefined
      controller.abort()
    }
  }, [delivery, sessionId, generation, allowed])
  const [state, setState] = useState<{
    document?: AnalysisDocument
    error?: boolean
    generation?: ConnectionGeneration
  }>({})
  useEffect(() => {
    setState({})
    if (!allowed || !generation || delivery.dshSessionId !== sessionId) return
    const abort = new AbortController()
    void (async () => {
      const document = await readSavedAnalysis(rpc, sessionId, delivery.receipt, abort.signal)
      if (!abort.signal.aborted) setState({ document, generation })
    })().catch(() => {
      if (!abort.signal.aborted) setState({ error: true, generation })
    })
    return () => abort.abort()
  }, [delivery, sessionId, rpc, generation, allowed])
  const readCode = useMemo(
    () => savedCodeReader(rpc, { sessionId }, delivery.receipt),
    [rpc, sessionId, delivery.receipt],
  )
  if (
    !allowed ||
    !generation ||
    delivery.dshSessionId !== sessionId ||
    (state.generation === generation && state.error)
  )
    return <p role="alert">{t('marivo.presentation.ui-read-failed')}</p>
  return (
    <div className="mv-ui" data-analysis-tool-call="saved">
      <UIStyleSheet />
      <Button variant="outline" type="button" onClick={() => onOpen(delivery.receipt)}>
        {t('marivo.presentation.ui-open-tab')}
      </Button>
      {state.generation === generation && state.document ? (
        <SavedAnalysisSurface
          document={state.document}
          openSemanticRef={onOpenSemanticRef}
          readCode={readCode}
          askPoint={(selection) => {
            const signal = lifetime.current?.signal
            return signal
              ? onAskPoint(selection, signal)
              : Promise.reject(new Error('input-unavailable'))
          }}
        />
      ) : (
        <p role="status">{t('marivo.presentation.ui-loading')}</p>
      )}
    </div>
  )
}
export function installAnalysisTool(
  ctx: Context,
  rpc: PresentationRpc,
  open: (sessionId: string, receipt: PresentationReceipt) => void,
  connection: ConnectionGenerationState,
  candidates: AnalysisCandidates,
  openSemantic: (sessionId: string, workspaceId: string, ref: SemanticRef) => void,
  askPoint: (
    sessionId: string,
    workspaceId: string,
    recordId: string,
    selection: Parameters<NonNullable<AnalysisResourceContext['askPoint']>>[0],
    signal: AbortSignal,
  ) => Promise<void>,
): void {
  const subscribe = (fn: () => void) => connection.subscribe(fn)
  const getGeneration = () => connection.getSnapshot()
  const subscribeWorkspaces = (fn: () => void) => ctx.workspaces.list.subscribe(fn)
  const getWorkspaces = () => ctx.workspaces.list.getSnapshot()
  const LocalizedView = localized(ctx, function AnalysisToolView(props: ToolCallViewProps) {
    const t = useCopy()
    const generation = useSyncExternalStore(subscribe, getGeneration)
    const workspaces = useSyncExternalStore(subscribeWorkspaces, getWorkspaces)
    const observed = useSyncExternalStore(candidates.subscribe, () =>
      'turn' in props.block
        ? candidates.get(props.sessionId, props.block.turn, props.callId)
        : undefined,
    )
    const delivery = useMemo(() => analysisToolDelivery(props.block), [props.block])
    const owners = workspaces.items.filter((w) => w.sessionIds.includes(props.sessionId))
    const allowed =
      workspaces.phase === 'ready' &&
      workspaces.state !== 'error' &&
      owners.length === 1 &&
      owners[0]?.workspaceId === delivery?.receipt.workspaceId
    if (!delivery) {
      const workspaceId =
        owners.length === 1 && workspaces.phase === 'ready' && workspaces.state !== 'error'
          ? owners[0]?.workspaceId
          : undefined
      if (!generation || !workspaceId)
        return <p role="status">{t('marivo.presentation.ui-preparing')}</p>
      const candidate =
        observed?.generation === generation && observed.workspaceId === workspaceId
          ? observed
          : analysisCandidate(props.block, props.sessionId, workspaceId, generation)
      if (candidate.surface === 'tab')
        return (
          <p role="status">
            {t(
              candidate.phase === 'failed' || candidate.phase === 'cancelled'
                ? 'marivo.presentation.ui-failed'
                : 'marivo.presentation.ui-generating',
            )}
          </p>
        )
      return <CandidateView candidate={candidate} rpc={rpc} />
    }
    if (delivery.surface !== 'tool')
      return (
        <span className="mv-ui">
          <UIStyleSheet />
          <Button
            variant="outline"
            type="button"
            onClick={() => open(props.sessionId, delivery.receipt)}
          >
            {delivery.receipt.title}
          </Button>
        </span>
      )
    if (!allowed || !generation || delivery.dshSessionId !== props.sessionId)
      return <p role="alert">{t('marivo.presentation.ui-read-failed')}</p>
    return (
      <span className="mv-ui">
        <UIStyleSheet />
        <Button
          variant="outline"
          type="button"
          onClick={() => open(props.sessionId, delivery.receipt)}
        >
          {t('marivo.presentation.ui-open-tab')}
        </Button>
      </span>
    )
  })
  ctx.slots.inject('tool.call.toolview', () =>
    ctx.slots.register(
      { name: 'tool.call.toolview', key: 'marivo_present', locale: 'marivo.presentation' },
      (props: ToolCallViewProps) => <LocalizedView {...props} />,
    ),
  )
  const LocalizedSurfaceNode = localized(
    ctx,
    function AnalysisSurfaceNode(
      props: Pick<ChatNodeViewProps<'marivo-analysis-surface'>, 'node' | 'sessionId'>,
    ) {
      const generation = useSyncExternalStore(subscribe, getGeneration)
      const workspaces = useSyncExternalStore(subscribeWorkspaces, getWorkspaces)
      const deliveries = useMemo(
        () => analysisSurfacesForNode(props.node, props.sessionId),
        [props.node, props.sessionId],
      )
      const owners = workspaces.items.filter((workspace) =>
        workspace.sessionIds.includes(props.sessionId),
      )
      return (
        <>
          {deliveries.map((delivery) => (
            <SavedToolView
              key={presentationDeliveryIdentity(delivery)}
              delivery={delivery}
              sessionId={props.sessionId}
              rpc={rpc}
              onOpen={(receipt) => open(props.sessionId, receipt)}
              onOpenSemanticRef={(ref) =>
                openSemantic(props.sessionId, delivery.receipt.workspaceId, ref)
              }
              onAskPoint={(selection, signal) =>
                askPoint(
                  props.sessionId,
                  delivery.receipt.workspaceId,
                  analysisRecordId(delivery.receipt.reportId, delivery.receipt.buildId),
                  selection,
                  signal,
                )
              }
              generation={generation}
              allowed={
                workspaces.phase === 'ready' &&
                workspaces.state !== 'error' &&
                owners.length === 1 &&
                owners[0]?.workspaceId === delivery.receipt.workspaceId
              }
            />
          ))}
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
        <LocalizedSurfaceNode {...props} />
      ),
    ),
  )
}
