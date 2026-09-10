export interface CredentialDraft {
  id: string
  field: string
  key?: string
  value: string
  existing?: string
  reference?: string
}

export function credentialReference(name: string, draft: CredentialDraft): string {
  if (draft.reference !== undefined) return draft.reference.trim()
  if (!draft.value) return draft.existing ?? ''
  const part = (value: string) =>
    value
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, '_')
      .slice(0, 40)
  return `DS_${part(name) || 'CONNECTION'}_${part(draft.key ?? draft.field.replace(/_env$/, ''))}_${draft.id.replace(/-/g, '').toUpperCase()}`
}

/** Values are kept separate from the public configuration, then handed to the credential operation. */
export function prepareCredentials(name: string, drafts: CredentialDraft[]) {
  const fields: Record<string, string | Record<string, string>> = {}
  const changes: Record<string, string> = Object.create(null)
  for (const draft of drafts) {
    const ref = credentialReference(name, draft)
    if (!ref && !draft.value) continue
    if (
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(ref) ||
      ref.length > 256 ||
      /^(MARIVO_|DSH_DATA_ANALYSIS_|DSH_HOME$|DSH_SESSION_ID$|DSH_SESSION_JSONL$|DSH_SHELL$)/i.test(
        ref,
      )
    )
      throw new Error(
        'marivo.credentials.credential-references-may-contain-only-letters-numbers-and-underscores',
      )
    if (draft.key !== undefined) {
      if (!draft.key.trim())
        throw new Error('marivo.credentials.enter-the-header-name-for-this-credential')
      fields[draft.field] ??= Object.create(null)
      const mapping = fields[draft.field] as Record<string, string>
      if (Object.hasOwn(mapping, draft.key))
        throw new Error('marivo.credentials.header-names-must-be-unique')
      mapping[draft.key] = ref
    } else fields[draft.field] = ref
    if (draft.value) {
      if (changes[ref] !== undefined && changes[ref] !== draft.value)
        throw new Error(
          'marivo.credentials.the-same-credential-reference-cannot-have-different-values',
        )
      changes[ref] = draft.value
    }
  }
  return { fields, changes }
}
