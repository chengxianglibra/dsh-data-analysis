/** Keep feature RPC names while using Harness's authenticated shared API transport. */
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'

export function createPluginRpc(rpc: ClientConnectionRpc): ClientConnectionRpc {
  return {
    call: (channel, endpoint, payload, signal) =>
      rpc.call('/api', `${channel.slice(1)}/${endpoint}`, payload, signal),
  }
}
