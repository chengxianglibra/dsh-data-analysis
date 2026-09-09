/** Isolated browser fault injection. Never included in the default client entry. */
export function installReadDelayProbe(ctx: any) {
  const rpc = ctx.connection.rpc,
    call = rpc.call.bind(rpc)
  let armed: string | false = false,
    release: (() => void) | undefined
  let overviewReads = 0
  rpc.call = async (channel: string, endpoint: string, payload: unknown, signal?: AbortSignal) => {
    if (endpoint.endsWith('/overview')) overviewReads++
    const hold = armed && endpoint.endsWith(armed)
    if (hold) armed = false
    const result = await call(channel, endpoint, payload, signal)
    if (hold)
      await new Promise<void>((resolve) => {
        release = resolve
      })
    return result
  }
  ctx.effect(() => () => {
    release?.()
    rpc.call = call
  })
  return {
    overviewReads: () => overviewReads,
    arm: (endpoint = '/files/read') => {
      armed = endpoint
    },
    held: () => !!release,
    release: () => {
      release?.()
      release = undefined
    },
  }
}
