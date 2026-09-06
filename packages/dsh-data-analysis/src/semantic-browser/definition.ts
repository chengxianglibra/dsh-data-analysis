import { closed, parseRef, refKey, type SemanticRef } from '../semantic-reference/contracts.ts'

export type DefinitionValue =
  | string
  | number
  | boolean
  | null
  | DefinitionValue[]
  | { readonly [key: string]: DefinitionValue }
export interface ComputationDefinition {
  readonly schema: 'marivo.semantic_definition/v1'
  readonly ref: SemanticRef
  readonly catalog_definition_fingerprint: string
  readonly node: { readonly [key: string]: DefinitionValue }
  readonly temporal: { readonly [key: string]: DefinitionValue }
  readonly source_location: { readonly file: string; readonly line: number }
}
// Transport allowlist for the public definition payload, not a semantic validator.
const keys = new Set(
  'kind operation q target target_kind filter dimension operator values value weight numerator denominator terms sign metric base over selection ref resolution anchor count unit grain calendar level status expression reason entity name value_type operand data_type left right condition when_true when_false declared override effective source fold schema path display language form text bindings alias redacted_literals'.split(
    ' ',
  ),
)
function value(input: unknown, depth = 0, budget = { left: 10000 }): DefinitionValue {
  if (--budget.left < 0 || depth > 64) throw new Error('definition-too-large')
  if (input === null || typeof input === 'boolean') return input
  if (typeof input === 'string' && input.length <= 1024 * 1024) return input
  if (typeof input === 'number' && Number.isFinite(input)) return input
  if (Array.isArray(input)) return input.map((x) => value(x, depth + 1, budget))
  if (typeof input !== 'object' || input === null) throw new Error('invalid-definition')
  const result: Record<string, DefinitionValue> = {}
  for (const [key, item] of Object.entries(input)) {
    if (!keys.has(key)) throw new Error('invalid-definition-field')
    result[key] = value(item, depth + 1, budget)
  }
  if (result.schema === 'marivo.semantic_ref/v1') parseRef(result)
  return result
}
export function parseComputation(
  input: unknown,
  ref: SemanticRef,
  fingerprint: string,
): ComputationDefinition | null {
  if (input === null) return null
  const r = closed(input, [
    'schema',
    'ref',
    'catalog_definition_fingerprint',
    'node',
    'temporal',
    'source_location',
  ])
  if (
    r.schema !== 'marivo.semantic_definition/v1' ||
    refKey(parseRef(r.ref)) !== refKey(ref) ||
    r.catalog_definition_fingerprint !== fingerprint
  )
    throw new Error('definition-identity-mismatch')
  const source = closed(r.source_location, ['file', 'line'])
  if (
    typeof source.file !== 'string' ||
    !Number.isSafeInteger(source.line) ||
    (source.line as number) < 0
  )
    throw new Error('invalid-definition-source')
  const node = value(r.node),
    temporal = value(r.temporal)
  if (
    !node ||
    typeof node !== 'object' ||
    Array.isArray(node) ||
    typeof node.kind !== 'string' ||
    !temporal ||
    typeof temporal !== 'object' ||
    Array.isArray(temporal)
  )
    throw new Error('invalid-definition')
  return {
    schema: r.schema,
    ref,
    catalog_definition_fingerprint: fingerprint,
    node,
    temporal,
    source_location: { file: source.file, line: source.line as number },
  }
}
