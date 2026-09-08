import type { ISessions, IWorkspaces, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'

export interface AskDshHost {
  sessions: Pick<ISessions, 'list' | 'scope'>
  workspaces: Pick<IWorkspaces, 'list'>
  conversation: Pick<IConversation, 'input'>
}

/** Append through the Host's public draft path; never submit or serialize references. */
export function appendPresentationContext(
  host: AskDshHost,
  sessionId: string,
  workspaceId: string,
  context: string,
): void {
  const sessions = host.sessions.list.getSnapshot()
  const workspaces = host.workspaces.list.getSnapshot()
  if (
    !sessionId ||
    !workspaceId ||
    sessions.current !== sessionId ||
    workspaces.phase !== 'ready' ||
    workspaces.state === 'error' ||
    !workspaces.items.some(
      (workspace) =>
        workspace.workspaceId === workspaceId &&
        workspace.sessionIds.includes(sessionId as SessionId),
    )
  )
    throw new Error('报告所属 Session 或 Workspace 已变化或不可用，请重新打开报告。')
  const actx = host.sessions.scope(sessionId as SessionId)
  if (!actx) throw new Error('报告所属会话已不可用，请重新打开报告。')
  const input = host.conversation.input.for(actx)
  const draft = input.state.getSnapshot().draft
  const wrapped = `【报告上下文】\n${context}\n【报告上下文结束】`
  input.setDraft(draft ? `${draft}\n\n${wrapped}` : wrapped)
}
