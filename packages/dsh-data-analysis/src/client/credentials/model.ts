import type {
  DatasourceAuthoring,
  DatasourceConfiguration,
  DatasourceCreateInput,
} from '../../datasource/authoring.ts'
import type {
  ConfigurationRequestView,
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
  workspaceId?: string
  overviewUpdated?: boolean
  error?: string
  operation?: CredentialOperationView
}
export interface CredentialClientState {
  open: boolean
  workspaceId: string
  sessionId: string
  generation: string
  revision?: string
  datasources: CredentialContextView[]
  requests: (CredentialRequestView | ConfigurationRequestView)[]
  requestId: string
  selected: string
  loading: boolean
  error: string
  operations: ClientOperation[]
  outcomes: Record<string, ClientOperation>
  operation?: CredentialOperationView
  handle?: QueryHandle
}
const messages: Record<string, string> = {
  'datasource-remove-unavailable': '当前 Runtime 不支持删除数据源。',
  'datasource-not-removable': '该数据源不属于可删除的项目本地定义。',
  'datasource-remove-failed': '未能确认数据源删除结果，请刷新列表检查；对应凭证尚未删除。',
  'credential-delete-failed':
    '数据源已删除，但部分凭证删除失败；请在 Harness 凭证管理中处理保留项。',
  'datasource-config-changed': '配置已被修改，请重新打开编辑页面后再保存。',
  'datasource-identity-fixed': '数据源名称和引擎不能修改。',
  'context-changed': 'Workspace 或数据源定义已变化，请重新读取后操作。',
  'credentials-changed': '凭证配置已变化，请重新读取后验证。',
  'call-ended': '原调用已结束，已保存的值仍保留；请重新发起任务。',
  'credential-missing': '凭证尚未配齐，请补填后验证。',
  'credential-save-failed': '部分凭证保存失败；已成功保存的项目保留。',
  'operation-busy': '该操作正在进行，请等待结果。',
  'credential-state-unavailable': '暂时无法读取凭证状态，请稍后重试。',
  'capacity-exceeded': '当前操作数量达到上限，请稍后重试。',
  'datasource-already-exists': '该数据源已存在，请使用其他名称。',
  'datasource-definition-invalid': '数据源定义无效，请检查名称、字段类型和凭证引用。',
  'datasource-credential-ref-invalid':
    '凭证引用名称无效。*_env 字段填写引用名（如 MY_DB_PASSWORD），仅可使用字母、数字和下划线，且不能以数字开头；不能使用 MARIVO_、DSH_DATA_ANALYSIS_ 前缀或 Host 保留名称。实际用户名和密码请在创建后的“新增凭证”中填写。',
  'datasource-authoring-unavailable': '当前 Runtime 不支持新增数据源。',
}
export function credentialMessage(code: string): string {
  return messages[code] ?? '凭证操作失败，请检查配置后重试。'
}
class CredentialResponseError extends Error {
  readonly code: string
  constructor(code: string) {
    super(credentialMessage(code))
    this.code = code
  }
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
    outcomes: {},
  }
  readonly #rpc: BrowserRpc
  readonly #storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  readonly #listeners = new Set<() => void>()
  readonly #lifetime = new AbortController()
  #suspended = false
  #watch?: AbortController
  #read?: AbortController
  #refresh?: AbortController
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
    if (!result.ok) throw new CredentialResponseError(result.error?.message ?? '')
    return result.value
  }
  async show(workspaceId: string, selectedToken?: string): Promise<void> {
    this.#suspended = false
    this.#patch({ open: true, requestId: '' })
    for (const entry of this.#operations.values()) void this.#query(entry.handle)
    await this.selectWorkspace(workspaceId, selectedToken)
  }
  async authoring(
    workspaceId: string,
    signal: AbortSignal,
  ): Promise<DatasourceAuthoring & { generation: string }> {
    return (await this.#call('authoring', { workspaceId }, signal)) as DatasourceAuthoring & {
      generation: string
    }
  }
  async createDatasource(
    workspaceId: string,
    schema: DatasourceAuthoring & { generation: string },
    input: DatasourceCreateInput,
  ): Promise<void> {
    let result: { name: string }
    try {
      result = (await this.#call('create-datasource', {
        workspaceId,
        generation: schema.generation,
        fingerprint: schema.fingerprint,
        ...input,
      })) as { name: string }
    } catch (error) {
      if (
        error instanceof CredentialResponseError &&
        [
          'datasource-credential-ref-invalid',
          'datasource-already-exists',
          'context-changed',
        ].includes(error.code)
      )
        throw error
      throw new Error(
        `${error instanceof Error ? error.message : '新增数据源失败。'} 如提交结果未确认，请刷新列表核对后再操作。`,
      )
    }
    if (!this.#state.open || this.#state.workspaceId !== workspaceId) return
    await this.selectWorkspace(workspaceId)
    if (this.#state.workspaceId !== workspaceId) return
    const created = this.#state.datasources.find((item) => item.name === result.name)
    if (created) this.select(created.token)
  }
  async configuration(
    workspaceId: string,
    name: string,
    signal: AbortSignal,
  ): Promise<DatasourceConfiguration> {
    return (await this.#call(
      'configuration',
      { workspaceId, name },
      signal,
    )) as DatasourceConfiguration
  }
  async saveConfiguration(
    workspaceId: string,
    schema: DatasourceAuthoring & { generation: string },
    input: DatasourceCreateInput,
    original?: DatasourceConfiguration,
    requestId?: string,
    changes: Record<string, string> = {},
  ): Promise<void> {
    try {
      let result: { name: string; request?: ConfigurationRequestView }
      try {
        result = (await this.#call(original ? 'update-datasource' : 'create-datasource', {
          workspaceId,
          generation: schema.generation,
          fingerprint: schema.fingerprint,
          ...input,
          ...(original ? { name: original.name, version: original.version } : {}),
          ...(requestId ? { requestId } : {}),
        })) as { name: string; request?: ConfigurationRequestView }
      } catch (error) {
        if (
          error instanceof CredentialResponseError &&
          [
            'datasource-credential-ref-invalid',
            'datasource-already-exists',
            'datasource-config-changed',
            'datasource-identity-fixed',
            'context-changed',
            'operation-busy',
          ].includes(error.code)
        )
          throw error
        throw new Error(
          `${error instanceof Error ? error.message : '保存配置失败。'} 如保存结果未确认，请重新读取配置核对后再操作；不会自动重发。`,
        )
      }

      if (
        !this.#state.open ||
        this.#state.workspaceId !== workspaceId ||
        (requestId && this.#state.requestId !== requestId)
      )
        return
      if (result.request) {
        this.#acceptRequest(result.request)
        const context = result.request.context
        if (context) {
          this.#checkCredentialWrites(context, changes)
          const ready = context.refs.every(
            (ref) => context.credentials[ref]?.configured || changes[ref],
          )
          if (ready || Object.keys(changes).length) await this.start(context, 'submit', changes)
        }
      } else {
        await this.selectWorkspace(workspaceId)
        if (this.#state.workspaceId !== workspaceId) return
        const selected = this.#state.datasources.find((item) => item.name === result.name)
        if (selected) {
          this.select(selected.token)
          this.#checkCredentialWrites(selected, changes)
          if (Object.keys(changes).length) await this.start(selected, 'save', changes)
        }
      }
    } finally {
      for (const ref of Object.keys(changes)) delete changes[ref]
    }
  }
  #checkCredentialWrites(context: CredentialContextView, changes: Record<string, string>) {
    if (Object.keys(changes).some((ref) => context.credentials[ref]?.configured))
      throw new Error(
        '配置已保存，但引用名已存在。未覆盖已有凭证；请在凭证页确认更新，或编辑配置使用新的引用名。',
      )
  }
  #acceptRequest(request: ConfigurationRequestView) {
    this.#patch({
      requests: [...this.#state.requests.filter((item) => item.id !== request.id), request],
    })
  }
  async selectConfiguration(workspaceId: string, requestId: string, name: string): Promise<void> {
    const request = (await this.#call('select-configuration', {
      workspaceId,
      requestId,
      name,
    })) as ConfigurationRequestView
    if (
      this.#state.workspaceId !== workspaceId ||
      this.#state.requestId !== requestId ||
      !this.#state.open
    )
      return
    this.#acceptRequest(request)
  }
  close(): void {
    this.#read?.abort()
    this.#refresh?.abort()
    this.#patch({ open: false, loading: false })
  }
  suspend(): void {
    this.#suspended = true
    for (const controller of this.#polls.values()) controller.abort()
    this.#polls.clear()
    this.close()
  }
  openRequest(id: string): void {
    this.#read?.abort()
    this.#refresh?.abort()
    this.#patch({ open: true, requestId: id, loading: false })
  }
  select(token: string): void {
    this.#patch({ selected: token, requestId: '', error: '' })
  }
  async selectWorkspace(workspaceId: string, selectedToken?: string): Promise<void> {
    this.#read?.abort()
    this.#refresh?.abort()
    const flight = new AbortController()
    this.#read = flight
    const selected =
      selectedToken ?? (this.#state.workspaceId === workspaceId ? this.#state.selected : '')
    const activity = new Map(
      [...Object.values(this.#state.outcomes), ...this.#operations.values()].map((entry) => [
        entry.handle.scope,
        entry.handle.id,
      ]),
    )
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
        outcomes: this.#currentOutcomes(workspaceId, value.generation, value.datasources, activity),
        selected: value.datasources.some((item) => item.token === selected)
          ? selected
          : (value.datasources[0]?.token ?? ''),
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
  /** Receive the shared Host watch without sharing a tab's selection or form state. */
  syncRequests(sessionId: string, state: CredentialClientState): void {
    const requests = state.requests.filter((request) => request.sessionId === sessionId)
    const changed =
      JSON.stringify(requests) !== JSON.stringify(this.#state.requests) ||
      state.generation !== this.#state.generation ||
      state.revision !== this.#state.revision
    this.#patch({ sessionId, requests, generation: state.generation, revision: state.revision })
    if (changed && this.#state.open) void this.refreshDatasources()
  }
  async refreshDatasources(): Promise<void> {
    const workspaceId = this.#state.workspaceId
    if (!workspaceId || !this.#state.open) return
    this.#refresh?.abort()
    const flight = new AbortController()
    this.#refresh = flight
    try {
      const value = (await this.#call('overview', { workspaceId }, flight.signal)) as {
        generation: string
        datasources: CredentialContextView[]
      }
      if (!flight.signal.aborted && this.#state.open && this.#state.workspaceId === workspaceId) {
        const name = this.#state.datasources.find(
          (item) => item.token === this.#state.selected,
        )?.name
        this.#patch({
          datasources: value.datasources,
          generation: value.generation,
          selected:
            value.datasources.find((item) => item.name === name)?.token ??
            value.datasources[0]?.token ??
            '',
        })
      }
    } catch {
      /* Keep the visible form; explicit refresh can surface read failures. */
    }
  }
  session(sessionId: string): void {
    if (sessionId === this.#state.sessionId && this.#watch) return
    this.#watch?.abort()
    this.#read?.abort()
    this.#refresh?.abort()
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
        )) as {
          generation: string
          cursor: string
          requests: CredentialRequestView[]
          configurationRequests?: ConfigurationRequestView[]
        }
        if (signal.aborted) return
        cursor = value.cursor
        attempt = 0
        const requests = [...value.requests, ...(value.configurationRequests ?? [])]
        this.#patch({ generation: value.generation, revision: value.cursor, requests })
        const request = requests.find((r) => r.endedAt === undefined && !this.#opened.has(r.id))
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
        .map(({ handle, name, workspaceId }) => ({ handle, name, workspaceId }))
      if (pending.length) this.#storage?.setItem(STORAGE_KEY, JSON.stringify(pending))
      else this.#storage?.removeItem(STORAGE_KEY)
    } catch {
      /* in-memory queries still work */
    }
  }
  #visible(scope: string): boolean {
    const selected = this.#state.requestId
      ? this.#state.requests.find((request) => request.id === this.#state.requestId)?.context?.token
      : this.#state.selected
    return selected === scope
  }
  #currentOutcomes(
    workspaceId: string,
    generation: string,
    datasources: CredentialContextView[],
    activity: Map<string, string | undefined>,
  ): Record<string, ClientOperation> {
    const scopes = new Set(datasources.map((context) => context.token))
    return Object.fromEntries(
      Object.entries(this.#state.outcomes)
        .filter(
          ([scope, entry]) =>
            entry.handle.generation === generation &&
            (entry.workspaceId !== workspaceId ||
              scopes.has(scope) ||
              entry.operation?.action === 'delete-datasource'),
        )
        .map(([scope, entry]) => [
          scope,
          scopes.has(scope) && activity.get(scope) === entry.handle.id
            ? { ...entry, overviewUpdated: true }
            : entry,
        ]),
    )
  }
  #activity(scope: string): string | undefined {
    return (
      [...this.#operations.values()].find((entry) => entry.handle.scope === scope)?.handle.id ??
      this.#state.outcomes[scope]?.handle.id
    )
  }
  async #refreshOverview(handle: QueryHandle): Promise<void> {
    const { workspaceId, generation, datasources, open, requestId } = this.#state
    if (
      !open ||
      requestId ||
      handle.generation !== generation ||
      !datasources.some((context) => context.token === handle.scope)
    )
      return
    this.#refresh?.abort()
    const flight = new AbortController(),
      read = this.#read,
      activity = new Map(
        datasources.map((context) => [context.token, this.#activity(context.token)]),
      )
    this.#refresh = flight
    try {
      const value = (await this.#call('overview', { workspaceId }, flight.signal)) as {
        generation: string
        datasources: CredentialContextView[]
      }
      if (
        flight.signal.aborted ||
        read !== this.#read ||
        workspaceId !== this.#state.workspaceId ||
        generation !== this.#state.generation ||
        value.generation !== generation
      )
        return
      const current = new Map(this.#state.datasources.map((context) => [context.token, context]))
      const updated = value.datasources.map((context) =>
        current.has(context.token) && activity.get(context.token) !== this.#activity(context.token)
          ? current.get(context.token)!
          : context,
      )
      this.#patch({
        datasources: updated,
        outcomes: this.#currentOutcomes(workspaceId, generation, updated, activity),
        selected: updated.some((context) => context.token === this.#state.selected)
          ? this.#state.selected
          : (updated[0]?.token ?? ''),
      })
    } catch {
      // Keep the last authoritative overview and scoped outcome if a passive refresh fails.
    }
  }
  #publish(handle: QueryHandle, operation: CredentialOperationView): void {
    const entry = this.#operations.get(handle.id)
    if (!entry) return
    if (operation.status !== 'running') {
      this.#settle({ ...entry, operation })
      return
    }
    this.#operations.set(handle.id, { ...entry, operation })
    this.#patch({
      operations: [...this.#operations.values()],
      ...(this.#state.handle?.id === handle.id
        ? { operation, ...(this.#visible(handle.scope) ? { error: '' } : {}) }
        : {}),
    })
    this.#persist()
  }
  #settle(entry: ClientOperation): void {
    this.#operations.delete(entry.handle.id)
    this.#patch({
      operations: [...this.#operations.values()],
      outcomes: { ...this.#state.outcomes, [entry.handle.scope]: entry },
      ...(this.#state.handle?.id === entry.handle.id
        ? {
            handle: undefined,
            operation: undefined,
            ...(this.#visible(entry.handle.scope) ? { error: entry.error ?? '' } : {}),
          }
        : {}),
    })
    this.#persist()
  }
  selectOperation(id: string): void {
    const entry = this.#operations.get(id)
    if (entry)
      this.#patch({ handle: entry.handle, operation: entry.operation, error: entry.error ?? '' })
  }
  dismissOutcome(scope: string): void {
    const outcomes = { ...this.#state.outcomes }
    delete outcomes[scope]
    this.#patch({ outcomes })
  }
  async start(
    context: CredentialContextView,
    action: CredentialAction,
    changes: Record<string, string> = {},
    reference?: string,
    deleteCredentials?: boolean,
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
    const outcomes = { ...this.#state.outcomes }
    delete outcomes[context.token]
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
    this.#operations.set(handle.id, {
      handle,
      name: context.name,
      workspaceId: context.workspaceId,
      operation,
    })
    this.#patch({
      handle,
      operation,
      operations: [...this.#operations.values()],
      outcomes,
      error: '',
    })
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
        ...(action === 'delete-datasource'
          ? { deleteCredentials: deleteCredentials === true }
          : {}),
      })
    } catch (error) {
      if (action === 'delete-datasource' && error instanceof CredentialResponseError) {
        const entry = this.#operations.get(handle.id)
        if (entry)
          this.#settle({
            ...entry,
            operation: {
              ...operation,
              status: 'failed',
              phase: 'settled',
              errors: [error.code],
            },
          })
        await this.#refreshOverview(handle)
        return
      }
      if (this.#state.handle?.id === handle.id && this.#visible(handle.scope))
        this.#patch({ error: '提交响应未确认，正在查询操作状态；不会重新发送秘密值。' })
    } finally {
      for (const ref of Object.keys(changes)) delete changes[ref]
    }
    await this.#query(handle)
  }
  async #query(handle: QueryHandle): Promise<void> {
    const entry = this.#operations.get(handle.id)
    if (
      this.#suspended ||
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
            const error =
              entry.operation?.action === 'delete-datasource'
                ? '删除状态不可恢复，部分删除可能已发生，请刷新数据源并核对 Harness 凭证状态。'
                : '操作状态不可恢复。保存可能已经发生，请重新读取实际配置后决定下一步。'
            this.#settle({ ...entry, operation: undefined, error })
            return
          }
          this.#publish(handle, operation)
          if (operation.status !== 'running') {
            await this.#refreshOverview(handle)
            return
          }
        } catch {
          if (
            !signal.aborted &&
            this.#state.handle?.id === handle.id &&
            this.#visible(handle.scope)
          )
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
      const entries = JSON.parse(raw) as Array<{
        handle: QueryHandle
        name: string
        workspaceId?: string
      }>
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
          this.#operations.set(handle.id, {
            handle,
            name: entry.name,
            ...(typeof entry.workspaceId === 'string' ? { workspaceId: entry.workspaceId } : {}),
          })
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
    this.#refresh?.abort()
    for (const controller of this.#polls.values()) controller.abort()
    this.#listeners.clear()
  }
}
