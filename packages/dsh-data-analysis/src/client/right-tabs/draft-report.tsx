import { useEffect, useState } from 'react'
import {
  type AnalysisDocument,
  parseAnalysisDocument,
} from '../../presentation/contracts/analysis-document.ts'
import { type DraftDelivery, MARIVO_PRESENTATION_RPC_CHANNEL } from '../../presentation/receipt.ts'
import { CandidateAnalysisSurface } from '../analysis-ui/lazy-surface.tsx'
import { useCopy } from '../i18n/context.tsx'
import type { PresentationRpc } from '../presentation/delivery-model.ts'
import { Alert, AlertDescription } from '../ui/primitives/alert.tsx'
import { UIStyleSheet } from '../ui/theme.ts'

export function DraftReportView({
  delivery,
  rpc,
}: {
  delivery: DraftDelivery
  rpc: PresentationRpc
}) {
  const t = useCopy()
  const [document, setDocument] = useState<AnalysisDocument>()
  const [failedRevision, setFailedRevision] = useState<string>()
  useEffect(() => {
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
      setDocument(next)
    })().catch(() => {
      if (!abort.signal.aborted) setFailedRevision(delivery.draftRevision)
    })
    return () => abort.abort()
  }, [delivery, rpc])
  const failed = failedRevision === delivery.draftRevision
  return (
    <section className="mv-ui" data-analysis-draft={delivery.draftId}>
      <UIStyleSheet />
      <Alert role={failed ? 'alert' : 'status'} variant={failed ? 'destructive' : 'default'}>
        <AlertDescription>
          {t(failed ? 'marivo.presentation.ui-draft-unavailable' : 'marivo.presentation.ui-draft')}
        </AlertDescription>
      </Alert>
      {document && (
        <CandidateAnalysisSurface
          program={document.program}
          title={document.title}
          locale={document.locale}
          resources={document.resources}
        />
      )}
    </section>
  )
}
