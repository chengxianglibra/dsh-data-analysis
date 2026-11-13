import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {
  IConversation,
  InputState,
  ReferenceInsert,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

export interface InputContextHost {
  sessions: Pick<ISessions, 'list' | 'scope'>
  workspaces: Pick<IWorkspaces, 'list'>
  conversation: Pick<IConversation, 'input'>
}

function ownedInput(host: InputContextHost, sessionId: string, workspaceId: string) {
  const workspaces = host.workspaces.list.getSnapshot()
  const owners = workspaces.items.filter((item) => item.sessionIds.includes(sessionId as SessionId))
  if (
    !sessionId ||
    !workspaceId ||
    !host.sessions.list.getSnapshot().byId[sessionId as SessionId]?.retainedBy.mainView ||
    workspaces.phase !== 'ready' ||
    workspaces.state === 'error' ||
    owners.length !== 1 ||
    owners[0]!.workspaceId !== workspaceId
  )
    throw new Error('input-owner-unavailable')
  const actx = host.sessions.scope(sessionId as SessionId)
  if (!actx) throw new Error('input-owner-unavailable')
  return { actx, input: host.conversation.input.for(actx), workspace: owners[0]! }
}

/** Host detect coordinates count each atomic reference as one character. */
function inputEnd({
  claim,
  draft,
  draftRev,
  occurrences,
}: Pick<InputState, 'claim' | 'draft' | 'draftRev' | 'occurrences'>) {
  const commandExpansion = claim ? claim.token.trimEnd().length - 1 : 0
  const end = occurrences.reduce(
    (length, item) => length - item.length + 1,
    draft.length - commandExpansion,
  )
  return { start: end, end, draftRev }
}

/** Keep the owning draft alive while a reference is prepared for one native insertion. */
export async function withInputReferenceInsertion(
  host: InputContextHost,
  { sessionId, workspaceId }: { sessionId: string; workspaceId: string },
  lifetime: AbortSignal,
  prepare: (signal: AbortSignal, insert: (reference: ReferenceInsert) => void) => Promise<void>,
): Promise<void> {
  const controller = new AbortController()
  const signal = AbortSignal.any([lifetime, controller.signal])
  signal.throwIfAborted()
  const initial = ownedInput(host, sessionId, workspaceId)
  let previous = initial.input.state.getSnapshot()
  const checkDraft = (current: InputState) => {
    if (current.phase !== 'plain' && current.phase !== 'claimed')
      throw new Error('input-unavailable')
    // Harness can send optimistically while phase stays plain. A reset also ends the edit.
    if (
      (previous.draft.length > 0 || previous.attachmentIds.length > 0) &&
      current.draft.length === 0 &&
      current.attachmentIds.length === 0
    )
      throw new Error('input-reset')
    previous = current
  }
  checkDraft(previous)
  const checkOwner = () => {
    const current = ownedInput(host, sessionId, workspaceId)
    if (current.actx !== initial.actx || current.workspace.path !== initial.workspace.path)
      throw new Error('input-owner-changed')
    return current
  }
  const changed = () => {
    try {
      checkOwner()
      checkDraft(initial.input.state.getSnapshot())
    } catch {
      controller.abort()
    }
  }
  const stops = [
    host.sessions.list.subscribe(changed),
    host.workspaces.list.subscribe(changed),
    initial.input.state.subscribe(changed),
  ]
  try {
    await prepare(signal, (reference) => {
      signal.throwIfAborted()
      const { actx, input } = checkOwner()
      const snapshot = input.state.getSnapshot()
      checkDraft(snapshot)
      const applied = actx.bail(actx, 'slash/input-insert-reference', {
        reference,
        span: inputEnd(snapshot),
      })
      if (applied !== true) throw new Error('input-unavailable')
    })
  } finally {
    for (const stop of stops) stop()
  }
}

/** Focus only while the original session still owns the visible input. */
export function focusOwnedInput(
  host: InputContextHost,
  owner: { sessionId: string; workspaceId: string },
  lifetime: AbortSignal,
): void {
  if (lifetime.aborted) return
  try {
    ownedInput(host, owner.sessionId, owner.workspaceId).input.focus()
  } catch {
    // The input may disappear after insertion, e.g. while switching sessions.
  }
}
