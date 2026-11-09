import { useEffect, useState } from 'react'
import {
  type AnalysisDocument,
  parseAnalysisDocument,
  sameAnalysisDeclaration,
} from '../../presentation/contracts/analysis-document.ts'
import { MARIVO_PRESENTATION_RPC_CHANNEL } from '../../presentation/receipt.ts'
import { useCopy } from '../i18n/context.tsx'
import type { PresentationRpc } from '../presentation/delivery-model.ts'
import { Alert, AlertDescription } from '../ui/primitives/alert.tsx'
import { UIStyleSheet } from '../ui/theme.ts'
import { CandidateView } from './candidate-view.tsx'
import type { AnalysisDraftView } from './drafts.ts'
import { CandidateAnalysisSurface } from './lazy-surface.tsx'
import { streamingAnalysisProgram } from './streaming-program.ts'

export function DraftReportView({ view, rpc }: { view: AnalysisDraftView; rpc: PresentationRpc }) {
  const t = useCopy()
  const { delivery, candidate } = view
  const { generation, workspaceId, workspacePath } = view
  const [loaded, setLoaded] = useState<{
    document: AnalysisDocument
    draftId: string
    generation: AnalysisDraftView['generation']
    workspaceId: string
    workspacePath?: string
  }>()
  const document =
    loaded?.generation === generation &&
    loaded.workspaceId === workspaceId &&
    loaded.workspacePath === workspacePath &&
    loaded.draftId === delivery?.draftId
      ? loaded.document
      : undefined
  const [failedRevision, setFailedRevision] = useState<string>()
  useEffect(() => {
    if (!delivery) return
    const abort = new AbortController()
    void (async () => {
      const result = (await rpc.call(
        MARIVO_PRESENTATION_RPC_CHANNEL,
        'draft/read',
        delivery,
        abort.signal,
      )) as { ok?: boolean; value?: unknown }
      if (abort.signal.aborted) return
      if (result?.ok !== true) throw new Error('analysis-draft-unavailable')
      const next = parseAnalysisDocument(result.value)
      if (next.workspaceId !== delivery.workspaceId || next.buildId !== delivery.draftRevision)
        throw new Error('analysis-draft-identity-mismatch')
      setLoaded({
        document: next,
        draftId: delivery.draftId,
        generation,
        workspaceId,
        workspacePath,
      })
    })().catch(() => {
      if (!abort.signal.aborted) setFailedRevision(delivery.draftRevision)
    })
    return () => abort.abort()
  }, [delivery, rpc, generation, workspaceId, workspacePath])
  const terminal = candidate?.phase === 'failed' || candidate?.phase === 'cancelled'
  const failed = Boolean(delivery && failedRevision === delivery.draftRevision) || terminal
  const streaming =
    candidate?.preview &&
    ['preparing', 'start'].includes(candidate.phase) &&
    (!candidate.draftId ||
      (candidate.draftId === delivery?.draftId && candidate.draftRevision === document?.buildId))
  // Rebase candidates read their reviewed saved base, rather than applying the
  // patch to the old working document. They remain transient until Host admission.
  if (candidate && (!document || (streaming && candidate.rebaseOnRecordId)))
    return (
      <section className="mv-ui" data-analysis-draft={delivery?.draftId ?? view.turn}>
        <CandidateView
          candidate={{
            ...candidate,
            basedOnRecordId: candidate.rebaseOnRecordId ?? candidate.basedOnRecordId,
          }}
          rpc={rpc}
          fallbackDocument={document}
        />
      </section>
    )
  const program =
    streaming && document
      ? streamingAnalysisProgram(document.program, candidate.program)
      : document?.program
  const resources =
    streaming && candidate.resources && document
      ? Object.fromEntries(
          Object.entries(document.resources).filter(([name, resource]) =>
            candidate.resources?.[name]
              ? sameAnalysisDeclaration(resource.declaration, candidate.resources[name])
              : false,
          ),
        )
      : document?.resources
  return (
    <section className="mv-ui" data-analysis-draft={delivery?.draftId ?? view.turn}>
      <UIStyleSheet />
      <Alert role={failed ? 'alert' : 'status'} variant={failed ? 'destructive' : 'default'}>
        <AlertDescription>
          {t(failed ? 'marivo.presentation.ui-draft-unavailable' : 'marivo.presentation.ui-draft')}
        </AlertDescription>
      </Alert>
      {document && program && (
        <CandidateAnalysisSurface
          program={program}
          title={(streaming && candidate.title) || document.title}
          locale={(streaming && candidate.locale) || document.locale}
          resources={resources ?? {}}
          isStreaming={Boolean(streaming && !candidate.complete)}
        />
      )}
    </section>
  )
}
