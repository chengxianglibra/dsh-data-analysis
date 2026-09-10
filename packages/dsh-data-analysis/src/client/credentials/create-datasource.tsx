// @ts-nocheck -- JSX is bundled by the plugin client build.
import { useEffect, useId, useRef, useState } from 'react'
import { credentialReference, prepareCredentials } from './credential-draft.ts'
import { datasourceDescription } from './descriptions.ts'

function credentialLabel(field) {
  return (
    {
      user_env: '用户名',
      password_env: '密码',
      http_bearer_token_env: '访问令牌',
      http_headers_env: 'Header 凭证值',
    }[field] ?? field.replace(/_env$/, '')
  )
}
function credentialRows(schema, backend, values = {}) {
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
      model.authoring(workspaceId, controller.signal),
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
        if (configuration) {
          const fields = value.backends.find((item) => item.name === configuration.backend)?.fields
          if (!fields) throw new Error('当前 Runtime 无法完整编辑该数据源。')
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
        if (!controller.signal.aborted) setError(error.message)
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
        if (value === undefined || value === '') continue
        input[field.name] = field.type === 'string' ? value : JSON.parse(value)
      }
      const prepared = prepareCredentials(input.name ?? '', credentials)
      Object.assign(input, prepared.fields)
      changes = prepared.changes
    } catch (error) {
      setError(
        error instanceof SyntaxError ? '请检查数字、布尔值或 JSON 字段的格式。' : error.message,
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
      if (active.current) setError(`${error.message} 本次凭证输入已清空，请重新填写后提交。`)
    } finally {
      for (const ref of Object.keys(changes)) delete changes[ref]
      if (active.current) setBusy(false)
    }
  }
  return (
    <form className="mc-form" aria-label={name ? '编辑数据源' : '新增数据源'} onSubmit={submit}>
      <div className="mc-form-body">
        <div className="mc-detail-heading">
          <h3>{name ? '编辑数据源' : '新增数据源'}</h3>
        </div>
        {error && (
          <p role="alert" className="mc-result" data-tone="error">
            {error}
          </p>
        )}
        {!schema && !error && <p role="status">正在读取数据源配置字段…</p>}
        {schema && (
          <fieldset className="mc-field" disabled={busy}>
            <label className="mc-secret-input">
              引擎
              <select
                aria-label="引擎"
                disabled={!!name}
                value={backend}
                onChange={(event) => {
                  setBackend(event.target.value)
                  setValues({})
                  setCredentials(credentialRows(schema, event.target.value))
                  setError('')
                }}
              >
                {schema.backends.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            {fields
              .filter((field) => !field.name.endsWith('_env'))
              .map((field) => (
                <label
                  className="mc-secret-input"
                  key={field.name}
                  htmlFor={`${formId}-${field.name}`}
                >
                  <span className="mc-input-heading">
                    <span className="mc-input-name">
                      {field.name}
                      {field.required ? ' *' : ''}
                    </span>
                    {field.description && (
                      <span className="mc-input-description">
                        {datasourceDescription(field.description)}
                      </span>
                    )}
                  </span>
                  {field.type === 'boolean' ? (
                    <select
                      id={`${formId}-${field.name}`}
                      aria-label={field.name}
                      value={values[field.name] ?? ''}
                      onChange={(event) =>
                        setValues({ ...values, [field.name]: event.target.value })
                      }
                    >
                      <option value="">
                        默认{field.default == null ? '' : ` (${field.default})`}
                      </option>
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  ) : (
                    <input
                      id={`${formId}-${field.name}`}
                      aria-label={field.name}
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
                </label>
              ))}
            {credentialFields.length > 0 && (
              <section className="mc-inline-credentials" aria-label="连接凭证">
                <h4>连接凭证</h4>
                <p className="mc-note">
                  直接填写凭证值，由 Harness 保存。引用名自动生成，可展开确认或修改。
                  {name ? '留空沿用；填写新值默认使用新的引用。' : ''}
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
                              <label className="mc-secret-input">
                                Header 名称
                                <input
                                  aria-label="Header 名称"
                                  value={row.key}
                                  onChange={(event) =>
                                    updateCredential(row.id, { key: event.target.value })
                                  }
                                />
                              </label>
                            )}
                            <label className="mc-secret-input">
                              <span className="mc-input-heading">
                                <span className="mc-input-name">
                                  {label}
                                  {field.required ? ' *' : ''}
                                </span>
                                <span className="mc-input-description">
                                  {row.existing
                                    ? '已设置引用，留空沿用。'
                                    : '可直接填写，无需先创建凭证。'}
                                </span>
                              </span>
                              <input
                                aria-label={label}
                                type="password"
                                autoComplete="new-password"
                                maxLength={65536}
                                required={field.required && !reference}
                                value={row.value}
                                placeholder={
                                  row.existing ? '留空沿用，填写新值以替换' : '填写凭证值'
                                }
                                onChange={(event) =>
                                  updateCredential(row.id, { value: event.target.value })
                                }
                              />
                            </label>
                            <details className="mc-reference-options">
                              <summary>凭证引用名 · 确认或修改</summary>
                              <label className="mc-secret-input">
                                {field.name}
                                <input
                                  aria-label={field.name}
                                  autoComplete="off"
                                  value={reference}
                                  placeholder="填写凭证值后自动生成"
                                  onChange={(event) =>
                                    updateCredential(row.id, { reference: event.target.value })
                                  }
                                />
                              </label>
                              <p className="mc-note">
                                可填写已有引用并将凭证值留空，以复用已保存的凭证。已有凭证的值不会被自动覆盖。
                              </p>
                              {row.reference !== undefined && (
                                <button
                                  type="button"
                                  onClick={() => updateCredential(row.id, { reference: undefined })}
                                >
                                  恢复自动引用名
                                </button>
                              )}
                            </details>
                            {row.key !== undefined && (
                              <button
                                type="button"
                                className="mc-quiet"
                                onClick={() =>
                                  setCredentials((rows) =>
                                    rows.filter((item) => item.id !== row.id),
                                  )
                                }
                              >
                                移除 Header
                              </button>
                            )}
                          </div>
                        )
                      })}
                    {field.type === 'json' && (
                      <button
                        type="button"
                        onClick={() =>
                          setCredentials((rows) => [
                            ...rows,
                            { id: crypto.randomUUID(), field: field.name, key: '', value: '' },
                          ])
                        }
                      >
                        添加 Header 凭证
                      </button>
                    )}
                  </div>
                ))}
              </section>
            )}
          </fieldset>
        )}
      </div>
      <p className="mc-note">
        {requestId
          ? '保存配置和凭证后测试连接，成功后助手继续分析。测试失败可修正重试，已保存的内容不会回滚。'
          : name
            ? '保存后需要重新测试连接。名称和引擎保持不变。'
            : ''}
      </p>
      <div className="mc-form-footer">
        <button className="mc-primary" type="submit" disabled={!backend || busy}>
          {busy
            ? '正在保存或验证…'
            : requestId
              ? '保存并测试，成功后继续'
              : name
                ? '保存配置'
                : '确认新增数据源'}
        </button>
        <button type="button" onClick={close} disabled={busy}>
          取消
        </button>
      </div>
    </form>
  )
}
