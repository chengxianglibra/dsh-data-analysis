import {
  type PresentationDocument,
  type PresentationReceipt,
  parsePresentationDocument,
} from '../../presentation/contracts/index.ts'
import {
  MARIVO_PRESENTATION_RPC_CHANNEL,
  type PresentationDelivery,
  parsePresentationDelivery,
} from '../../presentation/receipt.ts'
import { presentationDeliveryIdentity } from './delivery.ts'

export interface PresentationRpc {
  call(channel: string, endpoint: string, payload: unknown, signal: AbortSignal): Promise<unknown>
}
export type PresentationAsset = 'presentation.json' | 'index.html'
export interface PresentationDeliveryState {
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
      'asset,bodyBase64,buildId,bytes,mimeType,sha256,workspaceId' ||
    file.workspaceId !== receipt.workspaceId ||
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

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
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

/** A single reader owns only saved-file state. It cannot execute Python or request credentials. */
export class PresentationDeliveryModel {
  readonly #rpc: PresentationRpc
  readonly #save: SavePresentationHtml
  readonly #listeners = new Set<() => void>()
  #state: PresentationDeliveryState = { open: false, loading: false, downloading: false }
  #flights = new Set<AbortController>()
  #generation = 0
  #disposed = false
  constructor(rpc: PresentationRpc, save: SavePresentationHtml = savePresentationHtml) {
    this.#rpc = rpc
    this.#save = save
  }
  getSnapshot = (): PresentationDeliveryState => this.#state
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }
  #publish(change: Partial<PresentationDeliveryState>): void {
    this.#state = { ...this.#state, ...change }
    for (const listener of this.#listeners) listener()
  }
  #cancel(): void {
    this.#generation++
    for (const flight of this.#flights) flight.abort()
    this.#flights.clear()
  }
  #prepare(delivery: PresentationDelivery, sessionId: string, workspaceId: string): boolean {
    if (this.#disposed) return false
    parsePresentationDelivery(delivery)
    if (
      presentationDeliveryIdentity(delivery) !==
      (this.#state.delivery && presentationDeliveryIdentity(this.#state.delivery))
    ) {
      this.#cancel()
      this.#state = { open: false, loading: false, downloading: false, delivery }
    }
    if (sessionId !== delivery.dshSessionId || workspaceId !== delivery.receipt.workspaceId) {
      this.unavailable('Workspace 或 Session 已变化，无法读取这份分析快照。')
      return false
    }
    return true
  }
  contextChanged(sessionId: string, workspaceId: string): void {
    const delivery = this.#state.delivery
    if (
      delivery &&
      (sessionId !== delivery.dshSessionId || workspaceId !== delivery.receipt.workspaceId)
    )
      this.unavailable('Workspace 或 Session 已变化，无法读取这份分析快照。')
  }
  unavailable(message = 'Workspace 已不可用，无法读取这份分析快照。'): void {
    this.#cancel()
    this.#publish({
      document: undefined,
      loading: false,
      downloading: false,
      error: message,
      downloadError: message,
      notice: undefined,
    })
  }
  close(): void {
    this.#cancel()
    this.#publish({ open: false, loading: false, downloading: false, document: undefined })
  }
  resetConnection(): void {
    if (this.#state.delivery) this.unavailable('Host 连接已重置，请重新打开分析快照。')
  }
  async #read(
    delivery: PresentationDelivery,
    asset: PresentationAsset,
    signal: AbortSignal,
  ): Promise<Uint8Array> {
    const response = (await this.#rpc.call(
      MARIVO_PRESENTATION_RPC_CHANNEL,
      'files/read',
      {
        sessionId: delivery.dshSessionId,
        receipt: delivery.receipt,
        asset,
      },
      signal,
    )) as { ok?: boolean; value?: unknown; error?: { code?: string; message?: string } }
    if (response?.ok !== true)
      throw new Error(
        [response?.error?.code, response?.error?.message ?? '无法读取分析快照。']
          .filter(Boolean)
          .join(': '),
      )
    return verifyPresentationAsset(response.value, delivery.receipt, asset)
  }
  async show(
    delivery: PresentationDelivery,
    sessionId: string,
    workspaceId: string,
  ): Promise<void> {
    if (!this.#prepare(delivery, sessionId, workspaceId)) {
      if (!this.#disposed) this.#publish({ open: true })
      return
    }
    this.#cancel()
    const flight = new AbortController(),
      generation = this.#generation
    this.#flights.add(flight)
    this.#publish({
      open: true,
      loading: true,
      downloading: false,
      document: undefined,
      error: undefined,
      downloadError: undefined,
      notice: undefined,
    })
    try {
      const bytes = await this.#read(delivery, 'presentation.json', flight.signal)
      if (flight.signal.aborted || generation !== this.#generation || this.#disposed) return
      const document = parsePresentationDocument(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
      )
      if (
        document.workspaceId !== delivery.receipt.workspaceId ||
        document.buildId !== delivery.receipt.buildId ||
        document.title !== delivery.receipt.title
      )
        throw new Error('presentation-document-identity-mismatch')
      this.#publish({ document, loading: false })
    } catch (error) {
      if (!flight.signal.aborted && generation === this.#generation && !this.#disposed)
        this.#publish({ loading: false, error: errorMessage(error) })
    } finally {
      this.#flights.delete(flight)
    }
  }
  async download(
    delivery: PresentationDelivery,
    sessionId: string,
    workspaceId: string,
  ): Promise<void> {
    if (!this.#prepare(delivery, sessionId, workspaceId) || this.#state.downloading) return
    const flight = new AbortController(),
      generation = this.#generation
    this.#flights.add(flight)
    this.#publish({ downloading: true, downloadError: undefined, notice: undefined })
    try {
      const bytes = await this.#read(delivery, 'index.html', flight.signal)
      if (flight.signal.aborted || generation !== this.#generation || this.#disposed) return
      this.#save(bytes, `marivo-${delivery.receipt.buildId}.html`)
      this.#publish({ downloading: false, notice: '已下载 HTML' })
    } catch (error) {
      if (!flight.signal.aborted && generation === this.#generation && !this.#disposed)
        this.#publish({ downloading: false, downloadError: errorMessage(error) })
    } finally {
      this.#flights.delete(flight)
    }
  }
  dispose(): void {
    this.#disposed = true
    this.#cancel()
    this.#listeners.clear()
  }
}
