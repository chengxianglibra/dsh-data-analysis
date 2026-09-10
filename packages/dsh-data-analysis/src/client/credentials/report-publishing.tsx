import { useEffect, useState } from 'react'
import type { PublishingCredentialView, PublishingField } from '../../report-publishing/service.ts'
import type { CredentialClientModel } from './model.ts'

const labels: Record<PublishingField, string> = {
  accessKeyId: 'Access Key ID',
  secretAccessKey: 'Secret Access Key',
  sessionToken: 'Session Token',
}
export function ReportPublishingCredentials({
  model,
  workspaceId,
}: {
  model: CredentialClientModel
  workspaceId: string
}) {
  const [view, setView] = useState<PublishingCredentialView>()
  const [editing, setEditing] = useState<Partial<Record<PublishingField, boolean>>>({})
  const [deleting, setDeleting] = useState<PublishingField>()
  const [draft, setDraft] = useState<Partial<Record<PublishingField, string>>>({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [lifetime] = useState(() => new AbortController())
  useEffect(() => {
    const abort = new AbortController()
    void model
      .publishingCredentials('describe', workspaceId, {}, abort.signal)
      .then((next) => {
        if (!abort.signal.aborted) setView(next)
      })
      .catch(() => {
        if (!abort.signal.aborted) setMessage('无法读取报告发布凭证状态，请重新打开页面重试。')
      })
    return () => abort.abort()
  }, [model, workspaceId])
  useEffect(() => () => lifetime.abort(), [lifetime])
  async function change(field: PublishingField, remove: boolean) {
    setBusy(true)
    setMessage('')
    try {
      const next = await model.publishingCredentials(
        remove ? 'unset' : 'set',
        workspaceId,
        {
          field,
          configId: view?.configId,
          ...(remove ? {} : { value: draft[field] }),
        },
        lifetime.signal,
      )
      if (lifetime.signal.aborted) return
      setView(next)
      setEditing((previous) => ({ ...previous, [field]: false }))
      setDeleting(undefined)
      setDraft((previous) => ({ ...previous, [field]: '' }))
      setMessage(remove ? '已删除保存值，当前状态已刷新。' : '已保存，下次发布使用新凭证。')
    } catch (error) {
      if (!lifetime.signal.aborted)
        setMessage(
          error instanceof Error && error.message === 'report-publishing-config-changed'
            ? '发布配置已变化，请刷新凭证状态后重新填写。'
            : '凭证操作未确认，请刷新状态后重试；启动环境提供的凭证需在启动环境中修改。',
        )
    } finally {
      if (!lifetime.signal.aborted) setBusy(false)
    }
  }
  if (!view?.enabled) return message ? <p role="status">{message}</p> : null
  return (
    <section className="mc-publishing" aria-label="报告发布凭证">
      <h3 className="mc-section-heading">报告发布凭证 · {view.name}</h3>
      <p className="mc-note">
        Bucket：{view.bucket}。凭证由当前 Harness 共享，适用于使用此发布目标的所有 Workspace。
      </p>
      <div className="mc-fields">
        {view.fields.map((item) => (
          <fieldset
            className="mc-field"
            key={item.field}
            disabled={busy}
            aria-label={item.reference}
          >
            <div className="mc-field-header">
              <div className="mc-field-title">
                <h4>{item.reference}</h4>
                <p>
                  字段：{labels[item.field]}
                  {item.required ? '（必填）' : ''} · 来源：{item.source ?? '无'}
                  {!item.writable && ' · 来源只读'}
                </p>
              </div>
              <div className="mc-field-actions">
                <span className="mc-badge" data-ready={item.configured}>
                  {item.configured ? '已配置' : '未配置'}
                </span>
                {item.writable && item.configured && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setEditing({ ...editing, [item.field]: !editing[item.field] })
                        setDraft({ ...draft, [item.field]: '' })
                      }}
                    >
                      {editing[item.field] ? '取消更换' : '更换'}
                    </button>
                    <button
                      type="button"
                      className="mc-danger"
                      onClick={() => setDeleting(item.field)}
                    >
                      删除已保存值
                    </button>
                  </>
                )}
              </div>
            </div>
            {item.writable && (!item.configured || editing[item.field]) && (
              <label className="mc-secret-input">
                新值
                <input
                  id={`report-publishing-${item.field}`}
                  type="password"
                  autoComplete="new-password"
                  maxLength={65536}
                  value={draft[item.field] ?? ''}
                  placeholder="输入凭证值"
                  onChange={(event) => setDraft({ ...draft, [item.field]: event.target.value })}
                />
                <button
                  type="button"
                  className="mc-primary"
                  disabled={!draft[item.field]}
                  onClick={() => void change(item.field, false)}
                >
                  {item.configured ? '确认更换' : '新增凭证'}
                </button>
              </label>
            )}
            {deleting === item.field && (
              <div className="mc-confirm">
                <p>确认删除 {item.reference} 的已保存值？</p>
                <button
                  type="button"
                  className="mc-danger"
                  onClick={() => void change(item.field, true)}
                >
                  确认删除已保存值
                </button>
                <button type="button" onClick={() => setDeleting(undefined)}>
                  保留
                </button>
              </div>
            )}
          </fieldset>
        ))}
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true)
          void model
            .publishingCredentials('describe', workspaceId, {}, lifetime.signal)
            .then((next) => {
              if (!lifetime.signal.aborted) {
                setView(next)
                setDraft({})
                setEditing({})
                setDeleting(undefined)
                setMessage('状态已刷新。')
              }
            })
            .catch(() => {
              if (!lifetime.signal.aborted) setMessage('刷新失败，请重试。')
            })
            .finally(() => {
              if (!lifetime.signal.aborted) setBusy(false)
            })
        }}
      >
        刷新凭证状态
      </button>
      {message && <p role="status">{message}</p>}
    </section>
  )
}
