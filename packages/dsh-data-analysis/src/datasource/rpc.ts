import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { z } from 'zod'
import { registerPluginRpc } from '../rpc.ts'
import type { MarivoDatasourceBridgePort } from './bridge.ts'
import { CREDENTIAL_CHANNEL, credentialError, type MarivoCredentialService } from './service.ts'

const text = z.string().min(1).max(256)
const handle = { generation: z.string().uuid(), id: z.string().uuid(), scope: z.string().uuid() }
const mutation = z
  .object({
    ...handle,
    action: z.enum(['save', 'update', 'delete', 'delete-datasource', 'test', 'submit', 'diagnose']),
    deleteCredentials: z.boolean().optional(),
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
  const unregister = registerPluginRpc(
    connection,
    CREDENTIAL_CHANNEL,
    [
      'overview',
      'authoring',
      'create-datasource',
      'configuration',
      'update-datasource',
      'select-configuration',
      'watch',
      'start',
      'operation',
      'cancel-operation',
      'cancel-request',
    ],
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
        } else if (endpoint === 'authoring') {
          const input = z.object({ workspaceId: text }).strict().parse(payload)
          const bridge = await workspace(input.workspaceId)
          if (!bridge.authoring) throw new Error('authoring-unavailable')
          value = { generation: service.generation, ...(await bridge.authoring(signal)) }
        } else if (endpoint === 'configuration') {
          const input = z.object({ workspaceId: text, name: text }).strict().parse(payload)
          const bridge = await workspace(input.workspaceId)
          if (!bridge.configuration) throw new Error('authoring-unavailable')
          value = await bridge.configuration(input.name, signal)
        } else if (endpoint === 'select-configuration') {
          const input = z
            .object({ workspaceId: text, requestId: z.string().uuid(), name: text })
            .strict()
            .parse(payload)
          value = await service.selectConfiguration(
            input.requestId,
            input.workspaceId,
            input.name,
            () => workspace(input.workspaceId),
            signal,
          )
        } else if (endpoint === 'create-datasource' || endpoint === 'update-datasource') {
          const input = z
            .object({
              workspaceId: text,
              generation: z.string().uuid(),
              fingerprint: z.string().min(1).max(256),
              backend: text,
              name: text.optional(),
              version: text.optional(),
              requestId: z.string().uuid().optional(),
              fields: z.record(text, z.unknown()),
            })
            .strict()
            .parse(payload)
          const request = input.requestId
            ? await service.configurationRequest(
                input.requestId,
                input.workspaceId,
                () => workspace(input.workspaceId),
                signal,
              )
            : undefined
          const operationSignal = request ? AbortSignal.any([signal, request.signal]) : signal
          const resolve = async () => {
            if (input.requestId)
              await service.configurationRequest(
                input.requestId,
                input.workspaceId,
                () => workspace(input.workspaceId),
                operationSignal,
              )
            return workspace(input.workspaceId)
          }
          if (endpoint === 'update-datasource') {
            const { name, version } = z.object({ name: text, version: text }).parse(input)
            if (
              request?.view.configuration.mode === 'edit' &&
              request.view.configuration.name !== name
            )
              throw new Error('invalid-request')
            value = await service.updateDatasource(
              input.generation,
              input.fingerprint,
              { backend: input.backend, fields: input.fields, name, version },
              resolve,
              operationSignal,
            )
          } else {
            if (input.name || input.version || request?.view.configuration.mode === 'edit')
              throw new Error('invalid-request')
            value = await service.createDatasource(
              input.generation,
              input.fingerprint,
              { backend: input.backend, fields: input.fields },
              resolve,
              operationSignal,
            )
          }
          if (input.requestId) {
            const configured = await service.selectConfiguration(
              input.requestId,
              input.workspaceId,
              (value as { name: string }).name,
              () => workspace(input.workspaceId),
              operationSignal,
            )
            value = { ...(value as { name: string }), request: configured }
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
  )
  // The profile owns this shared service; withdrawing its Web entry must not close it.
  return unregister
}
