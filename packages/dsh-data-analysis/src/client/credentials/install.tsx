// @ts-nocheck -- JSX and slot faces are supplied by the DSH client runtime module table.

import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { useCopy } from './../i18n/context.tsx'
import { localized } from '../i18n/host.tsx'
import { Button } from '../ui/controls.tsx'
import { Alert, AlertDescription } from '../ui/primitives/alert.tsx'
import { Badge } from '../ui/primitives/badge.tsx'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '../ui/primitives/card.tsx'
import { Checkbox } from '../ui/primitives/checkbox.tsx'
import { Empty, EmptyDescription } from '../ui/primitives/empty.tsx'
import { Field, FieldGroup, FieldLabel, FieldSet } from '../ui/primitives/field.tsx'
import { Input } from '../ui/primitives/input.tsx'
import { NativeSelect } from '../ui/primitives/native-select.tsx'
import { ToggleGroup, ToggleGroupItem } from '../ui/primitives/toggle-group.tsx'
import { UIStyleSheet } from '../ui/theme.ts'
import type { CredentialChanges } from './changes.ts'
import { CreateDatasource } from './create-datasource.tsx'
import { CredentialClientModel, credentialMessage } from './model.ts'
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
export function CredentialIcon({ name, size = 16 }) {
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
    <Alert
      className="mc-result"
      data-tone={stale ? 'stale' : result.ok ? 'success' : 'error'}
      role="status"
    >
      <AlertDescription>
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
      </AlertDescription>
    </Alert>
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
      data-error={Boolean(entry.error || errors.length)}
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
    <Card
      role="region"
      className="mc-properties"
      aria-label={t('marivo.credentials.datasource-properties')}
    >
      <CardHeader>
        <CardTitle>{t('marivo.credentials.datasource-properties')}</CardTitle>
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
  )
}
function CredentialForm({ context, request, state, model, workspaceId, onEdit }) {
  const t = useCopy()
  const formId = useId()

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
    <Card
      className="mc-form"
      role="region"
      aria-label={t('marivo.credentials.value-credential-configuration', { p0: context.name })}
    >
      <CardHeader className="mc-detail-heading mc-datasource-heading">
        <p className="mc-eyebrow">{t('marivo.credentials.datasource-configuration')}</p>
        <div className="mc-name-row">
          <CardTitle role="heading" aria-level={3}>
            {context.name}
          </CardTitle>
          <div className="mc-heading-actions">
            <Badge variant="secondary" data-ready={ready}>
              {ready && <CredentialIcon name="check" size={13} />}
              {context.refs.length === 0
                ? t('marivo.credentials.no-credentials-required')
                : ready
                  ? t('marivo.credentials.all-credentials-configured')
                  : t('marivo.credentials.value-value-configured', {
                      p0: configured,
                      p1: context.refs.length,
                    })}
            </Badge>
            {!ended && (
              <Button
                size="icon"
                variant="ghost"
                className="mc-icon-button"
                type="button"
                title={t('marivo.credentials.edit-configuration')}
                aria-label={t('marivo.credentials.edit-configuration')}
                disabled={busy}
                onClick={onEdit}
              >
                <CredentialIcon name="edit" />
              </Button>
            )}
            {!request && (
              <Button
                size="icon"
                variant="destructive"
                className="mc-icon-button"
                type="button"
                title={t('marivo.credentials.delete-datasource')}
                aria-label={t('marivo.credentials.delete-datasource')}
                disabled={busy || state.loading}
                onClick={() => setRemovingDatasource(true)}
              >
                <CredentialIcon name="delete" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="mc-form-body">
        {removingDatasource && (
          <Card
            className="mc-confirm"
            aria-label={t('marivo.credentials.confirm-datasource-deletion')}
          >
            <CardContent>
              <p>
                {t('marivo.credentials.confirm-datasource-deletion')}
                {context.name}
                {t(
                  'marivo.credentials.this-removes-the-datasource-definition-from-this-workspace-not',
                )}
              </p>
              {context.refs.length > 0 && (
                <>
                  <Field orientation="horizontal" data-disabled={busy}>
                    <Checkbox
                      id={`${formId}-delete-credentials`}
                      checked={removeCredentials}
                      disabled={busy}
                      onCheckedChange={(checked) => setRemoveCredentials(checked === true)}
                    />
                    <FieldLabel htmlFor={`${formId}-delete-credentials`}>
                      {t('marivo.credentials.also-delete-associated-saved-credentials')}
                    </FieldLabel>
                  </Field>
                  <p>
                    {t('marivo.credentials.credential-references')}
                    {context.refs.join('、')}
                    {t(
                      'marivo.credentials.other-datasources-or-workspaces-may-share-these-credentials-and',
                    )}
                  </p>
                </>
              )}
              <Button
                variant="destructive"
                type="button"
                disabled={busy || state.loading}
                onClick={() => {
                  setRemovingDatasource(false)
                  void model.start(context, 'delete-datasource', {}, undefined, removeCredentials)
                }}
              >
                {t('marivo.credentials.confirm-datasource-deletion')}
              </Button>
              <Button
                variant="outline"
                type="button"
                disabled={busy}
                onClick={() => {
                  setRemovingDatasource(false)
                  setRemoveCredentials(false)
                }}
              >
                {t('marivo.credentials.cancel')}
              </Button>
            </CardContent>
          </Card>
        )}
        {request && (
          <Card className="mc-request-status" role="status">
            <CardContent>
              <strong>{t(statusLabels[request.status])}</strong>
              {!ended && (
                <p>
                  {t('marivo.credentials.continue-the-current-task-after-successful-validation')}
                </p>
              )}
              {(request.status === 'call-ended' || request.status === 'context-changed') && (
                <p>{t('marivo.credentials.start-the-task-again')}</p>
              )}
            </CardContent>
          </Card>
        )}
        <DatasourceProperties context={context} />
        <CardTitle role="heading" aria-level={4} className="mc-section-heading">
          {t('marivo.credentials.credentials')}
        </CardTitle>
        {context.refs.length === 0 && (
          <p className="mc-note">
            {t('marivo.credentials.this-datasource-has-no-credential-references-you-can-test')}
          </p>
        )}
        {context.refs.length > 0 && (
          <Card className="mc-fields">
            <CardContent>
              {context.refs.map((ref) => {
                const info = context.credentials[ref]
                const shared = state.datasources
                  .filter((item) => item.refs.includes(ref))
                  .map((item) => item.name)
                return (
                  <FieldSet
                    className="mc-field"
                    key={ref}
                    disabled={busy || ended}
                    aria-label={ref}
                  >
                    <FieldGroup>
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
                          <Badge className="mc-badge" data-ready={Boolean(info?.configured)}>
                            {info?.configured
                              ? t('marivo.credentials.configured')
                              : t('marivo.credentials.not-configured')}
                          </Badge>
                          {info?.writable && info.configured && !editing[ref] && (
                            <Button
                              variant="outline"
                              type="button"
                              onClick={() => setEditing({ ...editing, [ref]: true })}
                            >
                              {t('marivo.credentials.replace')}
                            </Button>
                          )}
                          {info?.writable && info.configured && editing[ref] && (
                            <Button
                              variant="outline"
                              type="button"
                              onClick={() => {
                                setValues({ ...values, [ref]: '' })
                                setEditing({ ...editing, [ref]: false })
                              }}
                            >
                              {t('marivo.credentials.cancel-replacement')}
                            </Button>
                          )}
                          {info?.writable && !request && info.configured && (
                            <Button
                              variant="destructive"
                              type="button"
                              onClick={() => setDeleting(ref)}
                            >
                              {t('marivo.credentials.delete-saved-value')}
                            </Button>
                          )}
                        </div>
                      </div>
                      {info?.writable && (!info.configured || editing[ref]) && (
                        <Field>
                          <FieldLabel htmlFor={`${formId}-${ref}-value`}>
                            {t('marivo.credentials.new-value')}
                          </FieldLabel>
                          <Input
                            id={`${formId}-${ref}-value`}
                            type="password"
                            autoComplete="new-password"
                            placeholder={t('marivo.credentials.enter-credential-value-127')}
                            value={values[ref] ?? ''}
                            onChange={(event) =>
                              setValues({ ...values, [ref]: event.target.value })
                            }
                          />
                          {!request && (
                            <Button
                              variant="default"
                              type="button"
                              disabled={!values[ref]}
                              onClick={() => saveReference(ref)}
                            >
                              {info.configured
                                ? t('marivo.credentials.confirm-replacement')
                                : t('marivo.credentials.add-credential')}
                            </Button>
                          )}
                        </Field>
                      )}
                      {shared.length > 1 && (
                        <p className="mc-field-note">
                          {t('marivo.credentials.and')}
                          {shared.filter((name) => name !== context.name).join('、')}{' '}
                          {t('marivo.credentials.share-this-reference')}
                        </p>
                      )}
                      {deleting === ref && (
                        <Card className="mc-confirm">
                          <CardContent>
                            <p>
                              {t('marivo.credentials.confirm-deletion-of')}
                              {ref} {t('marivo.credentials.the-saved-value')}
                            </p>
                            <Button
                              variant="destructive"
                              type="button"
                              onClick={() => {
                                setDeleting('')
                                void model.start(context, 'delete', {}, ref)
                              }}
                            >
                              {t('marivo.credentials.confirm-saved-value-deletion')}
                            </Button>
                            <Button variant="outline" type="button" onClick={() => setDeleting('')}>
                              {t('marivo.credentials.keep')}
                            </Button>
                          </CardContent>
                        </Card>
                      )}
                    </FieldGroup>
                  </FieldSet>
                )
              })}
            </CardContent>
          </Card>
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
                <Button
                  size="icon"
                  variant="ghost"
                  className="mc-icon-button"
                  type="button"
                  title={t('marivo.credentials.test-connection')}
                  aria-label={t('marivo.credentials.test-connection')}
                  disabled={busy}
                  onClick={() => void model.start(context, 'test')}
                >
                  <CredentialIcon name="test" />
                </Button>
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
      </CardContent>
      {!ended && (request || busy) && (
        <CardFooter className="mc-form-footer">
          {request && (
            <Button variant="default" type="button" disabled={busy} onClick={submit}>
              {t('marivo.credentials.submit-credentials-and-continue')}
            </Button>
          )}
          {request && (
            <Button
              variant="outline"
              type="button"
              disabled={busy}
              onClick={() => void model.start(context, 'submit')}
            >
              {t('marivo.credentials.validate-existing-configuration-and-continue')}
            </Button>
          )}
          {request?.failure && (
            <Button
              variant="outline"
              type="button"
              disabled={busy}
              onClick={() => void model.start(context, 'diagnose')}
            >
              {t('marivo.credentials.ask-the-assistant-to-investigate')}
            </Button>
          )}
          {request ? (
            <Button
              variant="ghost"
              className="mc-cancel"
              type="button"
              onClick={() => void model.cancelRequest(request.id)}
            >
              {t('marivo.credentials.cancel-this-round')}
            </Button>
          ) : (
            busy && (
              <Button
                variant="ghost"
                className="mc-cancel"
                type="button"
                onClick={() => void model.cancelOperation(context.token)}
              >
                {t('marivo.credentials.cancel-operation')}
              </Button>
            )
          )}
        </CardFooter>
      )}
      {ended && (
        <CardFooter className="mc-form-footer">
          <Button variant="outline" type="button" onClick={() => model.show(workspaceId)}>
            {t('marivo.credentials.back-to-datasource-management')}
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}
export function CredentialPanel({ model, workspaces, onRefresh }) {
  const t = useCopy()
  const formId = useId()

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
    <section
      className="mv-ui mc-panel"
      aria-label={t('marivo.credentials.datasources-and-credentials')}
    >
      <UIStyleSheet />
      <style>{credentialStyles}</style>
      <div className="rt-heading-row">
        <h2 className="rt-heading">{t('marivo.credentials.datasources-and-credentials')}</h2>
        <div className="mc-heading-actions">
          {!request && (
            <Button
              size="icon"
              variant="ghost"
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
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            className="mc-icon-button"
            type="button"
            title={t('marivo.credentials.refresh-datasources')}
            aria-label={t('marivo.credentials.refresh-datasources')}
            disabled={state.loading}
            onClick={onRefresh ?? (() => void model.refreshDatasources())}
          >
            <CredentialIcon name="refresh" />
          </Button>
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
              <Button
                variant="outline"
                type="button"
                key={item.id}
                onClick={() => model.openRequest(item.id)}
              >
                {item.context?.name ??
                  item.configuration?.name ??
                  t('marivo.credentials.add-datasource')}{' '}
                · {t(statusLabels[item.status])}
              </Button>
            ))}
            {request && (
              <Button variant="ghost" type="button" onClick={() => model.show(workspaceId)}>
                {t('marivo.credentials.datasource-management')}
              </Button>
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
                        <Button
                          variant={
                            !creating && context?.token === item.token ? 'secondary' : 'outline'
                          }
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
                        </Button>
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
                <Card className="mc-request-status" key={entry.handle.id}>
                  <CardContent>
                    <OperationOutcome entry={entry} />
                    <Button
                      variant="outline"
                      type="button"
                      onClick={() => model.dismissOutcome(entry.handle.scope)}
                    >
                      {t('marivo.credentials.dismiss-deletion-result')}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            {state.error && (
              <Alert role="alert" className="mc-alert">
                <AlertDescription>{t(state.error)}</AlertDescription>
              </Alert>
            )}
            {state.loading && (
              <p className="mc-loading" role="status">
                {t('marivo.credentials.loading-datasources-and-credential-status')}
              </p>
            )}
            {!request && !creating && !state.loading && !context && !state.error && (
              <Empty className="mc-empty">
                <EmptyDescription>
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
                </EmptyDescription>
              </Empty>
            )}
            {request?.configuration && (
              <Card
                className="mc-request-status"
                aria-label={t('marivo.credentials.configuration-request')}
              >
                <CardHeader className="mc-request-heading">
                  <h3>{t('marivo.credentials.configure-a-datasource-to-continue')}</h3>
                  <Badge className="mc-badge" role="status">
                    {t(statusLabels[request.status])}
                  </Badge>
                  {request.endedAt === undefined && (
                    <Button
                      variant="ghost"
                      type="button"
                      onClick={() => void model.cancelRequest(request.id)}
                    >
                      {t('marivo.credentials.cancel-configuration-request')}
                    </Button>
                  )}
                </CardHeader>
                <CardContent>
                  <details className="mc-request-reason">
                    <summary>{t('marivo.credentials.show-assistant-request-details')}</summary>
                    <p>{t(request.configuration.reason)}</p>
                  </details>
                  {requestError && <p role="alert">{t(requestError)}</p>}
                  {request.endedAt === undefined && request.status !== 'executing' && (
                    <>
                      {request.configuration.mode === 'create' && !context && (
                        <>
                          <FieldSet
                            className="mc-request-choice"
                            aria-label={t('marivo.credentials.configuration-method')}
                          >
                            <ToggleGroup
                              type="single"
                              variant="outline"
                              value={requestChoice}
                              onValueChange={(choice) => {
                                if (!choice) return
                                setRequestChoice(choice)
                                setCreating(choice === 'create')
                                setEditingName('')
                                setRequestError('')
                              }}
                            >
                              <ToggleGroupItem value="create">
                                {t('marivo.credentials.add-datasource')}
                              </ToggleGroupItem>
                              <ToggleGroupItem value="existing">
                                {t('marivo.credentials.use-an-existing-datasource')}
                              </ToggleGroupItem>
                            </ToggleGroup>
                          </FieldSet>
                          {requestChoice === 'existing' && (
                            <div className="mc-existing-source">
                              <p>
                                {t(
                                  'marivo.credentials.if-an-existing-connection-can-access-the-target-table',
                                )}
                              </p>
                              <Field>
                                <FieldLabel htmlFor={`${formId}-existing-source`}>
                                  {t('marivo.credentials.select-an-existing-datasource')}
                                </FieldLabel>
                                <NativeSelect
                                  id={`${formId}-existing-source`}
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
                                </NativeSelect>
                              </Field>
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
                          <Button
                            variant="outline"
                            type="button"
                            onClick={() => {
                              setCreating(true)
                              setEditingName(request.configuration.name ?? '')
                            }}
                          >
                            {t('marivo.credentials.open-configuration-form')}
                          </Button>
                        )}
                    </>
                  )}
                </CardContent>
              </Card>
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
                    <Button
                      variant="outline"
                      type="button"
                      key={entry.handle.id}
                      aria-pressed={state.handle?.id === entry.handle.id}
                      onClick={() => model.selectOperation(entry.handle.id)}
                    >
                      {entry.name} {t('marivo.credentials.processing-177')}
                    </Button>
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
                    <Button
                      variant="outline"
                      type="button"
                      onClick={() => void model.cancelOperation()}
                    >
                      {t('marivo.credentials.cancel-this-operation')}
                    </Button>
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
    </section>
  )
}
export function installCredentials(ctx, rpc, changes?: CredentialChanges) {
  let storage: Storage | undefined
  try {
    storage = window.sessionStorage
  } catch {
    /* optional query-handle persistence */
  }
  const model = new CredentialClientModel(rpc, storage, changes)
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
          <>
            <UIStyleSheet />
            <style>{credentialStyles}</style>
            <Button
              variant="outline"
              className="mv-ui mc-pending-entry"
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
            </Button>
          </>
        ) : null
      }),
    ),
  )
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      { locale: 'marivo.navigation', name: 'shell.overlay', id: 'marivo-credential-observer' },
      localized(ctx, function Observer({ useSessions, useWorkspaces }) {
        const sessionId =
          useSessions((state) => state.ids.find((id) => state.byId[id]?.retainedBy.mainView)) ?? ''
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
