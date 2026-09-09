import { realpath } from 'node:fs/promises'
import type { MarivoCheckedRunner } from '../environment/types.ts'
import { boundedText, closed } from '../semantic-reference/contracts.ts'
import { semanticEnvironmentFingerprint } from '../semantic-reference/environment.ts'
import { abortable } from '../semantic-reference/rpc.ts'
import { CATALOG_MAX_BYTES, type CatalogSnapshot, parseCatalogProjection } from './contracts.ts'
import { BROWSER_CATALOG_PROGRAM } from './program.ts'

export interface BrowserWorkspace {
  readonly id: string
  readonly path: string
}
export interface BrowserHost {
  getWorkspace(id: string): BrowserWorkspace | undefined
  projectRoot(workspace: BrowserWorkspace): string
  resolve(root: string): Promise<MarivoCheckedRunner>
}

/** Workspace-addressed read service; intentionally has no Agent or credential dependency. */
export class SemanticBrowserService {
  readonly #host: BrowserHost
  readonly #lifetime = new AbortController()
  constructor(host: BrowserHost) {
    this.#host = host
  }
  #assertOwner(id: string, workspacePath: string, root: string): void {
    const current = this.#host.getWorkspace(id)
    if (!current || current.path !== workspacePath || this.#host.projectRoot(current) !== root)
      throw new Error('workspace-changed')
  }
  async read(payload: unknown, caller: AbortSignal): Promise<CatalogSnapshot> {
    const signal = AbortSignal.any([caller, this.#lifetime.signal])
    signal.throwIfAborted()
    const request = closed(payload, ['workspaceId'])
    const id = boundedText(request.workspaceId, 256)
    const workspace = this.#host.getWorkspace(id)
    if (!workspace) throw new Error('workspace-unavailable')
    const root = this.#host.projectRoot(workspace)
    const runner = await abortable(this.#host.resolve(root), signal)
    this.#assertOwner(id, workspace.path, root)
    if (runner.status !== 'ready') throw new Error('environment-failed')
    const result = await runner.runChecked({
      program: BROWSER_CATALOG_PROGRAM,
      args: [runner.binding.projectRoot],
      signal,
      environmentOverlay: { MARIVO_TELEMETRY: 'off', PYTHONDONTWRITEBYTECODE: '1' },
      limits: { timeoutMs: 30_000, stdoutMaxBytes: CATALOG_MAX_BYTES, stderrMaxBytes: 8192 },
    })
    signal.throwIfAborted()
    if ((await realpath(root)) !== runner.binding.projectRoot) throw new Error('workspace-changed')
    this.#assertOwner(id, workspace.path, root)
    signal.throwIfAborted()
    if (result.exitCode !== 0) throw new Error('catalog-load-failed')
    if (result.stdout.byteLength > CATALOG_MAX_BYTES) throw new Error('catalog-too-large')
    const projection = parseCatalogProjection(JSON.parse(result.stdout.toString('utf8')))
    return {
      ...projection,
      workspaceId: id,
      projectRoot: runner.binding.projectRoot,
      environmentFingerprint: semanticEnvironmentFingerprint(id, runner.binding.fingerprint),
      loadedAt: new Date().toISOString(),
    }
  }
  dispose(): void {
    this.#lifetime.abort()
  }
}

/** Fixed diagnostics only: Python errors may contain model code or datasource secrets. */
export function browserFailure(error: unknown): string {
  const code = error instanceof Error && 'code' in error ? error.code : undefined
  if (code === 'subprocess-timeout') return '语义层加载超时，请检查模型后重试。'
  if (
    code === 'subprocess-output-limit' ||
    (error instanceof Error && error.message === 'catalog-too-large')
  )
    return '语义层超过读取大小上限，未加载不完整目录。'
  if (
    error instanceof Error &&
    ['workspace-unavailable', 'workspace-changed'].includes(error.message)
  )
    return 'Workspace 已不可用或绑定发生变化，请重新选择。'
  return '无法加载语义层，请检查项目模型与 Marivo Runtime 后重试。'
}
