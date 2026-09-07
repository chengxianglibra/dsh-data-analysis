import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type {
  MarivoDatasourceBridgePort,
  MarivoDatasourceDescription,
  MarivoDatasourceTestResult,
} from '../../src/datasource/bridge.ts'
import { type CredentialStore, MarivoCredentialService } from '../../src/datasource/service.ts'
import { marivoCredentialStorageRef } from '../../src/datasource/shell-env.ts'
export class Store implements CredentialStore {
  values = new Map<string, string>()
  calls = { resolve: 0, set: 0, unset: 0 }
  readonly = false
  fail = ''
  async resolve(ref: CredentialRef) {
    this.calls.resolve++
    const value = this.values.get(ref)
    return value ? { value, source: 'fixture' } : undefined
  }
  async describe(ref: CredentialRef) {
    return { configured: this.values.has(ref), source: 'fixture', writable: !this.readonly }
  }
  async set(ref: CredentialRef, value: string) {
    this.calls.set++
    if (this.readonly || ref === this.fail) throw new Error('unsafe-provider-detail')
    this.values.set(ref, value)
  }
  async unset(ref: CredentialRef) {
    this.calls.unset++
    if (this.readonly) throw new Error('unsafe-provider-detail')
    this.values.delete(ref)
  }
  put(ref: string, value = 'canary-private-4826') {
    this.values.set(marivoCredentialStorageRef(ref), value)
  }
}
export function barrier() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}
export function fixture(interaction: 'web' | 'none' = 'none') {
  const store = new Store(),
    controller = new AbortController()
  let clock = 1000,
    tests = 0
  const description: MarivoDatasourceDescription = {
    name: 'warehouse',
    refs: ['DB_PASSWORD'],
    fields: { password: 'DB_PASSWORD' },
    definition: 'd'.repeat(64),
  }
  let result: MarivoDatasourceTestResult = {
    name: 'warehouse',
    ok: true,
    latency_ms: 1,
    failure: null,
    repair: null,
  }
  const bridge: MarivoDatasourceBridgePort = {
    binding: {
      projectRoot: '/workspace',
      pythonExecutable: '/runtime/python',
      marivoVersion: 'fixture',
      packagePath: '/runtime/marivo/__init__.py',
      subprocessPolicyId: 'fixture',
      fingerprint: 'f'.repeat(64),
    },
    describe: async (name) => ({
      ...description,
      name,
      refs: [...description.refs],
      fields: { ...description.fields },
    }),
    inventory: async () => [{ ...description }],
    test: async (_name, values) => {
      tests++
      assert.equal(values.DB_PASSWORD, store.values.get(marivoCredentialStorageRef('DB_PASSWORD')))
      return result
    },
  }
  const agent = {
    session: { id: 'session', header: {} },
    cancel: () => controller.abort(),
  } as unknown as Agent
  const exec = { agent, signal: controller.signal, callId: 'call' } as unknown as ToolExecution
  const service = new MarivoCredentialService(store, interaction, () => clock)
  const resolve = async () => bridge
  return {
    store,
    controller,
    agent,
    exec,
    service,
    bridge,
    description,
    resolve,
    get tests() {
      return tests
    },
    advance: (ms: number) => {
      clock += ms
    },
    setResult: (value: MarivoDatasourceTestResult) => {
      result = value
    },
  }
}
export async function context(f: ReturnType<typeof fixture>) {
  return (await f.service.overview('workspace', f.resolve, f.controller.signal))[0]!
}
export async function operation(
  f: ReturnType<typeof fixture>,
  view: Awaited<ReturnType<typeof context>>,
  action: 'update' | 'delete' | 'test' | 'submit' | 'diagnose',
  extra: {
    requestId?: string
    changes?: Record<string, string>
    reference?: string
    id?: string
  } = {},
) {
  const id = extra.id ?? randomUUID()
  f.service.start({
    generation: f.service.generation,
    id,
    scope: view.token,
    version: view.version,
    action,
    ...extra,
  })
  return finish(f, id, view.token)
}
export async function finish(f: ReturnType<typeof fixture>, id: string, scope: string) {
  for (;;) {
    const op = f.service.operation(f.service.generation, id, scope)!
    if (op.status !== 'running') return op
    await f.service.waitWatch(
      'session',
      f.service.watch('session').cursor,
      AbortSignal.timeout(5000),
    )
  }
}
export async function waiting(f: ReturnType<typeof fixture>) {
  for (;;) {
    const request = f.service.watch('session').requests.find((r) => r.endedAt === undefined)
    if (request) return request
    await f.service.waitWatch(
      'session',
      f.service.watch('session').cursor,
      AbortSignal.timeout(5000),
    )
  }
}
export const failed: MarivoDatasourceTestResult = {
  name: 'warehouse',
  ok: false,
  latency_ms: null,
  failure: {
    code: 'connection_open_failed',
    exception_type: 'DriverError',
    backend_name: null,
    backend_code: null,
    message: 'connection rejected',
  },
  repair: {
    kind: 'reconnect',
    help_target: { surface: 'datasource', canonical_id: 'test' },
    action: 'Check connection',
    snippet: null,
    candidates: [],
    preserves_evidence: null,
  },
}
