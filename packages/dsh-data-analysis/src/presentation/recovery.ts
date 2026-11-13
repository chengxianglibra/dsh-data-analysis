import type { AnalysisProgramError } from './contracts/analysis-program.ts'

export type PresentationRecoveryCode =
  | 'analysis-draft-invalid-request'
  | 'analysis-draft-stage-required'
  | 'analysis-draft-unavailable'
  | 'analysis-draft-conflict'
  | 'analysis-draft-busy'
  | 'analysis-program-incomplete'
  | 'analysis-program-invalid-statement'
  | 'analysis-program-invalid'
  | 'analysis-program-deleted-reference'
  | 'analysis-program-root-deleted'
  | 'analysis-resource-missing'
  | 'analysis-resource-read-failed'
  | 'report-input-invalid'
  | 'report-mode-conflict'
  | 'report-refresh-saved-ref-required'
  | 'report-refresh-field-forbidden'
  | 'report-refresh-resource-unknown'
  | 'report-workspace-mismatch'
  | 'presentation-workspace-changed'
  | 'presentation-workspace-unavailable'
  | 'presentation-session-mismatch'
  | 'report-draft-version-forbidden'
  | 'report-saved-ref-required'
  | 'report-not-found'
  | 'report-build-not-found'
  | 'report-version-unsupported'
  | 'report-document-incompatible'
  | 'report-read-failed'
  | 'report-write-failed'
  | 'report-delete-failed'
  | 'report-delete-conflict'
  | 'report-catalog-too-large'
  | 'report-catalog-unavailable'
  | 'report-save-conflict'
  | 'report-history-full'

type Phase = 'report-write' | 'report-read' | 'report-delete' | 'report-list'
type RecoveryDetails = AnalysisProgramError['details'] & {
  currentRef?: string
  applied?: false
  resource?: string
}

export const savedReportRecoveryPrefix = 'Report save committed. Saved ref: '

export function savedReportRecovery(ref: string) {
  return `${savedReportRecoveryPrefix}${ref}\nUse this saved ref. If verification is needed, read it with marivo_report_read.`
}

export function reportSaveOutcomeUnknown(callId: string) {
  return `Save receipt unavailable. Check marivo_report_list({callId:${JSON.stringify(callId)}}) for the exact committed version before retrying.`
}

/** Repair facts survive Harness normalization to plain Tool error text. */
export class PresentationRecoveryError extends Error {
  readonly code: PresentationRecoveryCode
  readonly phase: Phase
  readonly recovery: RecoveryDetails & { nextAction: string }
  constructor(
    code: PresentationRecoveryCode,
    nextAction: string,
    details: RecoveryDetails = {},
    phase: Phase = 'report-write',
  ) {
    const recovery = { ...details, nextAction }
    super(`${code}; error=${JSON.stringify({ code, phase, recovery })}`)
    this.name = 'PresentationRecoveryError'
    this.code = code
    this.phase = phase
    this.recovery = recovery
  }
}

export function reportLookupFailure(error: unknown, phase: Phase, signal: AbortSignal): never {
  signal.throwIfAborted()
  if (error instanceof PresentationRecoveryError) throw error
  const code = error instanceof Error ? error.message : ''
  if (
    code === 'report-not-found' ||
    code === 'report-build-not-found' ||
    (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
  )
    throw new PresentationRecoveryError(
      code === 'report-not-found' ? code : 'report-build-not-found',
      'Use marivo_report_list to find the intended report. Use a different saved version only if it satisfies the request.',
      {},
      phase,
    )
  if (code === 'report-version-unsupported' || code === 'report-document-incompatible')
    throw new PresentationRecoveryError(
      code,
      'Open this exact Build with a compatible plugin. Preserve the saved version and its resources.',
      {},
      phase,
    )
  throw new PresentationRecoveryError(
    phase === 'report-delete' ? 'report-delete-failed' : 'report-read-failed',
    phase === 'report-delete'
      ? 'Check whether the report is still in the Workspace catalog. If cleanup is pending, retry the same ref after checking storage.'
      : 'Check saved report storage and access in this Workspace before retrying. Preserve existing results.',
    {},
    phase,
  )
}

export function workspaceMismatch(phase: Phase) {
  return new PresentationRecoveryError(
    'report-workspace-mismatch',
    'Open the report in its original Workspace or find the intended report in the current Workspace.',
    {},
    phase,
  )
}

export function workspaceChanged(phase: Phase) {
  return new PresentationRecoveryError(
    'presentation-workspace-changed',
    'Reopen the intended Workspace and confirm the report before retrying.',
    {},
    phase,
  )
}

export function workspaceUnavailable(phase: Phase) {
  return new PresentationRecoveryError(
    'presentation-workspace-unavailable',
    'Open the intended Harness Workspace and retry from a Session that belongs to it.',
    {},
    phase,
  )
}

export function unavailableDraft(phase: 'report-write' | 'report-read' = 'report-write') {
  return new PresentationRecoveryError(
    'analysis-draft-unavailable',
    'This draft is unavailable. Use marivo_report_list and marivo_report_read for a saved version. Rebuild an unsaved preview from retained definitions and fixed results.',
    {},
    phase,
  )
}
