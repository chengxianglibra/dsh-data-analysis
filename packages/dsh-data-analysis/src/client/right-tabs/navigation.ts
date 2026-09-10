import { boundedText, parseRef, type SemanticRef } from '../../semantic-reference/contracts.ts'

export type Directory = 'datasources' | 'semantic' | 'reports'
export type Resource =
  | { kind: 'report'; workspaceId: string; reportId: string; buildId?: string }
  | { kind: 'semantic'; workspaceId: string; ref: SemanticRef }
export const directoryKind = (page: Directory) => `marivo-${page}`
export const definitionId = (kind: string) => `dsh-data-analysis/right-tabs/${kind}`
const segment = (value: string) => encodeURIComponent(boundedText(value, 2048))
export function resourceAddress(target: Resource): string {
  const root = `dsh-resource://marivo-${target.kind}/${segment(target.workspaceId)}/`
  return target.kind === 'report'
    ? `${root}${segment(target.reportId)}/${target.buildId ? `build/${segment(target.buildId)}` : 'current'}`
    : `${root}${segment(parseRef(target.ref).kind)}/${segment(target.ref.path)}`
}
export function parseResource(address: string): Resource {
  const match = /^dsh-resource:\/\/marivo-(report|semantic)\/([^?#]+)$/.exec(address)
  if (!match) throw new Error('marivo.navigation.unknown-marivo-resource-address')
  const parts = match[2]!.split('/').map(decodeURIComponent)
  const workspaceId = boundedText(parts[0], 256)
  let result: Resource
  if (match[1] === 'semantic' && parts.length === 3) {
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
    }
  } else throw new Error('marivo.navigation.unknown-marivo-resource-address')
  if (resourceAddress(result) !== address)
    throw new Error('marivo.navigation.resource-address-is-not-canonically-encoded')
  return result
}
export function canOpenResource(address: string, kind: Resource['kind']): boolean {
  try {
    return parseResource(address).kind === kind
  } catch {
    return false
  }
}
