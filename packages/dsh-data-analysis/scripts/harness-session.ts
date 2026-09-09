/** Validation reads use Harness-owned storage handles and always release them. */
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionInspection, SessionPersistence } from '@deepseek-ai/dsh-session-persistence'

export async function inspectStoredSession(
  persistence: SessionPersistence,
  id: SessionId,
): Promise<SessionInspection> {
  const handle = await persistence.open(id, 'read')
  try {
    const { events } = await handle.read()
    return { meta: handle.header, inheritedEventCount: handle.inheritedEventCount, events }
  } finally {
    await handle.close()
  }
}
