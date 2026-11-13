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
  | 'analysis-resource-missing'
  | 'report-save-conflict'
  | 'report-history-full'

type RecoveryDetails = AnalysisProgramError['details'] & {
  currentRef?: string
  applied?: false
  resource?: string
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
    'Drafts exist only in their original Session Turn and Host process and are cleared after saving. Use marivo_report_list to find saved reports, then marivo_report_read with a returned ref to confirm the target and recover its definition. Rebuild a preview from retained definitions and fixed resources. If these are missing, disclose the gap; do not replay analysis just to recover a draft.',
  )
}
