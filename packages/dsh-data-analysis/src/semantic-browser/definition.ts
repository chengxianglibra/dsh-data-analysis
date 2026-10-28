import {
  boundedText,
  closed,
  parseRef,
  refKey,
  type SemanticRef,
} from '../semantic-reference/contracts.ts'

/** Plugin display projection of captured public Catalog definitions, never an executable AST. */
export interface ComputationDefinition {
  readonly schema: 'dsh-data-analysis-computation/v1'
  readonly ref: SemanticRef
  readonly catalog_definition_fingerprint: string
  readonly expression: string
  readonly facts: readonly { readonly name: string; readonly value: string }[]
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
    const field = closed(item, ['name', 'value'])
    const name = boundedText(field.name, 128)
    if (!factNames.has(name)) throw new Error('invalid-definition-field')
    return { name, value: boundedText(field.value, 1024 * 1024, true) }
  })
  if (new Set(facts.map((item) => item.name)).size !== facts.length)
    throw new Error('invalid-definition-field')
  return {
    schema: r.schema,
    ref,
    catalog_definition_fingerprint: fingerprint,
    expression: boundedText(r.expression, 1024 * 1024, true),
    facts,
  }
}
