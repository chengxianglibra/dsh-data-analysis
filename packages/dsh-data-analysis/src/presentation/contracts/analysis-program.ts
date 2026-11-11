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

type AnalysisProgramCode =
  | 'analysis-program-incomplete'
  | 'analysis-program-invalid-statement'
  | 'analysis-program-invalid'

export class AnalysisProgramError extends Error {
  readonly code: AnalysisProgramCode
  readonly details: { line?: number; column?: number; unresolved?: string[]; detail?: string }

  constructor(code: AnalysisProgramCode, details: AnalysisProgramError['details']) {
    super(details.detail ? `${code}: ${details.detail}` : code)
    this.name = 'AnalysisProgramError'
    this.code = code
    this.details = details
  }
}

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
  const statements: string[] = []
  let start = 0
  let quote = ''
  let escaped = false
  const brackets: string[] = []
  const invalid = (
    position: number,
    code: 'analysis-program-incomplete' | 'analysis-program-invalid-statement',
  ): never => {
    const prefix = source.slice(0, position)
    throw new AnalysisProgramError(code, {
      line: prefix.split('\n').length,
      column: position - prefix.lastIndexOf('\n'),
    })
  }
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
        invalid(i, 'analysis-program-invalid-statement')
    } else if ((c === ';' || c === '\n' || c === undefined) && !brackets.length) {
      const fragment = source.slice(start, i)
      const raw = fragment.trim()
      const position = start + fragment.length - fragment.trimStart().length
      start = i + 1
      if (!raw) continue
      if (!/^[A-Za-z_][A-Za-z0-9_]*\s*=\s*[^=]/.test(raw))
        invalid(position, 'analysis-program-invalid-statement')
      try {
        const parsed = split(tokenize(raw))
        if (parsed.length !== 1) invalid(position, 'analysis-program-invalid-statement')
        parseExpression(parsed[0]!.tokens)
        // The public parser tolerates trailing tokens. The grouped expression must reach the suffix.
        const expression = raw.slice(raw.indexOf('=') + 1)
        const checked = parseExpression(tokenize(`(${expression}) + __analysis_statement_end`))
        if (
          checked.k !== 'BinOp' ||
          checked.op !== '+' ||
          checked.right.k !== 'Ref' ||
          checked.right.n !== '__analysis_statement_end'
        )
          invalid(position, 'analysis-program-invalid-statement')
      } catch {
        invalid(position, 'analysis-program-invalid-statement')
      }
      statements.push(raw)
    }
  }
  if (quote || brackets.length || autoClose(source).wasIncomplete)
    invalid(source.length, 'analysis-program-incomplete')
  if (!statements.length) invalid(0, 'analysis-program-invalid-statement')
  return statements.join('\n')
}

export function mergeAnalysisProgram(base: string, patch: string): string {
  const admitted = analysisStatements(patch)
  const changes = split(tokenize(admitted))
  if (new Set(changes.map((statement) => statement.id)).size !== changes.length)
    throw new AnalysisProgramError('analysis-program-invalid', {
      detail: 'analysis-patch-duplicate-statement',
    })
  const merged = mergeStatements(analysisStatements(base), admitted)
  const retained = new Set(split(tokenize(merged)).map((statement) => statement.id))
  // The official merger garbage-collects unreachable statements before Catalog
  // validation. Reject discarded edits instead of acknowledging a silent no-op.
  for (const statement of changes)
    if (parseExpression(statement.tokens).k !== 'Null' && !retained.has(statement.id))
      throw new AnalysisProgramError('analysis-program-invalid', {
        detail: `analysis-patch-unreachable-statement: ${statement.id}`,
      })
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
      if ((node.typeName === 'Tabs' || node.typeName === 'Accordion') && prop === 'items') {
        if (
          node.typeName === 'Accordion' &&
          (typeof child.props.value !== 'string' ||
            !child.props.value.trim() ||
            typeof child.props.trigger !== 'string' ||
            !child.props.trigger.trim())
        )
          throw new Error('analysis-accordion-item-invalid')
        if (tabValues.has(child.props.value))
          throw new Error(
            node.typeName === 'Tabs'
              ? 'analysis-tab-value-duplicate'
              : 'analysis-accordion-value-duplicate',
          )
        tabValues.add(child.props.value)
      }
      if (
        node.typeName === 'DashboardGrid' &&
        prop === 'items' &&
        typeof child.props.span === 'number' &&
        child.props.span > (typeof node.props.columns === 'number' ? node.props.columns : 4)
      )
        throw new Error('analysis-dashboard-span-exceeds-columns')
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
    throw new AnalysisProgramError('analysis-program-invalid', {
      unresolved: result.meta.unresolved.slice(0, 16),
      detail: JSON.stringify(result.meta).slice(0, 2048),
    })
  try {
    if (!analysisRootComponents.includes(result.root.typeName))
      throw new Error('Invalid analysis root')
    checkSlots(result.root)
    validators[result.root.typeName]!.parse(propsOnly(result.root))
  } catch (error) {
    throw new AnalysisProgramError('analysis-program-invalid', {
      detail: error instanceof Error ? error.message.slice(0, 2048) : undefined,
    })
  }
  return result.root
}
