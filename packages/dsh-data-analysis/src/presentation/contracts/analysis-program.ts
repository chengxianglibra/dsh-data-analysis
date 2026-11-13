import {
  type ASTNode,
  autoClose,
  createParser,
  type ElementNode,
  mergeStatements,
  parseExpression,
  split,
  tokenize,
  walkAST,
} from '@openuidev/lang-core'
import { z } from 'zod/v4'
import { analysisCatalogSchema, analysisRootComponents } from './analysis-catalog.ts'

type AnalysisProgramCode =
  | 'analysis-program-incomplete'
  | 'analysis-program-invalid-statement'
  | 'analysis-program-invalid'
  | 'analysis-program-deleted-reference'
  | 'analysis-program-root-deleted'

export class AnalysisProgramError extends Error {
  readonly code: AnalysisProgramCode
  readonly details: {
    line?: number
    column?: number
    unresolved?: string[]
    referencedBy?: string[]
    detail?: string
    statement?: string
    component?: string
    path?: string
    received?: string | number | boolean | null
    allowed?: (string | number | boolean | null)[]
    expected?: string
  }

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
  const?: string | number | boolean | null
  enum?: (string | number | boolean | null)[]
}
const definitions = analysisCatalogSchema.$defs as Record<string, Schema>
const names = new Set(Object.keys(analysisCatalogSchema.properties ?? {}))
// Child components are checked against their own concrete type below. Keep slot
// containers and all other constraints, without erasing child identity into unions.
const validators = Object.fromEntries(
  [...names].map((name) => {
    const definition = definitions[name]!
    const properties = Object.fromEntries(
      Object.entries(definition.properties ?? {}).map(([prop, schema]) => [
        prop,
        componentRefs(schema.items ?? schema).length
          ? schema.items
            ? { ...schema, items: {} }
            : {}
          : schema,
      ]),
    )
    return [
      name,
      z.fromJSONSchema({
        ...definition,
        properties,
        $defs: analysisCatalogSchema.$defs,
      } as z.core.JSONSchema.JSONSchema),
    ]
  }),
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
  const deleted = changes
    .filter((statement) => parseExpression(statement.tokens).k === 'Null')
    .map((statement) => statement.id)
  if (deleted.includes('root'))
    throw new AnalysisProgramError('analysis-program-root-deleted', { statement: 'root' })
  if (deleted.length) {
    const unresolved = parser.parse(merged).meta.unresolved.filter((name) => deleted.includes(name))
    if (unresolved.length) {
      const statement = unresolved[0]!
      const referencedBy = split(tokenize(merged))
        .flatMap((part) => {
          let referencesDeleted = false
          walkAST(parseExpression(part.tokens), (node) => {
            if ((node.k === 'Ref' || node.k === 'RuntimeRef') && node.n === statement)
              referencesDeleted = true
          })
          return referencesDeleted ? [part.id] : []
        })
        .slice(0, 16)
      throw new AnalysisProgramError('analysis-program-deleted-reference', {
        statement,
        unresolved: unresolved.slice(0, 16),
        referencedBy,
      })
    }
  }
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

function scalar(value: unknown): string | number | boolean | null | undefined {
  return value === null ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    (typeof value === 'string' && value.length <= 256)
    ? value
    : undefined
}

function propValue(value: unknown, path: readonly PropertyKey[]): unknown {
  return path.reduce<unknown>(
    (item, key) => (item !== null && typeof item === 'object' ? Reflect.get(item, key) : undefined),
    value,
  )
}

/** Use the authored discriminator to locate errors inside configuration unions. */
function focusIssue(issue: z.core.$ZodIssue, schema: Schema, value: unknown): z.core.$ZodIssue {
  if (issue.code !== 'invalid_union') return issue
  let target: Schema | undefined = schema
  for (const key of issue.path)
    target = typeof key === 'number' ? target?.items : target?.properties?.[String(key)]
  const received = propValue(value, issue.path)
  const variants = target?.anyOf ?? target?.oneOf ?? []
  if (!received || typeof received !== 'object' || !variants.length) return issue
  // Discriminators must be declared by every variant (e.g. view.chart).
  const keys = Object.keys(variants[0]?.properties ?? {}).filter((key) =>
    variants.every((variant) => {
      const prop = variant.properties?.[key]
      return prop && (Object.hasOwn(prop, 'const') || prop.enum)
    }),
  )
  for (const key of keys) {
    const actual = Reflect.get(received, key)
    const matches = variants.filter((variant) => {
      const prop = variant.properties![key]!
      return (prop.enum ?? [prop.const]).includes(actual)
    })
    if (matches.length === 0) {
      return {
        code: 'invalid_value',
        path: [...issue.path, key],
        values: variants.flatMap((variant) => {
          const prop = variant.properties![key]!
          return prop.enum ?? (prop.const === undefined ? [] : [prop.const])
        }),
        message: 'Use a supported discriminator value.',
      }
    }
    if (matches.length === 1) {
      const variant = matches[0]!
      const checked = z.fromJSONSchema(variant as z.core.JSONSchema.JSONSchema).safeParse(received)
      if (!checked.success) {
        const nested = focusIssue(checked.error.issues[0]!, variant, received)
        return { ...nested, path: [...issue.path, ...nested.path] }
      }
    }
  }
  return issue
}

/** Collapse literal unions into one constraint, never return raw branch JSON. */
function describeIssue(
  issue: z.core.$ZodIssue,
): Pick<AnalysisProgramError['details'], 'allowed' | 'expected'> {
  if (issue.code === 'invalid_value')
    return {
      allowed: issue.values
        .flatMap((value) => {
          const item = scalar(value)
          return item === undefined ? [] : [item]
        })
        .slice(0, 32),
    }
  if (issue.code === 'invalid_union') {
    const branches = issue.errors.flat()
    if (branches.every((item) => item.code === 'invalid_value' && item.path.length === 0))
      return { allowed: branches.flatMap((item) => describeIssue(item).allowed ?? []).slice(0, 32) }
    return { expected: 'a supported configuration matching the component signature' }
  }
  return { expected: issue.message.slice(0, 256) }
}

function componentError(
  node: ElementNode,
  location: string,
  relative: string,
  details: Pick<AnalysisProgramError['details'], 'detail' | 'allowed' | 'expected' | 'received'>,
): never {
  throw new AnalysisProgramError('analysis-program-invalid', {
    statement: node.statementId ?? location.split('/')[0],
    component: node.typeName,
    path: `${location}${relative}`,
    ...details,
  })
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
function checkSlots(node: ElementNode, inheritedLocation = node.typeName): void {
  const location = node.statementId ?? inheritedLocation
  const checked = validators[node.typeName]!.safeParse(node.props)
  if (!checked.success) {
    const issue = focusIssue(checked.error.issues[0]!, definitions[node.typeName]!, node.props)
    const relative = issue.path
      .map((key) => `/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`)
      .join('')
    componentError(node, location, relative, {
      received: scalar(propValue(node.props, issue.path)),
      ...describeIssue(issue),
    })
  }
  for (const [prop, schema] of Object.entries(definitions[node.typeName]?.properties ?? {})) {
    const accepted = componentRefs(schema.items ?? schema)
    if (!accepted.length) continue
    const value = node.props[prop]
    if (value === undefined) continue
    const children = schema.items ? value : [value]
    if (!Array.isArray(children))
      componentError(node, location, `/${prop}`, { expected: 'an array of components' })
    const tabValues = new Set<unknown>()
    for (const [index, child] of children.entries()) {
      const childLocation = `${location}/${prop}${schema.items ? `/${index}` : ''}`
      // These nodes originate in the fixed parser; the guard keeps invalid slots
      // out before traversing the parser-owned ElementNode shape.
      if (!isElement(child) || !accepted.includes(child.typeName))
        componentError(node, location, `/${prop}${schema.items ? `/${index}` : ''}`, {
          expected: 'a permitted child component',
          allowed: accepted,
          received: isElement(child) ? child.typeName : scalar(child),
        })
      checkSlots(child, childLocation)
      if ((node.typeName === 'Tabs' || node.typeName === 'Accordion') && prop === 'items') {
        if (
          node.typeName === 'Accordion' &&
          (typeof child.props.value !== 'string' ||
            !child.props.value.trim() ||
            typeof child.props.trigger !== 'string' ||
            !child.props.trigger.trim())
        )
          componentError(
            child,
            child.statementId ?? childLocation,
            !String(child.props.value).trim() ? '/value' : '/trigger',
            { detail: 'analysis-accordion-item-invalid', expected: 'a nonempty string' },
          )
        if (tabValues.has(child.props.value))
          componentError(child, child.statementId ?? childLocation, '/value', {
            detail:
              node.typeName === 'Tabs'
                ? 'analysis-tab-value-duplicate'
                : 'analysis-accordion-value-duplicate',
            received: scalar(child.props.value),
            expected: 'a distinct value within this group',
          })
        tabValues.add(child.props.value)
      }
      if (
        node.typeName === 'DashboardGrid' &&
        prop === 'items' &&
        typeof child.props.span === 'number' &&
        child.props.span > (typeof node.props.columns === 'number' ? node.props.columns : 4)
      )
        componentError(child, child.statementId ?? childLocation, '/span', {
          detail: 'analysis-dashboard-span-exceeds-columns',
          received: child.props.span,
          expected: `span <= ${node.props.columns ?? 4} (parent DashboardGrid.columns)`,
        })
    }
  }
}

function isElement(value: unknown): value is ElementNode {
  return (
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    value.type === 'element' &&
    'typeName' in value &&
    typeof value.typeName === 'string' &&
    'props' in value &&
    value.props !== null &&
    typeof value.props === 'object'
  )
}

/** Locate parser errors in the original syntax, before invalid children are discarded. */
function parserIssueLocation(program: string, statement: string, component: string) {
  try {
    const entry = split(tokenize(program)).find((item) => item.id === statement)
    if (!entry) return undefined
    const matches: string[] = []
    const visit = (node: ASTNode, path: string) => {
      if (node.k === 'Comp') {
        if (node.name === component) matches.push(path)
        const props = Object.keys(definitions[node.name]?.properties ?? {})
        node.args.forEach((arg, index) => {
          if (props[index]) visit(arg, `${path}/${props[index]}`)
        })
      } else if (node.k === 'Arr') {
        node.els.forEach((item, index) => {
          visit(item, `${path}/${index}`)
        })
      } else if (node.k === 'Obj') {
        node.entries.forEach(([key, item]) => {
          visit(item, `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`)
        })
      }
    }
    visit(parseExpression(entry.tokens), statement)
    return matches.length === 1 ? matches[0] : undefined
  } catch {
    return undefined
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
  ) {
    const issue = result.meta.errors[0]
    const location = issue?.statementId
      ? parserIssueLocation(program, issue.statementId, issue.component)
      : undefined
    throw new AnalysisProgramError('analysis-program-invalid', {
      unresolved: result.meta.unresolved.slice(0, 16),
      ...(issue
        ? {
            statement: issue.statementId,
            component: issue.component,
            ...(location ? { path: `${location}${issue.path}` } : {}),
            detail: issue.message.slice(0, 256),
          }
        : {
            detail: 'Use a complete static program with a supported root and resolved statements.',
          }),
    })
  }
  try {
    if (!analysisRootComponents.includes(result.root.typeName))
      componentError(result.root, result.root.statementId ?? 'root', '', {
        expected: 'a supported root component',
        allowed: analysisRootComponents,
        received: result.root.typeName,
      })
    checkSlots(result.root)
  } catch (error) {
    if (error instanceof AnalysisProgramError) throw error
    throw new AnalysisProgramError('analysis-program-invalid', {
      detail: error instanceof Error ? error.message.slice(0, 2048) : undefined,
    })
  }
  return result.root
}
