import {
  parseReportHistory,
  type ReportHistory,
  type ReportVersion,
} from '../../presentation/contracts/catalog.ts'
import { type PresentationEdits, presentationEdits } from '../../presentation/contracts/editing.ts'
import {
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

/** Download verified bytes as an attachment; never insert generated HTML in the Host DOM. */
export function savePresentationHtml(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([new Uint8Array(bytes)], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  try {
    document.body.append(anchor)
    anchor.click()
  } finally {
    anchor.remove()
    // Leave time for browsers to consume the download navigation.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

/** Check the exact receipt-bound bytes before either parsing JSON or downloading HTML. */
export async function verifyPresentationAsset(
  value: unknown,
  receipt: PresentationReceipt,
  asset: PresentationAsset,
): Promise<Uint8Array> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid-presentation-file-response')
  const file = value as Record<string, unknown>
  const expected = asset === 'presentation.json' ? receipt.files.document : receipt.files.html
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

export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (/report-history-full/.test(message)) return '报告版本记录已达到容量限制，本次保存未生效。'
  if (/report-save-conflict/.test(message))
    return '报告已被其他窗口保存。你的编辑已保留，请重新打开报告后再编辑。'
  if (/report-save-busy|lock.*timed out/i.test(message))
    return '报告正在保存或写入锁不可用，请稍后重试。'
  if (/invalid-report-edits|contract|invalid_value|unknown_field/i.test(message))
    return '编辑内容无效，请检查标题、正文和图表字段。'
  if (/workspace|session/i.test(message))
    return 'Workspace 或 Session 已变化或不可用，请在原项目中重新打开分析快照。'
  if (/ENOENT|asset-missing|file-missing|not-found/i.test(message))
    return '分析快照文件已缺失，请重新生成。'
  if (/digest-mismatch|asset-changed/i.test(message))
    return '分析快照文件已变化，与交付时的摘要不一致，无法读取或下载。'
  if (/asset-too-large|size-mismatch/i.test(message))
    return '分析快照文件大小与交付记录不一致或超出限制，无法读取。'
  if (/path-mismatch|owner-mismatch|identity-mismatch|asset-not-file/i.test(message))
    return '分析快照的文件路径或归属与交付记录不一致，无法读取。'
  if (/SyntaxError|JSON|UTF-8|invalid-presentation|presentation-document/i.test(message))
    return '分析快照文件内容无效，无法打开。'
  return '无法读取分析快照，请检查 Host 连接后重新打开。'
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
      const message = [
        response?.error?.code,
        response?.error?.message ?? 'presentation-operation-failed',
      ]
        .filter(Boolean)
        .join(': ')
      if (/workspace-(unavailable|changed)|session-unavailable/.test(message)) this.unavailable()
      throw new Error(message)
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
  async #openTarget(target: ReportTarget, version?: ReportVersion, preserveHistory = false) {
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
    })
    try {
      const receipt = version?.receipt ?? (await this.#resolve(target, flight.signal))
      const document = await this.#document(target, receipt, flight.signal)
      if (flight.signal.aborted || generation !== this.#generation || this.#disposed) return
      if (!version) this.#remember(receipt)
      this.#publish({ resolvedReceipt: receipt, document, loading: false })
    } catch (error) {
      if (!flight.signal.aborted && generation === this.#generation && !this.#disposed)
        this.#publish({ loading: false, error: errorMessage(error) })
    } finally {
      this.#flights.delete(flight)
    }
  }
  get dirty() {
    return (
      !!this.#state.editing &&
      !!this.#state.document &&
      JSON.stringify(this.#state.editing.edits) !==
        JSON.stringify(presentationEdits(this.#state.document))
    )
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
        notice: '编辑已保存',
        history: undefined,
        historyOpen: false,
        editError: undefined,
      })
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
      this.#publish({ downloading: false, notice: '已下载已保存的 HTML（不包含临时筛选）' })
    } catch (error) {
      if (!flight.signal.aborted && generation === this.#generation && !this.#disposed)
        this.#publish({ downloading: false, downloadError: errorMessage(error) })
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
      this.#publish({ downloading: false, notice: '已下载正在查看的已保存版本（不包含临时筛选）' })
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
  unavailable(message = 'Workspace 或 Session 已变化或不可用，请在原项目中重新打开报告。') {
    this.#cancel()
    this.#publish({
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
    })
  }
  close() {
    this.#cancel()
    this.#publish({
      open: false,
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
    this.unavailable('Host 连接已重置，请重新打开报告。')
  }
  dispose() {
    this.#disposed = true
    this.#cancel()
    this.#listeners.clear()
  }
}
