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
  const [open, setOpen] = useState(false)
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
    <section className="mc-properties" aria-label="报告发布凭证">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open)
          setDraft({})
        }}
      >
        报告发布凭证 · {view.name}
      </button>
      {open && (
        <div>
          <p>
            Bucket：{view.bucket}。凭证由当前 Harness 共享，适用于使用此发布目标的所有 Workspace。
          </p>
          {view.fields.map((item) => (
            <div className="mc-field" key={item.field}>
              <label htmlFor={`report-publishing-${item.field}`}>
                {labels[item.field]}
                {item.required ? '（必填）' : ''}
              </label>
              <p>
                {item.reference} · {item.configured ? '已配置' : '未配置'}
                {item.source ? ` · ${item.source}` : ''}
                {!item.writable ? ' · 只读' : ''}
              </p>
              <div className="mc-secret-input">
                <input
                  id={`report-publishing-${item.field}`}
                  type="password"
                  autoComplete="new-password"
                  maxLength={65536}
                  value={draft[item.field] ?? ''}
                  disabled={busy || !item.writable}
                  placeholder={item.configured ? '输入新值以替换，原值不回显' : '输入凭证值'}
                  onChange={(event) => setDraft({ ...draft, [item.field]: event.target.value })}
                />
                <button
                  type="button"
                  disabled={busy || !item.writable || !draft[item.field]}
                  onClick={() => void change(item.field, false)}
                >
                  保存 {labels[item.field]}
                </button>
                <button
                  type="button"
                  disabled={busy || !item.writable || !item.configured}
                  onClick={() => void change(item.field, true)}
                >
                  删除 {labels[item.field]}
                </button>
              </div>
            </div>
          ))}
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
        </div>
      )}
    </section>
  )
}
