import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { finishCleanup, PendingTasks } from '../lifecycle.ts'
import { registerPluginRpc } from '../rpc.ts'
import { buildPresentation } from './build/index.ts'
import { applyPresentationEdits } from './contracts/editing.ts'
import {
  type PresentationAsset,
  PresentationContractError,
  parsePresentationBuildId,
  parsePresentationDocument,
  parsePresentationReceipt,
} from './contracts/index.ts'
import { presentationAssetPath, presentationSha256, readPresentationAsset } from './files.ts'
import { MARIVO_PRESENTATION_RPC_CHANNEL } from './receipt.ts'
import {
  listReports,
  publishPresentation,
  readReceiptDocument,
  readReportHistory,
  resolvePresentation,
} from './reports.ts'

export interface PresentationWorkspace {
  id: string
  path: string
}
export type PresentationWorkspaceResolver = (
  sessionId: string,
) => PresentationWorkspace | undefined | Promise<PresentationWorkspace | undefined>

export class MarivoPresentationFileService {
  readonly #resolve: PresentationWorkspaceResolver
  readonly #resolveId?: PresentationWorkspaceResolver
  readonly #abort = new AbortController()
  readonly #tasks = new PendingTasks()
  #closing: Promise<void> | undefined
  constructor(resolve: PresentationWorkspaceResolver, resolveId?: PresentationWorkspaceResolver) {
    this.#resolve = resolve
    this.#resolveId = resolveId
  }
  async #workspace(input: Record<string, unknown>): Promise<PresentationWorkspace | undefined> {
    try {
      if ('workspaceId' in input) {
        const workspace = await this.#resolveId?.(input.workspaceId as string)
        if (workspace && workspace.id !== input.workspaceId)
          throw new Error('workspace-unavailable')
        return workspace
      }
      return await this.#resolve(input.sessionId as string)
    } catch {
      throw new Error('workspace-unavailable')
    }
  }
  #scope(input: Record<string, unknown>): 'workspaceId' | 'sessionId' {
    const scope = 'workspaceId' in input ? 'workspaceId' : 'sessionId'
    if (
      typeof input[scope] !== 'string' ||
      !input[scope].trim() ||
      input[scope].length > 512 ||
      ('workspaceId' in input && 'sessionId' in input)
    )
      throw new Error('invalid-request')
    return scope
  }
  catalog(
    endpoint: 'reports/list' | 'reports/history',
    payload: unknown,
    caller = new AbortController().signal,
  ) {
    return this.#tasks.track(this.#catalog(endpoint, payload, caller))
  }
  async #catalog(
    endpoint: 'reports/list' | 'reports/history',
    payload: unknown,
    caller = new AbortController().signal,
  ) {
    const signal = AbortSignal.any([caller, this.#abort.signal])
    signal.throwIfAborted()
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      throw new Error('invalid-request')
    const input = payload as Record<string, unknown>
    const scope = this.#scope(input)
    const expected = endpoint === 'reports/list' ? scope : ['reportId', scope].sort().join(',')
    if (Object.keys(input).sort().join(',') !== expected) throw new Error('invalid-request')
    const workspace = await this.#workspace(input)
    if (!workspace) throw new Error('workspace-unavailable')
    const root = path.resolve(workspace.path)
    const result =
      endpoint === 'reports/list'
        ? await listReports(root, workspace.id, signal)
        : await readReportHistory(
            root,
            workspace.id,
            parsePresentationBuildId(input.reportId),
            signal,
          )
    const current = await this.#workspace(input)
    if (!current || current.id !== workspace.id || path.resolve(current.path) !== root)
      throw new Error('workspace-changed')
    signal.throwIfAborted()
    return result
  }
  close(): Promise<void> {
    this.#abort.abort()
    this.#closing ??= finishCleanup([() => this.#tasks.drain()])
    return this.#closing
  }
  report(
    endpoint: 'reports/resolve' | 'reports/save',
    payload: unknown,
    caller = new AbortController().signal,
  ) {
    return this.#tasks.track(this.#report(endpoint, payload, caller))
  }
  async #report(
    endpoint: 'reports/resolve' | 'reports/save',
    payload: unknown,
    caller = new AbortController().signal,
  ) {
    const signal = AbortSignal.any([caller, this.#abort.signal])
    signal.throwIfAborted()
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      throw new Error('invalid-request')
    const input = payload as Record<string, unknown>
    const scope = this.#scope(input)
    const expected = (
      endpoint === 'reports/save'
        ? ['edits', 'expectedBuildId', 'reportId', scope]
        : ['reportId', scope]
    )
      .sort()
      .join(',')
    if (Object.keys(input).sort().join(',') !== expected) throw new Error('invalid-request')
    const reportId = parsePresentationBuildId(input.reportId, '/reportId')
    const workspace = await this.#workspace(input)
    if (!workspace) throw new Error('workspace-unavailable')
    const root = path.resolve(workspace.path)
    const check = async () => {
      signal.throwIfAborted()
      const current = await this.#workspace(input)
      if (!current || current.id !== workspace.id || path.resolve(current.path) !== root)
        throw new Error('workspace-changed')
    }
    await check()
    const receipt = await resolvePresentation(root, workspace.id, reportId, signal)
    await check()
    if (endpoint === 'reports/resolve') return receipt
    const expectedBuildId = parsePresentationBuildId(input.expectedBuildId)
    if (receipt.buildId !== expectedBuildId) throw new Error('report-save-conflict')
    const base = await readReceiptDocument(root, receipt, signal)
    let edited: ReturnType<typeof applyPresentationEdits>
    try {
      edited = applyPresentationEdits(base, input.edits)
    } catch {
      throw new Error('invalid-report-edits')
    }
    await check()
    return publishPresentation(
      root,
      { ...edited, buildId: randomUUID(), generatedAt: new Date().toISOString() },
      expectedBuildId,
      check,
      signal,
      { kind: 'reader', sessionId: typeof input.sessionId === 'string' ? input.sessionId : null },
    )
  }
  read(payload: unknown, caller = new AbortController().signal) {
    return this.#tasks.track(this.#read(payload, caller))
  }
  async #read(payload: unknown, caller = new AbortController().signal) {
    const signal = AbortSignal.any([caller, this.#abort.signal])
    signal.throwIfAborted()
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      throw new Error('invalid-request')
    const input = payload as Record<string, unknown>
    if (
      Object.keys(input).sort().join(',') !==
        ['asset', 'receipt', this.#scope(input)].sort().join(',') ||
      (input.asset !== 'presentation.json' && input.asset !== 'index.html')
    )
      throw new Error('invalid-request')
    const receipt = structuredClone(parsePresentationReceipt(input.receipt))
    const asset: PresentationAsset = input.asset
    const workspace = await this.#workspace(input)
    if (!workspace || workspace.id !== receipt.workspaceId) throw new Error('workspace-unavailable')
    const root = path.resolve(workspace.path)
    for (const file of Object.values(receipt.files))
      if (file.path !== presentationAssetPath(root, receipt.reportId, receipt.buildId, file.asset))
        throw new Error('asset-path-mismatch')
    const documentBytes = await readPresentationAsset(
      root,
      receipt.reportId,
      receipt.buildId,
      'presentation.json',
      signal,
    )
    if (
      documentBytes.length !== receipt.files.document.bytes ||
      presentationSha256(documentBytes) !== receipt.files.document.sha256
    )
      throw new Error('asset-digest-mismatch')
    const document = parsePresentationDocument(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(documentBytes)),
    )
    if (
      document.workspaceId !== workspace.id ||
      document.reportId !== receipt.reportId ||
      document.buildId !== receipt.buildId ||
      document.title !== receipt.title
    )
      throw new Error('asset-owner-mismatch')
    const bytes =
      asset === 'presentation.json'
        ? documentBytes
        : receipt.files.html
          ? await readPresentationAsset(root, receipt.reportId, receipt.buildId, asset, signal)
          : (await buildPresentation(document)).htmlBytes!
    const file =
      asset === 'presentation.json'
        ? receipt.files.document
        : (receipt.files.html ?? { bytes: bytes.length, sha256: presentationSha256(bytes) })
    if (bytes.length !== file.bytes || presentationSha256(bytes) !== file.sha256)
      throw new Error('asset-digest-mismatch')
    const current = await this.#workspace(input)
    if (!current || current.id !== workspace.id || path.resolve(current.path) !== root)
      throw new Error('workspace-changed')
    signal.throwIfAborted()
    return {
      workspaceId: workspace.id,
      reportId: receipt.reportId,
      buildId: receipt.buildId,
      asset,
      mimeType: asset === 'presentation.json' ? 'application/json' : 'text/html',
      sha256: file.sha256,
      bytes: bytes.length,
      bodyBase64: bytes.toString('base64'),
    }
  }
}

export function registerMarivoPresentationRpc(
  connection: HostConnectionHandle,
  service: MarivoPresentationFileService,
) {
  const unregister = registerPluginRpc(
    connection,
    MARIVO_PRESENTATION_RPC_CHANNEL,
    ['reports/resolve', 'reports/save', 'reports/list', 'reports/history', 'files/read'],
    async (endpoint, payload, signal) => {
      try {
        if (endpoint === 'reports/resolve' || endpoint === 'reports/save')
          return { ok: true, value: await service.report(endpoint, payload, signal) }
        if (endpoint === 'reports/list' || endpoint === 'reports/history')
          return { ok: true, value: await service.catalog(endpoint, payload, signal) }
        if (endpoint === 'files/read')
          return { ok: true, value: await service.read(payload, signal) }
        throw new Error('unknown-endpoint')
      } catch (error) {
        const message = signal.aborted
          ? 'cancelled'
          : error instanceof PresentationContractError
            ? error.code
            : (error as NodeJS.ErrnoException)?.code === 'ENOENT'
              ? 'asset-missing'
              : error instanceof Error &&
                  /^(invalid-request|workspace-unavailable|workspace-changed|asset-path-mismatch|asset-not-file|asset-too-large|asset-changed|asset-digest-mismatch|asset-owner-mismatch|unknown-endpoint|invalid-report-current|invalid-report-history|report-history-full|report-catalog-too-large|invalid-report-edits|report-save-conflict|presentation-directory-changed)$/.test(
                    error.message,
                  )
                ? error.message
                : error instanceof Error && /lock.*timed out|timed out.*lock/i.test(error.message)
                  ? 'report-save-busy'
                  : 'presentation-operation-failed'
        return { ok: false, error: { code: 'internal', message, details: {} } }
      }
    },
  )
  let closing: Promise<void> | undefined
  return () => (closing ??= finishCleanup([unregister, () => service.close()]))
}
