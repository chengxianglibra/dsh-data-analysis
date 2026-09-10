import { type InputContextHost, inputEnd, ownedInput } from '../input-context.ts'
import type { PresentationContext } from './context-reference.ts'
import { presentationReference } from './reference-source.ts'

export type AskDshHost = InputContextHost

/** Append through the Host's public draft path; never submit or serialize references. */
export function appendPresentationContext(
  host: AskDshHost,
  sessionId: string,
  workspaceId: string,
  context: PresentationContext,
): void {
  let owner: ReturnType<typeof ownedInput>
  try {
    owner = ownedInput(host, sessionId, workspaceId)
  } catch {
    throw new Error('marivo.presentation.the-report-s-session-or-workspace-changed-or-is')
  }
  const { actx, input } = owner
  const snapshot = input.state.getSnapshot()
  const reference = presentationReference(sessionId, workspaceId, context, !!snapshot.draft)
  const applied = actx.bail(actx, 'slash/input-insert-reference', {
    reference,
    span: inputEnd(snapshot),
  })
  if (applied !== true)
    throw new Error('marivo.presentation.the-session-draft-changed-or-is-being-submitted-retry')
}
