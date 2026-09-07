// @ts-nocheck -- JSX is bundled by the plugin client build.
import { useEffect, useState } from 'react'

export function CreateDatasource({ model, workspaceId, close }) {
  const [schema, setSchema] = useState(null)
  const [backend, setBackend] = useState('')
  const [values, setValues] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    model
      .authoring(workspaceId, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return
        setSchema(value)
        setBackend(value.backends[0]?.name ?? '')
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message)
      })
    return () => controller.abort()
  }, [model, workspaceId])
  const fields = schema?.backends.find((item) => item.name === backend)?.fields ?? []
  async function submit(event) {
    event.preventDefault()
    if (busy) return
    setError('')
    const input = {}
    try {
      for (const field of fields) {
        const value = values[field.name]
        if (value === undefined || value === '') continue
        input[field.name] = field.type === 'string' ? value : JSON.parse(value)
      }
    } catch {
      setError('请检查数字、布尔值或 JSON 字段的格式。')
      return
    }
    setBusy(true)
    try {
      await model.createDatasource(workspaceId, schema, { backend, fields: input })
      close()
    } catch (error) {
      setError(error.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="mc-form" aria-label="新增数据源" onSubmit={submit}>
      <div className="mc-form-body">
        <div className="mc-detail-heading">
          <h3>新增数据源</h3>
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
                value={backend}
                onChange={(event) => {
                  setBackend(event.target.value)
                  setValues({})
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
            {fields.map((field) => (
              <label
                className="mc-secret-input"
                key={field.name}
                htmlFor={`mc-create-${field.name}`}
              >
                {field.name}
                {field.required ? ' *' : ''}
                {field.type === 'boolean' ? (
                  <select
                    id={`mc-create-${field.name}`}
                    aria-label={field.name}
                    value={values[field.name] ?? ''}
                    onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
                  >
                    <option value="">
                      默认{field.default == null ? '' : ` (${field.default})`}
                    </option>
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                ) : (
                  <input
                    id={`mc-create-${field.name}`}
                    aria-label={field.name}
                    required={field.required}
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
                    onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
                  />
                )}
                {field.description && <span className="mc-field-note">{field.description}</span>}
                {field.name.endsWith('_env') && (
                  <span className="mc-field-note">
                    填写凭证引用名称；创建后可在数据源卡片中新增对应凭证值。
                  </span>
                )}
              </label>
            ))}
          </fieldset>
        )}
      </div>
      <div className="mc-form-footer">
        <button className="mc-primary" type="submit" disabled={!backend || busy}>
          {busy ? '正在新增…' : '确认新增数据源'}
        </button>
        <button type="button" onClick={close} disabled={busy}>
          取消
        </button>
      </div>
    </form>
  )
}
