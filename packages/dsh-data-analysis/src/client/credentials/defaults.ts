import type { DatasourceAuthoringView } from '../../datasource/defaults.ts'

export function creationFieldValues(
  schema: DatasourceAuthoringView,
  backend: string,
): Record<string, string> {
  const defaults = schema.creationDefaults?.[backend] ?? {}
  return Object.fromEntries(
    (schema.backends.find((item) => item.name === backend)?.fields ?? [])
      .filter((field) => !field.name.endsWith('_env') && Object.hasOwn(defaults, field.name))
      .map((field) => [
        field.name,
        field.type === 'string'
          ? (defaults[field.name] as string)
          : JSON.stringify(defaults[field.name]),
      ]),
  )
}
