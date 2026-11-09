import { useEffect, useState } from 'react'
import {
  type AnalysisDocument,
  parseAnalysisDocument,
  parseAnalysisRecordId,
} from '../../presentation/contracts/analysis-document.ts'
import { parseReportHistory } from '../../presentation/contracts/catalog.ts'
import { useCopy } from '../i18n/context.tsx'
import type { PresentationRpc } from '../presentation/delivery-model.ts'
import { Alert, AlertDescription } from '../ui/primitives/alert.tsx'
import { candidateResources } from './candidate.ts'
import { readSavedAnalysis } from './candidate-view.tsx'
import type { AnalysisResourceContext } from './context.tsx'
import { ReportAnalysisSurface } from './lazy-surface.tsx'
import { ReportReading } from './reading-state.tsx'
import { ReportMotion } from './report-motion.tsx'
import type { ReportViewState, ReportViews } from './report-views.ts'
import { streamingAnalysisProgram } from './streaming-program.ts'

/** One renderer for the whole report lifecycle; moving hosts retains admitted data and reading state. */
export function ReportView({
  view,
  views,
  rpc,
  actions,
}: {
  view: ReportViewState
  views: ReportViews
  rpc: PresentationRpc
  actions?: Omit<AnalysisResourceContext, 'readResource'>
}) {
  const t = useCopy()
  const [failedKey, setFailedKey] = useState<string>()
  const {
    candidate,
    draft,
    saved,
    generation,
    workspaceId,
    workspacePath,
    id,
    sessionId,
    documentKey,
    settled,
  } = view
  const baseId = candidate?.rebaseOnRecordId ?? (!draft ? candidate?.basedOnRecordId : undefined)
  const target = saved?.receipt.buildId ?? baseId ?? draft?.draftRevision
  useEffect(() => {
    if (!target || documentKey === target || settled) return
    const abort = new AbortController()
    void (async () => {
      let document: AnalysisDocument | undefined
      if (saved) document = await readSavedAnalysis(rpc, sessionId, saved.receipt, abort.signal)
      else if (baseId) {
        const { reportId, buildId } = parseAnalysisRecordId(baseId)
        const response = await rpc.call(
          '/marivo-presentation',
          'reports/history',
          { sessionId, reportId },
          abort.signal,
        )
        if (
          !response ||
          typeof response !== 'object' ||
          !('ok' in response) ||
          response.ok !== true ||
          !('value' in response)
        )
          throw new Error('report-history-unavailable')
        const history = parseReportHistory(response.value)
        if (history.workspaceId !== workspaceId) throw new Error('analysis-ui-owner-mismatch')
        const receipt = history.versions.find(
          (version) => version.receipt.buildId === buildId,
        )?.receipt
        if (!receipt) throw new Error('report-build-not-found')
        document = await readSavedAnalysis(rpc, sessionId, receipt, abort.signal)
      } else if (draft) {
        const response = await rpc.call('/marivo-presentation', 'draft/read', draft, abort.signal)
        if (
          !response ||
          typeof response !== 'object' ||
          !('ok' in response) ||
          response.ok !== true ||
          !('value' in response)
        )
          throw new Error('analysis-draft-unavailable')
        document = parseAnalysisDocument(response.value)
        if (document.workspaceId !== workspaceId || document.buildId !== draft.draftRevision)
          throw new Error('analysis-draft-identity-mismatch')
      }
      if (document && !abort.signal.aborted)
        views.document(id, { generation, workspacePath }, target, document)
    })().catch(() => {
      if (!abort.signal.aborted) setFailedKey(target)
    })
    return () => abort.abort()
    // Only a content identity change starts IO; placement and reading updates never do.
  }, [
    target,
    generation,
    workspaceId,
    workspacePath,
    rpc,
    sessionId,
    id,
    views,
    settled,
    documentKey,
    saved,
    draft,
    baseId,
  ])
  const terminal = view.settled || candidate?.phase === 'failed' || candidate?.phase === 'cancelled'
  const document = view.document
  const streaming = Boolean(
    !saved &&
      candidate?.preview &&
      !terminal &&
      ['preparing', 'start'].includes(candidate.phase) &&
      (!baseId || view.documentKey === baseId) &&
      (!candidate.draftId || candidate.draftRevision === document?.buildId),
  )
  const program =
    streaming && candidate
      ? document
        ? streamingAnalysisProgram(document.program, candidate.program)
        : candidate.program
      : document?.program
  const resources =
    streaming && candidate ? candidateResources(document, candidate) : document?.resources
  const published = Boolean(saved && view.documentKey === saved.receipt.buildId)
  const failed = terminal || Boolean(target && failedKey === target)
  const progress =
    published || failed
      ? undefined
      : saved
        ? 'loading'
        : streaming || !draft
          ? 'generating'
          : 'draft'
  return (
    <section
      className="mv-ui"
      data-analysis-report={id}
      data-analysis-phase={published ? 'saved' : failed ? 'failed' : draft ? 'draft' : 'candidate'}
    >
      {failed && (
        <Alert role="alert" variant="destructive">
          <AlertDescription>{t('marivo.presentation.ui-failed')}</AlertDescription>
        </Alert>
      )}
      {!program && progress && <ReportMotion phase={progress} />}
      <ReportReading.Provider value={view.reading}>
        {program && (
          <ReportAnalysisSurface
            viewId={id}
            progress={progress}
            revision={documentKey}
            recordId={published ? document?.recordId : undefined}
            program={program}
            title={candidate?.title ?? document?.title ?? saved?.receipt.title ?? 'Analysis'}
            locale={candidate?.locale ?? document?.locale ?? 'zh-CN'}
            resources={resources ?? {}}
            candidate={!published}
            isStreaming={streaming}
            candidateProgram={streaming ? candidate?.program : undefined}
            {...(published ? actions : {})}
          />
        )}
      </ReportReading.Provider>
    </section>
  )
}
