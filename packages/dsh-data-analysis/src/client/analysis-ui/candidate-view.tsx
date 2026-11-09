import type { ConnectionGeneration } from '@deepseek-ai/dsh-client-connection/client'
import { useEffect, useMemo, useState } from 'react'
import {
  type AnalysisDocument,
  parseAnalysisRecordId,
  parseSavedPresentation,
  sameAnalysisDeclaration,
} from '../../presentation/contracts/analysis-document.ts'
import { parseReportHistory } from '../../presentation/contracts/catalog.ts'
import type { PresentationReceipt } from '../../presentation/contracts/types.ts'
import type { PythonCodeRef, PythonExecutionDatasource } from '../../python-execution-contracts.ts'
import { useCopy } from '../i18n/context.tsx'
import { type PresentationRpc, verifyPresentationAsset } from '../presentation/delivery-model.ts'
import { Alert, AlertDescription } from '../ui/primitives/alert.tsx'
import { UIStyleSheet } from '../ui/theme.ts'
import type { AnalysisCandidate } from './candidate.ts'
import { CandidateAnalysisSurface, SavedAnalysisSurface } from './lazy-surface.tsx'
import { streamingAnalysisProgram } from './streaming-program.ts'

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
      typeof (value as { text?: unknown }).text !== 'string' ||
      typeof (value as { sha256?: unknown }).sha256 !== 'string'
    )
      throw new Error('analysis-ui-read-failed')
    const rawDatasources = (value as { datasources?: unknown }).datasources
    if (rawDatasources !== undefined) {
      if (
        !Array.isArray(rawDatasources) ||
        rawDatasources.length > 16 ||
        rawDatasources.some(
          (item) =>
            !item ||
            typeof item !== 'object' ||
            Object.keys(item).sort().join(',') !== 'backend,name' ||
            typeof (item as { name?: unknown }).name !== 'string' ||
            !(item as { name: string }).name ||
            !(
              (item as { backend?: unknown }).backend === null ||
              (typeof (item as { backend?: unknown }).backend === 'string' &&
                (item as { backend: string }).backend.length > 0)
            ),
        )
      )
        throw new Error('analysis-ui-read-failed')
    }
    return {
      text: (value as { text: string }).text,
      sha256: (value as { sha256: string }).sha256,
      ...(rawDatasources ? { datasources: rawDatasources as PythonExecutionDatasource[] } : {}),
    }
  }
}
export function CandidateView({
  candidate,
  rpc,
  fallbackDocument,
}: {
  candidate: AnalysisCandidate
  rpc: PresentationRpc
  fallbackDocument?: AnalysisDocument
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
  const retained = terminal ? (fallbackDocument ?? document) : (document ?? fallbackDocument)
  const preview = useMemo(() => {
    if (!candidate.preview || terminal) return undefined
    if (!document) return basedOnRecordId ? undefined : candidate.program
    return streamingAnalysisProgram(document.program, candidate.program)
  }, [candidate.preview, candidate.program, document, basedOnRecordId, terminal])
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
    <section
      className="mv-ui"
      data-analysis-candidate={candidate.callId}
      data-analysis-phase={candidate.phase}
    >
      <UIStyleSheet />
      <Alert
        role={terminal || failed ? 'alert' : 'status'}
        variant={terminal || failed ? 'destructive' : 'default'}
      >
        <AlertDescription>
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
        </AlertDescription>
      </Alert>
      {preview ? (
        <CandidateAnalysisSurface
          program={preview}
          title={candidate.title ?? document?.title ?? 'Analysis'}
          locale={candidate.locale ?? document?.locale ?? 'zh-CN'}
          resources={resources}
          isStreaming={!candidate.complete}
        />
      ) : retained ? (
        <SavedAnalysisSurface document={retained} />
      ) : null}
    </section>
  )
}
