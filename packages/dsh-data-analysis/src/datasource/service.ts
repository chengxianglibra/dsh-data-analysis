import { randomUUID } from 'node:crypto'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { type CredentialProvider, credentialRef } from '@deepseek-ai/dsh-credentials'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { DatasourceCreateInput } from './authoring.ts'
import type {
  MarivoDatasourceBridgePort,
  MarivoDatasourceDescription,
  MarivoDatasourceTestResult,
} from './bridge.ts'
import { marivoCredentialStorageRef } from './shell-env.ts'

export const CREDENTIAL_CHANNEL = '/dsh-data-analysis-credentials'
const RETENTION = 30 * 60_000
const CAPACITY = 512
export type CredentialStore = Pick<CredentialProvider, 'describe' | 'resolve' | 'set' | 'unset'>
export type CredentialAction = 'save' | 'update' | 'delete' | 'test' | 'submit' | 'diagnose'
export interface CredentialContextView {
  token: string
  workspaceId: string
  name: string
  refs: string[]
  fields: Record<string, string>
  version: string
  credentials: Record<string, { configured: boolean; source?: string; writable: boolean }>
  lastTest?: { at: number; result: MarivoDatasourceTestResult; stale: boolean }
}
export interface CredentialRequestView {
  id: string
  sessionId: string
  context: CredentialContextView
  status:
    | 'awaiting-input'
    | 'executing'
    | 'awaiting-decision'
    | 'succeeded'
    | 'handed-off'
    | 'call-ended'
    | 'context-changed'
  failure?: MarivoDatasourceTestResult
  endedAt?: number
}
export interface CredentialOperationView {
  id: string
  scope: string
  action: CredentialAction
  status: 'running' | 'succeeded' | 'failed' | 'cancelled'
  phase: 'saving' | 'validating' | 'settled'
  saved: string[]
  errors: string[]
  result?: MarivoDatasourceTestResult
  endedAt?: number
}
interface BoundContext {
  token: string
  workspaceId: string
  bridge: MarivoDatasourceBridgePort
  description: MarivoDatasourceDescription
  resolve: () => Promise<MarivoDatasourceBridgePort>
  touched: number
}
interface PreparedCredentialTest {
  result: MarivoDatasourceTestResult
  version: string
}
interface PendingRequest {
  view: CredentialRequestView
  context: BoundContext
  exec: ToolExecution
  signal: AbortSignal
  finish: (value: PreparedCredentialTest) => void
  reject: (error: Error) => void
  stop: () => void
}
export interface CredentialNeedsInput {
  status: 'needs-credentials'
  name: string
  refs: string[]
}
export interface PreparedCredentialExecution {
  status: 'ready'
  values: Record<string, string>
  grants: Record<string, MarivoDatasourceDescription>
  bridge: MarivoDatasourceBridgePort
  signal: AbortSignal
  /** Call synchronously immediately before starting the resolved Shell request. */
  assertCurrent: () => void
  /** Forget values and stop operation-scoped credential tracking. */
  release: () => void
}
export class CredentialServiceError extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.code = code
    this.name = 'CredentialServiceError'
  }
}
export function credentialError(error: unknown): string {
  return error instanceof CredentialServiceError ? error.code : 'credential-operation-failed'
}
function assert(condition: unknown, code: string): asserts condition {
  if (!condition) throw new CredentialServiceError(code)
}

/** Owns only plugin operations and execution-scoped waits. No value cache or datasource registry. */
export class MarivoCredentialService {
  readonly generation = randomUUID()
  readonly #store: CredentialStore
  readonly #contexts = new Map<string, BoundContext>()
  readonly #requests = new Map<string, PendingRequest>()
  readonly #operations = new Map<string, CredentialOperationView>()
  readonly #controllers = new Map<string, AbortController>()
  readonly #tasks = new Set<Promise<void>>()
  readonly #versions = new Map<string, number>()
  readonly #activeRefs = new Map<string, number>()
  readonly #history = new Map<
    string,
    { at: number; version: string; refs: string[]; result: MarivoDatasourceTestResult }
  >()
  readonly #lifetime = new AbortController()
  readonly #agents = new WeakMap<Agent, AbortController>()
  readonly #listeners = new Set<() => void>()
  #revision = 0
  #tail: Promise<void> = Promise.resolve()
  readonly interaction: 'web' | 'none'
  readonly now: () => number
  constructor(store: CredentialStore, interaction: 'web' | 'none' = 'web', now = Date.now) {
    this.#store = store
    this.interaction = interaction
    this.now = now
  }
  executionSignal(caller: AbortSignal, agent?: Agent): AbortSignal {
    let lifecycle: AbortController | undefined
    if (agent) {
      lifecycle = this.#agents.get(agent)
      if (!lifecycle) {
        lifecycle = new AbortController()
        this.#agents.set(agent, lifecycle)
      }
    }
    return AbortSignal.any([
      caller,
      this.#lifetime.signal,
      ...(lifecycle ? [lifecycle.signal] : []),
    ])
  }
  #changed(): void {
    this.#revision++
    for (const listener of this.#listeners) listener()
  }
  #prune(): void {
    const now = this.now()
    for (const [id, op] of this.#operations)
      if (op.endedAt !== undefined && now - op.endedAt >= RETENTION) this.#operations.delete(id)
    for (const [id, request] of this.#requests)
      if (request.view.endedAt !== undefined && now - request.view.endedAt >= RETENTION)
        this.#requests.delete(id)
    for (const [id, context] of this.#contexts)
      if (
        now - context.touched >= RETENTION &&
        ![...this.#requests.values()].some(
          (r) => r.context === context && r.view.endedAt === undefined,
        ) &&
        ![...this.#operations.values()].some((op) => op.scope === id && op.status === 'running')
      )
        this.#contexts.delete(id)
    for (const [key, history] of this.#history)
      if (now - history.at >= RETENTION) this.#history.delete(key)
    const retainedRefs = new Set([
      ...[...this.#contexts.values()].flatMap((context) => context.description.refs),
      ...[...this.#history.values()].flatMap((history) => history.refs),
      ...this.#activeRefs.keys(),
    ])
    for (const ref of this.#versions.keys()) if (!retainedRefs.has(ref)) this.#versions.delete(ref)
  }
  async #locked<T>(fn: () => Promise<T>, signal: AbortSignal): Promise<T> {
    const previous = this.#tail
    let release!: () => void
    this.#tail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      signal.throwIfAborted()
      return await fn()
    } finally {
      release()
    }
  }
  #version(context: BoundContext): string {
    return JSON.stringify(
      context.description.refs.map((ref) => [ref, this.#versions.get(ref) ?? 0]),
    )
  }
  #historyKey(context: BoundContext): string {
    return JSON.stringify([
      context.bridge.binding.fingerprint,
      context.description.name,
      context.description.definition,
    ])
  }
  invalidateStorageRef(storageRef: string): void {
    const refs = new Set(
      [...this.#contexts.values()].flatMap((context) => context.description.refs),
    )
    for (const ref of this.#activeRefs.keys()) refs.add(ref)
    for (const history of this.#history.values()) for (const ref of history.refs) refs.add(ref)
    this.invalidate([...refs].filter((ref) => marivoCredentialStorageRef(ref) === storageRef))
  }
  invalidate(refs: readonly string[]): void {
    for (const ref of refs) this.#versions.set(ref, (this.#versions.get(ref) ?? 0) + 1)
    this.#changed()
  }
  async #current(context: BoundContext, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    const bridge = await context.resolve()
    assert(bridge.binding.fingerprint === context.bridge.binding.fingerprint, 'context-changed')
    const described = await bridge.describe(context.description.name, signal)
    assert(described.definition === context.description.definition, 'context-changed')
    signal.throwIfAborted()
    context.touched = this.now()
  }
  async #view(context: BoundContext): Promise<CredentialContextView> {
    const credentials: CredentialContextView['credentials'] = Object.create(null)
    for (const ref of context.description.refs) {
      try {
        credentials[ref] = await this.#store.describe(
          credentialRef(marivoCredentialStorageRef(ref)),
        )
      } catch {
        throw new CredentialServiceError('credential-state-unavailable')
      }
    }
    const history = this.#history.get(this.#historyKey(context))
    return {
      token: context.token,
      workspaceId: context.workspaceId,
      name: context.description.name,
      refs: context.description.refs,
      fields: context.description.fields,
      version: this.#version(context),
      credentials,
      ...(history
        ? {
            lastTest: {
              at: history.at,
              result: history.result,
              stale: history.version !== this.#version(context),
            },
          }
        : {}),
    }
  }
  async #bind(
    workspaceId: string,
    resolve: () => Promise<MarivoDatasourceBridgePort>,
    name: string,
    signal: AbortSignal,
  ): Promise<BoundContext> {
    this.#prune()
    assert(!this.#lifetime.signal.aborted, 'disposed')
    const bridge = await resolve()
    const description = await bridge.describe(name, signal)
    assert(description.name === name, 'invalid-datasource-context')
    for (const ref of description.refs) marivoCredentialStorageRef(ref)
    assert(
      typeof description.definition === 'string' && !!description.fields,
      'invalid-datasource-context',
    )
    const context = {
      token: randomUUID(),
      workspaceId,
      bridge,
      description,
      resolve,
      touched: this.now(),
    }
    await this.#current(context, signal)
    return context
  }
  async overview(
    workspaceId: string,
    resolve: () => Promise<MarivoDatasourceBridgePort>,
    caller: AbortSignal,
  ): Promise<CredentialContextView[]> {
    const signal = AbortSignal.any([caller, this.#lifetime.signal])
    const bridge = await resolve()
    const items = await bridge.inventory(signal)
    assert(items.length <= 128, 'datasource-limit-exceeded')
    const views: CredentialContextView[] = []
    this.#prune()
    assert(!signal.aborted, 'disposed')
    for (const item of items) {
      for (const ref of item.refs) marivoCredentialStorageRef(ref)
      const context: BoundContext = {
        token: randomUUID(),
        workspaceId,
        bridge,
        description: item,
        resolve,
        touched: this.now(),
      }
      const old = [...this.#contexts.values()].find(
        (c) =>
          c.workspaceId === workspaceId &&
          c.description.name === context.description.name &&
          c.description.definition === context.description.definition &&
          c.bridge.binding.fingerprint === context.bridge.binding.fingerprint,
      )
      if (old) {
        this.#contexts.delete(old.token)
        context.token = old.token
      }
      assert(this.#contexts.size < CAPACITY, 'capacity-exceeded')
      this.#contexts.set(context.token, context)
      views.push(await this.#view(context))
    }
    const current = await resolve()
    assert(current.binding.fingerprint === bridge.binding.fingerprint, 'context-changed')
    signal.throwIfAborted()
    return views
  }

  async createDatasource(
    generation: string,
    fingerprint: string,
    input: DatasourceCreateInput,
    resolve: () => Promise<MarivoDatasourceBridgePort>,
    caller: AbortSignal,
  ): Promise<{ name: string }> {
    const signal = AbortSignal.any([caller, this.#lifetime.signal])
    return this.#locked(async () => {
      assert(generation === this.generation, 'context-changed')
      const bridge = await resolve()
      assert(bridge.binding.fingerprint === fingerprint, 'context-changed')
      assert(bridge.create, 'datasource-authoring-unavailable')
      signal.throwIfAborted()
      const result = await bridge.create(input, signal)
      assert(!result.error && result.name, result.error ?? 'datasource-definition-invalid')
      return { name: result.name }
    }, signal)
  }
  #watchRefs(refs: readonly string[]): () => void {
    const unique = new Set(refs)
    for (const ref of unique) this.#activeRefs.set(ref, (this.#activeRefs.get(ref) ?? 0) + 1)
    return () => {
      for (const ref of unique) {
        const count = this.#activeRefs.get(ref)! - 1
        if (count === 0) this.#activeRefs.delete(ref)
        else this.#activeRefs.set(ref, count)
      }
    }
  }
  async #snapshot(contexts: BoundContext[], signal: AbortSignal): Promise<Record<string, string>> {
    const stop = this.#watchRefs(contexts.flatMap((context) => context.description.refs))
    const values: Record<string, string> = Object.create(null)
    try {
      return await this.#locked(async () => {
        for (const context of contexts) await this.#current(context, signal)
        const versions = contexts.map((context) => this.#version(context))
        for (const ref of new Set(contexts.flatMap((context) => context.description.refs))) {
          let resolved: Awaited<ReturnType<CredentialStore['resolve']>>
          try {
            resolved = await this.#store.resolve(credentialRef(marivoCredentialStorageRef(ref)))
          } catch {
            throw new CredentialServiceError('credential-unavailable')
          }
          signal.throwIfAborted()
          assert(resolved?.value, 'credential-missing')
          values[ref] = resolved.value
        }
        for (const [index, context] of contexts.entries()) {
          await this.#current(context, signal)
          assert(versions[index] === this.#version(context), 'credentials-changed')
        }
        return values
      }, signal)
    } catch (error) {
      for (const ref of Object.keys(values)) delete values[ref]
      throw error
    } finally {
      stop()
    }
  }
  async #test(context: BoundContext, signal: AbortSignal): Promise<MarivoDatasourceTestResult> {
    const stop = this.#watchRefs(context.description.refs)
    let values: Record<string, string> | undefined
    try {
      const version = this.#version(context)
      values = await this.#snapshot([context], signal)
      const result = await context.bridge.test(context.description, values, signal)
      await this.#current(context, signal)
      assert(version === this.#version(context), 'credentials-changed')
      const key = this.#historyKey(context)
      this.#history.delete(key)
      if (this.#history.size >= CAPACITY) this.#history.delete(this.#history.keys().next().value!)
      this.#history.set(key, {
        at: this.now(),
        version,
        refs: [...context.description.refs],
        result,
      })
      return result
    } finally {
      if (values) for (const ref of Object.keys(values)) delete values[ref]
      stop()
    }
  }
  async #awaitCredentials(
    exec: ToolExecution,
    context: BoundContext,
    view: CredentialContextView,
    signal: AbortSignal,
  ): Promise<PreparedCredentialTest | CredentialNeedsInput | undefined> {
    const agent = exec.agent!
    const missing = view.refs.filter((ref) => !view.credentials[ref]?.configured)
    if (missing.length === 0) return undefined
    if (
      this.interaction === 'none' ||
      agent.session.header.origin === 'subagent' ||
      (agent.session.header.delegationDepth ?? 0) > 0
    )
      return { status: 'needs-credentials', name: context.description.name, refs: missing }
    this.#prune()
    assert(this.#requests.size < CAPACITY / 2, 'capacity-exceeded')
    assert(this.#contexts.size < CAPACITY, 'capacity-exceeded')
    this.#contexts.set(context.token, context)
    return new Promise<PreparedCredentialTest>((finish, reject) => {
      const id = randomUUID()
      const request: PendingRequest = {
        context,
        exec,
        signal,
        finish,
        reject,
        stop: () => signal.removeEventListener('abort', abort),
        view: { id, sessionId: agent.session.id, context: view, status: 'awaiting-input' },
      }
      const abort = () => {
        if (request.view.endedAt !== undefined) return
        request.view.status = 'call-ended'
        request.view.endedAt = this.now()
        request.stop()
        reject(new CredentialServiceError('call-ended'))
        this.#changed()
      }
      this.#requests.set(id, request)
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
      this.#changed()
    })
  }
  async prepare(
    _kind: 'test',
    exec: ToolExecution,
    resolve: () => Promise<MarivoDatasourceBridgePort>,
    name: string,
  ): Promise<MarivoDatasourceTestResult | CredentialNeedsInput> {
    assert(exec.agent, 'agent-required')
    const signal = this.executionSignal(exec.signal, exec.agent)
    const context = await this.#bind('', resolve, name, signal)
    const stop = this.#watchRefs(context.description.refs)
    try {
      const tested = await this.#awaitCredentials(exec, context, await this.#view(context), signal)
      return tested
        ? 'result' in tested
          ? tested.result
          : tested
        : await this.#test(context, signal)
    } finally {
      stop()
    }
  }
  async prepareExecution(
    exec: ToolExecution,
    resolve: () => Promise<MarivoDatasourceBridgePort>,
    names: string[],
  ): Promise<PreparedCredentialExecution | CredentialNeedsInput | MarivoDatasourceTestResult> {
    assert(exec.agent, 'agent-required')
    assert(
      names.length <= 16 &&
        new Set(names).size === names.length &&
        names.every((name) => typeof name === 'string' && !!name.trim() && name.length <= 256),
      'invalid-datasources',
    )
    const signal = this.executionSignal(exec.signal, exec.agent)
    const session = exec.agent.session
    const currentWorkspace = () =>
      JSON.stringify([Reflect.get(session.header, 'workspaceId'), session.header.cwd])
    const workspace = currentWorkspace()
    const contexts: BoundContext[] = []
    const stops: (() => void)[] = []
    const versions = new Map<BoundContext, string>()
    let values: Record<string, string> = {}
    let released = false
    const release = () => {
      if (released) return
      released = true
      for (const ref of Object.keys(values)) delete values[ref]
      for (const stop of stops) stop()
    }
    try {
      for (const name of names) {
        const context = await this.#bind('', resolve, name, signal)
        assert(
          !contexts.length ||
            context.bridge.binding.fingerprint === contexts[0]!.bridge.binding.fingerprint,
          'context-changed',
        )
        contexts.push(context)
        stops.push(this.#watchRefs(context.description.refs))
        const view = await this.#view(context)
        if (view.refs.every((ref) => view.credentials[ref]?.configured))
          versions.set(context, view.version)
      }
      for (const context of contexts) {
        // Another datasource form may have supplied shared refs while this call waited.
        const view = await this.#view(context)
        if (!versions.has(context) && view.refs.every((ref) => view.credentials[ref]?.configured))
          versions.set(context, view.version)
        const prepared = await this.#awaitCredentials(exec, context, view, signal)
        if (prepared && (!('result' in prepared) || !prepared.result.ok)) {
          release()
          return 'result' in prepared ? prepared.result : prepared
        }
        if (prepared) {
          assert(
            !versions.has(context) || versions.get(context) === prepared.version,
            'credentials-changed',
          )
          versions.set(context, prepared.version)
        }
      }
      const assertCurrent = () => {
        assert(!released, 'execution-ended')
        signal.throwIfAborted()
        assert(
          exec.agent?.session === session && currentWorkspace() === workspace,
          'context-changed',
        )
        for (const context of contexts)
          assert(versions.get(context) === this.#version(context), 'credentials-changed')
      }
      assertCurrent()
      values = await this.#snapshot(contexts, signal)
      assertCurrent()
      const bridge = contexts[0]?.bridge ?? (await resolve())
      if (!contexts.length) {
        const fingerprint = bridge.binding.fingerprint
        const current = await resolve()
        assert(current.binding.fingerprint === fingerprint, 'context-changed')
      }
      assertCurrent()
      return {
        status: 'ready',
        bridge,
        values,
        grants: Object.fromEntries(contexts.map((c) => [c.description.name, c.description])),
        signal,
        assertCurrent,
        release,
      }
    } catch (error) {
      release()
      throw error
    }
  }
  watch(
    sessionId: string,
    cursor?: string,
  ): { generation: string; cursor: string; requests: CredentialRequestView[] } {
    this.#prune()
    void cursor
    return {
      generation: this.generation,
      cursor: `${this.generation}:${this.#revision}`,
      requests: [...this.#requests.values()]
        .filter((r) => r.view.sessionId === sessionId)
        .map((r) => structuredClone(r.view)),
    }
  }
  async waitWatch(sessionId: string, cursor: string | undefined, signal: AbortSignal) {
    if (
      cursor === this.watch(sessionId).cursor &&
      !signal.aborted &&
      !this.#lifetime.signal.aborted
    ) {
      await new Promise<void>((resolve) => {
        const end = () => {
          clearTimeout(timer)
          this.#listeners.delete(end)
          signal.removeEventListener('abort', end)
          resolve()
        }
        const timer = setTimeout(end, 25_000)
        this.#listeners.add(end)
        signal.addEventListener('abort', end, { once: true })
        if (signal.aborted) end()
      })
    }
    signal.throwIfAborted()
    for (const request of this.#requests.values()) {
      if (request.view.sessionId !== sessionId || request.view.endedAt !== undefined) continue
      const view = await this.#view(request.context)
      if (JSON.stringify(view) !== JSON.stringify(request.view.context)) {
        request.view.context = view
        this.#changed()
      }
    }
    return this.watch(sessionId)
  }
  operation(generation: string, id: string, scope: string): CredentialOperationView | undefined {
    this.#prune()
    if (generation !== this.generation) return undefined
    const operation = this.#operations.get(id)
    assert(!operation || operation.scope === scope, 'operation-scope-mismatch')
    return operation ? structuredClone(operation) : undefined
  }
  start(input: {
    generation: string
    id: string
    scope: string
    action: CredentialAction
    version: string
    requestId?: string
    changes?: Record<string, string>
    reference?: string
  }): CredentialOperationView {
    this.#prune()
    assert(
      input.generation === this.generation && !this.#lifetime.signal.aborted,
      'context-changed',
    )
    const existing = this.#operations.get(input.id)
    if (existing) {
      assert(
        existing.scope === input.scope && existing.action === input.action,
        'operation-scope-mismatch',
      )
      return structuredClone(existing)
    }
    assert(this.#operations.size < CAPACITY, 'capacity-exceeded')
    const context = this.#contexts.get(input.scope)
    assert(context, 'context-changed')
    const request = input.requestId ? this.#requests.get(input.requestId) : undefined
    assert(
      !input.requestId ||
        (request &&
          request.context === context &&
          request.view.endedAt === undefined &&
          !request.signal.aborted),
      'call-ended',
    )
    assert(
      (input.action === 'submit' || input.action === 'diagnose') === !!request,
      'invalid-action',
    )
    assert(
      ![...this.#operations.values()].some(
        (op) => op.scope === input.scope && op.status === 'running',
      ),
      'operation-busy',
    )
    if (request) assert(request.view.status !== 'executing', 'operation-busy')
    assert(input.version === this.#version(context), 'credentials-changed')
    const changes = input.changes ?? {}
    assert(
      Object.keys(changes).every(
        (ref) =>
          context.description.refs.includes(ref) &&
          typeof changes[ref] === 'string' &&
          changes[ref]!.length > 0 &&
          changes[ref]!.length <= 65536,
      ),
      'invalid-changes',
    )
    assert(
      !Object.keys(changes).length ||
        input.action === 'save' ||
        input.action === 'update' ||
        input.action === 'submit',
      'invalid-changes',
    )
    assert(
      input.action !== 'delete' ||
        (input.reference && context.description.refs.includes(input.reference)),
      'invalid-reference',
    )
    const op: CredentialOperationView = {
      id: input.id,
      scope: input.scope,
      action: input.action,
      status: 'running',
      phase: 'saving',
      saved: [],
      errors: [],
    }
    this.#operations.set(op.id, op)
    const controller = new AbortController()
    this.#controllers.set(op.id, controller)
    const signal = AbortSignal.any([
      controller.signal,
      this.#lifetime.signal,
      ...(request ? [request.signal] : []),
    ])
    if (request) request.view.status = 'executing'
    const task = this.#run(
      context,
      request,
      op,
      changes,
      input.reference,
      input.version,
      signal,
    ).finally(() => {
      this.#controllers.delete(op.id)
      this.#tasks.delete(task)
    })
    this.#tasks.add(task)
    this.#changed()
    return structuredClone(op)
  }
  async #run(
    context: BoundContext,
    request: PendingRequest | undefined,
    op: CredentialOperationView,
    changes: Record<string, string>,
    reference: string | undefined,
    version: string,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      await this.#current(context, signal)
      if (op.action === 'diagnose') {
        assert(request?.view.failure, 'no-test-failure')
        op.result = request.view.failure
        request.view.status = 'handed-off'
        request.view.endedAt = this.now()
        request.stop()
        request.finish({ result: op.result, version: this.#version(context) })
      } else {
        await this.#locked(async () => {
          await this.#current(context, signal)
          assert(version === this.#version(context), 'credentials-changed')
          const refs = op.action === 'delete' ? [reference!] : Object.keys(changes)
          for (const ref of refs) {
            signal.throwIfAborted()
            // Revocation precedes writes; a snapshot already committed may finish.
            this.invalidate([ref])
            try {
              const storageRef = credentialRef(marivoCredentialStorageRef(ref))
              if (op.action === 'delete') await this.#store.unset(storageRef)
              else await this.#store.set(storageRef, changes[ref]!)
              op.saved.push(ref)
            } catch {
              op.errors.push(ref)
            }
          }
        }, signal)
        assert(op.errors.length === 0, 'credential-save-failed')
        for (const ref of Object.keys(changes)) delete changes[ref]
        if (op.action !== 'delete' && op.action !== 'save') {
          op.phase = 'validating'
          this.#changed()
          const testedVersion = this.#version(context)
          op.result = await this.#test(context, signal)
          if (request && request.view.endedAt === undefined) {
            request.view.context = await this.#view(context)
            signal.throwIfAborted()
            assert(testedVersion === this.#version(context), 'credentials-changed')
            if (op.result.ok) {
              request.view.status = 'succeeded'
              request.view.endedAt = this.now()
              request.stop()
              request.finish({ result: op.result, version: testedVersion })
            } else {
              request.view.status = 'awaiting-decision'
              request.view.failure = op.result
            }
          }
        }
      }
      op.status = 'succeeded'
    } catch (error) {
      op.status = signal.aborted ? 'cancelled' : 'failed'
      op.errors.push(signal.aborted ? 'cancelled' : credentialError(error))
      if (request && request.view.endedAt === undefined) {
        if (credentialError(error) === 'context-changed') {
          request.view.status = 'context-changed'
          request.view.endedAt = this.now()
          request.stop()
          request.reject(new CredentialServiceError('context-changed'))
        } else {
          request.view.status = 'awaiting-input'
          try {
            request.view.context = await this.#view(context)
          } catch {
            /* keep last safe facts */
          }
        }
      }
    } finally {
      for (const ref of Object.keys(changes)) delete changes[ref]
      op.phase = 'settled'
      op.endedAt = this.now()
      this.#changed()
    }
  }
  cancelOperation(generation: string, id: string, scope: string): void {
    const operation = this.operation(generation, id, scope)
    assert(operation, 'operation-unrecoverable')
    this.#controllers.get(id)?.abort()
  }
  cancelRequest(id: string): void {
    const request = this.#requests.get(id)
    assert(request && request.view.endedAt === undefined && !request.signal.aborted, 'call-ended')
    request.exec.agent!.cancel({ kind: 'user' }, { keepInbox: true })
  }
  disposeAgent(agent: Agent): void {
    this.#agents.get(agent)?.abort()
    for (const request of this.#requests.values())
      if (request.exec.agent === agent && request.view.endedAt === undefined) {
        request.view.status = 'call-ended'
        request.view.endedAt = this.now()
        request.stop()
        request.reject(new CredentialServiceError('call-ended'))
      }
    this.#changed()
  }
  track<T>(task: Promise<T>): Promise<T> {
    const tracked = task
      .then(
        () => {},
        () => {},
      )
      .finally(() => this.#tasks.delete(tracked))
    this.#tasks.add(tracked)
    return task
  }
  async close(): Promise<void> {
    this.#lifetime.abort()
    this.#changed()
    await Promise.allSettled([...this.#tasks])
  }
}
