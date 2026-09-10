import { setTimeout as delay } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { PendingTasks } from '../lifecycle.ts'
import { CREDENTIAL_CHANGES_SERVICE, type CredentialRevision } from './changes-contract.ts'
import { CredentialServiceError, type MarivoCredentialService } from './service.ts'

/** Reuses the Host's logical stream carrier; credentials and waiting calls keep their owner. */
export class CredentialChangesService extends TypertRemoteService {
  private readonly credentials: Pick<MarivoCredentialService, 'waitWatch'>
  private readonly lifetime = new AbortController()
  private readonly tasks = new PendingTasks()
  private closing?: Promise<void>
  constructor(ctx: Context, credentials: Pick<MarivoCredentialService, 'waitWatch'>) {
    super(ctx, CREDENTIAL_CHANGES_SERVICE)
    this.credentials = credentials
  }
  async *changes(sessionId: string, caller: AbortSignal): AsyncIterable<CredentialRevision> {
    const signal = AbortSignal.any([caller, this.lifetime.signal])
    let cursor: string | undefined
    while (!signal.aborted) {
      const snapshot = await this.tasks.track(this.snapshot(sessionId, cursor, signal))
      signal.throwIfAborted()
      if (snapshot.cursor !== cursor) {
        cursor = snapshot.cursor
        yield { generation: snapshot.generation, cursor }
      }
    }
  }
  private async snapshot(sessionId: string, cursor: string | undefined, signal: AbortSignal) {
    let attempt = 0
    for (;;) {
      signal.throwIfAborted()
      try {
        return await this.credentials.waitWatch(sessionId, cursor, signal)
      } catch (error) {
        signal.throwIfAborted()
        if (
          !(error instanceof CredentialServiceError) ||
          error.code !== 'credential-state-unavailable'
        )
          throw new Error('credential-notification-unavailable')
        await delay([1000, 2000, 5000][Math.min(attempt++, 2)], undefined, { signal })
      }
    }
  }
  close(): Promise<void> {
    this.lifetime.abort()
    this.closing ??= this.tasks.drain()
    return this.closing
  }
}
