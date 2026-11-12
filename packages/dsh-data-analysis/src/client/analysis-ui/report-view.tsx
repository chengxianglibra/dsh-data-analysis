import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  type AnalysisDocument,
  parseAnalysisDocument,
  parseAnalysisRecordId,
} from '../../presentation/contracts/analysis-document.ts'
import { parseReportHistory } from '../../presentation/contracts/catalog.ts'
import { parseResourceStream } from '../../presentation/contracts/resource-stream.ts'
import { useCopy } from '../i18n/context.tsx'
import type { PresentationRpc } from '../presentation/delivery-model.ts'
import { Alert, AlertDescription } from '../ui/primitives/alert.tsx'
import { candidateResources } from './candidate.ts'
import { isIncompatibleReport, readSavedAnalysis } from './candidate-view.tsx'
import type { AnalysisResourceContext } from './context.tsx'
import { ReportAnalysisSurface } from './lazy-surface.tsx'
import { ReportReading } from './reading-state.tsx'
import { ReportMotion } from './report-motion.tsx'
import { type ReportViewState, type ReportViews, reportContentKey } from './report-views.ts'
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
  const [readFailure, setReadFailure] = useState<{ key: string; incompatible: boolean }>()
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
  const editing = Boolean(saved && candidate)
  const pendingSavedBase = Boolean(
    candidate?.basedOnRecordId && ['preparing', 'start'].includes(candidate.phase),
  )
  const baseId =
    candidate?.rebaseOnRecordId ??
    (pendingSavedBase || !draft ? candidate?.basedOnRecordId : undefined)
  const target = reportContentKey(view)
  const callId = candidate?.callId
  const executing = candidate?.phase === 'start' && !settled && (!saved || editing)
  useEffect(() => {
    if (!executing || !callId) return
    const abort = new AbortController()
    void (async () => {
      const stream = views.get(id)?.resourceStream
      let after = stream?.callId === callId ? stream.revision : 0
      while (!abort.signal.aborted) {
        const response = await rpc.call(
          '/marivo-presentation',
          'resource-stream/read',
          { sessionId, workspaceId, turn: view.turn, callId, after },
          abort.signal,
        )
        if (
          !response ||
          typeof response !== 'object' ||
          !('ok' in response) ||
          response.ok !== true ||
          !('value' in response)
        )
          return
        const value = parseResourceStream(response.value)
        if (
          abort.signal.aborted ||
          value.sessionId !== sessionId ||
          value.workspaceId !== workspaceId ||
          value.turn !== view.turn ||
          value.callId !== callId ||
          value.revision < after
        )
          return
        views.resources(id, { generation, workspacePath }, value)
        after = value.revision
        if (value.status === 'complete' || value.status === 'failed') return
      }
    })().catch(() => {
      /* The final delivery remains authoritative when the transient stream is unavailable. */
    })
    return () => abort.abort()
  }, [
    executing,
    callId,
    sessionId,
    workspaceId,
    view.turn,
    generation,
    workspacePath,
    rpc,
    views,
    id,
  ])
  useEffect(() => {
    if (!target || documentKey === target || (settled && !saved)) return
    const abort = new AbortController()
    void (async () => {
      let document: AnalysisDocument | undefined
      if (saved && (!editing || target === saved.receipt.buildId))
        document = await readSavedAnalysis(rpc, sessionId, saved.receipt, abort.signal)
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
    })().catch((error: unknown) => {
      if (!abort.signal.aborted)
        setReadFailure({ key: target, incompatible: isIncompatibleReport(error) })
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
    editing,
    draft,
    baseId,
  ])
  const stream = view.resourceStream?.callId === callId ? view.resourceStream : undefined
  const terminal =
    view.settled ||
    candidate?.phase === 'failed' ||
    candidate?.phase === 'cancelled' ||
    stream?.status === 'failed'
  const document = view.document
  const streaming = Boolean(
    (!saved || editing) &&
      candidate?.preview &&
      !terminal &&
      ['preparing', 'start'].includes(candidate.phase) &&
      (!baseId || view.documentKey === baseId || view.document?.recordId === baseId) &&
      (!candidate.draftId || candidate.draftRevision === document?.buildId),
  )
  const nextProgram =
    streaming && candidate
      ? streamingAnalysisProgram(
          document?.program,
          candidate.program,
          !candidate.complete,
          candidate.resourcePatchInput === 'incomplete',
        )
      : document?.program
  const nextResources =
    streaming && candidate
      ? candidateResources(document, candidate, stream?.resources)
      : document?.resources
  const previous = useRef<{
    reading: ReportViewState['reading']
    program: string
    resources: AnalysisDocument['resources']
    title: string
    locale: AnalysisDocument['locale']
  }>()
  const retained = previous.current?.reading === view.reading ? previous.current : undefined
  // A receipt starts an asynchronous read; it must not revert or unmount the
  // already visible candidate while that read is in flight.
  const waiting = Boolean(target && documentKey !== target && !streaming)
  const content =
    waiting && retained
      ? retained
      : nextProgram
        ? {
            reading: view.reading,
            program: nextProgram,
            resources: nextResources ?? {},
            title:
              (streaming ? candidate?.title : undefined) ??
              document?.title ??
              saved?.receipt.title ??
              'Analysis',
            locale: (streaming ? candidate?.locale : undefined) ?? document?.locale ?? 'zh-CN',
          }
        : retained
  useLayoutEffect(() => {
    if (content) previous.current = content
  })
  const published = Boolean(
    saved &&
      view.document?.buildId === saved.receipt.buildId &&
      (!candidate || (terminal && !draft)),
  )
  const failed = candidate?.phase === 'failed' || stream?.status === 'failed'
  const readFailed = Boolean(target && readFailure?.key === target)
  const progress =
    published || failed || readFailed || settled
      ? undefined
      : saved && !editing
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
      {(failed || readFailed) && (
        <Alert role="alert" variant="destructive">
          <AlertDescription>
            {t(
              readFailed
                ? readFailure?.incompatible
                  ? 'marivo.presentation.incompatible-report'
                  : 'marivo.presentation.ui-read-failed'
                : 'marivo.presentation.ui-update-failed',
            )}
          </AlertDescription>
        </Alert>
      )}
      {!content && progress && <ReportMotion phase={progress} />}
      <ReportReading.Provider value={view.reading}>
        {content && (
          <ReportAnalysisSurface
            viewId={id}
            progress={progress}
            recordId={published ? document?.recordId : undefined}
            program={content.program}
            title={content.title}
            locale={content.locale}
            resources={content.resources}
            candidate={!published}
            isStreaming={streaming}
            candidateProgram={streaming ? candidate?.program : undefined}
            removedResourceNames={streaming ? candidate?.resourcePatch?.remove : undefined}
            {...(published ? actions : {})}
          />
        )}
      </ReportReading.Provider>
    </section>
  )
}
