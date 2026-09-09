import { type InputContextHost, inputEnd, ownedInput } from '../input-context.ts'
import { wrapPresentationContext } from './context-reference.ts'

export type AskDshHost = InputContextHost

/** Append through the Host's public draft path; never submit or serialize references. */
export function appendPresentationContext(
  host: AskDshHost,
  sessionId: string,
  workspaceId: string,
  context: string,
): void {
  let owner: ReturnType<typeof ownedInput>
  try {
    owner = ownedInput(host, sessionId, workspaceId)
  } catch {
    throw new Error('报告所属 Session 或 Workspace 已变化或不可用，请重新打开报告。')
  }
  const { actx, input } = owner
  const snapshot = input.state.getSnapshot()
  const wrapped = wrapPresentationContext(context, snapshot.draft ? '\n\n' : '')
  const applied = actx.bail(actx, 'slash/input-insert-text', {
    text: wrapped,
    span: inputEnd(snapshot),
  })
  if (applied !== true) throw new Error('会话草稿已变化或正在提交，请稍后重试。')
}
