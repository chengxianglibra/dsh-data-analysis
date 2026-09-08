import {
  BROWSER_ENDPOINT,
  type CatalogSnapshot,
  parseCatalogSnapshot,
  type SemanticObjectView,
} from '../../semantic-browser/contracts.ts'
import { CHANNEL, refKey, type SemanticRef } from '../../semantic-reference/contracts.ts'

export interface BrowserRpc {
  call(channel: string, endpoint: string, payload: unknown, signal: AbortSignal): Promise<unknown>
}
export interface BrowserView {
  readonly snapshot?: CatalogSnapshot
  readonly loading: boolean
  readonly error?: string
  readonly query: string
  readonly kind: string
  readonly domain: string
  readonly selected: string
  readonly history: readonly string[]
  readonly page: number
  readonly tab: 'overview' | 'definition' | 'relations'
}
export interface BrowserState {
  readonly open: boolean
  readonly workspaceId: string
  readonly fromReport?: boolean
  readonly views: Readonly<Record<string, BrowserView>>
}
export const emptyView = (): BrowserView => ({
  loading: false,
  query: '',
  kind: '',
  domain: '',
  selected: '',
  history: [],
  page: 0,
  tab: 'overview',
})
export const PAGE_SIZE = 40

/** Type navigation describes the selected domain, independent of search and selected type. */
export function countObjectsByKind(objects: readonly SemanticObjectView[], domain: string) {
  const byKind = new Map<string, number>()
  let total = 0
  for (const item of objects) {
    if (domain && item.domain !== domain) continue
    total++
    byKind.set(item.ref.kind, (byKind.get(item.ref.kind) ?? 0) + 1)
  }
  return { total, byKind }
}

export function filterObjects(
  objects: readonly SemanticObjectView[],
  view: BrowserView,
): SemanticObjectView[] {
  const normalize = (s: string) => s.normalize('NFKC').toLocaleLowerCase()
  const words = normalize(view.query).trim().split(/\s+/).filter(Boolean)
  return objects
    .filter(
      (item) =>
        (!view.kind || item.ref.kind === view.kind) &&
        (!view.domain || item.domain === view.domain) &&
        words.every((word) =>
          normalize(`${item.name} ${refKey(item.ref)} ${item.definition ?? ''}`).includes(word),
        ),
    )
    .sort(
      (a, b) => a.name.localeCompare(b.name, 'zh-CN') || refKey(a.ref).localeCompare(refKey(b.ref)),
    )
}

/** Page-owned state. Every completion is guarded even if the RPC ignores AbortSignal. */
export class SemanticBrowserModel {
  readonly #rpc: BrowserRpc
  #state: BrowserState = { open: false, workspaceId: '', views: {} }
  readonly #listeners = new Set<() => void>()
  #flight?: AbortController
  #generation = 0
  #disposed = false
  constructor(rpc: BrowserRpc) {
    this.#rpc = rpc
  }
  getSnapshot = (): BrowserState => this.#state
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }
  #publish(state: BrowserState): void {
    this.#state = state
    for (const listener of this.#listeners) listener()
  }
  #cancel(): void {
    this.#generation++
    this.#flight?.abort()
    this.#flight = undefined
    const id = this.#state.workspaceId
    if (this.#state.views[id]?.loading) this.patch({ loading: false })
  }
  show(workspaceId: string): void {
    if (this.#disposed) return
    this.#publish({ ...this.#state, open: true, fromReport: false })
    this.select(workspaceId)
  }
  /** Resolve a saved reference against a fresh Catalog, without reusing old filters or data. */
  showObject = (workspaceId: string, ref: SemanticRef): void => {
    if (this.#disposed || !workspaceId) return
    this.#cancel()
    this.#publish({
      ...this.#state,
      open: true,
      workspaceId,
      fromReport: true,
      views: {
        ...this.#state.views,
        [workspaceId]: { ...emptyView(), selected: refKey(ref) },
      },
    })
    void this.refresh()
  }
  close(): void {
    this.#cancel()
    this.#publish({ ...this.#state, open: false })
  }
  select(workspaceId: string): void {
    this.#cancel()
    this.#publish({ ...this.#state, workspaceId })
    if (workspaceId) void this.refresh()
  }
  patch(change: Partial<BrowserView>): void {
    const id = this.#state.workspaceId
    if (!id) return
    this.#publish({
      ...this.#state,
      views: {
        ...this.#state.views,
        [id]: { ...(this.#state.views[id] ?? emptyView()), ...change },
      },
    })
  }
  navigate(key: string): void {
    const view = this.#state.views[this.#state.workspaceId] ?? emptyView()
    if (key === view.selected) return
    this.patch({
      selected: key,
      history: view.selected ? [...view.history, view.selected] : view.history,
    })
  }
  back(): void {
    const history = this.#state.views[this.#state.workspaceId]?.history ?? []
    this.patch({ selected: history.at(-1) ?? '', history: history.slice(0, -1) })
  }
  unavailable(): void {
    this.#cancel()
    this.patch({ snapshot: undefined, error: 'Workspace 已不可用，请重新选择。' })
  }
  resetConnection(): void {
    this.#cancel()
    this.#publish({ ...this.#state, workspaceId: '', views: {} })
  }
  async refresh(): Promise<void> {
    const id = this.#state.workspaceId
    if (!id || !this.#state.open || this.#disposed) return
    this.#cancel()
    const flight = new AbortController(),
      generation = this.#generation
    this.#flight = flight
    this.patch({ loading: true, error: undefined })
    try {
      const result = (await this.#rpc.call(
        CHANNEL,
        BROWSER_ENDPOINT,
        { workspaceId: id },
        flight.signal,
      )) as { ok?: boolean; value?: unknown; error?: { message?: string } }
      if (this.#disposed || flight.signal.aborted || generation !== this.#generation) return
      if (!result.ok) {
        this.patch({ loading: false, error: result.error?.message ?? '无法加载语义层，请重试。' })
        return
      }
      const snapshot = parseCatalogSnapshot(result.value)
      if (snapshot.workspaceId !== id) throw new Error('workspace-mismatch')
      const view = this.#state.views[id] ?? emptyView()
      const index = this.#state.fromReport
        ? filterObjects(snapshot.objects, view).findIndex(
            (item) => refKey(item.ref) === view.selected,
          )
        : -1
      this.patch({
        loading: false,
        snapshot,
        error: undefined,
        ...(index >= 0 ? { page: Math.floor(index / PAGE_SIZE) } : {}),
      })
    } catch {
      if (!this.#disposed && !flight.signal.aborted && generation === this.#generation)
        this.patch({ loading: false, error: '无法加载语义层，请检查连接后重试。' })
    }
  }
  dispose(): void {
    this.#disposed = true
    this.#cancel()
    this.#listeners.clear()
  }
}
