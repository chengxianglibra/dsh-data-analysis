/** Isolated S0 probe; deliberately not registered by the production plugin. */
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import path from 'node:path'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import {
  PRESENTATION_BUDGETS,
  type PresentationAsset,
} from '../../src/presentation/contracts/types.ts'

export const S0_RPC_CHANNEL = '/marivo-presentation-s0'
export interface S0AssetRequest {
  workspaceId: string
  buildId: string
  asset: PresentationAsset
  sha256: string
}
export function presentationAssetPath(
  root: string,
  buildId: string,
  asset: PresentationAsset,
): string {
  return path.join(root, '.dsh-data-analysis', 'presentations', buildId, asset)
}
export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
function request(value: unknown): S0AssetRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid-request')
  const item = value as Record<string, unknown>
  if (Object.keys(item).sort().join(',') !== 'asset,buildId,sha256,workspaceId')
    throw new Error('invalid-request')
  if (typeof item.workspaceId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(item.workspaceId))
    throw new Error('invalid-workspace')
  if (typeof item.buildId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(item.buildId))
    throw new Error('invalid-build')
  if (item.asset !== 'presentation.json' && item.asset !== 'index.html')
    throw new Error('invalid-asset')
  if (typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256))
    throw new Error('invalid-digest')
  return item as unknown as S0AssetRequest
}

/** Workspace authority is supplied by Host lookup, never by a browser path. */
export class S0FileService {
  readonly #resolve: (id: string) => { id: string; path: string } | undefined
  constructor(resolveWorkspace: (id: string) => { id: string; path: string } | undefined) {
    this.#resolve = resolveWorkspace
  }
  async read(payload: unknown, signal = new AbortController().signal) {
    const input = request(payload)
    signal.throwIfAborted()
    const workspace = this.#resolve(input.workspaceId)
    if (!workspace || workspace.id !== input.workspaceId) throw new Error('workspace-unavailable')
    const root = await realpath(workspace.path)
    const assetPath = presentationAssetPath(root, input.buildId, input.asset)
    const parents = [
      root,
      path.join(root, '.dsh-data-analysis'),
      path.join(root, '.dsh-data-analysis', 'presentations'),
      path.dirname(assetPath),
    ]
    const parentStats = await Promise.all(parents.map((parent) => lstat(parent)))
    if (parentStats.some((stat) => !stat.isDirectory() || stat.isSymbolicLink()))
      throw new Error('asset-path-mismatch')
    const maximum =
      input.asset === 'presentation.json'
        ? PRESENTATION_BUDGETS.documentBytes
        : PRESENTATION_BUDGETS.htmlBytes
    // Reject symlinks anywhere below the canonical Workspace, including in-build aliases.
    if ((await realpath(assetPath)) !== assetPath) throw new Error('asset-path-mismatch')
    const file = await open(assetPath, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const before = await file.stat()
      if (!before.isFile()) throw new Error('asset-not-file')
      if (before.size > maximum) throw new Error('asset-too-large')
      signal.throwIfAborted()
      // A bounded read remains bounded if another process grows the file after stat.
      const data = Buffer.alloc(maximum + 1)
      let length = 0
      while (length < data.length) {
        signal.throwIfAborted()
        const read = await file.read(data, length, data.length - length, null)
        if (read.bytesRead === 0) break
        length += read.bytesRead
      }
      if (length > maximum) throw new Error('asset-too-large')
      const after = await file.stat()
      const current = await lstat(assetPath)
      const currentParents = await Promise.all(parents.map((parent) => lstat(parent)))
      if (
        currentParents.some(
          (stat, index) =>
            !stat.isDirectory() ||
            stat.isSymbolicLink() ||
            stat.dev !== parentStats[index]!.dev ||
            stat.ino !== parentStats[index]!.ino,
        )
      )
        throw new Error('asset-path-mismatch')
      if (
        (await realpath(assetPath)) !== assetPath ||
        current.dev !== after.dev ||
        current.ino !== after.ino ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        length !== after.size
      )
        throw new Error('asset-changed')
      const currentWorkspace = this.#resolve(input.workspaceId)
      if (
        !currentWorkspace ||
        currentWorkspace.id !== workspace.id ||
        (await realpath(currentWorkspace.path)) !== root
      )
        throw new Error('workspace-changed')
      const body = data.subarray(0, length)
      const digest = sha256(body)
      if (digest !== input.sha256) throw new Error('asset-digest-mismatch')
      signal.throwIfAborted()
      return {
        asset: input.asset,
        mimeType: input.asset === 'presentation.json' ? 'application/json' : 'text/html',
        sha256: digest,
        bytes: length,
        bodyBase64: body.toString('base64'),
      }
    } finally {
      await file.close()
    }
  }
}

export function registerS0FileRpc(connection: HostConnectionHandle, service: S0FileService) {
  return connection.rpc.handle(
    S0_RPC_CHANNEL,
    async (endpoint, payload, signal) => {
      try {
        if (endpoint !== 'files/read') throw new Error('unknown-endpoint')
        return { ok: true, value: await service.read(payload, signal) }
      } catch (error) {
        const safe =
          error instanceof Error &&
          /^(invalid-|workspace-|asset-|unknown-endpoint)/.test(error.message)
            ? error.message
            : 'asset-read-failed'
        return { ok: false, error: { code: 'internal', message: safe, details: {} } }
      }
    },
    { authority: 'trusted-host' },
  )
}
