import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { AnalysisDocument } from '../../presentation/contracts/analysis-document.ts'
import {
  parseReportHistory,
  type ReportHistory,
  type ReportVersion,
} from '../../presentation/contracts/catalog.ts'
import {
  PRESENTATION_BUDGETS,
  type PresentationReceipt,
  parsePresentationReceipt,
} from '../../presentation/contracts/index.ts'
import { parseSavedDocumentBytes } from '../../presentation/contracts/saved-document.ts'
import {
  MARIVO_PRESENTATION_RPC_CHANNEL,
  type PresentationDelivery,
  parsePresentationDelivery,
} from '../../presentation/receipt.ts'
import { zh as copyDictionary } from '../i18n/copy.ts'

export interface PresentationRpc {
  call(channel: string, endpoint: string, payload: unknown, signal: AbortSignal): Promise<unknown>
}
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
  readonly resolvedReceipt?: PresentationReceipt
  readonly open: boolean
  readonly delivery?: PresentationDelivery
  readonly loading: boolean
  readonly analysisDocument?: AnalysisDocument
  readonly error?: string
}

/** Check the exact receipt-bound bytes before parsing the saved JSON document. */
export async function verifyPresentationAsset(
  value: unknown,
  receipt: PresentationReceipt,
): Promise<Uint8Array> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid-presentation-file-response')
  const file = value as Record<string, unknown>
  const expected = receipt.files.document
  if (
    !Number.isSafeInteger(expected.bytes) ||
    expected.bytes < 1 ||
    expected.bytes > PRESENTATION_BUDGETS.documentBytes ||
    typeof expected.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(expected.sha256)
  )
    throw new Error('presentation-file-identity-mismatch')
  if (
    Object.keys(file).sort().join(',') !==
      'asset,bodyBase64,buildId,bytes,mimeType,reportId,sha256,workspaceId' ||
    file.workspaceId !== receipt.workspaceId ||
    file.reportId !== receipt.reportId ||
    file.buildId !== receipt.buildId ||
    file.asset !== 'presentation.json' ||
    file.sha256 !== expected.sha256 ||
    file.bytes !== expected.bytes ||
    typeof file.mimeType !== 'string' ||
    file.mimeType.split(';')[0] !== 'application/json' ||
    typeof file.bodyBase64 !== 'string' ||
    file.bodyBase64.length !== 4 * Math.ceil(expected.bytes / 3) ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(file.bodyBase64)
  )
    throw new Error('presentation-file-identity-mismatch')
  const decoded = atob(file.bodyBase64)
  if (decoded.length !== expected.bytes) throw new Error('presentation-file-size-mismatch')
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0))
  // Intranet HTTP pages lack crypto.subtle; verify the same bytes in every context.
  const actual = bytesToHex(sha256(bytes))
  if (actual !== expected.sha256) throw new Error('presentation-file-digest-mismatch')
  return bytes
}

const errorCopy: Readonly<Record<string, string>> = {
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
  'report-document-incompatible': 'marivo.presentation.incompatible-report',
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

/** Host file actions and editor state; never an Agent or data-source execution path. */
export class PresentationDeliveryModel {
  readonly #rpc: PresentationRpc
  readonly #listeners = new Set<() => void>()
  #state: PresentationDeliveryState = { open: false, loading: false }
  #flights = new Set<AbortController>()
  #generation = 0
  #disposed = false
  constructor(rpc: PresentationRpc) {
    this.#rpc = rpc
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
  async #document(delivery: ReportTarget, receipt: PresentationReceipt, signal: AbortSignal) {
    const bytes = await verifyPresentationAsset(
      await this.#call(
        'files/read',
        { ...targetScope(delivery), receipt, asset: 'presentation.json' },
        signal,
      ),
      receipt,
    )
    const document = parseSavedDocumentBytes(bytes)
    if (
      document.workspaceId !== receipt.workspaceId ||
      document.reportId !== receipt.reportId ||
      document.buildId !== receipt.buildId ||
      document.title !== receipt.title
    )
      throw new Error('presentation-document-identity-mismatch')
    return document
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
      analysisDocument: undefined,
      resolvedReceipt: undefined,
      error: undefined,
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
      this.#publish({ resolvedReceipt: receipt, analysisDocument: document, loading: false })
    } catch (error) {
      if (!flight.signal.aborted && generation === this.#generation && !this.#disposed)
        this.#publish({ loading: false, error: errorMessage(error) })
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
    const target = this.#state.reportTarget ?? this.#state.delivery
    if (!target) return
    const version = buildId
      ? this.#state.history?.versions.find((v) => v.receipt.buildId === buildId)
      : undefined
    if (buildId && !version) return
    await this.#openTarget(target, version, true)
    if (!version && this.#state.open && this.#state.historyOpen && this.#state.analysisDocument)
      await this.toggleHistory(true)
  }
  unavailable(
    message = 'marivo.presentation.workspace-or-session-changed-or-is-unavailable-reopen-the-354',
  ) {
    this.#cancel()
    this.#publish({
      history: undefined,
      historyLoading: false,
      historyError: undefined,
      analysisDocument: undefined,
      resolvedReceipt: undefined,
      loading: false,
      error: message,
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
      analysisDocument: undefined,
      resolvedReceipt: undefined,
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
