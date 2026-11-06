// @ts-nocheck -- JSX is bundled by the plugin client build.

import { useEffect, useState } from 'react'
import { Button } from '../ui/controls.tsx'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '../ui/primitives/field.tsx'
import { Input } from '../ui/primitives/input.tsx'
import { NativeSelect } from '../ui/primitives/native-select.tsx'
import { credentialReference } from './credential-draft.ts'

const allowed = {
  s3: [
    'type',
    'scope',
    'region',
    'key_id',
    'secret',
    'session_token',
    'endpoint',
    'url_style',
    'use_ssl',
  ],
  http_bearer: ['type', 'scope', 'token'],
  http_headers: ['type', 'scope', 'headers'],
}
const credentialKeys = {
  s3: ['key_id', 'secret', 'session_token'],
  http_bearer: ['token'],
  http_headers: [],
}
const labels = {
  key_id: 'marivo.credentials.scoped-access-key',
  secret: 'marivo.credentials.scoped-secret-key',
  session_token: 'marivo.credentials.scoped-session-token',
  token: 'marivo.credentials.scoped-bearer-token',
  header: 'marivo.credentials.scoped-header-value',
}
const titles = {
  s3: 'marivo.credentials.scoped-s3',
  http_bearer: 'marivo.credentials.scoped-bearer',
  http_headers: 'marivo.credentials.scoped-headers',
}
const uid = () => crypto.randomUUID()
const slot = (ref = '') => ({ id: uid(), ref })

/** Refuse unknown fields rather than discard a Runtime extension on edit. */
export function supportsScopedSecrets(value) {
  try {
    const items = JSON.parse(value || '[]')
    return (
      Array.isArray(items) &&
      items.every((item) => {
        if (
          !item ||
          typeof item !== 'object' ||
          Array.isArray(item) ||
          !Object.hasOwn(allowed, item.type)
        )
          return false
        if (Object.keys(item).some((key) => !allowed[item.type].includes(key))) return false
        if (item.type === 'http_headers')
          return (
            !!item.headers &&
            typeof item.headers === 'object' &&
            !Array.isArray(item.headers) &&
            Object.values(item.headers).every((ref) => typeof ref === 'string')
          )
        return credentialKeys[item.type].every(
          (key) => item[key] === undefined || typeof item[key] === 'string',
        )
      })
    )
  } catch {
    return false
  }
}

function drafts(value) {
  if (!supportsScopedSecrets(value)) return []
  return JSON.parse(value || '[]').map((source) => {
    const data = { ...source }
    const credentials = Object.fromEntries(
      credentialKeys[data.type].map((key) => {
        const ref = data[key] ?? ''
        delete data[key]
        return [key, slot(ref)]
      }),
    )
    const headers =
      data.type === 'http_headers'
        ? Object.entries(data.headers).map(([name, ref]) => ({
            id: uid(),
            name,
            credential: slot(ref),
          }))
        : []
    delete data.headers
    return { id: uid(), data, credentials, headers }
  })
}

/** Encode only non-secret definitions; draft values remain in component state owned by the form. */
function encode(entries) {
  return entries.map(({ data, credentials, headers }) => {
    const item = { ...data }
    for (const [key, credential] of Object.entries(credentials))
      if (credential.ref) item[key] = credential.ref
    if (data.type === 'http_headers')
      item.headers = Object.fromEntries(
        headers.map(({ name, credential }) => [name, credential.ref]),
      )
    return item
  })
}

function draftError(entries) {
  const scopes = new Set()
  for (const entry of entries) {
    const scope = entry.data.scope
    if (scope) {
      const key = `${entry.data.type === 's3' ? 's3' : 'http'}:${scope}`
      if (scopes.has(key)) return 'marivo.credentials.scoped-duplicate-scope'
      scopes.add(key)
    }
    if (entry.data.type !== 'http_headers') continue
    const names = entry.headers.map(({ name }) => name.trim().toLowerCase())
    if (!names.length || names.some((name) => !name) || new Set(names).size !== names.length)
      return 'marivo.credentials.scoped-duplicate-headers'
  }
  return ''
}

export function restoreClearedScopedDrafts(entries, secretValues) {
  let changed = false
  const restore = (credential) => {
    if (credential.previous === undefined || Object.hasOwn(secretValues, credential.ref))
      return credential
    changed = true
    return { ...credential, ref: credential.previous, previous: undefined }
  }
  const next = entries.map((entry) => ({
    ...entry,
    credentials: Object.fromEntries(
      Object.entries(entry.credentials).map(([key, item]) => [key, restore(item)]),
    ),
    headers: entry.headers.map((header) => ({ ...header, credential: restore(header.credential) })),
  }))
  return changed ? next : entries
}

export function ScopedSecrets({
  value,
  onChange,
  onError,
  secretValues,
  setSecretValues,
  name,
  formId,
  t,
}) {
  const [entries, setEntries] = useState(() => drafts(value))
  const unsupported = !supportsScopedSecrets(value)
  // The parent clears password inputs before every submission. Restore the previous
  // reference when a generated reference no longer has its unsaved value.
  useEffect(() => {
    const next = restoreClearedScopedDrafts(entries, secretValues)
    if (next !== entries) {
      setEntries(next)
      onError(draftError(next))
      onChange(JSON.stringify(encode(next)))
    }
  }, [entries, secretValues, onChange, onError])
  function update(next) {
    setEntries(next)
    const refs = new Set(
      next.flatMap((entry) => [
        ...Object.values(entry.credentials).map((credential) => credential.ref),
        ...entry.headers.map(({ credential }) => credential.ref),
      ]),
    )
    setSecretValues((values) =>
      Object.assign(
        Object.create(null),
        Object.fromEntries(Object.entries(values).filter(([ref]) => refs.has(ref))),
      ),
    )
    onError(draftError(next))
    onChange(JSON.stringify(encode(next)))
  }
  function changeEntry(index, change) {
    update(entries.map((entry, i) => (i === index ? change(entry) : entry)))
  }
  function changeSlot(index, key, headerIndex, change) {
    changeEntry(index, (entry) => {
      if (headerIndex === undefined)
        return {
          ...entry,
          credentials: { ...entry.credentials, [key]: change(entry.credentials[key]) },
        }
      return {
        ...entry,
        headers: entry.headers.map((header, i) =>
          i === headerIndex ? { ...header, credential: change(header.credential) } : header,
        ),
      }
    })
  }
  function changeSecret(index, key, headerIndex, current, text) {
    if (text && !name) return
    let ref = current.ref
    let previous = current.previous
    if (text && !Object.hasOwn(secretValues, ref)) {
      previous = ref
      ref = credentialReference(name, { id: uid(), field: key, value: text })
    } else if (!text && Object.hasOwn(secretValues, ref)) {
      ref = previous ?? ''
      previous = undefined
    }
    setSecretValues((values) => {
      const next = Object.assign(Object.create(null), values)
      if (text) next[ref] = text
      return next
    })
    changeSlot(index, key, headerIndex, () => ({ ...current, ref, previous }))
  }
  function changeReference(index, key, headerIndex, current, ref) {
    if (Object.hasOwn(secretValues, current.ref)) return
    changeSlot(index, key, headerIndex, () => ({ ...current, ref, previous: undefined }))
  }
  function remove(index) {
    update(entries.filter((_, i) => i !== index))
  }
  function add(type) {
    const data = { type, scope: '', ...(type === 's3' ? { region: '' } : {}) }
    const credentials = Object.fromEntries(credentialKeys[type].map((key) => [key, slot()]))
    update([
      ...entries,
      {
        id: uid(),
        data,
        credentials,
        headers: type === 'http_headers' ? [{ id: uid(), name: '', credential: slot() }] : [],
      },
    ])
  }
  function renderCredential(index, key, credential, headerIndex, required = true) {
    const id = `${formId}-scoped-${credential.id}`
    const hasValue = Object.hasOwn(secretValues, credential.ref)
    const label = t(labels[key])
    return (
      <Field key={id}>
        <FieldLabel htmlFor={id}>
          {label}
          {required ? ' *' : ''}
        </FieldLabel>
        <FieldDescription id={`${id}-help`}>
          {t('marivo.credentials.scoped-value-help')}
        </FieldDescription>
        <Input
          id={id}
          aria-label={label}
          aria-describedby={`${id}-help`}
          type="password"
          autoComplete="new-password"
          maxLength={65536}
          disabled={!name}
          required={required && !credential.ref}
          value={secretValues[credential.ref] ?? ''}
          onChange={(event) =>
            changeSecret(index, key, headerIndex, credential, event.target.value)
          }
        />
        {!name && <p>{t('marivo.credentials.scoped-name-required')}</p>}
        <details className="mc-reference-options">
          <summary>{t('marivo.credentials.scoped-reference-options')}</summary>
          <FieldLabel htmlFor={`${id}-ref`}>{t('marivo.credentials.scoped-reference')}</FieldLabel>
          <Input
            id={`${id}-ref`}
            aria-label={`${label} · ${t('marivo.credentials.scoped-reference')}`}
            autoComplete="off"
            value={credential.ref}
            disabled={hasValue}
            onChange={(event) =>
              changeReference(index, key, headerIndex, credential, event.target.value)
            }
          />
        </details>
      </Field>
    )
  }
  if (unsupported) return <p role="alert">{t('marivo.credentials.scoped-unsupported')}</p>
  return (
    <section
      aria-label={t('marivo.credentials.scoped-credentials')}
      className="mc-inline-credentials"
    >
      <h4>{t('marivo.credentials.scoped-credentials')}</h4>
      {entries.map((entry, index) => (
        <fieldset
          key={entry.id}
          className="mc-credential-group"
          aria-label={`${t(titles[entry.data.type])} ${index + 1}`}
        >
          <legend>{t(titles[entry.data.type])}</legend>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`${formId}-${entry.id}-scope`}>scope *</FieldLabel>
              <FieldDescription>{t('marivo.credentials.scoped-scope-help')}</FieldDescription>
              <Input
                id={`${formId}-${entry.id}-scope`}
                aria-label="scope"
                required
                value={entry.data.scope ?? ''}
                placeholder={entry.data.type === 's3' ? 's3://bucket/' : 'https://example.com/'}
                onChange={(event) =>
                  changeEntry(index, (old) => ({
                    ...old,
                    data: { ...old.data, scope: event.target.value },
                  }))
                }
              />
            </Field>
            {entry.data.type === 's3' && (
              <>
                <Field>
                  <FieldLabel htmlFor={`${formId}-${entry.id}-region`}>region *</FieldLabel>
                  <Input
                    id={`${formId}-${entry.id}-region`}
                    aria-label="region"
                    required
                    value={entry.data.region ?? ''}
                    onChange={(event) =>
                      changeEntry(index, (old) => ({
                        ...old,
                        data: { ...old.data, region: event.target.value },
                      }))
                    }
                  />
                </Field>
                {renderCredential(index, 'key_id', entry.credentials.key_id)}
                {renderCredential(index, 'secret', entry.credentials.secret)}
                {renderCredential(
                  index,
                  'session_token',
                  entry.credentials.session_token,
                  undefined,
                  false,
                )}
                <details className="mc-reference-options">
                  <summary>{t('marivo.credentials.scoped-s3-options')}</summary>
                  <Field>
                    <FieldLabel htmlFor={`${formId}-${entry.id}-endpoint`}>endpoint</FieldLabel>
                    <Input
                      id={`${formId}-${entry.id}-endpoint`}
                      aria-label="endpoint"
                      value={entry.data.endpoint ?? ''}
                      onChange={(event) =>
                        changeEntry(index, (old) => {
                          const data = { ...old.data }
                          if (event.target.value) data.endpoint = event.target.value
                          else delete data.endpoint
                          return { ...old, data }
                        })
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`${formId}-${entry.id}-url-style`}>url_style</FieldLabel>
                    <NativeSelect
                      id={`${formId}-${entry.id}-url-style`}
                      aria-label="url_style"
                      value={entry.data.url_style ?? ''}
                      onChange={(event) =>
                        changeEntry(index, (old) => {
                          const data = { ...old.data }
                          if (event.target.value) data.url_style = event.target.value
                          else delete data.url_style
                          return { ...old, data }
                        })
                      }
                    >
                      <option value="">{t('marivo.credentials.scoped-default')}</option>
                      <option value="vhost">vhost</option>
                      <option value="path">path</option>
                    </NativeSelect>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`${formId}-${entry.id}-ssl`}>use_ssl</FieldLabel>
                    <NativeSelect
                      id={`${formId}-${entry.id}-ssl`}
                      aria-label="use_ssl"
                      value={entry.data.use_ssl == null ? '' : String(entry.data.use_ssl)}
                      onChange={(event) =>
                        changeEntry(index, (old) => {
                          const data = { ...old.data }
                          if (event.target.value) data.use_ssl = event.target.value === 'true'
                          else delete data.use_ssl
                          return { ...old, data }
                        })
                      }
                    >
                      <option value="">{t('marivo.credentials.scoped-default')}</option>
                      <option value="true">{t('marivo.credentials.scoped-enabled')}</option>
                      <option value="false">{t('marivo.credentials.scoped-disabled')}</option>
                    </NativeSelect>
                  </Field>
                </details>
              </>
            )}
            {entry.data.type === 'http_bearer' &&
              renderCredential(index, 'token', entry.credentials.token)}
            {entry.data.type === 'http_headers' && (
              <>
                {entry.headers.map((header, hi) => (
                  <div key={header.id} className="mc-credential-entry">
                    <Field>
                      <FieldLabel htmlFor={`${formId}-${header.id}-name`}>
                        {t('marivo.credentials.scoped-header-name')} *
                      </FieldLabel>
                      <Input
                        id={`${formId}-${header.id}-name`}
                        aria-label={t('marivo.credentials.scoped-header-name')}
                        required
                        value={header.name}
                        onChange={(event) =>
                          changeEntry(index, (old) => ({
                            ...old,
                            headers: old.headers.map((item, i) =>
                              i === hi ? { ...item, name: event.target.value } : item,
                            ),
                          }))
                        }
                      />
                    </Field>
                    {renderCredential(index, 'header', header.credential, hi)}
                    <Button
                      variant="outline"
                      type="button"
                      onClick={() =>
                        changeEntry(index, (old) => ({
                          ...old,
                          headers: old.headers.filter((_, i) => i !== hi),
                        }))
                      }
                    >
                      {t('marivo.credentials.scoped-remove-header')}
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  type="button"
                  onClick={() =>
                    changeEntry(index, (old) => ({
                      ...old,
                      headers: [...old.headers, { id: uid(), name: '', credential: slot() }],
                    }))
                  }
                >
                  {t('marivo.credentials.scoped-add-header')}
                </Button>
              </>
            )}
            <Button variant="outline" type="button" onClick={() => remove(index)}>
              {t('marivo.credentials.scoped-remove')}
            </Button>
          </FieldGroup>
        </fieldset>
      ))}
      <div className="mc-scoped-actions">
        <Button variant="outline" type="button" onClick={() => add('s3')}>
          {t('marivo.credentials.scoped-add-s3')}
        </Button>
        <Button variant="outline" type="button" onClick={() => add('http_bearer')}>
          {t('marivo.credentials.scoped-add-bearer')}
        </Button>
        <Button variant="outline" type="button" onClick={() => add('http_headers')}>
          {t('marivo.credentials.scoped-add-headers')}
        </Button>
      </div>
    </section>
  )
}
