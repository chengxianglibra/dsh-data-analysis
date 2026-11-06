import type {
  DisplayField,
  ObjectRelation,
  SemanticObjectView,
} from '../../semantic-browser/contracts.ts'
import { refKey, type SemanticRef } from '../../semantic-reference/contracts.ts'

// Overview facts are selected per kind; calculation-specific measure fields live
// with the expression. Reference-only fields belong to the relations tab when
// its grouped links can represent them without losing information.
const overviewFields: Readonly<Record<string, readonly string[]>> = {
  domain: ['owner', 'default'],
  datasource: ['backend_type'],
  entity: [
    'datasource',
    'source_kind',
    'source_table',
    'source_database',
    'primary_key',
    'versioning',
  ],
  dimension: ['entity', 'unit', 'additivity', 'parse', 'sample_interval'],
  measure: ['entity', 'parse', 'sample_interval'],
  time_dimension: ['entity', 'parse', 'sample_interval'],
  metric: ['roots', 'unit'],
  relationship: ['from_entity', 'to_entity', 'keys', 'cardinality'],
  period_calendar: ['date', 'boundary_timezone', 'coverage'],
  temporal_set: ['occurrence_id', 'start', 'end', 'category', 'boundary_timezone', 'coverage'],
}

function matchesRelations(field: DisplayField, relations: readonly string[]): boolean {
  if (!relations.length) return false
  let value: unknown = field.value
  if (field.structured) value = JSON.parse(field.value)
  const references = Array.isArray(value) ? value : [value]
  return (
    references.length === relations.length &&
    references.every((reference, index) => reference === relations[index]) &&
    new Set(references).size === references.length
  )
}

export function representedByRelations(field: DisplayField, object: SemanticObjectView): boolean {
  return matchesRelations(
    field,
    object.relations
      .filter((relation) => relation.field === field.name)
      .map((relation) => refKey(relation.ref)),
  )
}

export function selectObjectFields(object: SemanticObjectView) {
  const relations = new Map<string, string[]>()
  for (const relation of object.relations) {
    const references = relations.get(relation.field) ?? []
    references.push(refKey(relation.ref))
    relations.set(relation.field, references)
  }
  const fields = object.fields.filter((field) => field.value)
  const uniqueFields = fields.filter(
    (field) => !matchesRelations(field, relations.get(field.name) ?? []),
  )
  const overviewNames = overviewFields[object.ref.kind] ?? []
  const overview = overviewNames.flatMap((name) =>
    uniqueFields.filter((field) => field.name === name),
  )
  const definition = uniqueFields.filter((field) => !overview.includes(field))
  return { overview, definition }
}

interface RelationRole {
  readonly field: string
  readonly positions: readonly number[]
  readonly total: number
}
interface RelationItem {
  readonly ref: SemanticRef
  readonly roles: readonly RelationRole[]
}
interface RelationGroup {
  readonly field: string
  readonly items: RelationItem[]
}

// Put each object under its most specific declared field. Other fields remain
// visible as roles, including positions when a field is split across groups.
export function groupRelations(relations: readonly ObjectRelation[]): RelationGroup[] {
  const generic = new Set(['dependencies', 'dependents'])
  const totals = new Map<string, number>()
  const targets = new Map<
    string,
    { ref: SemanticRef; fields: Map<string, number[]>; primary?: string }
  >()
  for (const relation of relations) {
    const position = (totals.get(relation.field) ?? 0) + 1
    totals.set(relation.field, position)
    const key = refKey(relation.ref)
    const target = targets.get(key) ?? { ref: relation.ref, fields: new Map<string, number[]>() }
    const positions = target.fields.get(relation.field) ?? []
    positions.push(position)
    target.fields.set(relation.field, positions)
    targets.set(key, target)
  }
  const assigned = new Map<string, number>()
  for (const target of targets.values()) {
    target.primary =
      [...target.fields.keys()].find((field) => !generic.has(field)) ??
      target.fields.keys().next().value
    if (target.primary) assigned.set(target.primary, (assigned.get(target.primary) ?? 0) + 1)
  }
  const groups = new Map<string, RelationGroup>()
  const seen = new Set<string>()
  for (const relation of relations) {
    const key = refKey(relation.ref)
    const target = targets.get(key)
    if (!target || target.primary !== relation.field || seen.has(key)) continue
    seen.add(key)
    const roles = [...target.fields].flatMap(([field, positions]) => {
      const total = totals.get(field) ?? 0
      return field !== target.primary || (assigned.get(field) ?? 0) !== total
        ? [{ field, positions, total }]
        : []
    })
    const group = groups.get(relation.field) ?? { field: relation.field, items: [] }
    group.items.push({ ref: target.ref, roles })
    groups.set(relation.field, group)
  }
  return [...groups.values()]
}
