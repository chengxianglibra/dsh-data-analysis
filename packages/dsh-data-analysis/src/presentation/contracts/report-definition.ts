import { z } from 'zod'
import { analysisResourceDeclaration, pythonCodeRef } from './resource-declaration.ts'
import { type FrameSnapshotV2, snapshotMetadataSchemas } from './snapshot.ts'

const text = z.string()
const names = z.array(text)
export const reportSourceSummary = z.discriminatedUnion('status', [
  z.strictObject({ codeRef: pythonCodeRef, status: z.literal('unavailable') }),
  z.strictObject({
    codeRef: pythonCodeRef,
    status: z.literal('available'),
    code: pythonCodeRef.extend({
      language: z.literal('python'),
      text,
      provenance: z.literal('execution'),
      datasources: z.array(z.strictObject({ name: text, backend: text.nullable() })).optional(),
      resultVariables: z.record(text, text).optional(),
    }),
  }),
])
const frameInterpretationSummary = z.union([
  snapshotMetadataSchemas.unavailableInterpretation,
  z.strictObject({
    status: z.literal('captured'),
    comparisons: z.array(
      z.strictObject({
        alias: snapshotMetadataSchemas.comparisonAlias,
        binding: z.enum(['ordinary', 'calendar', 'interval']),
        groups: snapshotMetadataSchemas.comparisonGroups,
      }),
    ),
    decompositions: z.array(
      z.strictObject({
        target: z.enum(['level', 'absolute', 'relative']),
        outputs: snapshotMetadataSchemas.decompositionOutputs,
      }),
    ),
    alignments: z.array(z.strictObject({ left: names, right: names })),
  }),
])
const data = {
  declaration: analysisResourceDeclaration,
  codeRef: pythonCodeRef.optional(),
  columns: z.array(snapshotMetadataSchemas.column),
  coverage: snapshotMetadataSchemas.coverage,
}
export const reportResourceSummary = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('image'),
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
    declaration: analysisResourceDeclaration,
  }),
  z.strictObject({ kind: z.literal('dataset'), ...data }),
  z.strictObject({
    kind: z.literal('frame'),
    ...data,
    fields: snapshotMetadataSchemas.fields,
    layout: snapshotMetadataSchemas.layout,
    axes: snapshotMetadataSchemas.axes,
    description: text.nullable(),
    values: names,
    interpretation: frameInterpretationSummary,
  }),
])
export const reportDefinition = z.strictObject({
  ref: text.min(1).max(4096),
  mode: z.enum(['edit', 'refresh-data']).optional(),
  basedOn: text.optional(),
  reuseGroups: z.array(names),
  title: text,
  locale: z.enum(['zh-CN', 'en-US']),
  catalog: z.strictObject({ id: text, build: text }),
  program: text,
  resources: z.record(text, reportResourceSummary),
  sources: z.array(reportSourceSummary).optional(),
})
export type ReportDefinition = z.infer<typeof reportDefinition>
export type ReportResourceSummary = z.infer<typeof reportResourceSummary>
export type ReportSourceSummary = z.infer<typeof reportSourceSummary>

/** Names needed for encoding, without business rows, periods, or analysis contexts. */
export function frameReadSummary(snapshot: FrameSnapshotV2) {
  const section = snapshot.frame.sections.interpretation
  const values = snapshot.frame.fields.filter((f) => f.role === 'value').map((f) => f.id)
  if (section.status !== 'captured')
    return { description: snapshot.frame.description, values, interpretation: section }
  return {
    description: snapshot.frame.description,
    values,
    interpretation: {
      status: section.status,
      comparisons: section.comparisons.map((c) => ({
        alias: c.alias,
        binding: c.binding.kind,
        groups: c.groups.map((g) => ({ name: g.name, values: g.values })),
      })),
      decompositions: section.decompositions.map((d) => ({
        target: d.target.kind,
        outputs: d.outputs.map((o) => ({ role: o.role, name: o.name })),
      })),
      alignments: section.alignments.map((a) => ({ left: a.left.values, right: a.right.values })),
    },
  }
}

const stringSpec = { type: 'string' } as const
const namesSpec = { type: 'array', items: stringSpec } as const
const codeRefSpec = {
  type: 'object',
  additionalProperties: false,
  properties: {
    executionId: { ...stringSpec, required: true },
    sha256: { ...stringSpec, required: true },
  },
} as const
const codeSpec = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...codeRefSpec.properties,
    language: { type: 'string', const: 'python', required: true },
    text: { ...stringSpec, required: true },
    provenance: { type: 'string', const: 'execution', required: true },
    datasources: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { ...stringSpec, required: true },
          backend: { oneOf: [stringSpec, { type: 'null' }], required: true },
        },
      },
    },
    resultVariables: {
      type: 'object',
      additionalProperties: true,
      description:
        'Output-name to Python variable-name string mapping; Host schema cannot express typed map values.',
    },
  },
} as const
const sourceSpec = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        codeRef: { ...codeRefSpec, required: true },
        status: { type: 'string', const: 'unavailable', required: true },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        codeRef: { ...codeRefSpec, required: true },
        status: { type: 'string', const: 'available', required: true },
        code: { ...codeSpec, required: true },
      },
    },
  ],
} as const
/** Host supports boolean additionalProperties only; map entries are validated above. */
export const reportDefinitionToolSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ref: { ...stringSpec, required: true },
    mode: { type: 'string', enum: ['edit', 'refresh-data'] },
    basedOn: stringSpec,
    title: { ...stringSpec, required: true },
    locale: { type: 'string', enum: ['zh-CN', 'en-US'], required: true },
    reuseGroups: { type: 'array', items: namesSpec, required: true },
    program: { ...stringSpec, required: true },
    catalog: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        id: { ...stringSpec, required: true },
        build: { ...stringSpec, required: true },
      },
    },
    resources: {
      type: 'object',
      additionalProperties: true,
      required: true,
      description:
        'Resource-name map. Every entry is validated as ReportResourceSummary: kind image|dataset|frame, exact declaration, optional codeRef; snapshots include columns [{id,label,type,nullable,unit?}] and coverage {start,totalRows,capturedRows,complete,columns,business}; Frame also includes fields,layout,axes,description,values,interpretation. Host JSON Schema cannot project typed dynamic map entries.',
    },
    sources: { type: 'array', items: sourceSpec },
  },
} as const
