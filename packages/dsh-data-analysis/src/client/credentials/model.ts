import { credentialRevisionSchema } from '../../datasource/changes-contract.ts'
import type {
  CredentialAction,
  CredentialContextView,
  CredentialOperationView,
  CredentialRequestView,
} from '../../datasource/service.ts'
import { PendingTasks } from '../../lifecycle.ts'
import { errorMessage, type Notice } from './../i18n/copy.ts'
import type { BrowserRpc } from '../semantic-browser/model.ts'
import type { CredentialChanges } from './changes.ts'

const CHANNEL = '/dsh-data-analysis-credentials'
const STORAGE_KEY = 'marivo-credential-operation'
// These are service.start precondition failures, raised before an operation is registered.
const START_REJECTIONS = new Set([
  'context-changed',
  'operation-scope-mismatch',
  'capacity-exceeded',
  'invalid-action',
  'call-ended',
  'operation-busy',
  'credentials-changed',
  'invalid-changes',
  'invalid-reference',
])
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
  error?: Notice
  operation?: CredentialOperationView
}
export interface CredentialClientState {
  open: boolean
  workspaceId: string
  sessionId: string
  generation: string
  revision?: string
  datasources: CredentialContextView[]
  requests: CredentialRequestView[]
  requestId: string
  selected: string
  loading: boolean
  error: Notice
  operations: ClientOperation[]
  outcomes: Record<string, ClientOperation>
  operation?: CredentialOperationView
  handle?: QueryHandle
}
const messages: Record<string, string> = {
  'datasource-remove-unavailable':
    'marivo.credentials.this-runtime-does-not-support-datasource-deletion',
  'datasource-not-removable':
    'marivo.credentials.this-datasource-is-not-a-removable-project-local-definition',
  'datasource-remove-failed':
    'marivo.credentials.datasource-deletion-is-unconfirmed-refresh-the-list-to-check',
  'credential-delete-failed':
    'marivo.credentials.datasource-deleted-but-some-credentials-could-not-be-deleted',
  'datasource-config-changed':
    'marivo.credentials.configuration-changed-reopen-the-editor-before-saving',
  'datasource-identity-fixed': 'marivo.credentials.datasource-name-and-engine-cannot-be-changed',
  'context-changed':
    'marivo.credentials.workspace-or-datasource-definition-changed-reload-before-continuing',
  'credentials-changed':
    'marivo.credentials.credential-configuration-changed-reload-before-validating',
  'call-ended': 'marivo.credentials.the-original-call-ended-saved-values-remain-start-the',
  'credential-missing':
    'marivo.credentials.some-credentials-are-missing-complete-them-before-validating',
  'credential-save-failed':
    'marivo.credentials.some-credentials-could-not-be-saved-successfully-saved-entries',
  'operation-busy': 'marivo.credentials.this-operation-is-in-progress-wait-for-its-result',
  'credential-state-unavailable':
    'marivo.credentials.credential-status-is-temporarily-unavailable-retry-later',
  'capacity-exceeded': 'marivo.credentials.the-operation-limit-has-been-reached-retry-later',
  'datasource-already-exists':
    'marivo.credentials.this-datasource-already-exists-choose-another-name',
  'datasource-definition-invalid':
    'marivo.credentials.invalid-datasource-definition-check-the-name-field-types-and',
  'datasource-credential-ref-invalid':
    'marivo.credentials.invalid-credential-reference-in-env-fields-enter-a-reference',
  'datasource-authoring-unavailable':
    'marivo.credentials.this-runtime-does-not-support-datasource-creation',
  'datasource-defaults-invalid':
    'marivo.credentials.invalid-datasourcedefaults-format-use-a-json-mapping-from-engines',
  'datasource-defaults-backend-invalid':
    'marivo.credentials.datasourcedefaults-contains-an-engine-unsupported-by-the-current-runtime',
  'datasource-defaults-field-invalid':
    'marivo.credentials.datasourcedefaults-contains-a-field-unsupported-by-the-current-runtime',
  'datasource-defaults-type-invalid':
    'marivo.credentials.datasourcedefaults-field-types-do-not-match-the-current-runtime',
  'datasource-defaults-credential-forbidden':
    'marivo.credentials.datasourcedefaults-does-not-support-credential-reference-fields-use-the',
}
export function credentialMessage(code: string): string {
  return (
    messages[code] ??
    'marivo.credentials.credential-operation-failed-check-the-configuration-and-retry'
  )
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
  readonly #changes?: CredentialChanges
  readonly #watchTasks = new PendingTasks()
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
  readonly #settling = new Map<string, Promise<boolean>>()
  readonly #opened = new Set<string>()
  constructor(
    rpc: BrowserRpc,
    storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
    changes?: CredentialChanges,
  ) {
    this.#changes = changes
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
          error:
            error instanceof Error
              ? errorMessage(error)
              : 'marivo.credentials.cannot-read-credential-status',
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
    const { workspaceId, sessionId, generation } = this.#state
    if (!workspaceId || !this.#state.open) return
    // A watch notification can arrive as an operation settles. Let its
    // authoritative post-operation read finish before starting another read.
    await Promise.all(this.#settling.values())
    if (
      !this.#state.open ||
      this.#state.workspaceId !== workspaceId ||
      this.#state.sessionId !== sessionId ||
      this.#state.generation !== generation
    )
      return
    this.#refresh?.abort()
    const flight = new AbortController()
    const activity = new Map(
      this.#state.datasources.map((context) => [context.token, this.#activity(context.token)]),
    )
    this.#refresh = flight
    try {
      const value = (await this.#call('overview', { workspaceId }, flight.signal)) as {
        generation: string
        datasources: CredentialContextView[]
      }
      if (
        !flight.signal.aborted &&
        this.#state.open &&
        this.#state.workspaceId === workspaceId &&
        this.#state.sessionId === sessionId &&
        this.#state.generation === generation &&
        value.generation === generation
      ) {
        const name = this.#state.datasources.find(
          (item) => item.token === this.#state.selected,
        )?.name
        const current = new Map(this.#state.datasources.map((context) => [context.token, context]))
        const updated = value.datasources.map((context) =>
          current.has(context.token) &&
          activity.get(context.token) !== this.#activity(context.token)
            ? current.get(context.token)!
            : context,
        )
        this.#patch({
          datasources: updated,
          outcomes: this.#currentOutcomes(workspaceId, generation, updated, activity),
          selected: updated.find((item) => item.name === name)?.token ?? updated[0]?.token ?? '',
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
    if (sessionId) void this.#watchTasks.track(this.#watchSession(sessionId, controller.signal))
  }
  async #watchSession(sessionId: string, caller: AbortSignal): Promise<void> {
    const lifetime = new AbortController()
    const signal = AbortSignal.any([caller, lifetime.signal, this.#lifetime.signal])
    let feed: ReturnType<CredentialChanges> | undefined
    let reading: Promise<void> | undefined
    type Item = import('@deepseek-ai/dsh-api-gateway/client').RemoteStreamItem<
      import('../../datasource/changes-contract.ts').CredentialRevision
    >
    let pending: Item | undefined
    const refresh = async () => {
      let attempt = 0
      while (pending && !signal.aborted) {
        const item = pending
        const readSignal = AbortSignal.any([signal, item.signal])
        if (readSignal.aborted) {
          if (pending === item) pending = undefined
          continue
        }
        try {
          // Never pass a cursor here: this is an immediate snapshot, not a long poll.
          const value = (await this.#call('watch', { sessionId }, readSignal)) as {
            generation: string
            cursor: string
            requests: CredentialRequestView[]
          }
          if (readSignal.aborted) continue
          credentialRevisionSchema.parse({ generation: value.generation, cursor: value.cursor })
          if (value.generation !== item.value.generation)
            throw new Error('credential-generation-changed')
          const requests = value.requests
          this.#patch({
            generation: value.generation,
            revision: value.cursor,
            requests,
            ...([
              'marivo.credentials.credential-request-connection-interrupted-reconnecting-host-waits-remain-subject',
              'marivo.credentials.credential-request-notifications-are-unavailable-check-the-host-connection',
            ].includes(String(this.#state.error))
              ? { error: '' }
              : {}),
          })
          item.accept()
          if (
            pending === item ||
            (pending?.signal === item.signal && pending.value.cursor === value.cursor)
          ) {
            pending?.accept()
            pending = undefined
          }
          attempt = 0
          const request = requests.find((r) => r.endedAt === undefined && !this.#opened.has(r.id))
          if (request) {
            this.#opened.add(request.id)
            this.openRequest(request.id)
          }
        } catch {
          if (!readSignal.aborted) {
            this.#patch({
              error:
                'marivo.credentials.credential-request-connection-interrupted-reconnecting-host-waits-remain-subject',
            })
            await delay([1000, 2000, 5000][Math.min(attempt++, 2)]!, readSignal)
          }
        }
      }
    }
    const startRead = () => {
      if (reading || !pending || signal.aborted) return
      reading = refresh().finally(() => {
        reading = undefined
        startRead()
      })
    }
    try {
      if (!this.#changes) throw new Error('credential-notification-unavailable')
      feed = this.#changes(sessionId)
      const stop = () => {
        void feed?.dispose().catch(() => {})
      }
      signal.addEventListener('abort', stop, { once: true })
      try {
        for await (const item of feed) {
          if (signal.aborted) break
          credentialRevisionSchema.parse(item.value)
          pending = item
          startRead()
        }
      } finally {
        signal.removeEventListener('abort', stop)
      }
    } catch {
      if (!signal.aborted)
        this.#patch({
          error:
            'marivo.credentials.credential-request-notifications-are-unavailable-check-the-host-connection',
        })
    } finally {
      lifetime.abort()
      await feed?.dispose().catch(() => {})
      await reading
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
            (entry.workspaceId !== workspaceId || scopes.has(scope)),
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
  async #refreshOverview(handle: QueryHandle): Promise<boolean> {
    const { workspaceId, generation, datasources, open, requestId } = this.#state
    if (
      !open ||
      requestId ||
      handle.generation !== generation ||
      !datasources.some((context) => context.token === handle.scope)
    )
      return false
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
        return false
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
      return true
    } catch {
      // Keep the last authoritative overview and scoped outcome if a passive refresh fails.
      return false
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
    workspaceId = context.workspaceId,
  ): Promise<void> {
    const settling = this.#settling.get(context.token)
    if (settling) {
      const generation = this.#state.generation
      const selected = this.#state.selected
      const requestId = this.#state.requestId
      const refreshedOverview = await settling
      const refreshed = this.#state.datasources.find((item) => item.token === context.token)
      if (
        this.#lifetime.signal.aborted ||
        (!requestId && this.#state.workspaceId !== workspaceId) ||
        this.#state.generation !== generation ||
        this.#state.selected !== selected ||
        this.#state.requestId !== requestId ||
        this.#suspended ||
        !refreshedOverview ||
        !refreshed
      ) {
        for (const ref of Object.keys(changes)) delete changes[ref]
        this.#patch({ error: credentialMessage('credentials-changed') })
        return
      }
      context = refreshed
    }
    const outcome = this.#state.outcomes[context.token]
    if (!this.#state.requestId && outcome?.operation && !outcome.overviewUpdated) {
      for (const ref of Object.keys(changes)) delete changes[ref]
      this.#patch({ error: credentialMessage('credentials-changed') })
      return
    }
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
    const requestId = action === 'submit' ? this.#state.requestId : undefined
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
      workspaceId,
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
      })
    } catch (error) {
      if (error instanceof CredentialResponseError && START_REJECTIONS.has(error.code)) {
        const entry = this.#operations.get(handle.id)
        if (entry) {
          const refresh = this.#refreshOverview(handle)
          this.#settling.set(handle.scope, refresh)
          this.#settle({
            ...entry,
            operation: {
              ...operation,
              status: 'failed',
              phase: 'settled',
              errors: [error.code],
            },
          })
          try {
            await refresh
          } finally {
            if (this.#settling.get(handle.scope) === refresh) this.#settling.delete(handle.scope)
          }
        }
        return
      }
      if (this.#state.handle?.id === handle.id && this.#visible(handle.scope))
        this.#patch({
          error:
            'marivo.credentials.submission-response-unconfirmed-checking-operation-status-without-resending-secret',
        })
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
              'marivo.credentials.operation-status-cannot-be-recovered-saving-may-have-occurred'
            this.#settle({ ...entry, operation: undefined, error })
            return
          }
          if (operation.status !== 'running') {
            const refresh = this.#refreshOverview(handle)
            this.#settling.set(handle.scope, refresh)
            this.#publish(handle, operation)
            try {
              await refresh
            } finally {
              if (this.#settling.get(handle.scope) === refresh) this.#settling.delete(handle.scope)
            }
            return
          }
          this.#publish(handle, operation)
        } catch {
          if (
            !signal.aborted &&
            this.#state.handle?.id === handle.id &&
            this.#visible(handle.scope)
          )
            this.#patch({
              error:
                'marivo.credentials.recovering-operation-results-submitted-saves-will-not-be-resent',
            })
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
      this.#patch({
        error:
          error instanceof Error ? errorMessage(error) : 'marivo.credentials.the-call-has-ended',
      })
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
      this.#patch({
        error: 'marivo.credentials.cancellation-is-unconfirmed-continue-checking-status',
      })
    }
  }
  reset(): void {
    this.#watch?.abort()
    this.#watch = undefined
    this.session(this.#state.sessionId)
    this.recover()
  }
  dispose(): Promise<void> {
    this.#lifetime.abort()
    this.#watch?.abort()
    this.#read?.abort()
    this.#refresh?.abort()
    for (const controller of this.#polls.values()) controller.abort()
    this.#listeners.clear()
    return this.#watchTasks.drain()
  }
}
