import path from 'node:path'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { finishCleanup, PendingTasks } from '../lifecycle.ts'
import { readPythonExecution } from '../python-execution.ts'
import { registerPluginRpc } from '../rpc.ts'
import { readReceiptAsset } from './asset.ts'
import { parseSavedPresentation } from './contracts/analysis-document.ts'
import {
  PresentationContractError,
  parsePresentationBuildId,
  parsePresentationReceipt,
} from './contracts/index.ts'
import { MARIVO_PRESENTATION_RPC_CHANNEL } from './receipt.ts'
import { listReports, readReportHistory, resolvePresentation } from './reports.ts'

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
  report(payload: unknown, caller = new AbortController().signal) {
    return this.#tasks.track(this.#report(payload, caller))
  }
  async #report(payload: unknown, caller = new AbortController().signal) {
    const signal = AbortSignal.any([caller, this.#abort.signal])
    signal.throwIfAborted()
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      throw new Error('invalid-request')
    const input = payload as Record<string, unknown>
    const scope = this.#scope(input)
    const expected = ['reportId', scope].sort().join(',')
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
    return receipt
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
      input.asset !== 'presentation.json'
    )
      throw new Error('invalid-request')
    const receipt = structuredClone(parsePresentationReceipt(input.receipt))
    const asset = input.asset
    const workspace = await this.#workspace(input)
    if (!workspace || workspace.id !== receipt.workspaceId) throw new Error('workspace-unavailable')
    const root = path.resolve(workspace.path)
    const { bytes, sha256 } = await readReceiptAsset(root, workspace.id, receipt, signal)
    const current = await this.#workspace(input)
    if (!current || current.id !== workspace.id || path.resolve(current.path) !== root)
      throw new Error('workspace-changed')
    signal.throwIfAborted()
    return {
      workspaceId: workspace.id,
      reportId: receipt.reportId,
      buildId: receipt.buildId,
      asset,
      mimeType: 'application/json',
      sha256,
      bytes: bytes.length,
      bodyBase64: bytes.toString('base64'),
    }
  }
  code(payload: unknown, caller = new AbortController().signal) {
    return this.#tasks.track(this.#code(payload, caller))
  }
  /**
   * Python source for a codeRef bound by the Host to a resource of the exact saved document
   * named by the receipt. Never resolves execution IDs outside that document or Workspace.
   */
  async #code(payload: unknown, caller = new AbortController().signal) {
    const signal = AbortSignal.any([caller, this.#abort.signal])
    signal.throwIfAborted()
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      throw new Error('invalid-request')
    const input = payload as Record<string, unknown>
    if (
      Object.keys(input).sort().join(',') !==
      ['codeRef', 'receipt', this.#scope(input)].sort().join(',')
    )
      throw new Error('invalid-request')
    const raw = input.codeRef
    if (
      !raw ||
      typeof raw !== 'object' ||
      Array.isArray(raw) ||
      Object.keys(raw).sort().join(',') !== 'executionId,sha256'
    )
      throw new Error('invalid-request')
    const { executionId, sha256 } = raw as Record<string, unknown>
    if (
      typeof executionId !== 'string' ||
      !/^[0-9a-f-]{36}$/.test(executionId) ||
      typeof sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(sha256)
    )
      throw new Error('invalid-request')
    const receipt = structuredClone(parsePresentationReceipt(input.receipt))
    const workspace = await this.#workspace(input)
    if (!workspace || workspace.id !== receipt.workspaceId) throw new Error('workspace-unavailable')
    const root = path.resolve(workspace.path)
    const { bytes } = await readReceiptAsset(root, workspace.id, receipt, signal)
    const document = parseSavedPresentation(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    )
    if (
      !Object.values(document.resources).some(
        (r) =>
          r.kind === 'snapshot' &&
          r.binding.codeRef?.executionId === executionId &&
          r.binding.codeRef.sha256 === sha256,
      )
    )
      throw new Error('code-not-bound')
    let snippet: Awaited<ReturnType<typeof readPythonExecution>>
    try {
      snippet = await readPythonExecution(root, { executionId, sha256 }, signal)
    } catch (error) {
      signal.throwIfAborted()
      throw error instanceof Error && /^Python execution source/.test(error.message)
        ? new Error('code-unavailable')
        : error
    }
    const current = await this.#workspace(input)
    if (!current || current.id !== workspace.id || path.resolve(current.path) !== root)
      throw new Error('workspace-changed')
    signal.throwIfAborted()
    return { text: snippet.text, sha256: snippet.sha256 }
  }
}

export function registerMarivoPresentationRpc(
  connection: HostConnectionHandle,
  service: MarivoPresentationFileService,
) {
  const unregister = registerPluginRpc(
    connection,
    MARIVO_PRESENTATION_RPC_CHANNEL,
    ['reports/resolve', 'reports/list', 'reports/history', 'files/read', 'code/read'],
    async (endpoint, payload, signal) => {
      try {
        if (endpoint === 'reports/resolve')
          return { ok: true, value: await service.report(payload, signal) }
        if (endpoint === 'reports/list' || endpoint === 'reports/history')
          return { ok: true, value: await service.catalog(endpoint, payload, signal) }
        if (endpoint === 'files/read')
          return { ok: true, value: await service.read(payload, signal) }
        if (endpoint === 'code/read')
          return { ok: true, value: await service.code(payload, signal) }
        throw new Error('unknown-endpoint')
      } catch (error) {
        const message = signal.aborted
          ? 'cancelled'
          : error instanceof PresentationContractError
            ? error.code
            : (error as NodeJS.ErrnoException)?.code === 'ENOENT'
              ? 'asset-missing'
              : error instanceof Error &&
                  /^(report-version-unsupported|invalid-request|workspace-unavailable|workspace-changed|asset-path-mismatch|asset-not-file|asset-too-large|asset-changed|asset-digest-mismatch|asset-owner-mismatch|unknown-endpoint|invalid-report-current|invalid-report-history|report-history-full|report-catalog-too-large|code-not-bound|code-unavailable)$/.test(
                    error.message,
                  )
                ? error.message
                : 'presentation-operation-failed'
        return { ok: false, error: { code: 'internal', message, details: {} } }
      }
    },
  )
  let closing: Promise<void> | undefined
  return () => (closing ??= finishCleanup([unregister, () => service.close()]))
}
