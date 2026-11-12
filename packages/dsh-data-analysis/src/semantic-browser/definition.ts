import {
  boundedText,
  closed,
  parseRef,
  refKey,
  type SemanticRef,
} from '../semantic-reference/contracts.ts'

/** Retain the original text and identify values serialized from a list or mapping. */
export interface DisplayField {
  readonly name: string
  readonly value: string
  readonly structured?: true
}

export function parseDisplayField(input: unknown, max: number): DisplayField {
  const hasStructure =
    typeof input === 'object' && input !== null && Object.hasOwn(input, 'structured')
  const field = closed(input, hasStructure ? ['name', 'value', 'structured'] : ['name', 'value'])
  const name = boundedText(field.name, 128)
  const value = boundedText(field.value, max, true)
  if (!hasStructure) return { name, value }
  if (field.structured !== true) throw new Error('invalid-display-field')
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return { name, value }
  }
  if (typeof parsed !== 'object' || parsed === null) return { name, value }
  return { name, value, structured: true }
}

/** Plugin display projection of captured public Catalog definitions, never an executable AST. */
export interface ComputationDefinition {
  readonly schema: 'dsh-data-analysis-computation/v1'
  readonly ref: SemanticRef
  readonly catalog_definition_fingerprint: string
  readonly expression: string
  readonly explanation: string
  readonly facts: readonly DisplayField[]
}
const factNames = new Set(['reductions', 'conditions', 'time_bindings', 'null_rules', 'facts'])
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
    'expression',
    'explanation',
    'facts',
  ])
  if (
    r.schema !== 'dsh-data-analysis-computation/v1' ||
    refKey(parseRef(r.ref)) !== refKey(ref) ||
    r.catalog_definition_fingerprint !== fingerprint
  )
    throw new Error('definition-identity-mismatch')
  if (!Array.isArray(r.facts) || r.facts.length > factNames.size)
    throw new Error('invalid-definition')
  const facts = r.facts.map((item) => {
    const field = parseDisplayField(item, 1024 * 1024)
    if (!factNames.has(field.name)) throw new Error('invalid-definition-field')
    return field
  })
  if (new Set(facts.map((item) => item.name)).size !== facts.length)
    throw new Error('invalid-definition-field')
  return {
    schema: r.schema,
    ref,
    catalog_definition_fingerprint: fingerprint,
    expression: boundedText(r.expression, 1024 * 1024, true),
    explanation: boundedText(r.explanation, 1024 * 1024, true),
    facts,
  }
}
