import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CalendarDaysIcon,
  Clock3Icon,
  Columns3Icon,
  DatabaseIcon,
  FolderIcon,
  HashIcon,
  Link2Icon,
  RulerIcon,
  Table2Icon,
} from 'lucide-react'
import { fieldIcon, kindIcon } from '../../src/client/semantic-browser/icons.ts'
import {
  groupRelations,
  representedByRelations,
  selectObjectFields,
} from '../../src/client/semantic-browser/presentation.ts'
import type { DisplayField, SemanticObjectView } from '../../src/semantic-browser/contracts.ts'
import type { SemanticRef } from '../../src/semantic-reference/contracts.ts'
import { object } from './fixtures.ts'

function ref(kind: string, path: string): SemanticRef {
  return { schema: 'marivo.semantic_ref/v1', kind, path }
}
const entity = ref('entity', 'sales.orders')
const field = ref('dimension', 'sales.orders.region')
const time = ref('time_dimension', 'sales.orders.ordered_at')
const value = (name: string, text: string): DisplayField => ({ name, value: text })
const list = (name: string, items: unknown[]): DisplayField => ({
  name,
  value: JSON.stringify(items),
  structured: true,
})
function fixture(kind: string, fields: DisplayField[], relations: SemanticObjectView['relations']) {
  return { ...object('sample', kind), fields, relations }
}

test('object icons and icons identifying referenced kinds share one mapping', () => {
  const icons = {
    domain: FolderIcon,
    datasource: DatabaseIcon,
    entity: Table2Icon,
    dimension: Columns3Icon,
    measure: RulerIcon,
    time_dimension: Clock3Icon,
    metric: HashIcon,
    relationship: Link2Icon,
    period_calendar: CalendarDaysIcon,
    temporal_set: CalendarDaysIcon,
  }
  for (const [kind, expected] of Object.entries(icons)) assert.equal(kindIcon(kind), expected)
  for (const [name, kind] of Object.entries({
    domain: 'domain',
    entity: 'entity',
    from_entity: 'entity',
    to_entity: 'entity',
    roots: 'entity',
    datasource: 'datasource',
    date: 'time_dimension',
    default_time: 'time_dimension',
    start: 'time_dimension',
    end: 'time_dimension',
    occurrence_id: 'dimension',
    category: 'dimension',
  })) {
    assert.equal(fieldIcon(name), kindIcon(kind), name)
  }
})

test('each supported kind places overview facts, definition details and direct relationships once', () => {
  const examples: Array<{
    kind: string
    summary: DisplayField
    detail: DisplayField
    reference: DisplayField
    target: SemanticRef
  }> = [
    {
      kind: 'domain',
      summary: value('owner', 'Sales'),
      detail: value('other', 'x'),
      reference: list('members', ['entity:sales.orders']),
      target: entity,
    },
    {
      kind: 'datasource',
      summary: value('backend_type', 'duckdb'),
      detail: value('other', 'x'),
      reference: list('entities', ['entity:sales.orders']),
      target: entity,
    },
    {
      kind: 'entity',
      summary: value('source_table', 'orders'),
      detail: value('other', 'x'),
      reference: list('fields', ['dimension:sales.orders.region']),
      target: field,
    },
    {
      kind: 'dimension',
      summary: value('unit', 'region'),
      detail: value('other', 'x'),
      reference: value('entity', 'entity:sales.orders'),
      target: entity,
    },
    {
      kind: 'measure',
      summary: value('sample_interval', '1 day'),
      detail: value('unit', 'CNY'),
      reference: value('entity', 'entity:sales.orders'),
      target: entity,
    },
    {
      kind: 'time_dimension',
      summary: value('parse', 'timestamp'),
      detail: value('other', 'x'),
      reference: value('entity', 'entity:sales.orders'),
      target: entity,
    },
    {
      kind: 'metric',
      summary: value('unit', 'CNY'),
      detail: value('other', 'x'),
      reference: list('roots', ['entity:sales.orders']),
      target: entity,
    },
    {
      kind: 'relationship',
      summary: value('cardinality', 'one_to_many'),
      detail: value('other', 'x'),
      reference: value('from_entity', 'entity:sales.orders'),
      target: entity,
    },
    {
      kind: 'period_calendar',
      summary: value('boundary_timezone', 'UTC'),
      detail: value('other', 'x'),
      reference: value('date', 'time_dimension:sales.orders.ordered_at'),
      target: time,
    },
    {
      kind: 'temporal_set',
      summary: value('boundary_timezone', 'UTC'),
      detail: value('other', 'x'),
      reference: value('start', 'time_dimension:sales.orders.ordered_at'),
      target: time,
    },
  ]
  for (const { kind, summary, detail, reference, target } of examples) {
    const view = fixture(
      kind,
      [summary, detail, reference],
      [{ field: reference.name, ref: target }],
    )
    const selected = selectObjectFields(view)
    assert.deepEqual(selected.overview, [summary], `${kind} overview`)
    assert.deepEqual(selected.definition, [detail], `${kind} definition`)
    assert.equal(representedByRelations(reference, view), true, `${kind} relation`)
    assert.deepEqual(
      view.fields,
      [summary, detail, reference],
      `${kind} snapshot remains unchanged`,
    )
  }
})

test('relationship links replace a field only when they preserve the full ordered value', () => {
  const relations = [
    { field: 'dependencies', ref: entity },
    { field: 'dependencies', ref: field },
  ]
  const fields = [
    list('dependencies', ['entity:sales.orders', 'dimension:sales.orders.region']),
    list('dependencies', ['dimension:sales.orders.region', 'entity:sales.orders']),
    list('dependencies', ['entity:sales.orders', 'entity:sales.orders']),
    list('dependencies', ['entity:sales.orders', 'unresolved']),
    list('dependencies', []),
    list('levels', [['week', 'dimension:sales.orders.region']]),
  ]
  const view = fixture('entity', fields, relations)
  assert.equal(representedByRelations(fields[0]!, view), true)
  for (const item of fields.slice(1)) assert.equal(representedByRelations(item, view), false)
  assert.deepEqual(selectObjectFields(view).definition, fields.slice(1))
})

test('relationship cards are unique while field roles and their original positions remain visible', () => {
  const relations = [
    { field: 'dependencies', ref: field },
    { field: 'dependencies', ref: entity },
    { field: 'dependencies', ref: time },
    { field: 'dependents', ref: entity },
    { field: 'entity', ref: entity },
    { field: 'default_time', ref: time },
  ]
  assert.deepEqual(groupRelations(relations), [
    {
      field: 'dependencies',
      items: [{ ref: field, roles: [{ field: 'dependencies', positions: [1], total: 3 }] }],
    },
    {
      field: 'entity',
      items: [
        {
          ref: entity,
          roles: [
            { field: 'dependencies', positions: [2], total: 3 },
            { field: 'dependents', positions: [1], total: 1 },
          ],
        },
      ],
    },
    {
      field: 'default_time',
      items: [{ ref: time, roles: [{ field: 'dependencies', positions: [3], total: 3 }] }],
    },
  ])
  assert.deepEqual(
    relations.map((relation) => relation.field),
    ['dependencies', 'dependencies', 'dependencies', 'dependents', 'entity', 'default_time'],
  )
})

test('grouped cards retain specific field order and repeated relationship positions', () => {
  assert.deepEqual(
    groupRelations([
      { field: 'dependencies', ref: field },
      { field: 'dependencies', ref: entity },
      { field: 'fields', ref: entity },
      { field: 'fields', ref: field },
      { field: 'fields', ref: field },
      { field: 'other', ref: field },
    ]),
    [
      {
        field: 'fields',
        items: [
          {
            ref: entity,
            roles: [
              { field: 'dependencies', positions: [2], total: 2 },
              { field: 'fields', positions: [1], total: 3 },
            ],
          },
          {
            ref: field,
            roles: [
              { field: 'dependencies', positions: [1], total: 2 },
              { field: 'fields', positions: [2, 3], total: 3 },
              { field: 'other', positions: [1], total: 1 },
            ],
          },
        ],
      },
    ],
  )
})
