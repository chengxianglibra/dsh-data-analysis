import { z } from 'zod'
import type { AnalysisDocument } from './contracts/analysis-document.ts'
import { snapshotMetadataSchemas } from './contracts/snapshot.ts'

export const resultConfigurationSummary = z.strictObject({
  kind: z.enum(['frame', 'dataset']),
  columns: z.array(snapshotMetadataSchemas.column.pick({ id: true, type: true })),
  coverage: snapshotMetadataSchemas.coverage,
  values: z.array(z.string()).optional(),
  axes: z
    .array(snapshotMetadataSchemas.axes.element.pick({ token: true, name: true, role: true }))
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
    summaries[name] = {
      kind: snapshot.kind,
      columns: snapshot.data.columns.map(({ id, type }) => ({ id, type })),
      coverage: snapshot.coverage,
      ...(snapshot.kind === 'frame'
        ? {
            values: snapshot.frame.fields
              .filter((field) => field.role === 'value')
              .map((field) => field.id),
            axes: snapshot.frame.axes.map(({ token, name, role }) => ({ token, name, role })),
          }
        : {}),
    }
  }
  // A large directory is disclosed explicitly as unavailable rather than silently truncated.
  return analysisResultSummarySchema.parse(
    Buffer.byteLength(JSON.stringify(summaries)) <= 16 * 1024
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
            'Resource-name map validated per entry as {kind:"frame"|"dataset",columns:[{id,type}],coverage:{start,totalRows,capturedRows,complete,columns,business},values?:string[],axes?:[{token,name,role}]}. Host schema cannot project typed dynamic map values.',
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
