import { createParser, type ElementNode } from '@openuidev/lang-core'
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
