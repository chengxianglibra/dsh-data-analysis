import { z } from 'zod'
import type { DatasourceAuthoring } from './authoring.ts'
import { CredentialServiceError } from './service.ts'
import { marivoCredentialStorageRef } from './shell-env.ts'

export type DatasourceDefaults = Record<string, Record<string, unknown>>
export type ManagedCredentialDefaults = Record<string, Record<string, string>>
export type DatasourceAuthoringView = DatasourceAuthoring & {
  creationDefaults?: DatasourceDefaults
}

/** Validate against this Workspace's live Runtime; never include config values in errors. */
export function withDatasourceDefaults(
  schema: DatasourceAuthoring,
  configured: unknown,
  managed?: ManagedCredentialDefaults,
): DatasourceAuthoringView {
  if (configured === undefined && managed === undefined) return schema
  const parsed = z
    .record(z.string(), z.record(z.string(), z.json()))
    .safeParse(configured === undefined ? {} : configured)
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
  const combined: DatasourceDefaults = Object.fromEntries(
    Object.entries(parsed.data).map(([backend, values]) => [backend, { ...values }]),
  )
  if (managed !== undefined) {
    const references = z.record(z.string(), z.record(z.string(), z.string())).safeParse(managed)
    if (!references.success) throw new CredentialServiceError('datasource-defaults-invalid')
    for (const [backend, fields] of Object.entries(references.data)) {
      const definition = schema.backends.find((item) => item.name === backend)
      if (!definition) throw new CredentialServiceError('datasource-defaults-backend-invalid')
      for (const [name, reference] of Object.entries(fields)) {
        if (!name.endsWith('_env') || !definition.fields.some((field) => field.name === name))
          throw new CredentialServiceError('datasource-defaults-field-invalid')
        marivoCredentialStorageRef(reference)
        if (Object.hasOwn(combined[backend] ?? {}, name))
          throw new CredentialServiceError('datasource-defaults-credential-forbidden')
      }
      combined[backend] = { ...combined[backend], ...fields }
    }
  }
  return { ...schema, creationDefaults: combined }
}
