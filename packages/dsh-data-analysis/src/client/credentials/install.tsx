// @ts-nocheck -- JSX and slot faces are supplied by the DSH client runtime module table.

import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { CreateDatasource } from './create-datasource.tsx'
import { CredentialClientModel, credentialMessage } from './model.ts'
import { credentialStyles } from './styles.ts'

const statusLabels = {
  'awaiting-input': '等待填写',
  executing: '正在保存或验证',
  'awaiting-decision': '连接验证失败，等待处理',
  succeeded: '验证完成，原调用继续',
  'handed-off': '已交给助手排查',
  'call-ended': '原调用已结束',
  'context-changed': '上下文已变化',
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
  if (!result) return null
  return (
    <div
      className="mc-result"
      data-tone={stale ? 'stale' : result.ok ? 'success' : 'error'}
      role="status"
    >
      <div className="mc-result-title">
        <CredentialIcon name={stale || !result.ok ? 'info' : 'check'} size={16} />
        {stale ? '配置已变化，请重新测试' : result.ok ? '连接测试成功' : '连接测试失败'}
      </div>
      {!result.ok && !stale && (
        <>
          <p>{result.failure?.message}</p>
          {result.repair?.action && <p>{result.repair.action}</p>}
          {result.failure?.code && (
            <details>
              <summary>查看错误代码</summary>
              <pre>{result.failure.code}</pre>
            </details>
          )}
        </>
      )}
    </div>
  )
}
function OperationOutcome({ entry }) {
  if (!entry) return null
  const operation = entry.operation
  const errors = operation?.errors ?? []
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
      {entry.error && <p>{entry.error}</p>}
      {operation?.status === 'cancelled' && <p>本次操作已取消。</p>}
      {operation?.status === 'succeeded' && operation.action === 'delete' && (
        <p>已删除保存值，当前配置状态已更新。</p>
      )}
      {errors.length > 0 && <p>{errors.map(credentialMessage).join(' ')}</p>}
      {operation?.status === 'failed' && errors.length === 0 && !operation.result && (
        <p>操作未完成，请重试。</p>
      )}
      {unsuccessful && operation?.saved.length > 0 && <p>已保存：{operation.saved.join('、')}。</p>}
    </div>
  )
}
export function DatasourceProperties({ context }) {
  const properties = Object.entries(context.properties ?? {})
  return (
    <section className="mc-properties" aria-label="数据源属性">
      <h4 className="mc-section-heading">数据源属性</h4>
      <dl className="mc-property-list">
        <div className="mc-property">
          <dt>引擎</dt>
          <dd>{context.backend || '未提供'}</dd>
        </div>
        {properties.map(([field, value]) => (
          <div className="mc-property" key={field}>
            <dt>{field}</dt>
            <dd>
              {value !== null && typeof value === 'object' ? (
                // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll long JSON values.
                <section className="mc-property-json" tabIndex={0} aria-label={`${field} 配置值`}>
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
function CredentialForm({ context, request, state, model, workspaceId }) {
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
    <section className="mc-form" aria-label={`${context.name} 凭证配置`}>
      <div className="mc-form-body">
        <div className="mc-detail-heading">
          <div>
            <p className="mc-eyebrow">数据源配置</p>
            <h3>{context.name}</h3>
          </div>
          <span className="mc-badge" data-ready={ready}>
            {ready && <CredentialIcon name="check" size={13} />}
            {context.refs.length === 0
              ? '无需凭证'
              : ready
                ? '凭证已配齐'
                : `${configured} / ${context.refs.length} 项已配置`}
          </span>
        </div>
        {request && (
          <div className="mc-request-status" role="status">
            <strong>{statusLabels[request.status]}</strong>
            {!ended && <p>验证成功后继续当前任务。</p>}
            {(request.status === 'call-ended' || request.status === 'context-changed') && (
              <p>请重新发起任务。</p>
            )}
          </div>
        )}
        <DatasourceProperties context={context} />
        <h4 className="mc-section-heading">凭证</h4>
        {context.refs.length === 0 && (
          <p className="mc-note">该数据源没有凭证引用，可直接测试连接。</p>
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
                        字段：
                        {Object.entries(context.fields)
                          .filter(([, value]) => value === ref)
                          .map(([field]) => field)
                          .join('、')}{' '}
                        · 来源：{info?.source ?? '无'}
                        {!info?.writable && ' · 来源只读'}
                      </p>
                    </div>
                    <div className="mc-field-actions">
                      <span className="mc-badge" data-ready={Boolean(info?.configured)}>
                        {info?.configured ? '已配置' : '未配置'}
                      </span>
                      {info?.writable && info.configured && !editing[ref] && (
                        <button
                          type="button"
                          onClick={() => setEditing({ ...editing, [ref]: true })}
                        >
                          更换
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
                          取消更换
                        </button>
                      )}
                      {info?.writable && !request && info.configured && (
                        <button className="mc-quiet" type="button" onClick={() => setDeleting(ref)}>
                          删除已保存值
                        </button>
                      )}
                    </div>
                  </div>
                  {info?.writable && (!info.configured || editing[ref]) && (
                    <label className="mc-secret-input">
                      新值
                      <input
                        type="password"
                        autoComplete="new-password"
                        placeholder="输入凭证值"
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
                          {info.configured ? '确认更换' : '新增凭证'}
                        </button>
                      )}
                    </label>
                  )}
                  {shared.length > 1 && (
                    <p className="mc-field-note">
                      与 {shared.filter((name) => name !== context.name).join('、')} 共享此引用
                    </p>
                  )}
                  {deleting === ref && (
                    <div className="mc-confirm">
                      <p>确认删除 {ref} 的已保存值？</p>
                      <button
                        className="mc-danger"
                        type="button"
                        onClick={() => {
                          setDeleting('')
                          void model.start(context, 'delete', {}, ref)
                        }}
                      >
                        确认删除已保存值
                      </button>
                      <button type="button" onClick={() => setDeleting('')}>
                        保留
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
            <h4>连接状态</h4>
            {latestTest?.at !== undefined && (
              <time dateTime={new Date(latestTest.at).toISOString()}>
                上次测试：{new Date(latestTest.at).toLocaleString()}
              </time>
            )}
          </div>
          {latestResult ? (
            <TestResult result={latestResult} stale={!request?.failure && latestTest?.stale} />
          ) : (
            <p className="mc-empty-test">尚未测试连接。</p>
          )}
          <OperationOutcome entry={outcome} />
        </div>
      </div>
      {!ended && (
        <div className="mc-form-footer">
          {request && (
            <button className="mc-primary" type="button" disabled={busy} onClick={submit}>
              提交凭证并继续
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void model.start(context, request ? 'submit' : 'test')}
          >
            {request ? '使用已有配置验证并继续' : '测试连接'}
          </button>
          {request?.failure && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void model.start(context, 'diagnose')}
            >
              交给助手排查
            </button>
          )}
          {request ? (
            <button
              className="mc-quiet mc-cancel"
              type="button"
              onClick={() => void model.cancelRequest(request.id)}
            >
              取消本轮
            </button>
          ) : (
            busy && (
              <button
                className="mc-quiet mc-cancel"
                type="button"
                onClick={() => void model.cancelOperation(context.token)}
              >
                取消操作
              </button>
            )
          )}
        </div>
      )}
      {ended && (
        <div className="mc-form-footer">
          <button type="button" onClick={() => model.show(workspaceId)}>
            返回数据源管理
          </button>
        </div>
      )}
    </section>
  )
}
export function CredentialPanel({ model, workspaces }) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot)
  const columns = useRef(null)
  const navigation = useRef(null)
  const main = useRef(null)
  const [creating, setCreating] = useState(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: Switching context discards the creation form.
  useEffect(() => setCreating(false), [state.open, state.workspaceId, state.requestId])
  const request = state.requests.find((item) => item.id === state.requestId)
  const pending = state.requests.filter(
    (item) => item.endedAt === undefined && item.sessionId === state.sessionId,
  )
  const context =
    request?.context ?? state.datasources.find((item) => item.token === state.selected)
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
  const datasources = request ? [request.context] : state.datasources
  const operations = state.operations.filter((entry) => entry.workspaceId === workspaceId)
  const activeOperation = operations.find(
    (entry) => entry.handle.id === state.handle?.id,
  )?.operation
  if (!state.open) return null
  return (
    <section className="mc-panel" aria-label="数据源与凭证">
      <style>{credentialStyles}</style>
      <div className="mc-shell">
        {pending.length > 0 && (
          <div className="mc-requests">
            <span>本会话待办</span>
            {pending.map((item) => (
              <button type="button" key={item.id} onClick={() => model.openRequest(item.id)}>
                {item.context.name} · {statusLabels[item.status]}
              </button>
            ))}
            {request && (
              <button className="mc-quiet" type="button" onClick={() => model.show(workspaceId)}>
                数据源管理
              </button>
            )}
          </div>
        )}
        <div className="mc-columns" ref={columns}>
          <aside className="mc-nav" aria-label="数据源导航">
            {!request && (
              <button
                type="button"
                disabled={!workspaceId || state.loading}
                onClick={() => setCreating(true)}
              >
                新增数据源
              </button>
            )}
            <div>
              <div className="mc-nav-heading">
                <h3>{request ? '请求的数据源' : `数据源 · ${datasources.length}`}</h3>
              </div>
              <ul className="mc-datasources" ref={navigation}>
                {datasources.map((item) => {
                  const count = item.refs.filter((ref) => item.credentials[ref]?.configured).length
                  const ready = count === item.refs.length
                  const running = state.operations.some(
                    (entry) => entry.handle.scope === item.token,
                  )
                  return (
                    <li key={item.token}>
                      <button
                        className="mc-datasource"
                        type="button"
                        aria-label={`选择数据源 ${item.name}`}
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
                              ? '正在处理…'
                              : item.refs.length === 0
                                ? '无需凭证'
                                : ready
                                  ? '凭证已配齐'
                                  : `${count} / ${item.refs.length} 项已配置`}
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          </aside>
          <main className="mc-main" ref={main}>
            {state.error && (
              <p role="alert" className="mc-alert">
                {state.error}
              </p>
            )}
            {state.loading && (
              <p className="mc-loading" role="status">
                正在读取数据源与凭证状态…
              </p>
            )}
            {!creating && !state.loading && !context && !state.error && (
              <div className="mc-empty">
                <CredentialIcon name="database" size={32} />
                <h3>
                  {!state.workspaceId
                    ? '当前会话未绑定 Workspace'
                    : state.datasources.length === 0
                      ? '暂无数据源'
                      : '选择一个数据源'}
                </h3>
                <p>
                  {!state.workspaceId
                    ? '请返回会话后重试。'
                    : state.datasources.length === 0
                      ? '该 Workspace 没有已定义的数据源。'
                      : '查看凭证配置与最近一次连接测试。'}
                </p>
              </div>
            )}
            {creating && (
              <CreateDatasource
                key={workspaceId}
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
              />
            )}
            {operations.length > 0 && (
              <section className="mc-activity" aria-label="进行中的凭证操作">
                <p className="mc-activity-heading">进行中 · {operations.length}</p>
                <div className="mc-activity-list">
                  {operations.map((entry) => (
                    <button
                      type="button"
                      key={entry.handle.id}
                      aria-pressed={state.handle?.id === entry.handle.id}
                      onClick={() => model.selectOperation(entry.handle.id)}
                    >
                      {entry.name} · 处理中
                    </button>
                  ))}
                </div>
                {activeOperation?.status === 'running' && (
                  <div className="mc-progress">
                    <p>
                      {state.operations.find((entry) => entry.handle.id === state.handle?.id)?.name}{' '}
                      · {activeOperation.phase === 'saving' ? '正在保存' : '正在验证连接'}
                    </p>
                    <button type="button" onClick={() => void model.cancelOperation()}>
                      取消此操作
                    </button>
                    {activeOperation.saved.length > 0 && (
                      <p>已保存：{activeOperation.saved.join('、')}。</p>
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
      { name: 'conversation.session.header.actions', id: 'marivo-credential-requests', order: 120 },
      function Pending({ sessionId }) {
        const state = useSyncExternalStore(model.subscribe, model.getSnapshot)
        const request = state.requests.find(
          (item) => item.sessionId === sessionId && item.endedAt === undefined,
        )
        return request ? (
          <button
            className="mc-pending-entry"
            type="button"
            onClick={() => model.openRequest(request.id)}
          >
            等待配置凭证
          </button>
        ) : null
      },
    ),
  )
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      { name: 'shell.overlay', id: 'marivo-credential-observer' },
      function Observer({ useSessions, useWorkspaces }) {
        const sessionId = useSessions((state) => state.current) ?? ''
        const workspaces = useWorkspaces((state) => state.items)
        const currentWorkspace =
          workspaces.find((item) => item.sessionIds.includes(sessionId))?.workspaceId ?? ''
        useEffect(() => model.session(sessionId), [sessionId])
        // biome-ignore lint/correctness/useExhaustiveDependencies: Workspace reassignment must dismiss old content.
        useEffect(() => model.close(), [currentWorkspace])
        return null
      },
    ),
  )
  return model
}
