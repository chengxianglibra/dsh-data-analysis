import type {
  CredentialAction,
  CredentialContextView,
  CredentialOperationView,
  CredentialRequestView,
} from '../../datasource/service.ts'
import type { BrowserRpc } from '../semantic-browser/model.ts'

const CHANNEL = '/dsh-data-analysis-credentials'
const STORAGE_KEY = 'marivo-credential-operation'
interface QueryHandle {
  generation: string
  id: string
  scope: string
}
export interface ClientOperation {
  handle: QueryHandle
  name: string
  error?: string
  operation?: CredentialOperationView
}
export interface CredentialClientState {
  open: boolean
  workspaceId: string
  sessionId: string
  generation: string
  datasources: CredentialContextView[]
  requests: CredentialRequestView[]
  requestId: string
  selected: string
  loading: boolean
  error: string
  operations: ClientOperation[]
  operation?: CredentialOperationView
  handle?: QueryHandle
}
const messages: Record<string, string> = {
  'context-changed': 'Workspace 或数据源定义已变化，请重新读取后操作。',
  'credentials-changed': '凭证配置已变化，请重新读取后验证。',
  'call-ended': '原调用已结束，已保存的值仍保留；请重新发起任务。',
  'credential-missing': '凭证尚未配齐，请补填后验证。',
  'credential-save-failed': '部分凭证保存失败；已成功保存的项目保留。',
  'operation-busy': '该操作正在进行，请等待结果。',
  'credential-state-unavailable': '暂时无法读取凭证状态，请稍后重试。',
  'capacity-exceeded': '当前操作数量达到上限，请稍后重试。',
}
export function credentialMessage(code: string): string {
  return messages[code] ?? '凭证操作失败，请检查配置后重试。'
}
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
    if (signal.aborted) done()
  })
}
export class CredentialClientModel {
  #state: CredentialClientState = {
    open: false,
    workspaceId: '',
    sessionId: '',
    generation: '',
    datasources: [],
    requests: [],
    requestId: '',
    selected: '',
    loading: false,
    error: '',
    operations: [],
  }
  readonly #rpc: BrowserRpc
  readonly #storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  readonly #listeners = new Set<() => void>()
  readonly #lifetime = new AbortController()
  #watch?: AbortController
  #read?: AbortController
  readonly #polls = new Map<string, AbortController>()
  readonly #operations = new Map<string, ClientOperation>()
  readonly #opened = new Set<string>()
  constructor(rpc: BrowserRpc, storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {
    this.#rpc = rpc
    this.#storage = storage
  }
  getSnapshot = (): CredentialClientState => this.#state
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }
  #patch(change: Partial<CredentialClientState>): void {
    if (this.#lifetime.signal.aborted) return
    this.#state = { ...this.#state, ...change }
    for (const listener of this.#listeners) listener()
  }
  async #call(
    endpoint: string,
    payload: unknown,
    signal: AbortSignal = this.#lifetime.signal,
  ): Promise<unknown> {
    const result = (await this.#rpc.call(CHANNEL, endpoint, payload, signal)) as {
      ok: boolean
      value?: unknown
      error?: { message?: string }
    }
    if (!result.ok) throw new Error(credentialMessage(result.error?.message ?? ''))
    return result.value
  }
  show(workspaceId: string): void {
    this.#patch({ open: true, requestId: '' })
    void this.selectWorkspace(workspaceId)
  }
  close(): void {
    this.#read?.abort()
    this.#patch({ open: false, loading: false })
  }
  openRequest(id: string): void {
    this.#read?.abort()
    this.#patch({ open: true, requestId: id, loading: false })
  }
  select(token: string): void {
    this.#patch({ selected: token, requestId: '' })
  }
  async selectWorkspace(workspaceId: string): Promise<void> {
    this.#read?.abort()
    const flight = new AbortController()
    this.#read = flight
    this.#patch({
      workspaceId,
      datasources: [],
      selected: '',
      requestId: '',
      loading: !!workspaceId,
      error: '',
    })
    if (!workspaceId) return
    try {
      const value = (await this.#call('overview', { workspaceId }, flight.signal)) as {
        generation: string
        datasources: CredentialContextView[]
      }
      if (flight.signal.aborted) return
      this.#patch({
        generation: value.generation,
        datasources: value.datasources,
        selected: value.datasources[0]?.token ?? '',
        loading: false,
      })
    } catch (error) {
      if (!flight.signal.aborted)
        this.#patch({
          loading: false,
          error: error instanceof Error ? error.message : '无法读取凭证状态。',
        })
    }
  }
  session(sessionId: string): void {
    if (sessionId === this.#state.sessionId && this.#watch) return
    this.#watch?.abort()
    this.#read?.abort()
    const controller = new AbortController()
    this.#watch = controller
    this.#patch({ sessionId, requests: [], requestId: '', open: false })
    if (sessionId) void this.#watchSession(sessionId, controller.signal)
  }
  async #watchSession(sessionId: string, signal: AbortSignal): Promise<void> {
    let cursor: string | undefined,
      attempt = 0
    while (!signal.aborted && !this.#lifetime.signal.aborted) {
      try {
        const value = (await this.#call(
          'watch',
          { sessionId, ...(cursor ? { cursor } : {}) },
          signal,
        )) as { generation: string; cursor: string; requests: CredentialRequestView[] }
        if (signal.aborted) return
        cursor = value.cursor
        attempt = 0
        this.#patch({ generation: value.generation, requests: value.requests })
        const request = value.requests.find(
          (r) => r.endedAt === undefined && !this.#opened.has(r.id),
        )
        if (request) {
          this.#opened.add(request.id)
          this.openRequest(request.id)
        }
      } catch {
        if (!signal.aborted) {
          this.#patch({ error: '凭证待办连接中断，正在重连；Host 中的等待仍受原调用期限限制。' })
          await delay([1000, 2000, 5000][Math.min(attempt++, 2)]!, signal)
        }
      }
    }
  }
  #persist(): void {
    try {
      const pending = [...this.#operations.values()]
        .filter(
          (entry) => !entry.error && (!entry.operation || entry.operation.status === 'running'),
        )
        .map(({ handle, name }) => ({ handle, name }))
      if (pending.length) this.#storage?.setItem(STORAGE_KEY, JSON.stringify(pending))
      else this.#storage?.removeItem(STORAGE_KEY)
    } catch {
      /* in-memory queries still work */
    }
  }
  #publish(handle: QueryHandle, operation: CredentialOperationView): void {
    const entry = this.#operations.get(handle.id)
    if (!entry) return
    this.#operations.set(handle.id, { ...entry, operation })
    this.#patch({
      operations: [...this.#operations.values()],
      ...(this.#state.handle?.id === handle.id ? { operation, error: '' } : {}),
    })
    this.#persist()
  }
  selectOperation(id: string): void {
    const entry = this.#operations.get(id)
    if (entry)
      this.#patch({ handle: entry.handle, operation: entry.operation, error: entry.error ?? '' })
  }
  async start(
    context: CredentialContextView,
    action: CredentialAction,
    changes: Record<string, string> = {},
    reference?: string,
  ): Promise<void> {
    if (
      [...this.#operations.values()].some(
        (entry) =>
          entry.handle.scope === context.token &&
          !entry.error &&
          (!entry.operation || entry.operation.status === 'running'),
      )
    ) {
      for (const ref of Object.keys(changes)) delete changes[ref]
      this.#patch({ error: credentialMessage('operation-busy') })
      return
    }
    // Keep one completed result per context, while retaining every outstanding operation.
    for (const [id, entry] of this.#operations)
      if (entry.handle.scope === context.token) this.#operations.delete(id)
    const handle = {
      generation: this.#state.generation,
      id: crypto.randomUUID(),
      scope: context.token,
    }
    const requestId =
      action === 'submit' || action === 'diagnose' ? this.#state.requestId : undefined
    const operation: CredentialOperationView = {
      id: handle.id,
      scope: handle.scope,
      action,
      status: 'running',
      phase: 'saving',
      saved: [],
      errors: [],
    }
    this.#operations.set(handle.id, { handle, name: context.name, operation })
    this.#patch({ handle, operation, operations: [...this.#operations.values()], error: '' })
    this.#persist()
    try {
      // Only operation queries publish authoritative progress. A late submit reply cannot
      // overwrite another operation or an already newer query result for this ID.
      await this.#call('start', {
        ...handle,
        action,
        version: context.version,
        ...(requestId ? { requestId } : {}),
        changes,
        ...(reference ? { reference } : {}),
      })
    } catch {
      if (this.#state.handle?.id === handle.id)
        this.#patch({ error: '提交响应未确认，正在查询操作状态；不会重新发送秘密值。' })
    } finally {
      for (const ref of Object.keys(changes)) delete changes[ref]
    }
    await this.#query(handle)
  }
  async #query(handle: QueryHandle): Promise<void> {
    const entry = this.#operations.get(handle.id)
    if (
      !entry ||
      entry.error ||
      this.#polls.has(handle.id) ||
      (entry.operation && entry.operation.status !== 'running')
    )
      return
    const controller = new AbortController()
    this.#polls.set(handle.id, controller)
    const signal = AbortSignal.any([controller.signal, this.#lifetime.signal])
    try {
      while (!signal.aborted) {
        try {
          const operation = (await this.#call(
            'operation',
            handle,
            signal,
          )) as CredentialOperationView | null
          if (signal.aborted) return
          if (!operation) {
            const error = '操作状态不可恢复。保存可能已经发生，请重新读取实际配置后决定下一步。'
            this.#operations.set(handle.id, { ...entry, operation: undefined, error })
            this.#patch({
              operations: [...this.#operations.values()],
              ...(this.#state.handle?.id === handle.id
                ? {
                    operation: undefined,
                    handle: undefined,
                    error,
                  }
                : {}),
            })
            this.#persist()
            return
          }
          this.#publish(handle, operation)
          if (operation.status !== 'running') {
            // Refresh only the still-visible context that owned this operation.
            if (
              !this.#state.requestId &&
              this.#state.selected === handle.scope &&
              this.#state.workspaceId &&
              this.#state.open
            )
              await this.selectWorkspace(this.#state.workspaceId)
            return
          }
        } catch {
          if (!signal.aborted && this.#state.handle?.id === handle.id)
            this.#patch({ error: '正在恢复操作结果；已提交的保存不会自动重发。' })
        }
        await delay(1000, signal)
      }
    } finally {
      if (this.#polls.get(handle.id) === controller) this.#polls.delete(handle.id)
    }
  }
  recover(): void {
    try {
      const raw = this.#storage?.getItem(STORAGE_KEY)
      if (!raw) return
      const entries = JSON.parse(raw) as Array<{ handle: QueryHandle; name: string }>
      if (!Array.isArray(entries)) return
      for (const entry of entries) {
        const handle = entry?.handle
        if (
          !handle ||
          ![handle.generation, handle.id, handle.scope].every(
            (v) => typeof v === 'string' && /^[a-f0-9-]{36}$/i.test(v),
          ) ||
          typeof entry.name !== 'string'
        )
          continue
        if (!this.#operations.has(handle.id))
          this.#operations.set(handle.id, { handle, name: entry.name })
        if (!this.#state.handle) this.selectOperation(handle.id)
        void this.#query(handle)
      }
      this.#patch({ operations: [...this.#operations.values()] })
    } catch {
      /* invalid or unavailable local handles are not replayed */
    }
  }
  async cancelRequest(id: string): Promise<void> {
    try {
      await this.#call('cancel-request', { requestId: id })
    } catch (error) {
      this.#patch({ error: error instanceof Error ? error.message : '调用已结束。' })
    }
  }
  async cancelOperation(scope?: string): Promise<void> {
    const handle = scope
      ? [...this.#operations.values()].find(
          (entry) =>
            entry.handle.scope === scope &&
            !entry.error &&
            (!entry.operation || entry.operation.status === 'running'),
        )?.handle
      : this.#state.handle
    if (!handle) return
    try {
      await this.#call('cancel-operation', handle)
    } catch {
      this.#patch({ error: '无法确认取消结果，请继续查询。' })
    }
  }
  reset(): void {
    this.#watch?.abort()
    this.#watch = undefined
    this.session(this.#state.sessionId)
    this.recover()
  }
  dispose(): void {
    this.#lifetime.abort()
    this.#watch?.abort()
    this.#read?.abort()
    for (const controller of this.#polls.values()) controller.abort()
    this.#listeners.clear()
  }
}
