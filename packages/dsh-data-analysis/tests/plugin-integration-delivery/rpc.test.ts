import assert from 'node:assert/strict'
import test from 'node:test'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { createPluginRpc } from '../../src/client/rpc.ts'
import { registerPluginRpc } from '../../src/rpc.ts'
import { createConnectionFixture } from '../semantic-reference-input/fixtures.ts'

test('plugin RPC uses exact authenticated API routes, validates envelopes and withdraws on disposal', async () => {
  const { connection, routes, channels } = createConnectionFixture()
  let calls = 0
  let aborted = false
  const dispose = registerPluginRpc(
    connection,
    '/plugin',
    ['read', 'write'],
    async (endpoint, payload, signal) => {
      calls++
      aborted = signal.aborted
      return { ok: true, value: { endpoint, payload } }
    },
  )
  assert.deepEqual([...routes.keys()], ['/api/plugin/read', '/api/plugin/write'])
  const controller = new AbortController()
  controller.abort()
  const rpc = createPluginRpc({
    call: async (channel, method, payload, signal) => {
      assert.equal(channel, '/api')
      const route = routes.get(channel + '/' + method)!
      return (
        await (
          await route.fetch(
            new Request('http://fixture' + route.path, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              signal,
              body: JSON.stringify({ type: 'client-request', rpcId: 'one', method, payload }),
            }),
          )
        ).json()
      ).result
    },
  })
  assert.deepEqual(await rpc.call('/plugin', 'read', { id: 1 }, controller.signal), {
    ok: true,
    value: { endpoint: 'read', payload: { id: 1 } },
  })
  assert.equal(aborted, true)
  const route = routes.get('/api/plugin/read')!
  for (const [body, contentType, status] of [
    ['{}', 'application/json', 400],
    ['{', 'application/json', 400],
    [
      JSON.stringify({ type: 'client-request', rpcId: 'two', method: 'plugin/write', payload: {} }),
      'application/json',
      400,
    ],
    ['{}', 'text/plain', 415],
  ] as const) {
    assert.equal(
      (
        await route.fetch(
          new Request('http://fixture' + route.path, {
            method: 'POST',
            headers: { 'content-type': contentType },
            body,
          }),
        )
      ).status,
      status,
    )
  }
  assert.equal(calls, 1)
  await dispose()
  assert.equal(routes.size, 0)
  assert.equal(channels.size, 0)
})

test('partial RPC registration failure withdraws prior routes', () => {
  let disposed = false
  const connection = {
    fetch: {
      register: () => {
        if (disposed) throw new Error('unexpected')
        if (registered++) throw new Error('duplicate route')
        return async () => {
          disposed = true
        }
      },
    },
  } as unknown as HostConnectionHandle
  let registered = 0
  assert.throws(
    () =>
      registerPluginRpc(connection, '/plugin', ['a', 'b'], async () => ({ ok: true, value: null })),
    /duplicate route/,
  )
  assert.equal(disposed, true)
})
