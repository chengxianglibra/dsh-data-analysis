import { parsePresentationReceipt } from '../../presentation/contracts/index.ts'
import type { PresentationReceipt } from '../../presentation/contracts/types.ts'
import { MARIVO_PRESENTATION_RPC_CHANNEL } from '../../presentation/receipt.ts'
import { CredentialClientModel } from '../credentials/model.ts'
import { ReportCatalogModel } from '../presentation/catalog-model.ts'
import { PresentationDeliveryModel, type PresentationRpc } from '../presentation/delivery-model.ts'
import type { ReaderViewMemory } from '../presentation/reader.tsx'
import { SemanticBrowserModel } from '../semantic-browser/model.ts'
import type { Directory, Resource } from './navigation.ts'

export type PageTarget = Resource | { kind: Directory; workspaceId: string }
export interface PageState {
  error?: string
  notice?: string
  newer?: PresentationReceipt
}
/** Lifetime belongs to a Host tab occurrence, never to a React body mount. */
export class TabPage {
  readonly sessionId: string
  readonly target: PageTarget
  readonly reader: PresentationDeliveryModel
  readonly catalog: ReportCatalogModel
  readonly semantic: SemanticBrowserModel
  readonly datasources: CredentialClientModel
  readonly viewMemory: ReaderViewMemory = new Map()
  readonly #rpc: PresentationRpc
  readonly #lifetime = new AbortController()
  #navigation = new AbortController()
  #revision = -1
  #updateRevision = 0
  #state: PageState = {}
  #listeners = new Set<() => void>()
  #closed = false
  constructor(sessionId: string, target: PageTarget, rpc: PresentationRpc, occurrenceId?: string) {
    this.sessionId = sessionId
    this.target = target
    this.#rpc = {
      call: async (channel, endpoint, payload, signal) => {
        const combined = AbortSignal.any([signal, this.#navigation.signal, this.#lifetime.signal])
        combined.throwIfAborted()
        const result = await rpc.call(channel, endpoint, payload, combined)
        combined.throwIfAborted()
        return result
      },
    }
    this.reader = new PresentationDeliveryModel(this.#rpc)
    this.catalog = new ReportCatalogModel(this.#rpc)
    this.semantic = new SemanticBrowserModel(this.#rpc)
    let storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined
    try {
      if (occurrenceId) {
        const saved = window.sessionStorage
        const key = `marivo-credential-operation:${JSON.stringify([sessionId, occurrenceId])}`
        storage = {
          getItem: () => saved.getItem(key),
          setItem: (_key, value) => saved.setItem(key, value),
          removeItem: () => saved.removeItem(key),
        }
      }
    } catch {
      // Host query handles remain recoverable in memory when storage is unavailable.
    }
    this.datasources = new CredentialClientModel(this.#rpc, storage)
    if (target.kind === 'datasources') this.datasources.recover()
  }
  getSnapshot = () => this.#state
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }
  patch(change: Partial<PageState>) {
    if (this.#closed) return
    this.#state = { ...this.#state, ...change }
    for (const listener of this.#listeners) listener()
  }
  async navigate(revision: number, force = false, history = false) {
    if (this.#closed || (this.#revision === revision && !force)) return
    this.#revision = revision
    if (this.reader.getSnapshot().editing || this.reader.getSnapshot().saving) {
      this.patch({ notice: 'marivo.navigation.your-edits-are-retained-save-or-cancel-them-first' })
      return
    }
    if (this.target.kind !== 'datasources' || this.#navigation.signal.aborted) {
      this.#navigation.abort()
      this.#navigation = new AbortController()
    }
    this.#updateRevision++
    this.patch({ error: undefined, newer: undefined, notice: undefined })
    const target = this.target
    if (target.kind === 'report') {
      if (target.buildId)
        await this.reader.showBuild(target.workspaceId, target.reportId, target.buildId)
      else await this.reader.showReport(target.workspaceId, target.reportId)
      if (
        history &&
        revision === this.#revision &&
        !this.#closed &&
        !this.#navigation.signal.aborted
      )
        await this.reader.toggleHistory()
      const displayed = this.reader.getSnapshot().document
      if (displayed)
        for (const key of this.viewMemory.keys())
          if (
            !key.startsWith(`${displayed.workspaceId}/${displayed.reportId}/${displayed.buildId}/`)
          )
            this.viewMemory.delete(key)
    } else if (target.kind === 'reports') this.catalog.show(target.workspaceId)
    else if (target.kind === 'datasources') await this.datasources.show(target.workspaceId)
    else if ('ref' in target) this.semantic.showObject(target.workspaceId, target.ref)
    else this.semantic.show(target.workspaceId)
  }
  async refresh(
    confirmDiscard: () => boolean = () =>
      window.confirm('marivo.navigation.there-are-unsaved-edits-discard-them-and-refresh-the'),
  ) {
    // Incidental refreshes must not undo revocation. Only a checked navigation
    // can reopen an unavailable occurrence.
    if (this.#state.error || this.reader.getSnapshot().saving) return
    if (this.reader.dirty && !confirmDiscard()) return
    this.reader.cancelEdit()
    await this.navigate(this.#revision, true)
  }
  async publicationChanged(workspaceId: string, reportId?: string) {
    if (this.#closed || this.#state.error || workspaceId !== this.target.workspaceId) return
    if (this.target.kind === 'reports') {
      await this.catalog.refresh()
      return
    }
    if (
      this.target.kind !== 'report' ||
      this.target.buildId ||
      (reportId && reportId !== this.target.reportId)
    )
      return
    const generation = ++this.#updateRevision
    try {
      const response = (await this.#rpc.call(
        MARIVO_PRESENTATION_RPC_CHANNEL,
        'reports/resolve',
        { workspaceId, reportId: this.target.reportId },
        this.#navigation.signal,
      )) as any
      if (!response?.ok)
        throw new Error(
          response?.error?.message ?? 'marivo.navigation.cannot-verify-the-new-version',
        )
      const receipt = parsePresentationReceipt(response.value)
      if (receipt.workspaceId !== workspaceId || receipt.reportId !== this.target.reportId)
        throw new Error('marivo.navigation.report-identity-changed')
      if (generation !== this.#updateRevision || this.#closed) return
      this.patch({
        newer:
          receipt.buildId !== this.reader.getSnapshot().document?.buildId ? receipt : undefined,
      })
    } catch (error) {
      if (generation === this.#updateRevision && !this.#closed && !this.#state.error)
        this.patch({
          notice:
            error instanceof Error
              ? error.message
              : 'marivo.navigation.cannot-verify-the-new-version',
        })
    }
  }
  unavailable(message: string) {
    this.#navigation.abort()
    this.#updateRevision++
    this.reader.unavailable(message)
    this.catalog.reset()
    this.semantic.unavailable()
    this.datasources.suspend()
    this.viewMemory.clear()
    this.patch({ error: message, newer: undefined })
  }
  dispose() {
    if (this.#closed) return
    this.#closed = true
    this.#lifetime.abort()
    this.reader.dispose()
    this.catalog.dispose()
    this.semantic.dispose()
    this.datasources.dispose()
    this.viewMemory.clear()
    this.#listeners.clear()
  }
}
