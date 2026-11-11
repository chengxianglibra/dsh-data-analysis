import { z } from 'zod'
import { snapshotMetadataSchemas } from './snapshot.ts'

const name = z.string().min(1).max(512)
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
  coordinateColumns: z.array(coordinateColumn).max(64),
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
