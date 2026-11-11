import type { Context } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {
  ClientConnectionRpc,
  ConnectionHandle,
} from '@deepseek-ai/dsh-client-connection/client'
import type { IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { AnalysisDocument } from '../../presentation/contracts/analysis-document.ts'
import { parseReportRef } from '../../presentation/contracts/report-ref.ts'
import { MARIVO_PRESENTATION_RPC_CHANNEL } from '../../presentation/receipt.ts'

type RefreshHost = Pick<Context, 'effect'> & {
  sessions: ISessions
  workspaces: IWorkspaces
  connection: ConnectionHandle
  conversation: IConversation
}
type Lock = {
  accepted: boolean
  sawBusy: boolean
  stop?: () => void
  baselineTurn: number
  generation: ReturnType<ConnectionHandle['generation']['getSnapshot']>
  scope: ReturnType<ISessions['scope']>
}
type RefreshResult = 'accepted' | 'stale' | 'unavailable' | 'failed' | 'uncertain'

/** Session-scoped report refresh admission, shared by all tab occurrences. */
export function createReportRefresh(ctx: RefreshHost, rpc: ClientConnectionRpc) {
  let disposed = false
  const refreshLocks = new Map<SessionId, Lock>()
  const refreshListeners = new Set<() => void>()
  let refreshRevision = 0
  const refreshStore = {
    subscribe: (listener: () => void) => {
      refreshListeners.add(listener)
      return () => refreshListeners.delete(listener)
    },
    getSnapshot: () => refreshRevision,
    changed: () => {
      refreshRevision++
      for (const listener of refreshListeners) listener()
    },
  }
  const releaseRefresh = (sessionId: SessionId, lock: Lock) => {
    if (refreshLocks.get(sessionId) !== lock) return
    lock.stop?.()
    refreshLocks.delete(sessionId)
    refreshStore.changed()
  }
  const refreshReport = async (
    page: { sessionId: SessionId; target: { workspaceId: string } },
    tab: { signal: AbortSignal },
    report: AnalysisDocument,
    isCurrent: () => boolean,
  ): Promise<RefreshResult> => {
    const sessionId = page.sessionId
    const workspaceId = page.target.workspaceId
    if (disposed || refreshLocks.has(sessionId)) return 'unavailable'
    const lock: Lock = {
      accepted: false,
      sawBusy: false,
      stop: undefined,
      baselineTurn: -1,
      generation: undefined,
      scope: undefined,
    }
    refreshLocks.set(sessionId, lock)
    refreshStore.changed()
    const generation = ctx.connection.generation.getSnapshot()
    const workspaces = ctx.workspaces.list.getSnapshot()
    const owners = workspaces.items.filter((item) => item.sessionIds.includes(sessionId))
    const path = owners.length === 1 ? owners[0]?.path : undefined
    const scope = ctx.sessions.scope(sessionId)
    lock.generation = generation
    lock.scope = scope
    const binding = ctx.sessions.binding(sessionId)
    const valid = () => {
      const state = ctx.workspaces.list.getSnapshot()
      const currentOwners = state.items.filter((item) => item.sessionIds.includes(sessionId))
      const session = binding?.session.getSnapshot()
      const input = scope && ctx.conversation.input.for(scope).state.getSnapshot()
      return Boolean(
        !disposed &&
          refreshLocks.get(sessionId) === lock &&
          generation &&
          ctx.connection.generation.getSnapshot() === generation &&
          !tab.signal.aborted &&
          isCurrent() &&
          state.phase === 'ready' &&
          state.state !== 'error' &&
          currentOwners.length === 1 &&
          currentOwners[0]?.workspaceId === workspaceId &&
          currentOwners[0]?.path === path &&
          path &&
          ctx.sessions.list.getSnapshot().byId[sessionId]?.retainedBy.mainView &&
          ctx.sessions.scope(sessionId) === scope &&
          ctx.sessions.binding(sessionId) === binding &&
          session &&
          !session.removed &&
          !session.running &&
          !session.pendingSubmissions.length &&
          input &&
          input.phase === 'plain' &&
          !input.queue.length,
      )
    }
    const watch = () => {
      const session = binding?.session.getSnapshot()
      if (!binding || !session || session.removed) {
        releaseRefresh(sessionId, lock)
        return
      }
      if (session.running || session.pendingSubmissions.length) lock.sawBusy = true
      const ended = binding.eventSource
        .getSnapshot()
        .entries.some(
          (entry) =>
            entry.type === 'event' &&
            entry.event.type === 'turn/end' &&
            entry.event.data.turn > lock.baselineTurn,
        )
      if (
        lock.accepted &&
        (ended || (lock.sawBusy && !session.running && !session.pendingSubmissions.length))
      )
        releaseRefresh(sessionId, lock)
    }
    let sending = false
    try {
      if (!binding || !scope || !valid()) return 'unavailable'
      const stopSession = binding.session.subscribe(watch)
      const stopEvents = binding.eventSource.subscribe(watch)
      lock.stop = () => {
        stopSession()
        stopEvents()
      }
      const result = await rpc.call(
        MARIVO_PRESENTATION_RPC_CHANNEL,
        'report/refresh-prepare',
        { sessionId, workspaceId, recordId: report.recordId },
        tab.signal,
      )
      if (!result.ok) return result.error?.message === 'report-not-current' ? 'stale' : 'failed'
      const ref =
        result.value && typeof result.value === 'object'
          ? Reflect.get(result.value, 'ref')
          : undefined
      const parsed = parseReportRef(ref)
      if (
        parsed.kind !== 'saved' ||
        parsed.workspaceId !== workspaceId ||
        parsed.reportId !== report.reportId ||
        parsed.buildId !== report.buildId
      )
        return 'failed'
      if (!valid()) return 'unavailable'
      const prompt =
        report.locale === 'en-US'
          ? `Please update all existing data resources in this report:\n${ref}\n\nFirst read the current report and verify its exact ref still matches the ref above. If the version has changed, stop and tell me. Review available sources, original inputs, and calculation definitions. Recalculate and save using the report data refresh workflow, preserving layout, components, text, title, and labels, including shared resource aliases that need to be updated together. Explain anything that cannot be safely recalculated; do not guess sources or change definitions. Report which resources were updated, reused, or left unchanged, and whether static narrative needs review.`
          : `请更新这份报告的全部现有数据资源：\n${ref}\n\n请先读取并核对当前报告的准确引用仍与以上引用一致；如果版本已变化，请停止并告知我。审阅可用来源，核对原始输入和计算口径，使用报告数据更新流程重新计算并保存，保持布局、组件、正文、标题和标签，包括需要一起更新的共享资源别名。无法安全重算的部分请明确说明，不要猜测来源或改变口径。完成后请说明哪些资源已更新、复用或尚未更新，以及静态正文是否需要复核。`
      lock.sawBusy = false
      lock.baselineTurn = binding.eventSource
        .getSnapshot()
        .entries.reduce(
          (turn, entry) =>
            entry.type === 'event' && entry.event.type === 'turn/start'
              ? Math.max(turn, entry.event.data.turn)
              : turn,
          -1,
        )
      sending = true
      const submitted = await binding.session.prompt([{ type: 'text', text: prompt }], 'queue')
      if (!submitted.ok) return 'uncertain'
      lock.accepted = true
      watch()
      return 'accepted'
    } catch {
      return sending ? 'uncertain' : 'failed'
    } finally {
      if (!lock.accepted) releaseRefresh(sessionId, lock)
    }
  }
  ctx.effect(() => {
    const ownerChanged = () => {
      for (const [sessionId, lock] of refreshLocks) {
        if (
          ctx.connection.generation.getSnapshot() !== lock.generation ||
          ctx.sessions.scope(sessionId) !== lock.scope
        )
          releaseRefresh(sessionId, lock)
      }
    }
    const stops = [
      ctx.connection.generation.subscribe(ownerChanged),
      ctx.sessions.list.subscribe(ownerChanged),
    ]
    return () => {
      disposed = true
      for (const stop of stops) stop()
      for (const [sessionId, lock] of refreshLocks) releaseRefresh(sessionId, lock)
    }
  })
  return { refreshLocks, refreshStore, refreshReport }
}
