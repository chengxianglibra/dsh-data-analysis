import { parseReportCatalog, type ReportCatalog } from '../../presentation/contracts/catalog.ts'
import { MARIVO_PRESENTATION_RPC_CHANNEL } from '../../presentation/receipt.ts'
import { errorMessage, type PresentationRpc } from './delivery-model.ts'

export interface CatalogState {
  open: boolean
  workspaceId: string
  query: string
  sort: 'recent' | 'title'
  loading: boolean
  catalog?: ReportCatalog
  error?: string
}
export class ReportCatalogModel {
  #state: CatalogState = { open: false, workspaceId: '', query: '', sort: 'recent', loading: false }
  #flight?: AbortController
  #generation = 0
  #disposed = false
  readonly #listeners = new Set<() => void>()
  readonly rpc: PresentationRpc
  constructor(rpc: PresentationRpc) {
    this.rpc = rpc
  }
  getSnapshot = () => this.#state
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }
  patch(change: Partial<CatalogState>) {
    this.#state = { ...this.#state, ...change }
    for (const listener of this.#listeners) listener()
  }
  #cancel() {
    this.#generation++
    this.#flight?.abort()
  }
  show(workspaceId: string) {
    if (this.#disposed) return
    this.#cancel()
    this.patch({
      open: true,
      workspaceId,
      catalog: undefined,
      error: undefined,
      ...(workspaceId === this.#state.workspaceId ? {} : { query: '', sort: 'recent' }),
    })
    void this.refresh()
  }
  close() {
    this.#cancel()
    this.patch({ open: false, loading: false, catalog: undefined })
  }
  reset() {
    this.close()
    this.patch({ workspaceId: '', query: '', error: undefined })
  }
  async refresh() {
    if (!this.#state.open || !this.#state.workspaceId || this.#disposed) return
    this.#cancel()
    const generation = this.#generation,
      flight = new AbortController(),
      workspaceId = this.#state.workspaceId
    this.#flight = flight
    this.patch({ loading: true, error: undefined })
    try {
      const result = (await this.rpc.call(
        MARIVO_PRESENTATION_RPC_CHANNEL,
        'reports/list',
        { workspaceId },
        flight.signal,
      )) as {
        ok?: boolean
        value?: unknown
        error?: { message?: string }
      }
      if (!result?.ok) throw new Error(result?.error?.message ?? 'catalog-unavailable')
      const catalog = parseReportCatalog(result.value)
      if (catalog.workspaceId !== workspaceId) throw new Error('workspace-changed')
      if (this.#disposed || flight.signal.aborted || generation !== this.#generation) return
      this.patch({ catalog, loading: false })
    } catch (error) {
      if (!this.#disposed && !flight.signal.aborted && generation === this.#generation)
        this.patch({ catalog: undefined, loading: false, error: errorMessage(error) })
    }
  }
  dispose() {
    this.#disposed = true
    this.#cancel()
    this.#listeners.clear()
  }
}

export function visibleReports(state: CatalogState) {
  const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase()
  const words = normalize(state.query).trim().split(/\s+/).filter(Boolean)
  return (state.catalog?.reports ?? [])
    .filter((item) => words.every((word) => normalize(item.receipt.title).includes(word)))
    .sort(
      (a, b) =>
        (state.sort === 'title'
          ? a.receipt.title.localeCompare(b.receipt.title, 'zh-CN')
          : (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '')) ||
        a.receipt.reportId.localeCompare(b.receipt.reportId),
    )
}
