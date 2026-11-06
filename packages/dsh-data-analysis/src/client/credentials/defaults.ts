import type { DatasourceAuthoringView } from '../../datasource/defaults.ts'

export function creationFieldValues(
  schema: DatasourceAuthoringView,
  backend: string,
  browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): Record<string, string> {
  const defaults = schema.creationDefaults?.[backend] ?? {}
  const fields = schema.backends.find((item) => item.name === backend)?.fields ?? []
  const values = Object.fromEntries(
    fields
      .filter(
        (field) =>
          field.type !== 'credential' &&
          field.type !== 'secrets' &&
          !(backend === 'duckdb' && field.name === 'read_only') &&
          Object.hasOwn(defaults, field.name),
      )
      .map((field) => [
        field.name,
        field.type === 'string'
          ? (defaults[field.name] as string)
          : JSON.stringify(defaults[field.name]),
      ]),
  )
  if (
    browserTimezone &&
    !Object.hasOwn(defaults, 'wall_clock_timezone') &&
    fields.some((field) => field.name === 'wall_clock_timezone' && field.type === 'string')
  )
    values.wall_clock_timezone = browserTimezone
  return values
}
