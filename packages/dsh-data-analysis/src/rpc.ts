/** Dedicated plugin RPC envelopes over Harness-owned authenticated exact Fetch routes. */
import {
  type ConnectionRpcHandler,
  clientRequestSchema,
  type HostConnectionHandle,
} from '@deepseek-ai/dsh-client-connection'
import { finishCleanup, PendingTasks } from './lifecycle.ts'

export function registerPluginRpc(
  connection: Pick<HostConnectionHandle, 'fetch'>,
  channel: string,
  endpoints: readonly string[],
  handler: ConnectionRpcHandler,
): () => Promise<void> {
  const lifetime = new AbortController()
  const tasks = new PendingTasks()
  let closing: Promise<void> | undefined
  const disposers: (() => Promise<void>)[] = []
  const close = (): Promise<void> => {
    if (closing) return closing
    lifetime.abort()
    closing = finishCleanup([...disposers.reverse(), () => tasks.drain()])
    return closing
  }
  try {
    for (const endpoint of endpoints) {
      const method = `${channel.slice(1)}/${endpoint}`
      disposers.push(
        connection.fetch.register({
          path: `/api/${method}`,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch(request) {
            if (lifetime.signal.aborted)
              return Promise.resolve(new Response('Plugin disposed', { status: 503 }))
            return tasks.track(
              (async () => {
                if (
                  request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
                  'application/json'
                )
                  return new Response('Expected application/json', { status: 415 })
                const body = await request.json().catch(() => undefined)
                const parsed = clientRequestSchema.safeParse(body)
                if (!parsed.success || parsed.data.method !== method)
                  return new Response('Invalid plugin request', { status: 400 })
                // A request admitted before withdrawal may still be decoding its body.
                if (lifetime.signal.aborted) return new Response('Plugin disposed', { status: 503 })
                const result = await handler(
                  endpoint,
                  parsed.data.payload,
                  AbortSignal.any([request.signal, lifetime.signal]),
                )
                return Response.json({ type: 'server-response', rpcId: parsed.data.rpcId, result })
              })(),
            )
          },
        }),
      )
    }
  } catch (error) {
    void close()
    throw error
  }
  return close
}
