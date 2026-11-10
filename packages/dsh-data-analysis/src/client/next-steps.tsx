import type { Context } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  ConnectionGeneration,
  ConnectionHandle,
} from '@deepseek-ai/dsh-client-connection/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { ArrowUpRightIcon } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { PendingTasks } from '../lifecycle.ts'
import type { NextStepsNotice } from '../next-steps/contracts.ts'
import { hostCopy } from './i18n/host.tsx'
import { NextStepsModel } from './next-steps-model.ts'
import { mountNotifications } from './notifications.ts'
import { Button } from './ui/controls.tsx'
import { UIStyleSheet } from './ui/theme.ts'

export function installNextSteps(ctx: Context) {
  const model = new NextStepsModel()
  const tasks = new PendingTasks()
  // The combined Host/browser build resolves Context.sessions to the Host face.
  const sessions = ctx.sessions as unknown as ISessions
  const connection = ctx.connection as unknown as ConnectionHandle
  const mounted = mountNotifications(ctx)
  type Owner = {
    sessionId: SessionId
    workspaceId: string
    path: string
    generation: ConnectionGeneration
  }
  let owner: Owner | undefined
  let stopFeed: (() => void) | undefined
  let stopSession: (() => void) | undefined
  let stopInput: (() => void) | undefined
  const inputFor = (value: Owner) => {
    const scope = sessions.scope(value.sessionId)
    return scope ? ctx.conversation.input.for(scope) : undefined
  }
  const available = () => {
    if (!owner || !connection.generation.getSnapshot()) return false
    const input = inputFor(owner)?.state.getSnapshot()
    const session = sessions.binding(owner.sessionId)?.session.getSnapshot()
    return Boolean(
      input &&
        session &&
        !session.running &&
        !session.removed &&
        !session.pendingSubmissions.length &&
        input.phase === 'plain' &&
        !input.draft &&
        !input.occurrences.length &&
        !input.attachmentIds.length &&
        !input.claim &&
        !input.queue.length,
    )
  }
  const updateOwner = () => {
    const generation = connection.generation.getSnapshot()
    const foreground = Object.values(sessions.list.getSnapshot().byId).filter(
      (row) => row.retainedBy.mainView,
    )
    const sessionId = foreground.length === 1 ? foreground[0]!.id : undefined
    const workspaces = ctx.workspaces.list.getSnapshot()
    const matches = sessionId
      ? workspaces.items.filter((w) => w.sessionIds.includes(sessionId))
      : []
    const workspace =
      workspaces.phase === 'ready' && workspaces.state !== 'error' && matches.length === 1
        ? matches[0]
        : undefined
    const next =
      sessionId && workspace && generation
        ? {
            sessionId,
            workspaceId: String(workspace.workspaceId),
            path: workspace.path,
            generation,
          }
        : undefined
    if (
      next?.sessionId === owner?.sessionId &&
      next?.workspaceId === owner?.workspaceId &&
      next?.path === owner?.path &&
      next?.generation === owner?.generation
    )
      return
    stopFeed?.()
    stopSession?.()
    stopInput?.()
    owner = next
    model.reset()
    if (!next) return
    const input = inputFor(next)
    stopInput = input?.state.subscribe(() => {
      if (input.state.getSnapshot().queue.length) model.clear()
      else model.touch()
    })
    const session = sessions.binding(next.sessionId)?.session
    let running = session?.getSnapshot().running
    stopSession = session?.subscribe(() => {
      const snapshot = session.getSnapshot()
      if (snapshot.pendingSubmissions.length || (!running && snapshot.running)) model.clear()
      else model.touch()
      running = snapshot.running
    })
    const lifetime = new AbortController()
    const stream = ctx.remote.$stream<NextStepsNotice>({
      name: 'dsh-data-analysis next steps',
      async *open(signal) {
        await mounted
        const combined = AbortSignal.any([signal, lifetime.signal])
        combined.throwIfAborted()
        let namespace: typeof ctx.remote.dshDataAnalysisNextSteps | undefined
        const consumer = ctx.inject(['remote.dshDataAnalysisNextSteps'], (scoped) => {
          namespace = scoped.remote.dshDataAnalysisNextSteps
        })
        const stop = () => {
          void consumer.dispose()
        }
        combined.addEventListener('abort', stop, { once: true })
        try {
          await consumer
          combined.throwIfAborted()
          if (!namespace) throw new Error('next-steps-stream-unavailable')
          yield* namespace.watch(next.sessionId, combined)
        } finally {
          combined.removeEventListener('abort', stop)
          await consumer.dispose()
        }
      },
      carrierFailed: () => model.clear(),
      ended: () => new Error('next-steps-stream-ended'),
    })
    stopFeed = () => {
      lifetime.abort()
      void tasks.track(stream.dispose()).catch(() => {})
    }
    void tasks.track(
      (async () => {
        try {
          for await (const item of stream) {
            if (lifetime.signal.aborted || item.signal.aborted || owner !== next) continue
            const binding = sessions.binding(next.sessionId)
            const snapshot = binding?.session.getSnapshot()
            const input = inputFor(next)?.state.getSnapshot()
            let turn = -1
            for (const entry of binding?.eventSource.getSnapshot().entries ?? []) {
              if (entry.type === 'event' && entry.event.type === 'turn/start')
                turn = Math.max(turn, entry.event.data.turn)
            }
            if (
              !snapshot ||
              snapshot.pendingSubmissions.length ||
              input?.queue.length ||
              item.value.turn !== turn
            )
              continue
            model.accept(item.value, next)
          }
        } catch {
          if (owner === next) model.clear()
        }
      })(),
    )
  }
  ctx.effect(() => {
    const stops = [
      sessions.list.subscribe(updateOwner),
      ctx.workspaces.list.subscribe(updateOwner),
      connection.generation.subscribe(updateOwner),
    ]
    updateOwner()
    return async () => {
      for (const stop of stops) stop()
      stopFeed?.()
      stopSession?.()
      stopInput?.()
      owner = undefined
      model.clear()
      await tasks.drain()
    }
  })
  const send = (prompt: string) => {
    const original = owner
    const notice = model.value
    updateOwner()
    if (!owner || owner !== original || model.value !== notice || !available()) return false
    const input = inputFor(owner)
    if (!input) return false
    try {
      input.setDraft(prompt)
      input.submit()
      return true
    } catch {
      input.notify('error', hostCopy(ctx)('marivo.presentation.ui-next-steps-failed'))
      return false
    }
  }
  function NextSteps({ sessionId, turn }: { sessionId: string; turn: number }) {
    useSyncExternalStore(model.subscribe, model.getSnapshot)
    const notice = model.value
    if (!notice || notice.sessionId !== sessionId || notice.turn !== turn) return null
    return (
      <div className="mv-ui mv-next-steps" data-next-steps-turn={turn}>
        <UIStyleSheet />
        {notice.items.map((item, index) => (
          <Button
            key={item.label}
            type="button"
            variant="outline"
            disabled={!available()}
            onFocus={(event) =>
              event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' })
            }
            onClick={() => model.submit(turn, index, send)}
          >
            {item.label}
            <ArrowUpRightIcon aria-hidden="true" />
          </Button>
        ))}
      </div>
    )
  }
  return { NextSteps, model }
}
