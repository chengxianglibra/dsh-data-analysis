import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { IConversation, InputState } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

export interface InputContextHost {
  sessions: Pick<ISessions, 'list' | 'scope'>
  workspaces: Pick<IWorkspaces, 'list'>
  conversation: Pick<IConversation, 'input'>
}

export function ownedInput(host: InputContextHost, sessionId: string, workspaceId: string) {
  const workspaces = host.workspaces.list.getSnapshot()
  const owners = workspaces.items.filter((item) => item.sessionIds.includes(sessionId as SessionId))
  if (
    !sessionId ||
    !workspaceId ||
    host.sessions.list.getSnapshot().current !== sessionId ||
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
export function inputEnd({
  draft,
  draftRev,
  occurrences,
}: Pick<InputState, 'draft' | 'draftRev' | 'occurrences'>) {
  const end = occurrences.reduce((length, item) => length - item.length + 1, draft.length)
  return { start: end, end, draftRev }
}
