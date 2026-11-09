import path from 'node:path'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { finishCleanup, PendingTasks } from '../lifecycle.ts'
import { readPythonExecution } from '../python-execution.ts'
import { registerPluginRpc } from '../rpc.ts'
import { readReceiptAsset } from './asset.ts'
import { componentFromDocument, componentModelText } from './component-reference.ts'
import { parseAnalysisRecordId, parseSavedPresentation } from './contracts/analysis-document.ts'
import { parseComponentEnvelope, parseComponentRequest } from './contracts/component-reference.ts'
import { parseDatasetEnvelope, parseDatasetRequest } from './contracts/dataset-reference.ts'
import {
  PresentationContractError,
  parsePresentationBuildId,
  parsePresentationReceipt,
} from './contracts/index.ts'
import {
  type PointRequest,
  parsePointEnvelope,
  parsePointRequest,
} from './contracts/point-reference.ts'
import { isFrameSnapshotV2 } from './contracts/snapshot.ts'
import { datasetContext, datasetFromDocument, datasetPointContext } from './dataset-reference.ts'
import type { AnalysisDrafts } from './drafts.ts'
import { pointFromDocument } from './point-reference.ts'
import { draftDeliverySchema, MARIVO_PRESENTATION_RPC_CHANNEL } from './receipt.ts'
import {
  listReports,
  readAnalysisRecord,
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
  readonly #drafts?: AnalysisDrafts
  readonly #abort = new AbortController()
  readonly #tasks = new PendingTasks()
  #closing: Promise<void> | undefined
  constructor(
    resolve: PresentationWorkspaceResolver,
    resolveId?: PresentationWorkspaceResolver,
    drafts?: AnalysisDrafts,
  ) {
    this.#resolve = resolve
    this.#resolveId = resolveId
    this.#drafts = drafts
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
  point(
    endpoint: 'point/prepare' | 'point/serialize',
    payload: unknown,
    caller = new AbortController().signal,
  ) {
    return this.#tasks.track(this.#point(endpoint, payload, caller))
  }
  async #point(
    endpoint: 'point/prepare' | 'point/serialize',
    payload: unknown,
    caller: AbortSignal,
  ) {
    const signal = AbortSignal.any([caller, this.#abort.signal])
    signal.throwIfAborted()
    let request: PointRequest
    let supplied: ReturnType<typeof parsePointEnvelope> | undefined
    if (endpoint === 'point/prepare') {
      request = parsePointRequest(payload)
    } else {
      if (
        !payload ||
        typeof payload !== 'object' ||
        Array.isArray(payload) ||
        Object.keys(payload).join(',') !== 'envelope'
      )
        throw new Error('invalid-request')
      supplied = parsePointEnvelope(Reflect.get(payload, 'envelope'))
      const { sessionId, workspaceId, recordId, resourceName, row, field } = supplied
      request = { sessionId, workspaceId, recordId, resourceName, row, field }
    }
    const workspace = await this.#workspace({ sessionId: request.sessionId })
    if (!workspace || workspace.id !== request.workspaceId) throw new Error('workspace-unavailable')
    const root = path.resolve(workspace.path)
    const { reportId, buildId } = parseAnalysisRecordId(request.recordId)
    const document = await readAnalysisRecord(root, workspace.id, reportId, buildId, signal)
    const actual = pointFromDocument(document, request)
    const current = await this.#workspace({ sessionId: request.sessionId })
    if (!current || current.id !== workspace.id || path.resolve(current.path) !== root)
      throw new Error('workspace-changed')
    signal.throwIfAborted()
    if (endpoint === 'point/prepare') return { envelope: actual }
    if (JSON.stringify(supplied) !== JSON.stringify(actual)) throw new Error('point-mismatch')
    // The Frame identity comes from the validated Build, not the client reference.
    // Keeping it out of the envelope also preserves references prepared before it
    // was included in model context.
    const resource = document.resources[request.resourceName]
    if (resource?.kind !== 'snapshot' || !isFrameSnapshotV2(resource.snapshot))
      throw new Error('point-unavailable')
    const { sessionId, artifactId } = resource.snapshot.source
    const recovery = artifactId
      ? 'The Marivo Frame is persisted. Recovery requires its original Runtime/project and stored artifact; use current marivo_help for the public recovery contract and preserve these exact identities. Recovery is not a data refresh; report any recovery failure.'
      : 'The Marivo Frame was captured in memory without a persisted artifact. The original Frame cannot be recovered across processes from this identity; use the saved point context or independently verify another available source before further analysis.'
    return {
      text: `AnalysisFrame selected value from a saved snapshot (not a new query). The description is saved explanatory text; unavailable period details are not captured. marivoFrame contains Marivo identity, not the Harness session. ${recovery}\n${JSON.stringify(
        {
          recordId: actual.recordId,
          resource: actual.resourceName,
          row: actual.row,
          marivoFrame: { sessionId, artifactId },
          ...actual.point,
          interpretation:
            actual.point.interpretation === null ? null : JSON.parse(actual.point.interpretation),
          periods: JSON.parse(actual.point.periods),
        },
      )}`,
    }
  }
  component(
    endpoint: 'component/prepare' | 'component/serialize',
    payload: unknown,
    caller = new AbortController().signal,
  ) {
    return this.#tasks.track(this.#component(endpoint, payload, caller))
  }
  async #component(
    endpoint: 'component/prepare' | 'component/serialize',
    payload: unknown,
    caller: AbortSignal,
  ) {
    const signal = AbortSignal.any([caller, this.#abort.signal])
    signal.throwIfAborted()
    let request: ReturnType<typeof parseComponentRequest>
    let supplied: ReturnType<typeof parseComponentEnvelope> | undefined
    if (endpoint === 'component/prepare') request = parseComponentRequest(payload)
    else {
      if (
        !payload ||
        typeof payload !== 'object' ||
        Array.isArray(payload) ||
        Object.keys(payload).join(',') !== 'envelope'
      )
        throw new Error('invalid-request')
      supplied = parseComponentEnvelope(Reflect.get(payload, 'envelope'))
      const { sessionId, workspaceId, recordId, resourceName, component } = supplied
      request = { sessionId, workspaceId, recordId, resourceName, component }
    }
    const workspace = await this.#workspace({ sessionId: request.sessionId })
    if (!workspace || workspace.id !== request.workspaceId) throw new Error('workspace-unavailable')
    const root = path.resolve(workspace.path)
    const { reportId, buildId } = parseAnalysisRecordId(request.recordId)
    const document = await readAnalysisRecord(root, workspace.id, reportId, buildId, signal)
    const { envelope, snapshot, view, display } = componentFromDocument(document, request)
    const current = await this.#workspace({ sessionId: request.sessionId })
    if (!current || current.id !== workspace.id || path.resolve(current.path) !== root)
      throw new Error('workspace-changed')
    signal.throwIfAborted()
    if (endpoint === 'component/prepare') return { envelope }
    if (JSON.stringify(supplied) !== JSON.stringify(envelope)) throw new Error('component-mismatch')
    return { text: componentModelText(document, request, snapshot, view, display) }
  }
  dataset(
    endpoint: 'dataset/prepare' | 'dataset/serialize',
    payload: unknown,
    caller = new AbortController().signal,
  ) {
    return this.#tasks.track(this.#dataset(endpoint, payload, caller))
  }
  async #dataset(
    endpoint: 'dataset/prepare' | 'dataset/serialize',
    payload: unknown,
    caller: AbortSignal,
  ) {
    const signal = AbortSignal.any([caller, this.#abort.signal])
    signal.throwIfAborted()
    let request: ReturnType<typeof parseDatasetRequest>
    let supplied: ReturnType<typeof parseDatasetEnvelope> | undefined
    if (endpoint === 'dataset/prepare') {
      request = parseDatasetRequest(payload)
    } else {
      if (
        !payload ||
        typeof payload !== 'object' ||
        Array.isArray(payload) ||
        Object.keys(payload).join(',') !== 'envelope'
      )
        throw new Error('invalid-request')
      supplied = parseDatasetEnvelope(Reflect.get(payload, 'envelope'))
      const { sessionId, workspaceId, recordId, resourceName } = supplied
      request =
        supplied.schema === 'dsh-data-analysis-dataset-point/v1'
          ? {
              sessionId,
              workspaceId,
              recordId,
              resourceName,
              row: supplied.row,
              field: supplied.field,
            }
          : { sessionId, workspaceId, recordId, resourceName }
    }
    const workspace = await this.#workspace({ sessionId: request.sessionId })
    if (!workspace || workspace.id !== request.workspaceId) throw new Error('workspace-unavailable')
    const root = path.resolve(workspace.path)
    const { reportId, buildId } = parseAnalysisRecordId(request.recordId)
    const document = await readAnalysisRecord(root, workspace.id, reportId, buildId, signal)
    const { envelope, snapshot } = datasetFromDocument(document, request)
    const current = await this.#workspace({ sessionId: request.sessionId })
    if (!current || current.id !== workspace.id || path.resolve(current.path) !== root)
      throw new Error('workspace-changed')
    signal.throwIfAborted()
    if (endpoint === 'dataset/prepare') return { envelope }
    if (JSON.stringify(supplied) !== JSON.stringify(envelope)) throw new Error('dataset-mismatch')
    if ('row' in request)
      return {
        text: `DataFrame selected value from a saved snapshot (not a new query). Same-row context is bounded; consult coverage and rowContextTruncated before drawing conclusions:\n${JSON.stringify({ recordId: request.recordId, resource: request.resourceName, ...datasetPointContext(snapshot, request.row, request.field) })}`,
      }
    return {
      text: `DataFrame from a saved snapshot (not a new query). Columns and rows are bounded previews; consult coverage, columnsTruncated and previewTruncated before drawing conclusions:\n${JSON.stringify({ recordId: request.recordId, resource: request.resourceName, ...datasetContext(snapshot) })}`,
    }
  }
  report(payload: unknown, caller = new AbortController().signal) {
    return this.#tasks.track(this.#report(payload, caller))
  }
  draft(payload: unknown, caller: AbortSignal) {
    return this.#tasks.track(this.#readDraft(payload, caller))
  }
  async #readDraft(payload: unknown, caller: AbortSignal) {
    const signal = AbortSignal.any([caller, this.#abort.signal])
    signal.throwIfAborted()
    const parsed = draftDeliverySchema.safeParse(payload)
    if (!parsed.success) throw new Error('invalid-request')
    const request = parsed.data
    const workspace = await this.#workspace({ sessionId: request.dshSessionId })
    signal.throwIfAborted()
    const draft = this.#drafts?.get(request.dshSessionId)
    if (
      !draft ||
      !workspace ||
      draft.workspacePath !== workspace.path ||
      workspace.id !== request.workspaceId ||
      draft.delivery.workspaceId !== request.workspaceId ||
      draft.delivery.turn !== request.turn ||
      draft.delivery.surface !== request.surface ||
      draft.delivery.draftId !== request.draftId ||
      draft.delivery.draftRevision !== request.draftRevision
    )
      throw new Error('analysis-draft-unavailable')
    return draft.document
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
    return {
      text: snippet.text,
      sha256: snippet.sha256,
      ...(snippet.datasources ? { datasources: snippet.datasources } : {}),
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
    [
      'reports/resolve',
      'reports/list',
      'reports/history',
      'draft/read',
      'files/read',
      'code/read',
      'point/prepare',
      'point/serialize',
      'component/prepare',
      'component/serialize',
      'dataset/prepare',
      'dataset/serialize',
    ],
    async (endpoint, payload, signal) => {
      try {
        if (endpoint === 'reports/resolve')
          return { ok: true, value: await service.report(payload, signal) }
        if (endpoint === 'reports/list' || endpoint === 'reports/history')
          return { ok: true, value: await service.catalog(endpoint, payload, signal) }
        if (endpoint === 'files/read')
          return { ok: true, value: await service.read(payload, signal) }
        if (endpoint === 'draft/read')
          return { ok: true, value: await service.draft(payload, signal) }
        if (endpoint === 'code/read')
          return { ok: true, value: await service.code(payload, signal) }
        if (endpoint === 'dataset/prepare' || endpoint === 'dataset/serialize')
          return { ok: true, value: await service.dataset(endpoint, payload, signal) }
        if (endpoint === 'component/prepare' || endpoint === 'component/serialize')
          return { ok: true, value: await service.component(endpoint, payload, signal) }
        if (endpoint === 'point/prepare' || endpoint === 'point/serialize')
          return { ok: true, value: await service.point(endpoint, payload, signal) }
        throw new Error('unknown-endpoint')
      } catch (error) {
        const message = signal.aborted
          ? 'cancelled'
          : error instanceof PresentationContractError
            ? error.code
            : (error as NodeJS.ErrnoException)?.code === 'ENOENT'
              ? 'asset-missing'
              : error instanceof Error &&
                  /^(report-version-unsupported|invalid-request|workspace-unavailable|workspace-changed|asset-path-mismatch|asset-not-file|asset-too-large|asset-changed|asset-digest-mismatch|asset-owner-mismatch|unknown-endpoint|invalid-report-current|invalid-report-history|report-history-full|report-catalog-too-large|analysis-draft-unavailable|code-not-bound|code-unavailable|point-unavailable|point-mismatch|dataset-unavailable|dataset-mismatch|frame-unavailable|component-unavailable|component-mismatch|component-too-large)$/.test(
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
