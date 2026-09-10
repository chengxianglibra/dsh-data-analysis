import type {
  DatasourceAuthoring,
  DatasourceConfiguration,
  DatasourceCreateInput,
} from '../../datasource/authoring.ts'
import type { DatasourceAuthoringView } from '../../datasource/defaults.ts'
import type {
  ConfigurationRequestView,
  CredentialAction,
  CredentialContextView,
  CredentialOperationView,
  CredentialRequestView,
} from '../../datasource/service.ts'
import type { PublishingCredentialView, PublishingField } from '../../report-publishing/service.ts'
import { CopyError, errorMessage, message, type Notice } from './../i18n/copy.ts'
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
  requests: (CredentialRequestView | ConfigurationRequestView)[]
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
  async publishingCredentials(
    endpoint: 'describe' | 'set' | 'unset',
    workspaceId: string,
    payload: { field?: PublishingField; value?: string; configId?: string },
    signal: AbortSignal,
  ): Promise<PublishingCredentialView> {
    const result = (await this.#rpc.call(
      '/dsh-report-publishing',
      endpoint,
      { workspaceId, ...payload },
      AbortSignal.any([signal, this.#lifetime.signal]),
    )) as { ok: boolean; value: PublishingCredentialView; error?: { message?: string } }
    if (!result.ok)
      throw new Error(
        result.error?.message === 'report-publishing-config-changed'
          ? 'report-publishing-config-changed'
          : 'report-publishing-credential-operation-failed',
      )
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
    mode: 'create' | 'edit' = 'create',
  ): Promise<DatasourceAuthoringView & { generation: string }> {
    return (await this.#call(
      'authoring',
      { workspaceId, mode },
      signal,
    )) as DatasourceAuthoringView & {
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
      throw new CopyError(
        message('marivo.credentials.value-if-submission-is-unconfirmed-refresh-the-list-to', {
          p0: error instanceof Error ? errorMessage(error) : 'marivo.credentials.create-failed',
        }),
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
        throw new CopyError(
          message('marivo.credentials.value-if-saving-is-unconfirmed-reload-the-configuration-to', {
            p0: error instanceof Error ? errorMessage(error) : 'marivo.credentials.save-failed',
          }),
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
        'marivo.credentials.configuration-saved-but-the-reference-already-exists-existing-credentials',
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
          this.#patch({
            error:
              'marivo.credentials.credential-request-connection-interrupted-reconnecting-host-waits-remain-subject',
          })
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
              entry.operation?.action === 'delete-datasource'
                ? 'marivo.credentials.deletion-status-cannot-be-recovered-some-deletion-may-have'
                : 'marivo.credentials.operation-status-cannot-be-recovered-saving-may-have-occurred'
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
  dispose(): void {
    this.#lifetime.abort()
    this.#watch?.abort()
    this.#read?.abort()
    this.#refresh?.abort()
    for (const controller of this.#polls.values()) controller.abort()
    this.#listeners.clear()
  }
}
