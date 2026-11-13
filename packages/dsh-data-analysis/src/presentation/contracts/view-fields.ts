import { z } from 'zod'
import { snapshotMetadataSchemas } from './snapshot.ts'

const name = z.string().min(1).max(512)
const usage = z.strictObject({
  nameKind: z.enum(['column-id', 'public-axis-name', 'public-value-name']),
  parameters: z.array(z.string().min(1).max(128)).max(12),
})
export const viewNames = z.array(name).max(64)
export const viewAxis = z.strictObject({ token: name, name, role: name })
export const coordinateColumn = snapshotMetadataSchemas.layout.element.options[1].omit({
  kind: true,
})
export const viewFieldMetadata = {
  viewCandidates: z.strictObject({
    columns: viewNames,
    axis: viewNames,
    timeAxis: viewNames,
    values: viewNames,
    numericValues: viewNames,
  }),
  viewCandidateUsage: z.strictObject({
    columns: usage,
    axis: usage,
    timeAxis: usage,
    values: usage,
    numericValues: usage,
  }),
  coordinateColumns: z.array(coordinateColumn.extend({ axisName: name.optional() })).max(64),
}

/** Parameter names sit beside candidate arrays in both initial and repair receipts. */
export function viewCandidateUsage(
  kind: 'frame' | 'dataset',
): z.infer<typeof viewFieldMetadata.viewCandidateUsage> {
  const frame = kind === 'frame'
  return {
    columns: {
      nameKind: 'column-id',
      parameters: ['table.columns', 'metric.encoding.value', 'labels'],
    },
    axis: {
      nameKind: frame ? 'public-axis-name' : 'column-id',
      parameters: [
        'bar.encoding.axis',
        'line.encoding.series',
        'area.encoding.series',
        'bar.encoding.series',
        'heatmap.encoding.x',
        'heatmap.encoding.y',
        ...(frame ? ['pie.encoding.axis'] : []),
      ],
    },
    timeAxis: {
      nameKind: frame ? 'public-axis-name' : 'column-id',
      parameters: ['line.encoding.axis', 'area.encoding.axis'],
    },
    values: {
      nameKind: frame ? 'public-value-name' : 'column-id',
      parameters: frame
        ? ['comparison.encoding.value', 'decomposition.encoding.value']
        : ['metric.encoding.value'],
    },
    numericValues: {
      nameKind: frame ? 'public-value-name' : 'column-id',
      parameters: [
        'line.encoding.values',
        'area.encoding.values',
        'bar.encoding.values',
        'heatmap.encoding.value',
        ...(frame ? ['pie.encoding.value'] : []),
      ],
    },
  }
}

export const numericViewType = (type: string | undefined) =>
  type === 'float64' || type === 'int64' || type === 'decimal'
export const timeAxisRole = (role: string) => role === 'calendar' || role === 'interval'

/** The schema-level choices shared by the Python handoff and report receipts. */
export function viewCandidates(
  columns: string[],
  axes: ReadonlyArray<{ name: string; role: string }> | undefined,
  values: string[],
  numericValues: string[],
) {
  return {
    columns,
    axis: axes?.map(({ name }) => name) ?? columns,
    timeAxis: axes?.filter(({ role }) => timeAxisRole(role)).map(({ name }) => name) ?? columns,
    values,
    numericValues,
  }
}

/** Exclude names already in use in other positions of a distinct-name list. */
export function availableNames(names: string[], selected: string[], index: number) {
  return names.filter((name) => !selected.some((item, i) => i !== index && item === name))
}
