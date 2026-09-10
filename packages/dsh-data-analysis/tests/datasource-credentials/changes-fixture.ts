import { Context } from '@deepseek-ai/cordis'
import type { CredentialChanges } from '../../src/client/credentials/changes.ts'
import { CredentialChangesService } from '../../src/datasource/changes.ts'
import type { MarivoCredentialService } from '../../src/datasource/service.ts'

/** Host iterator adapter for model tests; real carrier acceptance uses Harness Web. */
export function changesFixture(
  service: Pick<MarivoCredentialService, 'waitWatch'>,
): CredentialChanges {
  return (sessionId) => {
    const controller = new AbortController()
    const notifications = new CredentialChangesService(new Context(), service)
    return {
      async *[Symbol.asyncIterator]() {
        for await (const value of notifications.changes(sessionId, controller.signal))
          yield { generation: 1, value, signal: controller.signal, accept() {} }
      },
      async dispose() {
        controller.abort()
        await notifications.close()
      },
    }
  }
}
