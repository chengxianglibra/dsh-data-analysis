import type { Context } from '@deepseek-ai/cordis'
import type { RemoteStreamItem } from '@deepseek-ai/dsh-api-gateway/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import {
  type CredentialRevision,
  credentialChangesRemote,
} from '../../datasource/changes-contract.ts'

export type CredentialChangeFeed = AsyncIterable<RemoteStreamItem<CredentialRevision>> & {
  dispose(): Promise<void>
}
export type CredentialChanges = (sessionId: string) => CredentialChangeFeed

/** Mount before opening a logical stream, using the existing Gateway WebSocket. */
export function credentialChanges(ctx: Context): CredentialChanges {
  const mounted = ctx.remote.$mount(credentialChangesRemote)
  // Initialization may be withdrawn before a Session starts consuming the mount.
  void mounted.catch(() => {})
  ctx.effect(() => async () => (await mounted)())
  // Host and browser Context augmentations share this build; use the browser contract here.
  const connection = ctx.connection as unknown as ConnectionHandle
  return (sessionId): CredentialChangeFeed => {
    let snapshot: AbortController | undefined
    const stopConnection = connection.generation.subscribe(() => {
      if (!connection.generation.getSnapshot()) snapshot?.abort()
    })
    const stream = ctx.remote.$stream<CredentialRevision>({
      name: 'dsh-data-analysis credential changes',
      async *open(signal) {
        const current = new AbortController()
        snapshot = current
        try {
          await mounted
          signal.throwIfAborted()
          // A dynamically mounted namespace needs its own declared Cordis consumer.
          let namespace: typeof ctx.remote.dshDataAnalysisCredentials | undefined
          const consumer = ctx.inject(['remote.dshDataAnalysisCredentials'], (scoped) => {
            namespace = scoped.remote.dshDataAnalysisCredentials
          })
          const stop = () => {
            void consumer.dispose()
          }
          signal.addEventListener('abort', stop, { once: true })
          if (signal.aborted) stop()
          try {
            await consumer
            signal.throwIfAborted()
            if (!namespace) throw new Error('credential-notification-unavailable')
            yield* namespace.changes(sessionId, signal)
          } finally {
            // Abort snapshots before RemoteStream starts waiting for reconnection.
            current.abort()
            signal.removeEventListener('abort', stop)
            await consumer.dispose()
          }
        } finally {
          current.abort()
        }
      },
      carrierFailed: () => snapshot?.abort(),
      ended: () => new Error('credential-notification-ended'),
    })
    const dispose = async () => {
      stopConnection()
      snapshot?.abort()
      await stream.dispose()
    }
    return {
      async *[Symbol.asyncIterator]() {
        try {
          for await (const item of stream)
            yield { ...item, signal: AbortSignal.any([item.signal, snapshot!.signal]) }
        } finally {
          await dispose()
        }
      },
      dispose,
    }
  }
}
