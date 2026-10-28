import type { Context } from '@deepseek-ai/cordis'
import type {
  ConnectionGeneration,
  ConnectionGenerationState,
} from '@deepseek-ai/dsh-client-connection/client'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { AnalysisDocument } from '../../presentation/contracts/analysis-document.ts'
import type { PresentationReceipt } from '../../presentation/contracts/types.ts'
import type { PresentationDelivery } from '../../presentation/receipt.ts'
import { useCopy } from '../i18n/context.tsx'
import { localized } from '../i18n/host.tsx'
import type { PresentationRpc } from '../presentation/delivery-model.ts'
import { type AnalysisCandidates, analysisCandidate, analysisToolDelivery } from './candidate.ts'
import { CandidateView, readSavedAnalysis } from './candidate-view.tsx'
import { SavedAnalysisSurface } from './lazy-surface.tsx'

function SavedToolView({
  delivery,
  sessionId,
  rpc,
  onOpen,
  generation,
  allowed,
}: {
  delivery: PresentationDelivery
  sessionId: string
  rpc: PresentationRpc
  onOpen: (receipt: PresentationReceipt) => void
  generation: ConnectionGeneration | undefined
  allowed: boolean
}) {
  const t = useCopy()
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
  if (
    !allowed ||
    !generation ||
    delivery.dshSessionId !== sessionId ||
    (state.generation === generation && state.error)
  )
    return <p role="alert">{t('marivo.presentation.ui-read-failed')}</p>
  return (
    <div data-analysis-tool-call="saved">
      <button type="button" onClick={() => onOpen(delivery.receipt)}>
        {t('marivo.presentation.ui-open-tab')}
      </button>
      {state.generation === generation && state.document ? (
        <SavedAnalysisSurface document={state.document} />
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
        <button type="button" onClick={() => open(props.sessionId, delivery.receipt)}>
          {delivery.receipt.title}
        </button>
      )
    return (
      <SavedToolView
        key={delivery.receipt.buildId}
        delivery={delivery}
        sessionId={props.sessionId}
        rpc={rpc}
        onOpen={(receipt) => open(props.sessionId, receipt)}
        generation={generation}
        allowed={allowed}
      />
    )
  })
  ctx.slots.inject('tool.call.toolview', () =>
    ctx.slots.register(
      { name: 'tool.call.toolview', key: 'marivo_present', locale: 'marivo.presentation' },
      (props: ToolCallViewProps) => <LocalizedView {...props} />,
    ),
  )
}
