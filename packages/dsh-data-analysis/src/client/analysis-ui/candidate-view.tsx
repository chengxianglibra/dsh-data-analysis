import type { ConnectionGeneration } from '@deepseek-ai/dsh-client-connection/client'
import { useEffect, useMemo, useState } from 'react'
import {
  type AnalysisDocument,
  parseAnalysisRecordId,
  parseSavedPresentation,
  sameAnalysisDeclaration,
} from '../../presentation/contracts/analysis-document.ts'
import {
  mergeAnalysisProgram,
  parseAnalysisProgram,
} from '../../presentation/contracts/analysis-program.ts'
import { parseReportHistory } from '../../presentation/contracts/catalog.ts'
import type { PresentationReceipt } from '../../presentation/contracts/types.ts'
import type { PythonCodeRef } from '../../python-execution-contracts.ts'
import { useCopy } from '../i18n/context.tsx'
import { type PresentationRpc, verifyPresentationAsset } from '../presentation/delivery-model.ts'
import type { AnalysisCandidate } from './candidate.ts'
import { CandidateAnalysisSurface, SavedAnalysisSurface } from './lazy-surface.tsx'

function responseValue(response: unknown): unknown {
  if (
    !response ||
    typeof response !== 'object' ||
    !('ok' in response) ||
    response.ok !== true ||
    !('value' in response)
  )
    throw new Error('analysis-ui-read-failed')
  return response.value
}
export async function readSavedAnalysis(
  rpc: PresentationRpc,
  sessionId: string,
  receipt: PresentationReceipt,
  signal: AbortSignal,
) {
  const bytes = await verifyPresentationAsset(
    responseValue(
      await rpc.call(
        '/marivo-presentation',
        'files/read',
        { sessionId, receipt, asset: 'presentation.json' },
        signal,
      ),
    ),
    receipt,
  )
  const document = parseSavedPresentation(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
  )
  if (
    document.workspaceId !== receipt.workspaceId ||
    document.reportId !== receipt.reportId ||
    document.buildId !== receipt.buildId ||
    document.title !== receipt.title
  )
    throw new Error('analysis-ui-owner-mismatch')
  return document
}
/**
 * Host reads Python source only for a codeRef bound to the exact saved receipt document.
 * Resolves undefined when the execution record is missing or no longer readable.
 */
export function savedCodeReader(
  rpc: PresentationRpc,
  scope: { sessionId: string } | { workspaceId: string },
  receipt: PresentationReceipt,
) {
  return async (codeRef: PythonCodeRef, signal: AbortSignal) => {
    const response = await rpc.call(
      '/marivo-presentation',
      'code/read',
      { ...scope, receipt, codeRef: { executionId: codeRef.executionId, sha256: codeRef.sha256 } },
      signal,
    )
    if (
      response &&
      typeof response === 'object' &&
      'ok' in response &&
      response.ok === false &&
      'error' in response &&
      (response.error as { message?: unknown })?.message === 'code-unavailable'
    )
      return undefined
    const value = responseValue(response)
    if (
      !value ||
      typeof value !== 'object' ||
      typeof (value as { text?: unknown }).text !== 'string'
    )
      throw new Error('analysis-ui-read-failed')
    return { text: (value as { text: string }).text }
  }
}
export function CandidateView({
  candidate,
  rpc,
}: {
  candidate: AnalysisCandidate
  rpc: PresentationRpc
}) {
  const t = useCopy()
  const [base, setBase] = useState<{
    recordId: string
    document: AnalysisDocument
    generation: ConnectionGeneration
  }>()
  const [failed, setFailed] = useState(false)
  const { basedOnRecordId, sessionId, workspaceId, generation } = candidate
  useEffect(() => {
    setBase(undefined)
    setFailed(false)
    if (!basedOnRecordId) return
    const abort = new AbortController()
    void (async () => {
      const { reportId, buildId } = parseAnalysisRecordId(basedOnRecordId)
      const history = parseReportHistory(
        responseValue(
          await rpc.call(
            '/marivo-presentation',
            'reports/history',
            { sessionId, reportId },
            abort.signal,
          ),
        ),
      )
      if (history.workspaceId !== workspaceId) throw new Error('analysis-ui-owner-mismatch')
      const receipt = history.versions.find((v) => v.receipt.buildId === buildId)?.receipt
      if (!receipt) throw new Error('report-build-not-found')
      const document = await readSavedAnalysis(rpc, sessionId, receipt, abort.signal)
      if (!abort.signal.aborted) setBase({ recordId: basedOnRecordId, document, generation })
    })().catch(() => {
      if (!abort.signal.aborted) setFailed(true)
    })
    return () => abort.abort()
  }, [basedOnRecordId, sessionId, workspaceId, generation, rpc])
  const document =
    base && base.recordId === basedOnRecordId && base.generation === generation
      ? base.document
      : undefined
  const terminal = candidate.phase === 'failed' || candidate.phase === 'cancelled'
  const preview = useMemo(() => {
    if (!candidate.preview || terminal) return undefined
    if (!document) return basedOnRecordId ? undefined : candidate.program
    if (!candidate.complete) return undefined
    try {
      const merged = candidate.program
        ? mergeAnalysisProgram(document.program, candidate.program)
        : document.program
      parseAnalysisProgram(merged)
      return merged
    } catch {
      return undefined
    }
  }, [
    candidate.preview,
    candidate.program,
    candidate.complete,
    document,
    basedOnRecordId,
    terminal,
  ])
  const resources = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(document?.resources ?? {}).filter(
          ([name, resource]) =>
            candidate.resources === undefined ||
            (candidate.resources[name] &&
              sameAnalysisDeclaration(resource.declaration, candidate.resources[name]!)),
        ),
      ),
    [document, candidate.resources],
  )
  return (
    <section data-analysis-candidate={candidate.callId} data-analysis-phase={candidate.phase}>
      <p role={terminal || failed ? 'alert' : 'status'}>
        {t(
          terminal
            ? 'marivo.presentation.ui-failed'
            : failed
              ? 'marivo.presentation.ui-read-failed'
              : !candidate.surface
                ? 'marivo.presentation.ui-preparing'
                : candidate.phase === 'start'
                  ? 'marivo.presentation.ui-saving'
                  : 'marivo.presentation.ui-generating',
        )}
      </p>
      {preview ? (
        <CandidateAnalysisSurface
          program={preview}
          title={candidate.title ?? document?.title ?? 'Analysis'}
          locale={candidate.locale ?? document?.locale ?? 'zh-CN'}
          resources={resources}
          isStreaming={!candidate.complete}
        />
      ) : document ? (
        <SavedAnalysisSurface document={document} />
      ) : null}
    </section>
  )
}
