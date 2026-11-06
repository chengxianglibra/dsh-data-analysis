import type { DatasourceAuthoring } from '../../datasource/authoring.ts'

type DatasourceField = DatasourceAuthoring['backends'][number]['fields'][number]

// These are presentation preferences, not an engine or field registry: the
// Runtime remains authoritative about which fields exist and are required.
const basicNames = new Set([
  'name',
  'host',
  'port',
  'path',
  'database',
  'catalog',
  'schema',
  'secure',
  'http_scheme',
  'wall_clock_timezone',
])

export function groupDatasourceFields<T extends DatasourceField>(
  fields: readonly T[],
  backend: string,
): {
  basic: T[]
  advanced: T[]
  credential: T[]
  secrets: T[]
} {
  const basic: T[] = []
  const advanced: T[] = []
  const credential: T[] = []
  const secrets: T[] = []
  for (const field of fields) {
    // Keep existing values in the edit payload, but do not expose DuckDB's
    // connection mode as a form setting.
    if (backend === 'duckdb' && field.name === 'read_only') continue
    if (field.type === 'credential') credential.push(field)
    else if (field.type === 'secrets') secrets.push(field)
    else if (field.required || basicNames.has(field.name)) basic.push(field)
    else advanced.push(field)
  }
  // Keep the source timezone visible after the connection fields.
  basic.sort(
    (a, b) =>
      Number(b.required) - Number(a.required) ||
      Number(a.name === 'wall_clock_timezone') - Number(b.name === 'wall_clock_timezone'),
  )
  return { basic, advanced, credential, secrets }
}

export function isRestrictedAutocommit(backend: string, field: DatasourceField): boolean {
  return (
    (backend === 'mysql' || backend === 'postgres') &&
    field.name === 'autocommit' &&
    field.type === 'boolean'
  )
}

export function hasUnsupportedAutocommit(
  backend: string,
  fields: readonly DatasourceField[],
  values: Record<string, string | undefined>,
): boolean {
  return (
    values.autocommit === 'false' && fields.some((field) => isRestrictedAutocommit(backend, field))
  )
}
