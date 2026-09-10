// @ts-nocheck -- JSX and slot faces are supplied by the DSH client runtime module table.

import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useCopy } from './../i18n/context.tsx'
import { localized } from '../i18n/host.tsx'
import { CreateDatasource } from './create-datasource.tsx'
import { CredentialClientModel, credentialMessage } from './model.ts'
import { ReportPublishingCredentials } from './report-publishing.tsx'
import { credentialStyles } from './styles.ts'

const statusLabels = {
  'awaiting-input': 'marivo.credentials.awaiting-input',
  executing: 'marivo.credentials.saving-or-validating-77',
  'awaiting-decision': 'marivo.credentials.connection-validation-failed-action-needed',
  succeeded: 'marivo.credentials.validated-original-call-continues',
  'handed-off': 'marivo.credentials.handed-to-the-assistant-for-investigation',
  'call-ended': 'marivo.credentials.original-call-ended',
  cancelled: 'marivo.credentials.configuration-request-cancelled',
  'context-changed': 'marivo.credentials.context-changed',
}
export function CredentialIcon({ name, size = 18 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === 'database' && (
        <>
          <ellipse cx="12" cy="5" rx="8" ry="3" />
          <path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0" />
        </>
      )}
      {name === 'refresh' && (
        <path d="M20 7v5h-5M4 17v-5h5M6.1 6a8 8 0 0 1 13.4 3M4.5 15a8 8 0 0 0 13.4 3" />
      )}
      {name === 'add' && <path d="M12 5v14M5 12h14" />}
      {name === 'edit' && <path d="m16 3 5 5L9 20l-6 1 1-6L16 3ZM13 6l5 5" />}
      {name === 'delete' && <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" />}
      {name === 'test' && (
        <path d="M9 3h6M10 3v6l-6 10a1.3 1.3 0 0 0 1 2h14a1.3 1.3 0 0 0 1-2L14 9V3M7 15h10" />
      )}
      {name === 'check' && <path d="m5 12 4 4L19 6" />}
      {name === 'info' && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v6m0-10v.01" />
        </>
      )}
    </svg>
  )
}
export function TestResult({ result, stale = false }) {
  const t = useCopy()

  if (!result) return null
  return (
    <div
      className="mc-result"
      data-tone={t(stale ? 'stale' : result.ok ? 'success' : 'error')}
      role="status"
    >
      <div className="mc-result-title">
        <CredentialIcon name={stale || !result.ok ? 'info' : 'check'} size={16} />
        {stale
          ? t('marivo.credentials.configuration-changed-test-again')
          : result.ok
            ? t('marivo.credentials.connection-test-succeeded')
            : t('marivo.credentials.connection-test-failed')}
      </div>
      {!result.ok && !stale && (
        <>
          <p>{t(result.failure?.message)}</p>
          {result.repair?.action && <p>{result.repair.action}</p>}
          {result.failure?.code && (
            <details>
              <summary>{t('marivo.credentials.show-error-code')}</summary>
              <pre>{result.failure.code}</pre>
            </details>
          )}
        </>
      )}
    </div>
  )
}
function OperationOutcome({ entry }) {
  const t = useCopy()

  if (!entry) return null
  const operation = entry.operation
  const errors = operation?.errors ?? []
  if (operation?.action === 'delete-datasource')
    return (
      <div
        className="mc-operation-note"
        data-error={operation.status !== 'succeeded'}
        role="status"
      >
        <p>
          {operation.datasourceRemoved
            ? t('marivo.credentials.datasource-value-was-deleted', { p0: entry.name })
            : t('marivo.credentials.deletion-of-datasource-value-is-unconfirmed-refresh-the-list', {
                p0: entry.name,
              })}
        </p>
        {operation.datasourceRemoved && !operation.deleteCredentials && (
          <p>{t('marivo.credentials.associated-saved-credentials-were-retained')}</p>
        )}
        {operation.deletedCredentials?.length > 0 && (
          <p>
            {t('marivo.credentials.deleted-credentials')}
            {operation.deletedCredentials.join('、')}。
          </p>
        )}
        {operation.credentialDeleteFailures?.length > 0 && (
          <p>
            {t('marivo.credentials.credentials-that-could-not-be-deleted')}
            {operation.credentialDeleteFailures.join('、')}。
          </p>
        )}
        {operation.status === 'cancelled' && (
          <p>
            {t(
              'marivo.credentials.operation-cancelled-completed-deletions-remain-other-credentials-may-still',
            )}
          </p>
        )}
        {errors.length > 0 && <p>{errors.map(credentialMessage).join(' ')}</p>}
      </div>
    )
  const unsuccessful =
    entry.error ||
    operation?.status === 'cancelled' ||
    operation?.status === 'failed' ||
    operation?.result?.ok === false
  if (!unsuccessful && operation?.action !== 'delete') return null
  return (
    <div
      className="mc-operation-note"
      data-error={t(Boolean(entry.error || errors.length))}
      role="status"
    >
      {entry.error && <p>{t(entry.error)}</p>}
      {operation?.status === 'cancelled' && (
        <p>{t('marivo.credentials.this-operation-was-cancelled')}</p>
      )}
      {operation?.status === 'succeeded' && operation.action === 'delete' && (
        <p>{t('marivo.credentials.saved-value-deleted-configuration-status-updated')}</p>
      )}
      {errors.length > 0 && <p>{errors.map(credentialMessage).join(' ')}</p>}
      {operation?.status === 'failed' && errors.length === 0 && !operation.result && (
        <p>{t('marivo.credentials.operation-incomplete-please-retry')}</p>
      )}
      {unsuccessful && operation?.saved.length > 0 && (
        <p>
          {t('marivo.credentials.saved')}
          {operation.saved.join('、')}。
        </p>
      )}
    </div>
  )
}
export function DatasourceProperties({ context }) {
  const t = useCopy()

  const properties = Object.entries(context.properties ?? {})
  return (
    <section className="mc-properties" aria-label={t('marivo.credentials.datasource-properties')}>
      <h4 className="mc-section-heading">{t('marivo.credentials.datasource-properties')}</h4>
      <dl className="mc-property-list">
        <div className="mc-property">
          <dt>{t('marivo.credentials.engine')}</dt>
          <dd>{context.backend || t('marivo.credentials.not-provided')}</dd>
        </div>
        {properties.map(([field, value]) => (
          <div className="mc-property" key={field}>
            <dt>{field}</dt>
            <dd>
              {value !== null && typeof value === 'object' ? (
                <section
                  className="mc-property-json"
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll long JSON values.
                  tabIndex={0}
                  aria-label={t('marivo.credentials.value-configuration-value', { p0: field })}
                >
                  <pre>{JSON.stringify(value, null, 2)}</pre>
                </section>
              ) : (
                <span>
                  {typeof value === 'string' && value !== '' ? value : JSON.stringify(value)}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
function CredentialForm({ context, request, state, model, workspaceId, onEdit }) {
  const t = useCopy()

  const [values, setValues] = useState({})
  const [editing, setEditing] = useState({})
  const [deleting, setDeleting] = useState('')
  const [removingDatasource, setRemovingDatasource] = useState(false)
  const [removeCredentials, setRemoveCredentials] = useState(false)
  const busy =
    request?.status === 'executing' ||
    state.operations.some((entry) => entry.handle.scope === context.token)
  const ended = request?.endedAt !== undefined
  const configured = context.refs.filter((ref) => context.credentials[ref]?.configured).length
  const ready = configured === context.refs.length
  const outcome = state.outcomes[context.token]
  const latestTest =
    !outcome?.overviewUpdated && outcome?.operation?.result
      ? { result: outcome.operation.result, at: outcome.operation.endedAt, stale: false }
      : context.lastTest
  const latestResult = request?.failure ?? latestTest?.result
  // biome-ignore lint/correctness/useExhaustiveDependencies: Identity or credential revision changes must discard unsubmitted secrets.
  useEffect(() => {
    setValues({})
    setEditing({})
    setDeleting('')
    setRemovingDatasource(false)
    setRemoveCredentials(false)
  }, [context.token, context.version])
  const saveReference = (ref) => {
    const changes = { [ref]: values[ref] }
    setValues({ ...values, [ref]: '' })
    setEditing({ ...editing, [ref]: false })
    void model.start(context, 'save', changes)
  }
  const submit = () => {
    const changes = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ''))
    setValues({})
    setEditing({})
    void model.start(context, request ? 'submit' : 'update', changes)
  }
  return (
    <section
      className="mc-form"
      aria-label={t('marivo.credentials.value-credential-configuration', { p0: context.name })}
    >
      <div className="mc-form-body">
        <div className="mc-detail-heading mc-datasource-heading">
          <p className="mc-eyebrow">{t('marivo.credentials.datasource-configuration')}</p>
          <div className="mc-name-row">
            <h3>{context.name}</h3>
            <div className="mc-heading-actions">
              <span className="mc-badge" data-ready={ready}>
                {ready && <CredentialIcon name="check" size={13} />}
                {context.refs.length === 0
                  ? t('marivo.credentials.no-credentials-required')
                  : ready
                    ? t('marivo.credentials.all-credentials-configured')
                    : t('marivo.credentials.value-value-configured', {
                        p0: configured,
                        p1: context.refs.length,
                      })}
              </span>
              {!ended && (
                <button
                  className="mc-icon-button"
                  type="button"
                  title={t('marivo.credentials.edit-configuration')}
                  aria-label={t('marivo.credentials.edit-configuration')}
                  disabled={busy}
                  onClick={onEdit}
                >
                  <CredentialIcon name="edit" />
                </button>
              )}
              {!request && (
                <button
                  className="mc-icon-button mc-danger"
                  type="button"
                  title={t('marivo.credentials.delete-datasource')}
                  aria-label={t('marivo.credentials.delete-datasource')}
                  disabled={busy || state.loading}
                  onClick={() => setRemovingDatasource(true)}
                >
                  <CredentialIcon name="delete" />
                </button>
              )}
            </div>
          </div>
        </div>
        {removingDatasource && (
          <fieldset
            className="mc-confirm"
            aria-label={t('marivo.credentials.confirm-datasource-deletion')}
          >
            <p>
              {t('marivo.credentials.confirm-datasource-deletion')}
              {context.name}
              {t(
                'marivo.credentials.this-removes-the-datasource-definition-from-this-workspace-not',
              )}
            </p>
            {context.refs.length > 0 && (
              <>
                <label>
                  <input
                    type="checkbox"
                    checked={removeCredentials}
                    disabled={busy}
                    onChange={(event) => setRemoveCredentials(event.target.checked)}
                  />{' '}
                  {t('marivo.credentials.also-delete-associated-saved-credentials')}
                </label>
                <p>
                  {t('marivo.credentials.credential-references')}
                  {context.refs.join('、')}
                  {t(
                    'marivo.credentials.other-datasources-or-workspaces-may-share-these-credentials-and',
                  )}
                </p>
              </>
            )}
            <button
              className="mc-danger"
              type="button"
              disabled={busy || state.loading}
              onClick={() => {
                setRemovingDatasource(false)
                void model.start(context, 'delete-datasource', {}, undefined, removeCredentials)
              }}
            >
              {t('marivo.credentials.confirm-datasource-deletion')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setRemovingDatasource(false)
                setRemoveCredentials(false)
              }}
            >
              {t('marivo.credentials.cancel')}
            </button>
          </fieldset>
        )}
        {request && (
          <div className="mc-request-status" role="status">
            <strong>{t(statusLabels[request.status])}</strong>
            {!ended && (
              <p>{t('marivo.credentials.continue-the-current-task-after-successful-validation')}</p>
            )}
            {(request.status === 'call-ended' || request.status === 'context-changed') && (
              <p>{t('marivo.credentials.start-the-task-again')}</p>
            )}
          </div>
        )}
        <DatasourceProperties context={context} />
        <h4 className="mc-section-heading">{t('marivo.credentials.credentials')}</h4>
        {context.refs.length === 0 && (
          <p className="mc-note">
            {t('marivo.credentials.this-datasource-has-no-credential-references-you-can-test')}
          </p>
        )}
        {context.refs.length > 0 && (
          <div className="mc-fields">
            {context.refs.map((ref) => {
              const info = context.credentials[ref]
              const shared = state.datasources
                .filter((item) => item.refs.includes(ref))
                .map((item) => item.name)
              return (
                <fieldset className="mc-field" key={ref} disabled={busy || ended} aria-label={ref}>
                  <div className="mc-field-header">
                    <div className="mc-field-title">
                      <h4>{ref}</h4>
                      <p>
                        {t('marivo.credentials.field')}
                        {Object.entries(context.fields)
                          .filter(([, value]) => value === ref)
                          .map(([field]) => field)
                          .join('、')}{' '}
                        {t('marivo.credentials.source')}
                        {info?.source ?? t('marivo.credentials.none')}
                        {!info?.writable && t('marivo.credentials.read-only-source')}
                      </p>
                    </div>
                    <div className="mc-field-actions">
                      <span className="mc-badge" data-ready={Boolean(info?.configured)}>
                        {info?.configured
                          ? t('marivo.credentials.configured')
                          : t('marivo.credentials.not-configured')}
                      </span>
                      {info?.writable && info.configured && !editing[ref] && (
                        <button
                          type="button"
                          onClick={() => setEditing({ ...editing, [ref]: true })}
                        >
                          {t('marivo.credentials.replace')}
                        </button>
                      )}
                      {info?.writable && info.configured && editing[ref] && (
                        <button
                          type="button"
                          onClick={() => {
                            setValues({ ...values, [ref]: '' })
                            setEditing({ ...editing, [ref]: false })
                          }}
                        >
                          {t('marivo.credentials.cancel-replacement')}
                        </button>
                      )}
                      {info?.writable && !request && info.configured && (
                        <button
                          className="mc-danger"
                          type="button"
                          onClick={() => setDeleting(ref)}
                        >
                          {t('marivo.credentials.delete-saved-value')}
                        </button>
                      )}
                    </div>
                  </div>
                  {info?.writable && (!info.configured || editing[ref]) && (
                    <label className="mc-secret-input">
                      {t('marivo.credentials.new-value')}
                      <input
                        type="password"
                        autoComplete="new-password"
                        placeholder={t('marivo.credentials.enter-credential-value-127')}
                        value={values[ref] ?? ''}
                        onChange={(event) => setValues({ ...values, [ref]: event.target.value })}
                      />
                      {!request && (
                        <button
                          type="button"
                          className="mc-primary"
                          disabled={!values[ref]}
                          onClick={() => saveReference(ref)}
                        >
                          {info.configured
                            ? t('marivo.credentials.confirm-replacement')
                            : t('marivo.credentials.add-credential')}
                        </button>
                      )}
                    </label>
                  )}
                  {shared.length > 1 && (
                    <p className="mc-field-note">
                      {t('marivo.credentials.and')}
                      {shared.filter((name) => name !== context.name).join('、')}{' '}
                      {t('marivo.credentials.share-this-reference')}
                    </p>
                  )}
                  {deleting === ref && (
                    <div className="mc-confirm">
                      <p>
                        {t('marivo.credentials.confirm-deletion-of')}
                        {ref} {t('marivo.credentials.the-saved-value')}
                      </p>
                      <button
                        className="mc-danger"
                        type="button"
                        onClick={() => {
                          setDeleting('')
                          void model.start(context, 'delete', {}, ref)
                        }}
                      >
                        {t('marivo.credentials.confirm-saved-value-deletion')}
                      </button>
                      <button type="button" onClick={() => setDeleting('')}>
                        {t('marivo.credentials.keep')}
                      </button>
                    </div>
                  )}
                </fieldset>
              )
            })}
          </div>
        )}
        <div className="mc-test">
          <div className="mc-test-heading">
            <h4>{t('marivo.credentials.connection-status')}</h4>
            <div className="mc-heading-actions">
              {latestTest?.at !== undefined && (
                <time dateTime={new Date(latestTest.at).toISOString()}>
                  {t('marivo.credentials.last-test')}
                  {new Date(latestTest.at).toLocaleString()}
                </time>
              )}
              {!request && (
                <button
                  className="mc-icon-button"
                  type="button"
                  title={t('marivo.credentials.test-connection')}
                  aria-label={t('marivo.credentials.test-connection')}
                  disabled={busy}
                  onClick={() => void model.start(context, 'test')}
                >
                  <CredentialIcon name="test" />
                </button>
              )}
            </div>
          </div>
          {latestResult ? (
            <TestResult result={latestResult} stale={!request?.failure && latestTest?.stale} />
          ) : (
            <p className="mc-empty-test">
              {t('marivo.credentials.connection-has-not-been-tested')}
            </p>
          )}
          {outcome?.operation?.action !== 'delete-datasource' && (
            <OperationOutcome entry={outcome} />
          )}
        </div>
      </div>
      {!ended && (request || busy) && (
        <div className="mc-form-footer">
          {request && (
            <button className="mc-primary" type="button" disabled={busy} onClick={submit}>
              {t('marivo.credentials.submit-credentials-and-continue')}
            </button>
          )}
          {request && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void model.start(context, 'submit')}
            >
              {t('marivo.credentials.validate-existing-configuration-and-continue')}
            </button>
          )}
          {request?.failure && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void model.start(context, 'diagnose')}
            >
              {t('marivo.credentials.ask-the-assistant-to-investigate')}
            </button>
          )}
          {request ? (
            <button
              className="mc-quiet mc-cancel"
              type="button"
              onClick={() => void model.cancelRequest(request.id)}
            >
              {t('marivo.credentials.cancel-this-round')}
            </button>
          ) : (
            busy && (
              <button
                className="mc-quiet mc-cancel"
                type="button"
                onClick={() => void model.cancelOperation(context.token)}
              >
                {t('marivo.credentials.cancel-operation')}
              </button>
            )
          )}
        </div>
      )}
      {ended && (
        <div className="mc-form-footer">
          <button type="button" onClick={() => model.show(workspaceId)}>
            {t('marivo.credentials.back-to-datasource-management')}
          </button>
        </div>
      )}
    </section>
  )
}
export function CredentialPanel({ model, workspaces, onRefresh }) {
  const t = useCopy()

  const state = useSyncExternalStore(model.subscribe, model.getSnapshot)
  const columns = useRef(null)
  const navigation = useRef(null)
  const main = useRef(null)
  const [creating, setCreating] = useState(false)
  const [editingName, setEditingName] = useState('')
  const [requestError, setRequestError] = useState('')
  const [requestChoice, setRequestChoice] = useState('create')
  // biome-ignore lint/correctness/useExhaustiveDependencies: Switching context discards the creation form.
  useEffect(() => {
    setCreating(false)
    setEditingName('')
    setRequestError('')
    setRequestChoice('create')
  }, [state.open, state.workspaceId, state.requestId])
  const request = state.requests.find((item) => item.id === state.requestId)
  // biome-ignore lint/correctness/useExhaustiveDependencies: Open the initial form once per request occurrence; live watch updates must preserve user navigation.
  useEffect(() => {
    if (!request?.configuration || request.context || request.endedAt !== undefined) return
    setCreating(true)
    setEditingName(request.configuration.mode === 'edit' ? request.configuration.name : '')
  }, [request?.id, state.open])
  useEffect(() => {
    if (request?.endedAt === undefined) return
    setCreating(false)
    setEditingName('')
  }, [request?.endedAt])
  const pending = state.requests.filter(
    (item) => item.endedAt === undefined && item.sessionId === state.sessionId,
  )
  const context = request
    ? request.context
    : state.datasources.find((item) => item.token === state.selected)
  // biome-ignore lint/correctness/useExhaustiveDependencies: A different detail or creation page starts at the top of its content.
  useEffect(() => {
    if (main.current) {
      main.current.scrollTop = 0
      const page = main.current.closest('.rt-page')
      if (page) page.scrollTop = 0
    }
    if (columns.current) columns.current.scrollTop = 0
    const list = navigation.current
    const selected = list?.querySelector('[aria-pressed="true"]')
    if (selected) {
      const bounds = selected.getBoundingClientRect()
      const viewport = list.getBoundingClientRect()
      if (bounds.left < viewport.left) list.scrollLeft += bounds.left - viewport.left
      else if (bounds.right > viewport.right) list.scrollLeft += bounds.right - viewport.right
    }
  }, [creating, context?.token])
  const workspaceId = request
    ? (workspaces.find((item) => item.sessionIds.includes(request.sessionId))?.workspaceId ?? '')
    : state.workspaceId
  const datasources = request ? (request.context ? [request.context] : []) : state.datasources
  const operations = state.operations.filter((entry) => entry.workspaceId === workspaceId)
  const activeOperation = operations.find(
    (entry) => entry.handle.id === state.handle?.id,
  )?.operation
  if (!state.open) return null
  return (
    <section className="mc-panel" aria-label={t('marivo.credentials.datasources-and-credentials')}>
      <style>{credentialStyles}</style>
      <div className="rt-heading-row">
        <h2 className="rt-heading">{t('marivo.credentials.datasources-and-credentials')}</h2>
        <div className="mc-heading-actions">
          {!request && (
            <button
              className="mc-icon-button"
              type="button"
              title={t('marivo.credentials.add-datasource')}
              aria-label={t('marivo.credentials.add-datasource')}
              disabled={!workspaceId || state.loading}
              onClick={() => {
                setEditingName('')
                setCreating(true)
              }}
            >
              <CredentialIcon name="add" />
            </button>
          )}
          <button
            className="mc-icon-button"
            type="button"
            title={t('marivo.credentials.refresh-datasources')}
            aria-label={t('marivo.credentials.refresh-datasources')}
            disabled={state.loading}
            onClick={onRefresh ?? (() => void model.refreshDatasources())}
          >
            <CredentialIcon name="refresh" />
          </button>
        </div>
      </div>
      <p className="rt-caption">
        {workspaces.find((item) => item.workspaceId === workspaceId)?.title ?? workspaceId}
      </p>
      <div className="mc-shell">
        {(pending.length > 0 || request) && (
          <div className="mc-requests">
            <span>
              {pending.length
                ? t('marivo.credentials.requests-in-this-session')
                : t('marivo.credentials.configuration-result')}
            </span>
            {pending.map((item) => (
              <button type="button" key={item.id} onClick={() => model.openRequest(item.id)}>
                {item.context?.name ??
                  item.configuration?.name ??
                  t('marivo.credentials.add-datasource')}{' '}
                · {t(statusLabels[item.status])}
              </button>
            ))}
            {request && (
              <button className="mc-quiet" type="button" onClick={() => model.show(workspaceId)}>
                {t('marivo.credentials.datasource-management')}
              </button>
            )}
          </div>
        )}
        <div className="mc-columns" ref={columns}>
          {!request && (
            <aside className="mc-nav" aria-label={t('marivo.credentials.datasource-navigation')}>
              <div>
                <div className="mc-nav-heading">
                  <h3>
                    {request
                      ? t('marivo.credentials.requested-datasource')
                      : t('marivo.credentials.datasource-value', { p0: datasources.length })}
                  </h3>
                </div>
                <ul className="mc-datasources" ref={navigation}>
                  {datasources.map((item) => {
                    const count = item.refs.filter(
                      (ref) => item.credentials[ref]?.configured,
                    ).length
                    const ready = count === item.refs.length
                    const running = state.operations.some(
                      (entry) => entry.handle.scope === item.token,
                    )
                    return (
                      <li key={item.token}>
                        <button
                          className="mc-datasource"
                          type="button"
                          aria-label={t('marivo.credentials.select-datasource-value', {
                            p0: item.name,
                          })}
                          aria-pressed={!creating && context?.token === item.token}
                          onClick={() => {
                            if (request) model.openRequest(request.id)
                            else {
                              setCreating(false)
                              model.select(item.token)
                            }
                          }}
                        >
                          <CredentialIcon name="database" />
                          <span className="mc-datasource-copy">
                            <span className="mc-datasource-name">{item.name}</span>
                            <span className="mc-datasource-status">
                              <span className="mc-dot" data-ready={ready} />
                              {running
                                ? t('marivo.credentials.processing')
                                : item.refs.length === 0
                                  ? t('marivo.credentials.no-credentials-required')
                                  : ready
                                    ? t('marivo.credentials.all-credentials-configured')
                                    : t('marivo.credentials.value-value-configured', {
                                        p0: count,
                                        p1: item.refs.length,
                                      })}
                            </span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            </aside>
          )}
          <main className="mc-main" ref={main}>
            {Object.values(state.outcomes)
              .filter(
                (entry) =>
                  entry.workspaceId === workspaceId &&
                  entry.operation?.action === 'delete-datasource',
              )
              .map((entry) => (
                <div className="mc-request-status" key={entry.handle.id}>
                  <OperationOutcome entry={entry} />
                  <button type="button" onClick={() => model.dismissOutcome(entry.handle.scope)}>
                    {t('marivo.credentials.dismiss-deletion-result')}
                  </button>
                </div>
              ))}
            {state.error && (
              <p role="alert" className="mc-alert">
                {t(state.error)}
              </p>
            )}
            {state.loading && (
              <p className="mc-loading" role="status">
                {t('marivo.credentials.loading-datasources-and-credential-status')}
              </p>
            )}
            {!request && !creating && !state.loading && !context && !state.error && (
              <div className="mc-empty">
                <CredentialIcon name="database" size={32} />
                <h3>
                  {!state.workspaceId
                    ? t('marivo.credentials.this-session-is-not-bound-to-a-workspace')
                    : state.datasources.length === 0
                      ? t('marivo.credentials.no-datasources')
                      : t('marivo.credentials.select-a-datasource')}
                </h3>
                <p>
                  {!state.workspaceId
                    ? t('marivo.credentials.return-to-the-session-and-retry')
                    : state.datasources.length === 0
                      ? t('marivo.credentials.this-workspace-has-no-defined-datasources')
                      : t(
                          'marivo.credentials.view-credential-configuration-and-the-latest-connection-test',
                        )}
                </p>
              </div>
            )}
            {request?.configuration && (
              <section
                className="mc-request-status"
                aria-label={t('marivo.credentials.configuration-request')}
              >
                <div className="mc-request-heading">
                  <h3>{t('marivo.credentials.configure-a-datasource-to-continue')}</h3>
                  <span className="mc-badge" role="status">
                    {t(statusLabels[request.status])}
                  </span>
                  {request.endedAt === undefined && (
                    <button
                      className="mc-quiet"
                      type="button"
                      onClick={() => void model.cancelRequest(request.id)}
                    >
                      {t('marivo.credentials.cancel-configuration-request')}
                    </button>
                  )}
                </div>
                <details className="mc-request-reason">
                  <summary>{t('marivo.credentials.show-assistant-request-details')}</summary>
                  <p>{t(request.configuration.reason)}</p>
                </details>
                {requestError && <p role="alert">{t(requestError)}</p>}
                {request.endedAt === undefined && request.status !== 'executing' && (
                  <>
                    {request.configuration.mode === 'create' && !context && (
                      <>
                        <fieldset
                          className="mc-request-choice"
                          aria-label={t('marivo.credentials.configuration-method')}
                        >
                          <button
                            type="button"
                            aria-pressed={requestChoice === 'create'}
                            onClick={() => {
                              setRequestChoice('create')
                              setCreating(true)
                              setEditingName('')
                              setRequestError('')
                            }}
                          >
                            {t('marivo.credentials.add-datasource')}
                          </button>
                          <button
                            type="button"
                            aria-pressed={requestChoice === 'existing'}
                            onClick={() => {
                              setRequestChoice('existing')
                              setCreating(false)
                              setEditingName('')
                              setRequestError('')
                            }}
                          >
                            {t('marivo.credentials.use-an-existing-datasource')}
                          </button>
                        </fieldset>
                        {requestChoice === 'existing' && (
                          <div className="mc-existing-source">
                            <p>
                              {t(
                                'marivo.credentials.if-an-existing-connection-can-access-the-target-table',
                              )}
                            </p>
                            <label className="mc-secret-input">
                              {t('marivo.credentials.select-an-existing-datasource')}
                              <select
                                aria-label={t('marivo.credentials.select-an-existing-datasource')}
                                value=""
                                onChange={async (event) => {
                                  if (!event.target.value) return
                                  try {
                                    await model.selectConfiguration(
                                      workspaceId,
                                      request.id,
                                      event.target.value,
                                    )
                                    setCreating(false)
                                    setEditingName('')
                                  } catch (error) {
                                    setRequestError(error.message)
                                  }
                                }}
                              >
                                <option value="">{t('marivo.credentials.please-select')}</option>
                                {state.datasources.map((item) => (
                                  <option key={item.name} value={item.name}>
                                    {item.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            {state.datasources.length === 0 && (
                              <p>
                                {t(
                                  'marivo.credentials.no-reusable-datasource-is-available-switch-to-add-datasource',
                                )}
                              </p>
                            )}
                          </div>
                        )}
                      </>
                    )}
                    {!creating &&
                      !context &&
                      (request.configuration.mode === 'edit' || requestChoice === 'create') && (
                        <button
                          type="button"
                          onClick={() => {
                            setCreating(true)
                            setEditingName(request.configuration.name ?? '')
                          }}
                        >
                          {t('marivo.credentials.open-configuration-form')}
                        </button>
                      )}
                  </>
                )}
              </section>
            )}
            {creating && request?.endedAt === undefined && (
              <CreateDatasource
                key={`${workspaceId}/${editingName}/${request?.id ?? ''}`}
                name={editingName || undefined}
                requestId={request?.configuration ? request.id : undefined}
                model={model}
                workspaceId={workspaceId}
                close={() => setCreating(false)}
              />
            )}
            {!creating && context && (
              <CredentialForm
                key={context.token}
                context={context}
                request={request}
                state={state}
                model={model}
                workspaceId={workspaceId}
                onEdit={() => {
                  setEditingName(context.name)
                  setCreating(true)
                }}
              />
            )}
            {operations.length > 0 && (
              <section
                className="mc-activity"
                aria-label={t('marivo.credentials.credential-operations-in-progress')}
              >
                <p className="mc-activity-heading">
                  {t('marivo.credentials.in-progress')}
                  {operations.length}
                </p>
                <div className="mc-activity-list">
                  {operations.map((entry) => (
                    <button
                      type="button"
                      key={entry.handle.id}
                      aria-pressed={state.handle?.id === entry.handle.id}
                      onClick={() => model.selectOperation(entry.handle.id)}
                    >
                      {entry.name} {t('marivo.credentials.processing-177')}
                    </button>
                  ))}
                </div>
                {activeOperation?.status === 'running' && (
                  <div className="mc-progress">
                    <p>
                      {state.operations.find((entry) => entry.handle.id === state.handle?.id)?.name}{' '}
                      ·{' '}
                      {activeOperation.phase === 'removing'
                        ? t('marivo.credentials.deleting')
                        : activeOperation.phase === 'saving'
                          ? t('marivo.credentials.saving')
                          : t('marivo.credentials.validating-connection')}
                    </p>
                    <button type="button" onClick={() => void model.cancelOperation()}>
                      {t('marivo.credentials.cancel-this-operation')}
                    </button>
                    {activeOperation.saved.length > 0 && (
                      <p>
                        {t('marivo.credentials.saved')}
                        {activeOperation.saved.join('、')}。
                      </p>
                    )}
                  </div>
                )}
              </section>
            )}
          </main>
        </div>
      </div>
      {!request && workspaceId && (
        <ReportPublishingCredentials key={workspaceId} model={model} workspaceId={workspaceId} />
      )}
    </section>
  )
}
export function installCredentials(ctx, rpc) {
  let storage: Storage | undefined
  try {
    storage = window.sessionStorage
  } catch {
    /* optional query-handle persistence */
  }
  const model = new CredentialClientModel(rpc, storage)
  model.recover()
  ctx.effect(() => () => model.dispose(), 'dsh-data-analysis: credential client lifecycle')
  ctx.on('connection/reset', () => model.reset())
  ctx.slots.inject('conversation.session.header.actions', () =>
    ctx.slots.register(
      {
        locale: 'marivo.navigation',
        name: 'conversation.session.header.actions',
        id: 'marivo-credential-requests',
        order: 120,
      },
      localized(ctx, function Pending({ sessionId }) {
        const t = useCopy()

        const state = useSyncExternalStore(model.subscribe, model.getSnapshot)
        const request = state.requests.find(
          (item) => item.sessionId === sessionId && item.endedAt === undefined,
        )
        return request ? (
          <button
            className="mc-pending-entry"
            style={{
              flex: 'none',
              whiteSpace: 'nowrap',
              fontSize: 12,
              padding: '4px 6px',
              border: '1px solid currentColor',
              borderRadius: 7,
              background: 'transparent',
              color: 'inherit',
              cursor: 'pointer',
            }}
            aria-label={
              request.configuration
                ? t('marivo.credentials.awaiting-datasource-configuration')
                : t('marivo.credentials.awaiting-credentials')
            }
            title={
              request.configuration
                ? t('marivo.credentials.awaiting-datasource-configuration')
                : t('marivo.credentials.awaiting-credentials')
            }
            type="button"
            onClick={() => model.openRequest(request.id)}
          >
            {t('marivo.credentials.configuration-needed')}
          </button>
        ) : null
      }),
    ),
  )
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      { locale: 'marivo.navigation', name: 'shell.overlay', id: 'marivo-credential-observer' },
      localized(ctx, function Observer({ useSessions, useWorkspaces }) {
        const sessionId = useSessions((state) => state.current) ?? ''
        const workspaces = useWorkspaces((state) => state.items)
        const currentWorkspace =
          workspaces.find((item) => item.sessionIds.includes(sessionId))?.workspaceId ?? ''
        useEffect(() => model.session(sessionId), [sessionId])
        // biome-ignore lint/correctness/useExhaustiveDependencies: Workspace reassignment must dismiss old content.
        useEffect(() => model.close(), [currentWorkspace])
        return null
      }),
    ),
  )
  return model
}
