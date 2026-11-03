// @ts-nocheck -- JSX is bundled by the plugin client build.

import { useEffect, useId, useRef, useState } from 'react'
import { useCopy } from './../i18n/context.tsx'
import { errorMessage, message } from './../i18n/copy.ts'
import { Button } from '../ui/controls.tsx'
import { Alert, AlertDescription } from '../ui/primitives/alert.tsx'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '../ui/primitives/card.tsx'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from '../ui/primitives/field.tsx'
import { Input } from '../ui/primitives/input.tsx'
import { NativeSelect } from '../ui/primitives/native-select.tsx'
import { credentialReference, prepareCredentials } from './credential-draft.ts'
import { creationFieldValues } from './defaults.ts'
import { datasourceDescription } from './descriptions.ts'

function credentialLabel(field) {
  return (
    {
      user_env: 'marivo.credentials.username',
      password_env: 'marivo.credentials.password',
      http_bearer_token_env: 'marivo.credentials.access-token',
      http_headers_env: 'marivo.credentials.header-credential-value',
    }[field] ?? field.replace(/_env$/, '')
  )
}
function credentialRows(schema, backend, values = schema.creationDefaults?.[backend] ?? {}) {
  return (schema.backends.find((item) => item.name === backend)?.fields ?? [])
    .filter((field) => field.name.endsWith('_env'))
    .flatMap((field) =>
      field.type === 'json'
        ? Object.entries(values[field.name] ?? {}).map(([key, existing]) => ({
            id: crypto.randomUUID(),
            field: field.name,
            key,
            existing,
            value: '',
          }))
        : [{ id: crypto.randomUUID(), field: field.name, existing: values[field.name], value: '' }],
    )
}

export function CreateDatasource({ model, workspaceId, close, name, requestId }) {
  const t = useCopy()

  const formId = useId()
  const active = useRef(false)
  const [schema, setSchema] = useState(null)
  const [original, setOriginal] = useState(null)
  const [backend, setBackend] = useState('')
  const [values, setValues] = useState({})
  const [credentials, setCredentials] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    active.current = true
    Promise.all([
      model.authoring(workspaceId, controller.signal, name ? 'edit' : 'create'),
      name ? model.configuration(workspaceId, name, controller.signal) : Promise.resolve(null),
    ])
      .then(([value, configuration]) => {
        if (controller.signal.aborted) return
        setSchema(value)
        setOriginal(configuration)
        setBackend(configuration?.backend ?? value.backends[0]?.name ?? '')
        setCredentials(
          credentialRows(
            value,
            configuration?.backend ?? value.backends[0]?.name,
            configuration?.fields,
          ),
        )
        if (!configuration) setValues(creationFieldValues(value, value.backends[0]?.name ?? ''))
        if (configuration) {
          const fields = value.backends.find((item) => item.name === configuration.backend)?.fields
          if (!fields)
            throw new Error('marivo.credentials.this-runtime-cannot-fully-edit-this-datasource')
          setValues(
            Object.fromEntries(
              fields
                .filter(
                  (field) =>
                    !field.name.endsWith('_env') && configuration.fields[field.name] !== undefined,
                )
                .map((field) => [
                  field.name,
                  field.type === 'string'
                    ? configuration.fields[field.name]
                    : JSON.stringify(configuration.fields[field.name]),
                ]),
            ),
          )
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorMessage(error))
      })
    return () => {
      active.current = false
      controller.abort()
    }
  }, [model, workspaceId, name])
  const fields = schema?.backends.find((item) => item.name === backend)?.fields ?? []
  const credentialFields = fields.filter((field) => field.name.endsWith('_env'))
  const updateCredential = (id, change) =>
    setCredentials((rows) => rows.map((row) => (row.id === id ? { ...row, ...change } : row)))
  async function submit(event) {
    event.preventDefault()
    if (busy) return
    setError('')
    const input = {}
    let changes = {}
    try {
      for (const field of fields.filter((field) => !field.name.endsWith('_env'))) {
        const value = values[field.name]
        if (value === undefined) continue
        if (
          value === '' &&
          (field.type !== 'string' ||
            (name
              ? original?.fields[field.name] !== ''
              : schema.creationDefaults?.[backend]?.[field.name] !== ''))
        )
          continue
        input[field.name] = field.type === 'string' ? value : JSON.parse(value)
      }
      const prepared = prepareCredentials(input.name ?? '', credentials)
      Object.assign(input, prepared.fields)
      changes = prepared.changes
    } catch (error) {
      setError(
        error instanceof SyntaxError
          ? 'marivo.credentials.check-the-format-of-number-boolean-and-json-fields'
          : errorMessage(error),
      )
      return
    }
    setBusy(true)
    // Remove secrets from mounted inputs as soon as the explicit submission begins.
    setCredentials((rows) => rows.map((row) => ({ ...row, value: '' })))
    try {
      await model.saveConfiguration(
        workspaceId,
        schema,
        { backend, fields: input },
        original,
        requestId,
        changes,
      )
      if (active.current) close()
    } catch (error) {
      if (active.current)
        setError(
          message('marivo.credentials.value-credential-inputs-have-been-cleared-enter-them-again', {
            p0: errorMessage(error),
          }),
        )
    } finally {
      for (const ref of Object.keys(changes)) delete changes[ref]
      if (active.current) setBusy(false)
    }
  }
  return (
    <form
      className="mc-form"
      aria-label={
        name ? t('marivo.credentials.edit-datasource') : t('marivo.credentials.add-datasource')
      }
      onSubmit={submit}
    >
      <Card>
        <CardHeader className="mc-detail-heading">
          <CardTitle role="heading" aria-level={3}>
            {name
              ? t('marivo.credentials.edit-datasource')
              : t('marivo.credentials.add-datasource')}
          </CardTitle>
        </CardHeader>
        <CardContent className="mc-form-body">
          {error && (
            <Alert role="alert" className="mc-result" data-tone="error">
              <AlertDescription>{t(error)}</AlertDescription>
            </Alert>
          )}
          {!schema && !error && (
            <p role="status">{t('marivo.credentials.loading-datasource-configuration-fields')}</p>
          )}
          {schema && (
            <FieldSet className="mc-field" disabled={busy}>
              <FieldGroup>
                <Field data-disabled={busy}>
                  <FieldLabel htmlFor={`${formId}-engine`}>
                    {t('marivo.credentials.engine')}
                  </FieldLabel>
                  <NativeSelect
                    id={`${formId}-engine`}
                    aria-label={t('marivo.credentials.engine')}
                    disabled={!!name}
                    value={backend}
                    onChange={(event) => {
                      setBackend(event.target.value)
                      setValues(creationFieldValues(schema, event.target.value))
                      setCredentials(credentialRows(schema, event.target.value))
                      setError('')
                    }}
                  >
                    {schema.backends.map((item) => (
                      <option key={item.name} value={item.name}>
                        {item.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                {fields
                  .filter((field) => !field.name.endsWith('_env'))
                  .map((field) => (
                    <Field
                      key={field.name}
                      data-disabled={busy || (!!name && field.name === 'name')}
                    >
                      <FieldLabel htmlFor={`${formId}-${field.name}`}>
                        {field.name}
                        {field.required ? ' *' : ''}
                      </FieldLabel>
                      {field.description && (
                        <FieldDescription id={`${formId}-${field.name}-help`}>
                          {t(datasourceDescription(field.description))}
                        </FieldDescription>
                      )}
                      {field.type === 'boolean' ? (
                        <NativeSelect
                          id={`${formId}-${field.name}`}
                          aria-label={field.name}
                          aria-describedby={
                            field.description ? `${formId}-${field.name}-help` : undefined
                          }
                          value={values[field.name] ?? ''}
                          onChange={(event) =>
                            setValues({ ...values, [field.name]: event.target.value })
                          }
                        >
                          <option value="">
                            {t('marivo.credentials.default')}
                            {field.default == null ? '' : ` (${field.default})`}
                          </option>
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </NativeSelect>
                      ) : (
                        <Input
                          id={`${formId}-${field.name}`}
                          aria-label={field.name}
                          aria-describedby={
                            field.description ? `${formId}-${field.name}-help` : undefined
                          }
                          required={field.required}
                          disabled={!!name && field.name === 'name'}
                          autoComplete="off"
                          type={field.type === 'number' ? 'number' : 'text'}
                          placeholder={
                            field.default == null
                              ? field.type === 'json'
                                ? 'JSON'
                                : ''
                              : String(field.default)
                          }
                          value={values[field.name] ?? ''}
                          onChange={(event) =>
                            setValues({ ...values, [field.name]: event.target.value })
                          }
                        />
                      )}
                    </Field>
                  ))}
                {credentialFields.length > 0 && (
                  <section
                    className="mc-inline-credentials"
                    aria-label={t('marivo.credentials.connection-credentials')}
                  >
                    <h4>{t('marivo.credentials.connection-credentials')}</h4>
                    <p className="mc-note">
                      {t(
                        'marivo.credentials.enter-credential-values-directly-for-harness-to-save-references',
                      )}
                      {name
                        ? t('marivo.credentials.leave-blank-to-keep-the-current-value-a-new')
                        : ''}
                    </p>
                    {credentialFields.map((field) => (
                      <div key={field.name} className="mc-credential-group">
                        {credentials
                          .filter((row) => row.field === field.name)
                          .map((row) => {
                            const label = credentialLabel(field.name)
                            const reference = credentialReference(values.name ?? '', row)
                            return (
                              <div key={row.id} className="mc-credential-entry">
                                {row.key !== undefined && (
                                  <Field data-disabled={busy}>
                                    <FieldLabel htmlFor={`${formId}-${row.id}-header`}>
                                      {t('marivo.credentials.header-name')}
                                    </FieldLabel>
                                    <Input
                                      id={`${formId}-${row.id}-header`}
                                      aria-label={t('marivo.credentials.header-name')}
                                      value={row.key}
                                      onChange={(event) =>
                                        updateCredential(row.id, { key: event.target.value })
                                      }
                                    />
                                  </Field>
                                )}
                                <Field data-disabled={busy}>
                                  <FieldLabel htmlFor={`${formId}-${row.id}-value`}>
                                    {t(label)}
                                    {field.required ? ' *' : ''}
                                  </FieldLabel>
                                  <FieldDescription id={`${formId}-${row.id}-value-help`}>
                                    {row.existing
                                      ? t(
                                          'marivo.credentials.a-reference-is-configured-leave-blank-to-keep-it',
                                        )
                                      : t(
                                          'marivo.credentials.enter-the-value-directly-no-need-to-create-a',
                                        )}
                                  </FieldDescription>
                                  <Input
                                    id={`${formId}-${row.id}-value`}
                                    aria-describedby={`${formId}-${row.id}-value-help`}
                                    aria-label={t(label)}
                                    type="password"
                                    autoComplete="new-password"
                                    maxLength={65536}
                                    required={field.required && !reference}
                                    value={row.value}
                                    placeholder={
                                      row.existing
                                        ? t(
                                            'marivo.credentials.leave-blank-to-keep-enter-a-new-value-to',
                                          )
                                        : t('marivo.credentials.enter-credential-value')
                                    }
                                    onChange={(event) =>
                                      updateCredential(row.id, { value: event.target.value })
                                    }
                                  />
                                </Field>
                                <details className="mc-reference-options">
                                  <summary>
                                    {t('marivo.credentials.credential-reference-review-or-change')}
                                  </summary>
                                  <Field data-disabled={busy}>
                                    <FieldLabel htmlFor={`${formId}-${row.id}-reference`}>
                                      {field.name}
                                    </FieldLabel>
                                    <Input
                                      id={`${formId}-${row.id}-reference`}
                                      aria-label={field.name}
                                      autoComplete="off"
                                      value={reference}
                                      placeholder={t(
                                        'marivo.credentials.generated-after-entering-a-credential-value',
                                      )}
                                      onChange={(event) =>
                                        updateCredential(row.id, {
                                          reference: event.target.value,
                                        })
                                      }
                                    />
                                  </Field>
                                  <p className="mc-note">
                                    {t(
                                      'marivo.credentials.to-reuse-a-saved-credential-enter-its-reference-and',
                                    )}
                                  </p>
                                  {row.reference !== undefined && (
                                    <Button
                                      variant="outline"
                                      type="button"
                                      onClick={() =>
                                        updateCredential(row.id, { reference: undefined })
                                      }
                                    >
                                      {t('marivo.credentials.restore-automatic-reference')}
                                    </Button>
                                  )}
                                </details>
                                {row.key !== undefined && (
                                  <Button
                                    variant="ghost"
                                    type="button"
                                    onClick={() =>
                                      setCredentials((rows) =>
                                        rows.filter((item) => item.id !== row.id),
                                      )
                                    }
                                  >
                                    {t('marivo.credentials.remove-header')}
                                  </Button>
                                )}
                              </div>
                            )
                          })}
                        {field.type === 'json' && (
                          <Button
                            variant="outline"
                            type="button"
                            onClick={() =>
                              setCredentials((rows) => [
                                ...rows,
                                { id: crypto.randomUUID(), field: field.name, key: '', value: '' },
                              ])
                            }
                          >
                            {t('marivo.credentials.add-header-credential')}
                          </Button>
                        )}
                      </div>
                    ))}
                  </section>
                )}
              </FieldGroup>
            </FieldSet>
          )}
        </CardContent>
        <p className="mc-note">
          {requestId
            ? t(
                'marivo.credentials.save-configuration-and-credentials-then-test-the-connection-the',
              )
            : name
              ? t('marivo.credentials.test-the-connection-again-after-saving-name-and-engine')
              : ''}
        </p>
        <CardFooter className="mc-form-footer">
          <Button variant="default" type="submit" disabled={!backend || busy}>
            {busy
              ? t('marivo.credentials.saving-or-validating')
              : requestId
                ? t('marivo.credentials.save-and-test-then-continue')
                : name
                  ? t('marivo.credentials.save-configuration')
                  : t('marivo.credentials.confirm-new-datasource')}
          </Button>
          <Button variant="outline" type="button" onClick={close} disabled={busy}>
            {t('marivo.credentials.cancel')}
          </Button>
        </CardFooter>
      </Card>
    </form>
  )
}
