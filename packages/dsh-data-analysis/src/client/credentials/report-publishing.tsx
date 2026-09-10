import { useEffect, useState } from 'react'
import type { PublishingCredentialView, PublishingField } from '../../report-publishing/service.ts'
import { useCopy } from './../i18n/context.tsx'
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
  const t = useCopy()

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
        if (!abort.signal.aborted)
          setMessage(
            'marivo.credentials.cannot-read-report-publishing-credential-status-reopen-the-page',
          )
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
      setMessage(
        remove
          ? 'marivo.credentials.saved-value-deleted-status-refreshed'
          : 'marivo.credentials.saved-the-next-publication-will-use-the-new-credential',
      )
    } catch (error) {
      if (!lifetime.signal.aborted)
        setMessage(
          error instanceof Error && error.message === 'report-publishing-config-changed'
            ? 'marivo.credentials.publishing-configuration-changed-refresh-credential-status-and-enter-values'
            : 'marivo.credentials.credential-operation-unconfirmed-refresh-status-before-retrying-credentials-from',
        )
    } finally {
      if (!lifetime.signal.aborted) setBusy(false)
    }
  }
  if (!view?.enabled) return message ? <p role="status">{t(message)}</p> : null
  return (
    <section
      className="mc-publishing"
      aria-label={t('marivo.credentials.report-publishing-credentials')}
    >
      <h3 className="mc-section-heading">
        {t('marivo.credentials.report-publishing-credentials-228')}
        {view.name}
      </h3>
      <p className="mc-note">
        Bucket：{view.bucket}
        {t('marivo.credentials.credentials-are-shared-by-the-current-harness-across-all')}
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
                  {t('marivo.credentials.field')}
                  {labels[item.field]}
                  {item.required ? t('marivo.credentials.required') : ''}{' '}
                  {t('marivo.credentials.source')}
                  {item.source ?? t('marivo.credentials.none')}
                  {!item.writable && t('marivo.credentials.read-only-source')}
                </p>
              </div>
              <div className="mc-field-actions">
                <span className="mc-badge" data-ready={item.configured}>
                  {item.configured
                    ? t('marivo.credentials.configured')
                    : t('marivo.credentials.not-configured')}
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
                      {editing[item.field]
                        ? t('marivo.credentials.cancel-replacement')
                        : t('marivo.credentials.replace')}
                    </button>
                    <button
                      type="button"
                      className="mc-danger"
                      onClick={() => setDeleting(item.field)}
                    >
                      {t('marivo.credentials.delete-saved-value')}
                    </button>
                  </>
                )}
              </div>
            </div>
            {item.writable && (!item.configured || editing[item.field]) && (
              <label className="mc-secret-input">
                {t('marivo.credentials.new-value')}
                <input
                  id={`report-publishing-${item.field}`}
                  type="password"
                  autoComplete="new-password"
                  maxLength={65536}
                  value={draft[item.field] ?? ''}
                  placeholder={t('marivo.credentials.enter-credential-value-127')}
                  onChange={(event) => setDraft({ ...draft, [item.field]: event.target.value })}
                />
                <button
                  type="button"
                  className="mc-primary"
                  disabled={!draft[item.field]}
                  onClick={() => void change(item.field, false)}
                >
                  {item.configured
                    ? t('marivo.credentials.confirm-replacement')
                    : t('marivo.credentials.add-credential')}
                </button>
              </label>
            )}
            {deleting === item.field && (
              <div className="mc-confirm">
                <p>
                  {t('marivo.credentials.confirm-deletion-of')}
                  {item.reference} {t('marivo.credentials.the-saved-value')}
                </p>
                <button
                  type="button"
                  className="mc-danger"
                  onClick={() => void change(item.field, true)}
                >
                  {t('marivo.credentials.confirm-saved-value-deletion')}
                </button>
                <button type="button" onClick={() => setDeleting(undefined)}>
                  {t('marivo.credentials.keep')}
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
                setMessage('marivo.credentials.status-refreshed')
              }
            })
            .catch(() => {
              if (!lifetime.signal.aborted)
                setMessage('marivo.credentials.refresh-failed-please-retry')
            })
            .finally(() => {
              if (!lifetime.signal.aborted) setBusy(false)
            })
        }}
      >
        {t('marivo.credentials.refresh-credential-status')}
      </button>
      {message && <p role="status">{t(message)}</p>}
    </section>
  )
}
