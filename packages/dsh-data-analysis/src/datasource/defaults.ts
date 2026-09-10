import { z } from 'zod'
import type { DatasourceAuthoring } from './authoring.ts'
import { CredentialServiceError } from './service.ts'

export type DatasourceDefaults = Record<string, Record<string, unknown>>
export type DatasourceAuthoringView = DatasourceAuthoring & {
  creationDefaults?: DatasourceDefaults
}

/** Validate against this Workspace's live Runtime; never include config values in errors. */
export function withDatasourceDefaults(
  schema: DatasourceAuthoring,
  configured: unknown,
): DatasourceAuthoringView {
  if (configured === undefined) return schema
  const parsed = z.record(z.string(), z.record(z.string(), z.json())).safeParse(configured)
  if (!parsed.success) throw new CredentialServiceError('datasource-defaults-invalid')
  for (const [backend, values] of Object.entries(parsed.data)) {
    const definition = schema.backends.find((item) => item.name === backend)
    if (!definition) throw new CredentialServiceError('datasource-defaults-backend-invalid')
    for (const [name, value] of Object.entries(values)) {
      const field = definition.fields.find((item) => item.name === name)
      if (name.endsWith('_env'))
        throw new CredentialServiceError('datasource-defaults-credential-forbidden')
      if (!field) throw new CredentialServiceError('datasource-defaults-field-invalid')
      if (field.type !== 'json' && typeof value !== field.type)
        throw new CredentialServiceError('datasource-defaults-type-invalid')
    }
  }
  return { ...schema, creationDefaults: parsed.data }
}
