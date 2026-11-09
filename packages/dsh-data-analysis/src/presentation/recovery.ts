/** Repair facts stay in the message because Harness normalizes Tool errors to text. */
export class PresentationRecoveryError extends Error {
  constructor(
    code:
      | 'analysis-draft-invalid-request'
      | 'analysis-draft-stage-required'
      | 'analysis-draft-unavailable'
      | 'analysis-draft-conflict'
      | 'analysis-draft-busy'
      | 'report-save-conflict',
    nextAction: string,
    identity: { currentRecordId?: string; draftId?: string; draftRevision?: string } = {},
  ) {
    super(`${code}; repair=${JSON.stringify({ ...identity, nextAction })}`)
    this.name = 'PresentationRecoveryError'
  }
}

export function unavailableDraft() {
  return new PresentationRecoveryError(
    'analysis-draft-unavailable',
    'Drafts exist only in their original Session Turn and Host process. Read the saved base with marivo_ui_read if available, then rebuild a preview from retained definitions and snapshotRefs. If these are missing, disclose the gap; do not replay analysis just to recover a draft.',
  )
}
