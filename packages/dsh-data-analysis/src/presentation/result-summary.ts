import { z } from 'zod'
import type { AnalysisDocument } from './contracts/analysis-document.ts'
import { snapshotMetadataSchemas } from './contracts/snapshot.ts'
import {
  numericViewType,
  viewCandidates,
  viewCandidateUsage,
  viewFieldMetadata,
} from './contracts/view-fields.ts'

export const resultConfigurationSummary = z.strictObject({
  ...viewFieldMetadata,
  kind: z.enum(['frame', 'dataset']),
  columns: z.array(snapshotMetadataSchemas.column.pick({ id: true, type: true })),
  coverage: snapshotMetadataSchemas.coverage,
  values: z.array(z.string()).optional(),
  axes: z
    .array(
      snapshotMetadataSchemas.axes.element
        .pick({ token: true, name: true, role: true, variant: true })
        .extend({ keyTypes: z.array(snapshotMetadataSchemas.column.shape.type) }),
    )
    .optional(),
})
export const analysisResultSummarySchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('captured'),
    resources: z.record(z.string(), resultConfigurationSummary),
  }),
  z.strictObject({ status: z.literal('unavailable'), reason: z.literal('budget') }),
])
export type ResultConfigurationSummary = z.infer<typeof resultConfigurationSummary>
export type AnalysisResultSummary = z.infer<typeof analysisResultSummarySchema>

/** Configuration facts from admitted snapshots only; never reads results or source data. */
export function analysisResultSummary(
  resources: AnalysisDocument['resources'],
): AnalysisResultSummary {
  const summaries: Record<string, ResultConfigurationSummary> = {}
  for (const [name, resource] of Object.entries(resources)) {
    if (resource.kind !== 'snapshot') continue
    const snapshot = resource.snapshot
    const columns = snapshot.data.columns.map(({ id, type }) => ({ id, type }))
    const frame = snapshot.kind === 'frame' ? snapshot.frame : undefined
    const values = frame?.fields.filter(({ role }) => role === 'value').map(({ id }) => id)
    const axes = frame?.axes.map(({ token, name, role, variant, keys }) => ({
      token,
      name,
      role,
      variant,
      keyTypes: keys.map(({ dtype }) => dtype.type),
    }))
    const ids = columns.map(({ id }) => id)
    const valueNames = values ?? ids
    summaries[name] = {
      kind: snapshot.kind,
      columns,
      coverage: snapshot.coverage,
      ...(frame ? { values, axes } : {}),
      viewCandidateUsage: viewCandidateUsage(snapshot.kind),
      viewCandidates: viewCandidates(
        ids,
        frame?.axes.map(({ name, variant }) => ({ name, role: variant.kind })),
        valueNames,
        columns
          .filter(({ id, type }) => valueNames.includes(id) && numericViewType(type))
          .map(({ id }) => id),
      ),
      coordinateColumns:
        frame?.layout.flatMap((entry) => {
          if (entry.kind !== 'coordinate') return []
          const { name, axisToken, endpoint, part } = entry
          return [
            {
              name,
              axisToken,
              endpoint,
              part,
              axisName: axes?.find((axis) => axis.token === axisToken)?.name,
            },
          ]
        }) ?? [],
    }
  }
  // Axis names can repeat across many projected columns. Keep the token mapping
  // and candidate arrays when direct names alone would exceed the budget.
  if (Buffer.byteLength(JSON.stringify(summaries)) > 32 * 1024)
    for (const summary of Object.values(summaries))
      summary.coordinateColumns = summary.coordinateColumns.map(
        ({ axisName: _axisName, ...column }) => column,
      )
  // A large directory is disclosed explicitly as unavailable rather than silently truncated.
  return analysisResultSummarySchema.parse(
    Buffer.byteLength(JSON.stringify(summaries)) <= 32 * 1024
      ? { status: 'captured', resources: summaries }
      : { status: 'unavailable', reason: 'budget' },
  )
}

/** Dynamic resource entries use the concrete local validator; Host only supports open maps. */
export const analysisResultSummaryToolSchema = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        status: { type: 'string', const: 'captured', required: true },
        resources: {
          type: 'object',
          additionalProperties: true,
          required: true,
          description:
            'Resource-name map. Each entry has kind, columns:[{id,type}], coverage, optional Frame values and axes:[{token,name,role,variant,keyTypes}] (variant includes calendar timezone and grain), viewCandidates:{columns,axis,timeAxis,values,numericValues} (name arrays), viewCandidateUsage mapping each candidate group to {nameKind,parameters} (chart.parameter paths), and coordinateColumns:[{name,axisToken,axisName?,endpoint,part}].',
        },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        status: { type: 'string', const: 'unavailable', required: true },
        reason: { type: 'string', const: 'budget', required: true },
      },
    },
  ],
} as const
