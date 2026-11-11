// @ts-nocheck -- JSX and slot faces are supplied by the DSH client runtime module table.

import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import {
  CheckIcon,
  DatabaseIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
} from 'lucide-react'
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { useCopy } from './../i18n/context.tsx'
import { localized } from '../i18n/host.tsx'
import { Button, IconButton } from '../ui/controls.tsx'
import { Alert, AlertDescription } from '../ui/primitives/alert.tsx'
import { Badge } from '../ui/primitives/badge.tsx'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '../ui/primitives/card.tsx'
import { Empty, EmptyDescription } from '../ui/primitives/empty.tsx'
import { Field, FieldGroup, FieldLabel, FieldSet } from '../ui/primitives/field.tsx'
import { Input } from '../ui/primitives/input.tsx'
import { TabsContent, TabsList, Tabs as TabsRoot, TabsTrigger } from '../ui/primitives/tabs.tsx'
import { UIStyleSheet } from '../ui/theme.ts'
import type { CredentialChanges } from './changes.ts'
import { CredentialClientModel, credentialMessage } from './model.ts'
import { credentialStyles } from './styles.ts'

const statusLabels = {
  'awaiting-input': 'marivo.credentials.awaiting-input',
  executing: 'marivo.credentials.saving-or-validating-77',
  succeeded: 'marivo.credentials.validated-original-call-continues',
  'call-ended': 'marivo.credentials.original-call-ended',
  cancelled: 'marivo.credentials.configuration-request-cancelled',
  'context-changed': 'marivo.credentials.context-changed',
}
export function CredentialIcon({ name, size = 16 }) {
  const Icon = {
    database: DatabaseIcon,
    refresh: RefreshCwIcon,
    delete: Trash2Icon,
    check: CheckIcon,
  }[name]
  return Icon ? <Icon size={size} aria-hidden="true" /> : null
}
function OperationOutcome({ entry }) {
  const t = useCopy()

  if (!entry) return null
  const operation = entry.operation
  const errors = operation?.errors ?? []
  const unsuccessful =
    entry.error || operation?.status === 'cancelled' || operation?.status === 'failed'
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
      {operation?.status === 'failed' && errors.length === 0 && (
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
        <CardTitle role="heading" aria-level={4} className="mc-section-heading">
          <SlidersHorizontalIcon aria-hidden="true" />
          {t('marivo.credentials.datasource-properties')}
        </CardTitle>
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
function CredentialForm({ context, request, state, model, workspaceId }) {
  const t = useCopy()
  const formId = useId()

  const [values, setValues] = useState({})
  const [editing, setEditing] = useState({})
  const [deleting, setDeleting] = useState('')
  const busy =
    request?.status === 'executing' ||
    state.operations.some((entry) => entry.handle.scope === context.token)
  const ended = request?.endedAt !== undefined
  const configured = context.refs.filter((ref) => context.credentials[ref]?.configured).length
  const ready = configured === context.refs.length
  const outcome = state.outcomes[context.token]
  // biome-ignore lint/correctness/useExhaustiveDependencies: Identity or credential revision changes must discard unsubmitted secrets.
  useEffect(() => {
    setValues({})
    setEditing({})
    setDeleting('')
  }, [context.token, context.version])
  const saveReference = (ref) => {
    const changes = { [ref]: values[ref] }
    setValues({ ...values, [ref]: '' })
    setEditing({ ...editing, [ref]: false })
    void model.start(context, 'save', changes, undefined, workspaceId)
  }
  const submit = () => {
    const changes = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ''))
    setValues({})
    setEditing({})
    void model.start(context, 'submit', changes, undefined, workspaceId)
  }
  return (
    <Card
      className="mc-form mc-datasource-detail"
      role="region"
      aria-label={t('marivo.credentials.value-credential-configuration', { p0: context.name })}
    >
      <CardHeader className="mc-detail-heading mc-datasource-heading">
        <div className="mc-name-row">
          <div className="mc-identity">
            <span className="mc-identity-icon">
              <CredentialIcon name="database" size={22} />
            </span>
            <div className="mc-identity-copy">
              <p className="mc-eyebrow">{t('marivo.credentials.datasource-configuration')}</p>
              <div className="mc-identity-title">
                <CardTitle role="heading" aria-level={3}>
                  {context.name}
                </CardTitle>
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
              </div>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="mc-form-body">
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
        <section className="mc-credential-section">
          <CardTitle role="heading" aria-level={4} className="mc-section-heading">
            <ShieldCheckIcon aria-hidden="true" />
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
                                  void model.start(context, 'delete', {}, ref, workspaceId)
                                }}
                              >
                                {t('marivo.credentials.confirm-saved-value-deletion')}
                              </Button>
                              <Button
                                variant="outline"
                                type="button"
                                onClick={() => setDeleting('')}
                              >
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
        </section>
        <OperationOutcome entry={outcome} />
      </CardContent>
      {!ended && (request || busy) && (
        <CardFooter className="mc-form-footer">
          {request && (
            <Button variant="default" type="button" disabled={busy} onClick={submit}>
              {t('marivo.credentials.submit-credentials-and-continue')}
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
  const request = state.requests.find((item) => item.id === state.requestId)
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
    const selected = list?.querySelector('[aria-selected="true"]')
    if (selected) {
      const bounds = selected.getBoundingClientRect()
      const viewport = list.getBoundingClientRect()
      if (bounds.left < viewport.left) list.scrollLeft += bounds.left - viewport.left
      else if (bounds.right > viewport.right) list.scrollLeft += bounds.right - viewport.right
    }
  }, [context?.token])
  const workspaceId = request
    ? (workspaces.find((item) => item.sessionIds.includes(request.sessionId))?.workspaceId ?? '')
    : state.workspaceId
  const datasources = request ? (request.context ? [request.context] : []) : state.datasources
  const operations = state.operations.filter((entry) => entry.workspaceId === workspaceId)
  const activeOperation = operations.find(
    (entry) => entry.handle.id === state.handle?.id,
  )?.operation
  if (!state.open) return null
  const credentialForm = context && (
    <CredentialForm
      key={context.token}
      context={context}
      request={request}
      state={state}
      model={model}
      workspaceId={workspaceId}
    />
  )
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
          <IconButton
            variant="ghost"
            className="mc-icon-button"
            type="button"
            title={t('marivo.credentials.refresh-datasources')}
            label={t('marivo.credentials.refresh-datasources')}
            disabled={state.loading}
            onClick={onRefresh ?? (() => void model.refreshDatasources())}
          >
            <CredentialIcon name="refresh" />
          </IconButton>
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
                {item.context?.name} · {t(statusLabels[item.status])}
              </Button>
            ))}
            {request && (
              <Button variant="ghost" type="button" onClick={() => model.show(workspaceId)}>
                {t('marivo.credentials.datasource-management')}
              </Button>
            )}
          </div>
        )}
        <TabsRoot
          className="mc-columns"
          ref={columns}
          value={!request ? (context?.token ?? '') : ''}
          activationMode="manual"
          onValueChange={(token) => {
            model.select(token)
          }}
        >
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
                <TabsList
                  variant="line"
                  className="mc-datasources"
                  ref={navigation}
                  aria-label={t('marivo.credentials.datasource-navigation')}
                >
                  {datasources.map((item, index) => {
                    const count = item.refs.filter(
                      (ref) => item.credentials[ref]?.configured,
                    ).length
                    const ready = count === item.refs.length
                    const running = state.operations.some(
                      (entry) => entry.handle.scope === item.token,
                    )
                    const status =
                      item.refs.length === 0
                        ? t('marivo.credentials.no-credentials-required')
                        : ready
                          ? t('marivo.credentials.all-credentials-configured')
                          : t('marivo.credentials.value-value-configured', {
                              p0: count,
                              p1: item.refs.length,
                            })
                    const description = running
                      ? `${status} · ${t('marivo.credentials.processing')}`
                      : status
                    const statusId = `${formId}-datasource-status-${index}`
                    return (
                      <TabsTrigger
                        key={item.token}
                        value={item.token}
                        className="mc-datasource"
                        type="button"
                        title={item.name}
                        aria-label={t('marivo.credentials.select-datasource-value', {
                          p0: item.name,
                        })}
                        aria-describedby={statusId}
                      >
                        <CredentialIcon name="database" />
                        <span className="mc-datasource-copy">
                          <span className="mc-datasource-name">{item.name}</span>
                          <span
                            className="mc-dot"
                            data-ready={ready}
                            title={description}
                            aria-hidden="true"
                          />
                        </span>
                        <span id={statusId} className="mc-visually-hidden">
                          {description}
                        </span>
                      </TabsTrigger>
                    )
                  })}
                </TabsList>
              </div>
            </aside>
          )}
          <main className="mc-main" ref={main}>
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
            {!request && !state.loading && !context && !state.error && (
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
            {request
              ? credentialForm
              : context && <TabsContent value={context.token}>{credentialForm}</TabsContent>}
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
                      · {t('marivo.credentials.saving')}
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
        </TabsRoot>
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
              aria-label={t('marivo.credentials.awaiting-credentials')}
              title={t('marivo.credentials.awaiting-credentials')}
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
