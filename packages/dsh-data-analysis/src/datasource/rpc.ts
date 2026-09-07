import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { z } from 'zod'
import type { MarivoDatasourceBridgePort } from './bridge.ts'
import { CREDENTIAL_CHANNEL, credentialError, type MarivoCredentialService } from './service.ts'

const text = z.string().min(1).max(256)
const handle = { generation: z.string().uuid(), id: z.string().uuid(), scope: z.string().uuid() }
const mutation = z
  .object({
    ...handle,
    action: z.enum(['update', 'delete', 'test', 'submit', 'diagnose']),
    version: z.string().max(65536),
    requestId: z.string().uuid().optional(),
    reference: text.optional(),
    changes: z.record(text, z.string().min(1).max(65536)).optional(),
  })
  .strict()
export function registerCredentialRpc(
  connection: HostConnectionHandle,
  service: MarivoCredentialService,
  workspace: (id: string) => Promise<MarivoDatasourceBridgePort>,
): () => Promise<void> {
  const unregister = connection.rpc.handle(
    CREDENTIAL_CHANNEL,
    async (endpoint, payload, signal) => {
      try {
        if (Buffer.byteLength(JSON.stringify(payload) ?? '') > 1_048_576)
          throw new Error('invalid-request')
        let value: unknown
        if (endpoint === 'overview') {
          const input = z.object({ workspaceId: text }).strict().parse(payload)
          value = {
            generation: service.generation,
            datasources: await service.overview(
              input.workspaceId,
              () => workspace(input.workspaceId),
              signal,
            ),
          }
        } else if (endpoint === 'watch') {
          const input = z
            .object({ sessionId: text, cursor: z.string().max(256).optional() })
            .strict()
            .parse(payload)
          value = await service.waitWatch(input.sessionId, input.cursor, signal)
        } else if (endpoint === 'start') {
          value = service.start(mutation.parse(payload))
        } else if (endpoint === 'operation') {
          const input = z.object(handle).strict().parse(payload)
          value = service.operation(input.generation, input.id, input.scope) ?? null
        } else if (endpoint === 'cancel-operation') {
          const input = z.object(handle).strict().parse(payload)
          service.cancelOperation(input.generation, input.id, input.scope)
          value = { cancelled: true }
        } else if (endpoint === 'cancel-request') {
          const input = z.object({ requestId: z.string().uuid() }).strict().parse(payload)
          service.cancelRequest(input.requestId)
          value = { cancelled: true }
        } else throw new Error('unknown-endpoint')
        return { ok: true, value }
      } catch (error) {
        return {
          ok: false,
          error: { code: 'internal', message: credentialError(error), details: {} },
        }
      }
    },
    { authority: 'trusted-host' },
  )
  return async () => {
    const draining = unregister()
    await service.close()
    await draining
  }
}
