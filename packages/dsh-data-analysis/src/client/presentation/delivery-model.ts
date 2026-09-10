import { zh as copyDictionary } from '../i18n/copy.ts'
import { savePresentationHtml } from './download.ts'

export { savePresentationHtml } from './download.ts'

import {
  parseReportHistory,
  type ReportHistory,
  type ReportVersion,
} from '../../presentation/contracts/catalog.ts'
import { type PresentationEdits, presentationEdits } from '../../presentation/contracts/editing.ts'
import {
  PRESENTATION_BUDGETS,
  type PresentationDocument,
  type PresentationReceipt,
  parsePresentationDocument,
  parsePresentationReceipt,
} from '../../presentation/contracts/index.ts'
import {
  MARIVO_PRESENTATION_RPC_CHANNEL,
  type PresentationDelivery,
  parsePresentationDelivery,
} from '../../presentation/receipt.ts'

export interface PresentationRpc {
  call(channel: string, endpoint: string, payload: unknown, signal: AbortSignal): Promise<unknown>
}
export type PresentationAsset = 'presentation.json' | 'index.html'
export interface WorkspaceReportTarget {
  workspaceId: string
  reportId: string
}
type ReportTarget = PresentationDelivery | WorkspaceReportTarget
const targetScope = (target: ReportTarget) =>
  'dshSessionId' in target
    ? { sessionId: target.dshSessionId }
    : { workspaceId: target.workspaceId }
const targetIdentity = (target: ReportTarget) => ('receipt' in target ? target.receipt : target)
export interface PresentationDeliveryState {
  readonly publishingConfigId?: string
  readonly publishingName?: string
  readonly publishingUnavailable?: boolean
  readonly publishingLoading?: boolean
  readonly publicationUrl?: string
  readonly reportTarget?: WorkspaceReportTarget
  readonly history?: ReportHistory
  readonly historyOpen?: boolean
  readonly historyLoading?: boolean
  readonly historyError?: string
  readonly historical?: boolean
  readonly receipts: Readonly<Record<string, PresentationReceipt>>
  readonly resolvedReceipt?: PresentationReceipt
  readonly editing?: {
    edits: PresentationEdits
    undo: PresentationEdits[]
    redo: PresentationEdits[]
  }
  readonly saving?: boolean
  readonly editError?: string
  readonly open: boolean
  readonly delivery?: PresentationDelivery
  readonly loading: boolean
  readonly downloading: boolean
  readonly document?: PresentationDocument
  readonly error?: string
  readonly downloadError?: string
  readonly notice?: string
}
export type SavePresentationHtml = (bytes: Uint8Array, filename: string) => void

/** Check the exact receipt-bound bytes before either parsing JSON or downloading HTML. */
export async function verifyPresentationAsset(
  value: unknown,
  receipt: PresentationReceipt,
  asset: PresentationAsset,
): Promise<Uint8Array> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid-presentation-file-response')
  const file = value as Record<string, unknown>
  // New reports export HTML on demand from the server-verified fixed JSON Build.
  const expected =
    asset === 'presentation.json'
      ? receipt.files.document
      : (receipt.files.html ?? { bytes: file.bytes as number, sha256: file.sha256 as string })
  if (
    !Number.isSafeInteger(expected.bytes) ||
    expected.bytes < 1 ||
    expected.bytes >
      (asset === 'presentation.json'
        ? PRESENTATION_BUDGETS.documentBytes
        : PRESENTATION_BUDGETS.htmlBytes) ||
    typeof expected.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(expected.sha256)
  )
    throw new Error('presentation-file-identity-mismatch')
  const mime = asset === 'presentation.json' ? 'application/json' : 'text/html'
  if (
    Object.keys(file).sort().join(',') !==
      'asset,bodyBase64,buildId,bytes,mimeType,reportId,sha256,workspaceId' ||
    file.workspaceId !== receipt.workspaceId ||
    file.reportId !== receipt.reportId ||
    file.buildId !== receipt.buildId ||
    file.asset !== asset ||
    file.sha256 !== expected.sha256 ||
    file.bytes !== expected.bytes ||
    typeof file.mimeType !== 'string' ||
    file.mimeType.split(';')[0] !== mime ||
    typeof file.bodyBase64 !== 'string' ||
    file.bodyBase64.length !== 4 * Math.ceil(expected.bytes / 3) ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(file.bodyBase64)
  )
    throw new Error('presentation-file-identity-mismatch')
  const decoded = atob(file.bodyBase64)
  if (decoded.length !== expected.bytes) throw new Error('presentation-file-size-mismatch')
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const actual = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
  if (actual !== expected.sha256) throw new Error('presentation-file-digest-mismatch')
  return bytes
}

const errorCopy: Readonly<Record<string, string>> = {
  'report-history-full':
    'marivo.presentation.report-history-has-reached-its-capacity-this-save-did',
  'report-save-conflict':
    'marivo.presentation.another-window-saved-this-report-your-edits-are-retained',
  'report-save-busy': 'marivo.presentation.the-report-is-being-saved-or-its-write-lock',
  'lock-timeout': 'marivo.presentation.the-report-is-being-saved-or-its-write-lock',
  'invalid-report-edits':
    'marivo.presentation.invalid-edits-check-the-title-content-and-chart-fields',
  invalid_value: 'marivo.presentation.invalid-edits-check-the-title-content-and-chart-fields',
  unknown_field: 'marivo.presentation.invalid-edits-check-the-title-content-and-chart-fields',
  duplicate_id: 'marivo.presentation.invalid-edits-check-the-title-content-and-chart-fields',
  budget: 'marivo.presentation.invalid-edits-check-the-title-content-and-chart-fields',
  'workspace-unavailable':
    'marivo.presentation.workspace-or-session-changed-or-is-unavailable-reopen-the',
  'workspace-changed':
    'marivo.presentation.workspace-or-session-changed-or-is-unavailable-reopen-the',
  'session-unavailable':
    'marivo.presentation.workspace-or-session-changed-or-is-unavailable-reopen-the',
  'presentation-workspace-mismatch':
    'marivo.presentation.workspace-or-session-changed-or-is-unavailable-reopen-the',
  ENOENT: 'marivo.presentation.analysis-snapshot-file-is-missing-regenerate-it',
  'asset-missing': 'marivo.presentation.analysis-snapshot-file-is-missing-regenerate-it',
  'file-missing': 'marivo.presentation.analysis-snapshot-file-is-missing-regenerate-it',
  'report-build-not-found': 'marivo.presentation.analysis-snapshot-file-is-missing-regenerate-it',
  'presentation-file-digest-mismatch':
    'marivo.presentation.analysis-snapshot-file-changed-and-no-longer-matches-the',
  'asset-digest-mismatch':
    'marivo.presentation.analysis-snapshot-file-changed-and-no-longer-matches-the',
  'asset-changed': 'marivo.presentation.analysis-snapshot-file-changed-and-no-longer-matches-the',
  'asset-too-large': 'marivo.presentation.analysis-snapshot-size-does-not-match-its-record-or',
  'presentation-file-size-mismatch':
    'marivo.presentation.analysis-snapshot-size-does-not-match-its-record-or',
  'asset-path-mismatch':
    'marivo.presentation.analysis-snapshot-path-or-ownership-does-not-match-its',
  'asset-owner-mismatch':
    'marivo.presentation.analysis-snapshot-path-or-ownership-does-not-match-its',
  'presentation-file-identity-mismatch':
    'marivo.presentation.analysis-snapshot-path-or-ownership-does-not-match-its',
  'presentation-document-identity-mismatch':
    'marivo.presentation.analysis-snapshot-path-or-ownership-does-not-match-its',
  'asset-not-file': 'marivo.presentation.analysis-snapshot-path-or-ownership-does-not-match-its',
  'invalid-presentation-file-response':
    'marivo.presentation.invalid-analysis-snapshot-content-it-cannot-be-opened',
  'invalid-report-current':
    'marivo.presentation.invalid-analysis-snapshot-content-it-cannot-be-opened',
  'invalid-report-history':
    'marivo.presentation.invalid-analysis-snapshot-content-it-cannot-be-opened',
  'report-version-unsupported': 'marivo.presentation.unsupported-report',
  'report-locale-invalid': 'marivo.presentation.unsupported-report',
}

class PresentationRequestError extends Error {
  readonly code: string
  constructor(code: string, detail: string) {
    super(detail)
    this.code = code
  }
}
export function errorMessage(error: unknown): string {
  if (error instanceof Error && Object.hasOwn(errorCopy, error.message))
    return errorCopy[error.message]!
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string' &&
    Object.hasOwn(errorCopy, error.code)
  )
    return errorCopy[error.code]!
  if (error instanceof Error && Object.hasOwn(copyDictionary, error.message)) return error.message
  if (error instanceof SyntaxError)
    return 'marivo.presentation.invalid-analysis-snapshot-content-it-cannot-be-opened'
  return 'marivo.presentation.cannot-read-the-analysis-snapshot-check-the-host-connection'
}

export const reportKey = (receipt: PresentationReceipt) =>
  `${receipt.workspaceId}/${receipt.reportId}`

/** Host file actions and editor state; never an Agent or data-source execution path. */
export class PresentationDeliveryModel {
  readonly #rpc: PresentationRpc
  readonly #save: SavePresentationHtml
  readonly #listeners = new Set<() => void>()
  #state: PresentationDeliveryState = {
    receipts: {},
    open: false,
    loading: false,
    downloading: false,
  }
  #flights = new Set<AbortController>()
  #publishingRead?: AbortController
  #previews = new Set<string>()
  #context = ''
  #generation = 0
  #disposed = false
  constructor(rpc: PresentationRpc, save: SavePresentationHtml = savePresentationHtml) {
    this.#rpc = rpc
    this.#save = save
  }
  getSnapshot = (): PresentationDeliveryState => this.#state
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }
  #publish(change: Partial<PresentationDeliveryState>) {
    this.#state = { ...this.#state, ...change }
    for (const listener of this.#listeners) listener()
  }
  #cancel() {
    this.#generation++
    for (const flight of this.#flights) flight.abort()
    this.#flights.clear()
  }
  #remember(receipt: PresentationReceipt) {
    this.#publish({ receipts: { ...this.#state.receipts, [reportKey(receipt)]: receipt } })
  }
  #valid(delivery: PresentationDelivery, sessionId: string, workspaceId: string) {
    parsePresentationDelivery(delivery)
    return (
      !this.#disposed &&
      sessionId === delivery.dshSessionId &&
      workspaceId === delivery.receipt.workspaceId
    )
  }
  async #call(endpoint: string, payload: unknown, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted()
    const response = (await this.#rpc.call(
      MARIVO_PRESENTATION_RPC_CHANNEL,
      endpoint,
      payload,
      signal,
    )) as {
      ok?: boolean
      value?: unknown
      error?: { code?: string; message?: string }
    }
    signal.throwIfAborted()
    if (response?.ok !== true) {
      const code =
        response?.error?.code ?? response?.error?.message ?? 'presentation-operation-failed'
      const detail = response?.error?.message ?? code
      if (
        ['workspace-unavailable', 'workspace-changed', 'session-unavailable'].includes(code) ||
        ['workspace-unavailable', 'workspace-changed', 'session-unavailable'].includes(detail)
      )
        this.unavailable()
      throw new PresentationRequestError(code, detail)
    }
    return response.value
  }
  async #resolve(delivery: ReportTarget, signal: AbortSignal) {
    const receipt = parsePresentationReceipt(
      await this.#call(
        'reports/resolve',
        {
          ...targetScope(delivery),
          reportId: targetIdentity(delivery).reportId,
        },
        signal,
      ),
    )
    if (
      receipt.workspaceId !== targetIdentity(delivery).workspaceId ||
      receipt.reportId !== targetIdentity(delivery).reportId
    )
      throw new Error('presentation-document-identity-mismatch')
    return receipt
  }
  async #read(
    delivery: ReportTarget,
    receipt: PresentationReceipt,
    asset: PresentationAsset,
    signal: AbortSignal,
  ) {
    return verifyPresentationAsset(
      await this.#call('files/read', { ...targetScope(delivery), receipt, asset }, signal),
      receipt,
      asset,
    )
  }
  async #document(delivery: ReportTarget, receipt: PresentationReceipt, signal: AbortSignal) {
    const bytes = await this.#read(delivery, receipt, 'presentation.json', signal)
    const document = parsePresentationDocument(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    )
    if (
      document.workspaceId !== receipt.workspaceId ||
      document.reportId !== receipt.reportId ||
      document.buildId !== receipt.buildId ||
      document.title !== receipt.title
    )
      throw new Error('presentation-document-identity-mismatch')
    return document
  }
  async preview(delivery: PresentationDelivery, sessionId: string, workspaceId: string) {
    const key = reportKey(delivery.receipt)
    if (!this.#valid(delivery, sessionId, workspaceId) || this.#previews.has(key)) return
    const flight = new AbortController(),
      generation = this.#generation
    this.#flights.add(flight)
    this.#previews.add(key)
    try {
      const receipt = await this.#resolve(delivery, flight.signal)
      if (!flight.signal.aborted && generation === this.#generation && !this.#disposed)
        this.#remember(receipt)
    } catch {
      /* Opening exposes the exact read error; a failed preview never substitutes another build. */
    } finally {
      this.#flights.delete(flight)
      this.#previews.delete(key)
    }
  }
  async show(
    delivery: PresentationDelivery,
    sessionId: string,
    workspaceId: string,
  ): Promise<void> {
    if (!this.#valid(delivery, sessionId, workspaceId)) {
      if (!this.#disposed) {
        this.#publish({ open: true, delivery })
        this.unavailable()
      }
      return
    }
    await this.#openTarget(delivery)
  }
  async showReport(workspaceId: string, reportId: string) {
    if (this.#disposed) return
    await this.#openTarget({ workspaceId, reportId })
  }
  /** Open a fixed published Build without first displaying the current pointer. */
  async showBuild(workspaceId: string, reportId: string, buildId: string) {
    if (this.#disposed) return
    await this.#openTarget({ workspaceId, reportId }, undefined, false, buildId)
  }
  async #openTarget(
    target: ReportTarget,
    version?: ReportVersion,
    preserveHistory = false,
    buildId?: string,
  ) {
    this.#cancel()
    const flight = new AbortController(),
      generation = this.#generation
    this.#flights.add(flight)
    this.#publish({
      open: true,
      delivery: 'dshSessionId' in target ? target : undefined,
      reportTarget: 'dshSessionId' in target ? undefined : target,
      historical: !!version && version.receipt.buildId !== this.#state.history?.currentBuildId,
      ...(preserveHistory
        ? {}
        : { history: undefined, historyOpen: false, historyError: undefined }),
      historyLoading: false,
      loading: true,
      downloading: false,
      document: undefined,
      resolvedReceipt: undefined,
      editing: undefined,
      saving: false,
      editError: undefined,
      error: undefined,
      downloadError: undefined,
      notice: undefined,
      publicationUrl: undefined,
      publishingName: undefined,
      publishingConfigId: undefined,
      publishingUnavailable: false,
      publishingLoading: true,
    })
    try {
      if (buildId) {
        const identity = targetIdentity(target)
        const history = parseReportHistory(
          await this.#call(
            'reports/history',
            { ...targetScope(target), reportId: identity.reportId },
            flight.signal,
          ),
        )
        if (history.workspaceId !== identity.workspaceId || history.reportId !== identity.reportId)
          throw new Error('presentation-document-identity-mismatch')
        version = history.versions.find((item) => item.receipt.buildId === buildId)
        if (!version) throw new Error('report-build-not-found')
        if (flight.signal.aborted || generation !== this.#generation || this.#disposed) return
        this.#publish({ history, historical: buildId !== history.currentBuildId })
      }
      const receipt = version?.receipt ?? (await this.#resolve(target, flight.signal))
      const document = await this.#document(target, receipt, flight.signal)
      if (flight.signal.aborted || generation !== this.#generation || this.#disposed) return
      if (!version) this.#remember(receipt)
      this.#publish({ resolvedReceipt: receipt, document, loading: false })
      void this.#describePublishing(receipt.workspaceId, generation)
    } catch (error) {
      if (!flight.signal.aborted && generation === this.#generation && !this.#disposed)
        this.#publish({ loading: false, publishingLoading: false, error: errorMessage(error) })
    } finally {
      this.#flights.delete(flight)
    }
  }
  async #describePublishing(workspaceId: string, generation: number): Promise<void> {
    if (generation !== this.#generation || this.#disposed) return
    this.#publishingRead?.abort()
    const flight = new AbortController()
    this.#publishingRead = flight
    this.#flights.add(flight)
    let publishingName: string | undefined
    let publishingConfigId: string | undefined
    let publishingUnavailable = false
    try {
      const result = (await this.#rpc.call(
        '/dsh-report-publishing',
        'describe',
        { workspaceId },
        flight.signal,
      )) as { ok: boolean; value?: { enabled: boolean; name?: string; configId?: string } }
      if (!result.ok || !result.value) throw new Error('publishing-unavailable')
      if (result.value.enabled) {
        if (!result.value.name || !result.value.configId) throw new Error('publishing-unavailable')
        publishingName = result.value.name
        publishingConfigId = result.value.configId
      }
    } catch {
      publishingUnavailable = true
    } finally {
      this.#flights.delete(flight)
    }
    if (flight.signal.aborted || generation !== this.#generation || this.#disposed) return
    this.#publish({
      publishingName,
      publishingConfigId,
      publishingUnavailable,
      publishingLoading: false,
    })
  }

  get dirty() {
    return (
      !!this.#state.editing &&
      !!this.#state.document &&
      JSON.stringify(this.#state.editing.edits) !==
        JSON.stringify(presentationEdits(this.#state.document))
    )
  }
  /** Recheck the current pointer without replacing the displayed document or its view state. */
  async beginCurrentEdit(validate: () => void = () => {}) {
    const { document, reportTarget, delivery } = this.#state
    const target = reportTarget ?? delivery
    if (!document || !target || this.#state.loading || this.#state.editing || this.#state.saving)
      return
    const flight = new AbortController(),
      generation = this.#generation
    this.#flights.add(flight)
    try {
      const current = await this.#resolve(target, flight.signal)
      if (flight.signal.aborted || generation !== this.#generation || this.#disposed) return
      validate()
      const historical = document.buildId !== current.buildId
      this.#publish({ historical })
      if (historical)
        throw new Error(
          'marivo.presentation.a-newer-version-exists-open-the-current-version-before',
        )
      this.beginEdit()
    } finally {
      this.#flights.delete(flight)
    }
  }
  beginEdit() {
    if (
      !this.#state.document ||
      this.#state.editing ||
      this.#state.saving ||
      this.#state.historical
    )
      return
    this.#publish({
      editing: { edits: presentationEdits(this.#state.document), undo: [], redo: [] },
      editError: undefined,
    })
  }
  changeEdits(edits: PresentationEdits) {
    const current = this.#state.editing
    if (!current || this.#state.saving || JSON.stringify(edits) === JSON.stringify(current.edits))
      return
    this.#publish({
      editing: {
        edits: structuredClone(edits),
        undo: [...current.undo.slice(-99), current.edits],
        redo: [],
      },
      editError: undefined,
    })
  }
  undoEdit() {
    const current = this.#state.editing
    if (!current?.undo.length || this.#state.saving) return
    this.#publish({
      editing: {
        edits: current.undo.at(-1)!,
        undo: current.undo.slice(0, -1),
        redo: [...current.redo, current.edits],
      },
      editError: undefined,
    })
  }
  redoEdit() {
    const current = this.#state.editing
    if (!current?.redo.length || this.#state.saving) return
    this.#publish({
      editing: {
        edits: current.redo.at(-1)!,
        redo: current.redo.slice(0, -1),
        undo: [...current.undo.slice(-99), current.edits],
      },
      editError: undefined,
    })
  }
  cancelEdit() {
    if (!this.#state.saving) this.#publish({ editing: undefined, editError: undefined })
  }
  async saveEdit() {
    const { editing, document, resolvedReceipt } = this.#state
    const delivery = this.#state.reportTarget ?? this.#state.delivery
    if (!editing || !document || !resolvedReceipt || !delivery || this.#state.saving) return
    const flight = new AbortController(),
      generation = this.#generation
    this.#flights.add(flight)
    this.#publish({ saving: true, editError: undefined })
    try {
      let receipt: PresentationReceipt
      try {
        receipt = parsePresentationReceipt(
          await this.#call(
            'reports/save',
            {
              ...targetScope(delivery),
              reportId: resolvedReceipt.reportId,
              expectedBuildId: resolvedReceipt.buildId,
              edits: editing.edits,
            },
            flight.signal,
          ),
        )
      } catch (error) {
        if (flight.signal.aborted || /conflict/.test(error instanceof Error ? error.message : ''))
          throw error
        // A lost response may follow a successful pointer commit. Confirm the exact submitted presentation.
        const recovered = await this.#resolve(delivery, flight.signal)
        const saved = await this.#document(delivery, recovered, flight.signal)
        if (
          recovered.buildId === resolvedReceipt.buildId ||
          JSON.stringify(presentationEdits(saved)) !== JSON.stringify(editing.edits)
        )
          throw error
        receipt = recovered
      }
      if (
        receipt.reportId !== resolvedReceipt.reportId ||
        receipt.workspaceId !== resolvedReceipt.workspaceId
      )
        throw new Error('presentation-document-identity-mismatch')
      const saved = await this.#document(delivery, receipt, flight.signal)
      if (flight.signal.aborted || generation !== this.#generation || this.#disposed) return
      this.#remember(receipt)
      this.#publish({
        document: saved,
        resolvedReceipt: receipt,
        editing: undefined,
        saving: false,
        notice: 'marivo.presentation.edits-saved',
        publishingLoading: true,
        publishingName: undefined,
        publishingConfigId: undefined,
        publishingUnavailable: false,
        publicationUrl: undefined,
        history: undefined,
        historyOpen: false,
        editError: undefined,
      })
      void this.#describePublishing(saved.workspaceId, generation)
    } catch (error) {
      if (!flight.signal.aborted && generation === this.#generation && !this.#disposed)
        this.#publish({ saving: false, editError: errorMessage(error) })
    } finally {
      this.#flights.delete(flight)
    }
  }
  async download(
    delivery: PresentationDelivery,
    sessionId: string,
    workspaceId: string,
    displayed = false,
  ): Promise<void> {
    if (!this.#valid(delivery, sessionId, workspaceId)) {
      this.unavailable()
      return
    }
    const flight = new AbortController(),
      generation = this.#generation
    this.#flights.add(flight)
    this.#publish({ downloading: true, downloadError: undefined })
    try {
      const receipt =
        displayed && this.#state.resolvedReceipt
          ? this.#state.resolvedReceipt
          : await this.#resolve(delivery, flight.signal)
      const bytes = await this.#read(delivery, receipt, 'index.html', flight.signal)
      if (flight.signal.aborted || generation !== this.#generation || this.#disposed) return
      if (!displayed) this.#remember(receipt)
      this.#save(bytes, `marivo-${receipt.reportId}-${receipt.buildId}.html`)
      this.#publish({
        downloading: false,
        notice: 'marivo.presentation.full-report-html-downloaded-without-temporary-filters',
      })
    } catch (error) {
      if (!flight.signal.aborted && generation === this.#generation && !this.#disposed)
        this.#publish({ downloading: false, downloadError: errorMessage(error) })
    } finally {
      this.#flights.delete(flight)
    }
  }
  async publishDisplayed(viewBytes?: Uint8Array) {
    const receipt = this.#state.resolvedReceipt
    if (
      !receipt ||
      !this.#state.document ||
      this.#state.editing ||
      this.#state.saving ||
      this.#state.error ||
      this.#state.downloading ||
      !this.#state.publishingName ||
      !this.#state.publishingConfigId
    )
      return
    const isCurrentBuild = () => {
      const current = this.#state.resolvedReceipt
      return (
        current?.workspaceId === receipt.workspaceId &&
        current.reportId === receipt.reportId &&
        current.buildId === receipt.buildId
      )
    }
    const flight = new AbortController(),
      generation = this.#generation
    this.#flights.add(flight)
    this.#publish({
      downloading: true,
      downloadError: undefined,
      publicationUrl: undefined,
      notice: undefined,
    })
    try {
      const result = (await this.#rpc.call(
        '/dsh-report-publishing',
        'publish',
        {
          configId: this.#state.publishingConfigId,
          workspaceId: receipt.workspaceId,
          reportId: receipt.reportId,
          buildId: receipt.buildId,
          ...(viewBytes ? { viewHtml: new TextDecoder().decode(viewBytes) } : {}),
        },
        flight.signal,
      )) as {
        ok: boolean
        value?: { url: string; workspaceId: string; reportId: string; buildId: string }
        error?: { message?: string }
      }
      if (flight.signal.aborted || generation !== this.#generation || this.#disposed) return
      if (!isCurrentBuild()) {
        this.#publish({ downloading: false })
        return
      }
      if (!result.ok) {
        const messages: Record<string, string> = {
          'report-publishing-config-changed':
            'marivo.presentation.publishing-configuration-changed-refresh-the-report-and-confirm-the',
          'report-publishing-credentials-missing':
            'marivo.presentation.publishing-credentials-are-incomplete-configure-them-under-datasources-and',
          'report-publishing-upload-unconfirmed':
            'marivo.presentation.publication-is-unconfirmed-the-object-may-have-uploaded-retry',
          'report-publishing-build-unavailable':
            'marivo.presentation.report-version-is-unavailable-refresh-the-report-and-retry',
          'report-publishing-disabled':
            'marivo.presentation.report-publishing-is-disabled-refresh-the-report',
          'report-publishing-view-invalid':
            'marivo.presentation.the-current-view-is-invalid-or-exceeds-the-html',
        }
        this.#publish({
          downloading: false,
          downloadError:
            messages[result.error?.message ?? ''] ??
            'marivo.presentation.publication-failed-check-the-configuration-and-report-before-retrying',
        })
        return
      }
      const value = result.value
      if (
        !value ||
        value.workspaceId !== receipt.workspaceId ||
        value.reportId !== receipt.reportId ||
        value.buildId !== receipt.buildId ||
        !/^https?:\/\//.test(value.url)
      )
        throw new Error('marivo.presentation.publishing-receipt-identity-mismatch')
      this.#publish({
        downloading: false,
        publicationUrl: value.url,
        notice: viewBytes
          ? 'marivo.presentation.current-view-html-published-including-current-filters-and-charts'
          : 'marivo.presentation.report-html-published-without-temporary-filters',
      })
    } catch (error) {
      if (!flight.signal.aborted && generation === this.#generation && !this.#disposed) {
        if (!isCurrentBuild()) {
          this.#publish({ downloading: false })
          return
        }
        this.#publish({
          downloading: false,
          downloadError:
            error instanceof Error &&
            error.message === 'marivo.presentation.publishing-receipt-identity-mismatch'
              ? error.message
              : 'marivo.presentation.publication-unconfirmed-check-the-connection-and-retry',
        })
      }
    } finally {
      this.#flights.delete(flight)
    }
  }
  async downloadDisplayed() {
    const target = this.#state.reportTarget ?? this.#state.delivery
    const receipt = this.#state.resolvedReceipt
    if (
      !target ||
      !receipt ||
      !this.#state.document ||
      this.#state.error ||
      this.#state.downloading
    )
      return
    const flight = new AbortController(),
      generation = this.#generation
    this.#flights.add(flight)
    this.#publish({ downloading: true, downloadError: undefined })
    try {
      const bytes = await this.#read(target, receipt, 'index.html', flight.signal)
      if (flight.signal.aborted || generation !== this.#generation || this.#disposed) return
      this.#save(bytes, `marivo-${receipt.reportId}-${receipt.buildId}.html`)
      this.#publish({
        downloading: false,
        notice:
          'marivo.presentation.downloaded-the-saved-version-being-viewed-without-temporary-filters',
      })
    } catch (error) {
      if (!flight.signal.aborted && generation === this.#generation && !this.#disposed)
        this.#publish({ downloading: false, downloadError: errorMessage(error) })
    } finally {
      this.#flights.delete(flight)
    }
  }
  async toggleHistory(refresh = false) {
    if (this.#state.historyOpen && !refresh) {
      this.#publish({ historyOpen: false })
      return
    }
    const target = this.#state.reportTarget ?? this.#state.delivery
    if (!target) return
    const flight = new AbortController(),
      generation = this.#generation
    this.#flights.add(flight)
    this.#publish({ historyOpen: true, historyLoading: true, historyError: undefined })
    try {
      const identity = targetIdentity(target)
      const history = parseReportHistory(
        await this.#call(
          'reports/history',
          { ...targetScope(target), reportId: identity.reportId },
          flight.signal,
        ),
      )
      if (history.workspaceId !== identity.workspaceId || history.reportId !== identity.reportId)
        throw new Error('presentation-document-identity-mismatch')
      if (flight.signal.aborted || generation !== this.#generation || this.#disposed) return
      this.#publish({
        history,
        historyLoading: false,
        historical: this.#state.resolvedReceipt?.buildId !== history.currentBuildId,
      })
    } catch (error) {
      if (!flight.signal.aborted && generation === this.#generation && !this.#disposed)
        this.#publish({ historyLoading: false, historyError: errorMessage(error) })
    } finally {
      this.#flights.delete(flight)
    }
  }
  async selectVersion(buildId?: string) {
    if (this.#state.editing || this.#state.saving) return
    const target = this.#state.reportTarget ?? this.#state.delivery
    if (!target) return
    const version = buildId
      ? this.#state.history?.versions.find((v) => v.receipt.buildId === buildId)
      : undefined
    if (buildId && !version) return
    await this.#openTarget(target, version, true)
    if (!version && this.#state.open && this.#state.historyOpen && this.#state.document)
      await this.toggleHistory(true)
  }
  contextChanged(sessionId: string, workspaceId: string) {
    const context = JSON.stringify([sessionId, workspaceId])
    if (!this.#state.reportTarget && this.#context && this.#context !== context) this.unavailable()
    this.#context = context
    const delivery = this.#state.delivery
    if (
      delivery &&
      (sessionId !== delivery.dshSessionId || workspaceId !== delivery.receipt.workspaceId)
    )
      this.unavailable()
  }
  unavailable(
    message = 'marivo.presentation.workspace-or-session-changed-or-is-unavailable-reopen-the-354',
  ) {
    this.#cancel()
    this.#publish({
      publishingLoading: false,
      receipts: {},
      history: undefined,
      historyLoading: false,
      historyError: undefined,
      document: undefined,
      resolvedReceipt: undefined,
      editing: undefined,
      saving: false,
      loading: false,
      downloading: false,
      editError: undefined,
      error: message,
      downloadError: message,
      notice: undefined,
      publicationUrl: undefined,
      publishingName: undefined,
      publishingConfigId: undefined,
      publishingUnavailable: true,
    })
  }
  close() {
    this.#cancel()
    this.#publish({
      publishingLoading: false,
      open: false,
      publicationUrl: undefined,
      publishingName: undefined,
      publishingConfigId: undefined,
      publishingUnavailable: true,
      reportTarget: undefined,
      delivery: undefined,
      history: undefined,
      historyOpen: false,
      historyLoading: false,
      loading: false,
      downloading: false,
      document: undefined,
      resolvedReceipt: undefined,
      editing: undefined,
      saving: false,
      editError: undefined,
    })
  }
  resetConnection() {
    this.unavailable('marivo.presentation.host-connection-reset-reopen-the-report')
  }
  dispose() {
    this.#disposed = true
    this.#cancel()
    this.#listeners.clear()
  }
}
