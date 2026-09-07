import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { applyPresentationEdits } from './contracts/editing.ts'
import {
  type PresentationAsset,
  parsePresentationBuildId,
  parsePresentationDocument,
  parsePresentationReceipt,
} from './contracts/index.ts'
import { presentationAssetPath, presentationSha256, readPresentationAsset } from './files.ts'
import { MARIVO_PRESENTATION_RPC_CHANNEL } from './receipt.ts'
import { publishPresentation, readReceiptDocument, resolvePresentation } from './reports.ts'

export interface PresentationWorkspace {
  id: string
  path: string
}
export type PresentationWorkspaceResolver = (
  sessionId: string,
) => PresentationWorkspace | undefined | Promise<PresentationWorkspace | undefined>

export class MarivoPresentationFileService {
  readonly #resolve: PresentationWorkspaceResolver
  readonly #abort = new AbortController()
  constructor(resolve: PresentationWorkspaceResolver) {
    this.#resolve = resolve
  }
  async #workspace(sessionId: string): Promise<PresentationWorkspace | undefined> {
    try {
      return await this.#resolve(sessionId)
    } catch {
      throw new Error('workspace-unavailable')
    }
  }
  close() {
    this.#abort.abort()
  }
  async report(
    endpoint: 'reports/resolve' | 'reports/save',
    payload: unknown,
    caller = new AbortController().signal,
  ) {
    const signal = AbortSignal.any([caller, this.#abort.signal])
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      throw new Error('invalid-request')
    const input = payload as Record<string, unknown>
    const expected =
      endpoint === 'reports/save'
        ? 'edits,expectedBuildId,reportId,sessionId'
        : 'reportId,sessionId'
    if (
      Object.keys(input).sort().join(',') !== expected ||
      typeof input.sessionId !== 'string' ||
      !input.sessionId.trim() ||
      input.sessionId.length > 512
    )
      throw new Error('invalid-request')
    const reportId = parsePresentationBuildId(input.reportId, '/reportId')
    const workspace = await this.#workspace(input.sessionId)
    if (!workspace) throw new Error('workspace-unavailable')
    const root = path.resolve(workspace.path)
    const check = async () => {
      signal.throwIfAborted()
      const current = await this.#workspace(input.sessionId as string)
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
    )
  }
  async read(payload: unknown, caller = new AbortController().signal) {
    const signal = AbortSignal.any([caller, this.#abort.signal])
    signal.throwIfAborted()
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      throw new Error('invalid-request')
    const input = payload as Record<string, unknown>
    if (
      Object.keys(input).sort().join(',') !== 'asset,receipt,sessionId' ||
      typeof input.sessionId !== 'string' ||
      !input.sessionId.trim() ||
      input.sessionId.length > 512 ||
      (input.asset !== 'presentation.json' && input.asset !== 'index.html')
    )
      throw new Error('invalid-request')
    const receipt = structuredClone(parsePresentationReceipt(input.receipt))
    const asset: PresentationAsset = input.asset
    const workspace = await this.#workspace(input.sessionId)
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
        : await readPresentationAsset(root, receipt.reportId, receipt.buildId, asset, signal)
    const file = asset === 'presentation.json' ? receipt.files.document : receipt.files.html
    if (bytes.length !== file.bytes || presentationSha256(bytes) !== file.sha256)
      throw new Error('asset-digest-mismatch')
    const current = await this.#workspace(input.sessionId)
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
  const unregister = connection.rpc.handle(
    MARIVO_PRESENTATION_RPC_CHANNEL,
    async (endpoint, payload, signal) => {
      try {
        if (endpoint === 'reports/resolve' || endpoint === 'reports/save')
          return { ok: true, value: await service.report(endpoint, payload, signal) }
        if (endpoint === 'files/read')
          return { ok: true, value: await service.read(payload, signal) }
        throw new Error('unknown-endpoint')
      } catch (error) {
        const message = signal.aborted
          ? 'cancelled'
          : (error as NodeJS.ErrnoException)?.code === 'ENOENT'
            ? 'asset-missing'
            : error instanceof Error &&
                /^(invalid-request|workspace-unavailable|workspace-changed|asset-path-mismatch|asset-not-file|asset-too-large|asset-changed|asset-digest-mismatch|asset-owner-mismatch|unknown-endpoint|invalid-report-current|invalid-report-edits|report-save-conflict|presentation-directory-changed)$/.test(
                  error.message,
                )
              ? error.message
              : error instanceof Error && /lock.*timed out|timed out.*lock/i.test(error.message)
                ? 'report-save-busy'
                : 'presentation-operation-failed'
        return { ok: false, error: { code: 'internal', message, details: {} } }
      }
    },
    { authority: 'trusted-host' },
  )
  return async () => {
    service.close()
    await unregister()
  }
}
