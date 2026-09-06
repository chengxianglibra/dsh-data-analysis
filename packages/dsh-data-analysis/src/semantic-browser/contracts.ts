import {
  boundedText,
  closed,
  parseRef,
  refKey,
  type SemanticRef,
} from '../semantic-reference/contracts.ts'
import { type ComputationDefinition, parseComputation } from './definition.ts'

export const BROWSER_ENDPOINT = 'semantic-browser/catalog'
export const CATALOG_MAX_BYTES = 32 * 1024 * 1024
export interface DisplayField {
  readonly name: string
  readonly value: string
}
export interface ObjectRelation {
  readonly field: string
  readonly ref: SemanticRef
}
export interface SemanticObjectView {
  readonly ref: SemanticRef
  readonly computation: ComputationDefinition | null
  readonly name: string
  readonly domain: string | null
  readonly definition: string | null
  readonly guardrails: readonly string[]
  readonly source: { readonly file: string; readonly line: number; readonly symbol: string }
  readonly fields: readonly DisplayField[]
  readonly relations: readonly ObjectRelation[]
}
export interface CatalogProjection {
  readonly fingerprint: string
  readonly kinds: readonly string[]
  readonly objects: readonly SemanticObjectView[]
}
export interface CatalogSnapshot extends CatalogProjection {
  readonly workspaceId: string
  readonly projectRoot: string
  readonly environmentFingerprint: string
  readonly loadedAt: string
}
function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error('invalid-catalog')
  return value
}
function text(value: unknown): string {
  return boundedText(value, CATALOG_MAX_BYTES, true)
}
function nullable(value: unknown): string | null {
  return value === null ? null : text(value)
}
export function parseCatalogProjection(value: unknown): CatalogProjection {
  const r = closed(value, ['fingerprint', 'kinds', 'objects'])
  const kinds = array(r.kinds, 128).map((item) => boundedText(item, 128))
  const objects = array(r.objects, 100_000).map((item): SemanticObjectView => {
    const row = closed(item, [
      'ref',
      'computation',
      'name',
      'domain',
      'definition',
      'guardrails',
      'source',
      'fields',
      'relations',
    ])
    const ref = parseRef(row.ref)
    if (!kinds.includes(ref.kind)) throw new Error('invalid-catalog')
    const source = closed(row.source, ['file', 'line', 'symbol'])
    if (!Number.isSafeInteger(source.line) || (source.line as number) < 0)
      throw new Error('invalid-catalog')
    return {
      ref,
      computation: parseComputation(row.computation, ref, boundedText(r.fingerprint, 256)),
      name: text(row.name),
      domain: nullable(row.domain),
      definition: nullable(row.definition),
      guardrails: array(row.guardrails, 100_000).map(text),
      source: { file: text(source.file), line: source.line as number, symbol: text(source.symbol) },
      fields: array(row.fields, 128).map((value) => {
        const field = closed(value, ['name', 'value'])
        return { name: boundedText(field.name, 128), value: text(field.value) }
      }),
      relations: array(row.relations, 100_000).map((value) => {
        const relation = closed(value, ['field', 'ref'])
        return { field: boundedText(relation.field, 128), ref: parseRef(relation.ref) }
      }),
    }
  })
  if (
    new Set(kinds).size !== kinds.length ||
    new Set(objects.map((x) => refKey(x.ref))).size !== objects.length
  )
    throw new Error('invalid-catalog')
  return { fingerprint: boundedText(r.fingerprint, 256), kinds, objects }
}
export function parseCatalogSnapshot(value: unknown): CatalogSnapshot {
  const r = closed(value, [
    'workspaceId',
    'projectRoot',
    'environmentFingerprint',
    'loadedAt',
    'fingerprint',
    'kinds',
    'objects',
  ])
  const loadedAt = boundedText(r.loadedAt, 64)
  if (!Number.isFinite(Date.parse(loadedAt))) throw new Error('invalid-catalog')
  return {
    ...parseCatalogProjection({ fingerprint: r.fingerprint, kinds: r.kinds, objects: r.objects }),
    workspaceId: boundedText(r.workspaceId, 256),
    projectRoot: boundedText(r.projectRoot, 8192),
    environmentFingerprint: boundedText(r.environmentFingerprint, 256),
    loadedAt,
  }
}
