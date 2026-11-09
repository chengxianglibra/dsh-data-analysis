import { boundedText, parseRef, type SemanticRef } from '../../semantic-reference/contracts.ts'

export type Directory = 'datasources' | 'semantic' | 'reports'
export type Resource =
  | {
      kind: 'report'
      workspaceId: string
      reportId: string
      buildId?: string
      reportViewId?: string
    }
  | { kind: 'semantic'; workspaceId: string; ref: SemanticRef }
export const directoryKind = (page: Directory) => `marivo-${page}`
export const definitionId = (kind: string) => `dsh-data-analysis/right-tabs/${kind}`
const segment = (value: string) => encodeURIComponent(boundedText(value, 2048))
export function resourceAddress(target: Resource): string {
  const root = `dsh-resource://marivo-${target.kind}/${segment(target.workspaceId)}/`
  return target.kind === 'report'
    ? `${root}${segment(target.reportId)}/${target.buildId ? `build/${segment(target.buildId)}` : 'current'}${target.reportViewId ? `?view=${segment(target.reportViewId)}` : ''}`
    : `${root}${segment(parseRef(target.ref).kind)}/${segment(target.ref.path)}`
}
export function parseResource(address: string): Resource {
  const match = /^dsh-resource:\/\/marivo-(report|semantic)\/([^?#]+)(?:\?view=([^&#]+))?$/.exec(
    address,
  )
  if (!match) throw new Error('marivo.navigation.unknown-marivo-resource-address')
  const parts = match[2]!.split('/').map(decodeURIComponent)
  const workspaceId = boundedText(parts[0], 256)
  let result: Resource
  if (match[1] === 'semantic' && parts.length === 3 && !match[3]) {
    result = {
      kind: 'semantic',
      workspaceId,
      ref: parseRef({ schema: 'marivo.semantic_ref/v1', kind: parts[1], path: parts[2] }),
    }
  } else if (
    match[1] === 'report' &&
    ((parts.length === 3 && parts[2] === 'current') || (parts.length === 4 && parts[2] === 'build'))
  ) {
    result = {
      kind: 'report',
      workspaceId,
      reportId: boundedText(parts[1], 256),
      ...(parts.length === 4 ? { buildId: boundedText(parts[3], 256) } : {}),
      ...(match[3] ? { reportViewId: boundedText(decodeURIComponent(match[3]), 2048) } : {}),
    }
  } else throw new Error('marivo.navigation.unknown-marivo-resource-address')
  if (resourceAddress(result) !== address)
    throw new Error('marivo.navigation.resource-address-is-not-canonically-encoded')
  return result
}

/** Reading placement lives in the native persisted address; navigation params are ephemeral. */
export function liveReportAddress(workspaceId: string, viewId: string): string {
  return `dsh-resource://marivo-analysis-live/${segment(workspaceId)}/${segment(viewId)}`
}
export function reportViewFromAddress(
  address: string,
): { workspaceId: string; viewId: string } | undefined {
  try {
    const live = /^dsh-resource:\/\/marivo-analysis-live\/([^/?#]+)\/([^/?#]+)$/.exec(address)
    if (live) {
      const workspaceId = boundedText(decodeURIComponent(live[1]!), 256)
      const viewId = boundedText(decodeURIComponent(live[2]!), 2048)
      if (liveReportAddress(workspaceId, viewId) === address) return { workspaceId, viewId }
      return undefined
    }
    const target = parseResource(address)
    return target.kind === 'report' && target.reportViewId
      ? { workspaceId: target.workspaceId, viewId: target.reportViewId }
      : undefined
  } catch {
    return undefined
  }
}
export function canOpenResource(address: string, kind: Resource['kind']): boolean {
  try {
    return parseResource(address).kind === kind
  } catch {
    return false
  }
}
