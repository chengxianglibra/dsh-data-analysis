/** Dedicated plugin RPC envelopes over Harness-owned authenticated exact Fetch routes. */
import {
  type ConnectionRpcHandler,
  clientRequestSchema,
  type HostConnectionHandle,
} from '@deepseek-ai/dsh-client-connection'

export function registerPluginRpc(
  connection: Pick<HostConnectionHandle, 'fetch'>,
  channel: string,
  endpoints: readonly string[],
  handler: ConnectionRpcHandler,
): () => Promise<void> {
  const disposers: (() => Promise<void>)[] = []
  try {
    for (const endpoint of endpoints) {
      const method = `${channel.slice(1)}/${endpoint}`
      disposers.push(
        connection.fetch.register({
          path: `/api/${method}`,
          methods: ['POST'],
          requestBody: 'buffered',
          async fetch(request) {
            if (
              request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
              'application/json'
            )
              return new Response('Expected application/json', { status: 415 })
            const body = await request.json().catch(() => undefined)
            const parsed = clientRequestSchema.safeParse(body)
            if (!parsed.success || parsed.data.method !== method)
              return new Response('Invalid plugin request', { status: 400 })
            const result = await handler(endpoint, parsed.data.payload, request.signal)
            return Response.json({ type: 'server-response', rpcId: parsed.data.rpcId, result })
          },
        }),
      )
    }
  } catch (error) {
    // Registered routes are synchronously withdrawn before their drain promises settle.
    for (const dispose of disposers.reverse()) void dispose()
    throw error
  }
  return async () => {
    await Promise.all(disposers.map((dispose) => dispose()))
  }
}
