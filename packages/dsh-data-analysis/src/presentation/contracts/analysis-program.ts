import {
  autoClose,
  createParser,
  type ElementNode,
  mergeStatements,
  parseExpression,
  split,
  tokenize,
} from '@openuidev/lang-core'
import { z } from 'zod/v4'
import { analysisCatalogSchema, analysisRootComponents } from './analysis-catalog.ts'

const parser = createParser(analysisCatalogSchema)
type Schema = {
  $ref?: string
  anyOf?: Schema[]
  oneOf?: Schema[]
  items?: Schema
  properties?: Record<string, Schema>
}
const definitions = analysisCatalogSchema.$defs as Record<string, Schema>
const names = new Set(Object.keys(analysisCatalogSchema.properties ?? {}))
const validators = Object.fromEntries(
  [...names].map((name) => [
    name,
    z.fromJSONSchema({
      $ref: `#/$defs/${name}`,
      $defs: analysisCatalogSchema.$defs,
    } as z.core.JSONSchema.JSONSchema),
  ]),
)

/** Keep statement boundaries explicit: the fixed merger splits source on newlines.
 * Validate every fragment before its tolerant parser can silently discard it.
 */
export function analysisStatements(source: string): string {
  if (autoClose(source).wasIncomplete) throw new Error('analysis-program-incomplete')
  const statements: string[] = []
  let start = 0
  let quote = ''
  let escaped = false
  const brackets: string[] = []
  for (let i = 0; i <= source.length; i++) {
    const c = source[i]
    if (quote) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === quote) quote = ''
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if (c && '([{'.includes(c)) brackets.push(c)
    else if (c && ')]}'.includes(c)) {
      if (brackets.pop() !== '([{'.charAt(')]}'.indexOf(c)))
        throw new Error('analysis-program-invalid-statement')
    } else if ((c === ';' || c === '\n' || c === undefined) && !brackets.length) {
      const raw = source.slice(start, i).trim()
      start = i + 1
      if (!raw) continue
      if (!/^[A-Za-z_][A-Za-z0-9_]*\s*=\s*[^=]/.test(raw))
        throw new Error('analysis-program-invalid-statement')
      const parsed = split(tokenize(raw))
      if (parsed.length !== 1) throw new Error('analysis-program-invalid-statement')
      parseExpression(parsed[0]!.tokens)
      // The public expression parser is tolerant of trailing tokens. A grouped
      // expression must reach this suffix; otherwise some input was ignored.
      const expression = raw.slice(raw.indexOf('=') + 1)
      const checked = parseExpression(tokenize(`(${expression}) + __analysis_statement_end`))
      if (
        checked.k !== 'BinOp' ||
        checked.op !== '+' ||
        checked.right.k !== 'Ref' ||
        checked.right.n !== '__analysis_statement_end'
      )
        throw new Error('analysis-program-invalid-statement')
      statements.push(raw)
    }
  }
  if (!statements.length) throw new Error('analysis-program-invalid-statement')
  return statements.join('\n')
}

export function mergeAnalysisProgram(base: string, patch: string): string {
  const admitted = analysisStatements(patch)
  const changes = split(tokenize(admitted))
  if (new Set(changes.map((statement) => statement.id)).size !== changes.length)
    throw new Error('analysis-patch-duplicate-statement')
  const merged = mergeStatements(analysisStatements(base), admitted)
  const retained = new Set(split(tokenize(merged)).map((statement) => statement.id))
  // The official merger garbage-collects unreachable statements before Catalog
  // validation. Reject discarded edits instead of acknowledging a silent no-op.
  for (const statement of changes)
    if (parseExpression(statement.tokens).k !== 'Null' && !retained.has(statement.id))
      throw new Error(`analysis-patch-unreachable-statement: ${statement.id}`)
  return merged
}

function propsOnly(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(propsOnly)
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    if (object.type === 'element') return propsOnly(object.props)
    return Object.fromEntries(Object.entries(object).map(([key, item]) => [key, propsOnly(item)]))
  }
  return value
}

function componentRefs(schema: Schema): string[] {
  if (schema.$ref) {
    const name = schema.$ref.split('/').at(-1)!
    return names.has(name) ? [name] : []
  }
  return (schema.anyOf ?? schema.oneOf ?? []).flatMap(componentRefs)
}

// The fixed parser validates component props but accepts a different registered
// component in a single-$ref slot (e.g. Tabs.items). Check element identities
// against the generated slot schema, without a second component relation table.
function checkSlots(node: ElementNode): void {
  for (const [prop, schema] of Object.entries(definitions[node.typeName]?.properties ?? {})) {
    const accepted = componentRefs(schema.items ?? schema)
    if (!accepted.length) continue
    const value = node.props[prop]
    if (value === undefined) continue
    const children = schema.items ? value : [value]
    if (!Array.isArray(children)) throw new Error(`Invalid render slot: ${node.typeName}.${prop}`)
    const tabValues = new Set<unknown>()
    for (const child of children) {
      if (child?.type !== 'element' || !accepted.includes(child.typeName))
        throw new Error(
          `Invalid render slot: ${node.typeName}.${prop}; expected ${accepted.join(' | ')}`,
        )
      if (node.typeName === 'Tabs' && prop === 'items') {
        if (tabValues.has(child.props.value)) throw new Error('analysis-tab-value-duplicate')
        tabValues.add(child.props.value)
      }
      checkSlots(child)
    }
  }
}

/** Pure Catalog admission; saved resource and view checks belong to analysis-document. */
export function parseAnalysisProgram(program: string): ElementNode {
  const result = parser.parse(program)
  if (
    result.meta.incomplete ||
    result.meta.unresolved.length ||
    result.meta.errors.length ||
    result.queryStatements.length ||
    result.mutationStatements.length ||
    !result.root
  )
    throw new Error(`Invalid analysis program: ${JSON.stringify(result.meta)}`)
  if (!analysisRootComponents.includes(result.root.typeName))
    throw new Error('Invalid analysis root')
  checkSlots(result.root)
  validators[result.root.typeName]!.parse(propsOnly(result.root))
  return result.root
}
