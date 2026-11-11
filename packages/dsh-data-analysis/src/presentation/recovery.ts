export type PresentationRecoveryCode =
  | 'analysis-draft-invalid-request'
  | 'analysis-draft-stage-required'
  | 'analysis-draft-unavailable'
  | 'analysis-draft-conflict'
  | 'analysis-draft-busy'
  | 'analysis-program-incomplete'
  | 'analysis-program-invalid-statement'
  | 'analysis-program-invalid'
  | 'analysis-resource-missing'
  | 'report-save-conflict'
  | 'report-history-full'

interface RecoveryDetails {
  currentRef?: string
  applied?: false
  line?: number
  column?: number
  resource?: string
  unresolved?: string[]
  detail?: string
}

/** Repair facts survive Harness normalization to plain Tool error text. */
export class PresentationRecoveryError extends Error {
  readonly code: PresentationRecoveryCode
  readonly phase = 'report-write'
  readonly recovery: RecoveryDetails & { nextAction: string }
  constructor(code: PresentationRecoveryCode, nextAction: string, details: RecoveryDetails = {}) {
    const recovery = { ...details, nextAction }
    super(`${code}; error=${JSON.stringify({ code, phase: 'report-write', recovery })}`)
    this.name = 'PresentationRecoveryError'
    this.code = code
    this.recovery = recovery
  }
}

export function unavailableDraft() {
  return new PresentationRecoveryError(
    'analysis-draft-unavailable',
    'Drafts exist only in their original Session Turn and Host process. Read an accessible saved ref, then rebuild a preview from retained definitions and fixed resources. If these are missing, disclose the gap; do not replay analysis just to recover a draft.',
  )
}
