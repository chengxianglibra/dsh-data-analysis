// @ts-nocheck -- JSX and slot faces are supplied by the DSH client runtime module table.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { CredentialClientModel, credentialMessage } from './model.ts'

const styles = `
.mc-dialog{width:min(850px,calc(100vw - 32px));max-height:85vh;padding:0;border:1px solid #87939b;border-radius:12px;background:var(--dsw-alias-surface-primary,#fff);color:var(--dsw-alias-text-primary,#18242c)}
.mc-dialog::backdrop{background:#0007}.mc-content{padding:24px}.mc-row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.mc-row h2{flex:1;margin:0}.mc-dialog button,.mc-dialog select,.mc-dialog input{font:inherit;padding:8px 10px;border:1px solid #87939b;border-radius:6px;background:transparent;color:inherit}.mc-dialog button{cursor:pointer}.mc-dialog button:disabled{opacity:.5;cursor:default}.mc-dialog input{min-width:200px;max-width:100%;box-sizing:border-box}.mc-dialog fieldset{margin:16px 0;border:1px solid #87939b;border-radius:8px;padding:16px}.mc-note{font-size:12px;opacity:.8}.mc-error{padding:12px;background:#b7541515;white-space:pre-wrap}.mc-dialog pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:180px;overflow:auto}.mc-status{border-left:3px solid #269786;padding-left:12px;margin:16px 0}
`
const statusLabels = {
  'awaiting-input': '等待填写',
  executing: '正在保存或验证',
  'awaiting-decision': '连接验证失败，等待处理',
  succeeded: '验证完成，原调用继续',
  'handed-off': '已交给助手排查',
  'call-ended': '原调用已结束',
  'context-changed': '上下文已变化',
}
function TestResult({ result }) {
  if (!result) return null
  return (
    <div className="mc-status">
      {result.ok ? '连接测试成功' : '连接测试失败'}
      {!result.ok && (
        <>
          <pre>{result.failure?.message}</pre>
          <p>{result.repair?.action}</p>
          <small>{result.failure?.code}</small>
        </>
      )}
    </div>
  )
}
function CredentialForm({ context, request, state, model }) {
  const [values, setValues] = useState({})
  const [editing, setEditing] = useState({})
  const [deleting, setDeleting] = useState('')
  const busy =
    request?.status === 'executing' ||
    state.operations.some(
      (entry) =>
        entry.handle.scope === context.token &&
        !entry.error &&
        (!entry.operation || entry.operation.status === 'running'),
    )
  const ended = request?.endedAt !== undefined
  // biome-ignore lint/correctness/useExhaustiveDependencies: Identity or credential revision changes must discard unsubmitted secrets.
  useEffect(() => {
    setValues({})
    setEditing({})
    setDeleting('')
  }, [context.token, context.version])
  const submit = () => {
    const changes = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ''))
    setValues({})
    setEditing({})
    void model.start(context, request ? 'submit' : 'update', changes)
  }
  return (
    <section>
      <h3>{context.name}</h3>
      <p className="mc-note">
        相同引用在其他 Workspace 中也可能共享。更换或删除后，使用旧凭证等待执行的代码不会启动。
      </p>
      {request && (
        <p role="status">
          {statusLabels[request.status]}。
          {ended
            ? request.status === 'call-ended' || request.status === 'context-changed'
              ? request.status === 'call-ended' || request.status === 'context-changed'
                ? '已保存的值仍保留；需要继续时请重新发起任务。'
                : '凭证配置已完成。'
              : '凭证配置已完成。'
            : '等待受原工具调用与 Code Mode 外层预算限制。'}
        </p>
      )}
      {context.refs.length === 0 && <p>该数据源没有凭证引用，可直接测试连接。</p>}
      {context.refs.map((ref) => {
        const info = context.credentials[ref]
        const shared = state.datasources
          .filter((item) => item.refs.includes(ref))
          .map((item) => item.name)
        return (
          <fieldset key={ref} disabled={busy || ended}>
            <legend>{ref}</legend>
            <p className="mc-note">
              字段：
              {Object.entries(context.fields)
                .filter(([, value]) => value === ref)
                .map(([field]) => field)
                .join('、')}{' '}
              · {info?.configured ? '已配置' : '未配置'} · 来源：{info?.source ?? '无'} ·{' '}
              {info?.writable ? '可更换' : '来源只读'}
            </p>
            {shared.length > 1 && (
              <p className="mc-note">当前列表共享数据源：{shared.join('、')}</p>
            )}
            {info?.writable && (
              <div className="mc-row">
                {!info.configured || editing[ref] ? (
                  <label>
                    新值{' '}
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={values[ref] ?? ''}
                      onChange={(event) => setValues({ ...values, [ref]: event.target.value })}
                    />
                  </label>
                ) : (
                  <button type="button" onClick={() => setEditing({ ...editing, [ref]: true })}>
                    更换
                  </button>
                )}
                {!request && info.configured && (
                  <button type="button" onClick={() => setDeleting(ref)}>
                    删除已保存值
                  </button>
                )}
                {deleting === ref && (
                  <>
                    <span>删除后可能仍由其他来源提供。</span>
                    <button
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
                  </>
                )}
              </div>
            )}
          </fieldset>
        )
      })}
      {context.lastTest && (
        <p className="mc-note">
          上次测试：{new Date(context.lastTest.at).toLocaleString()} ·{' '}
          {context.lastTest.stale ? '配置已变化，请重新测试' : '仅代表该次连接往返'}
        </p>
      )}
      <TestResult result={request?.failure ?? context.lastTest?.result} />
      {!ended && (
        <div className="mc-row">
          <button type="button" disabled={busy} onClick={submit}>
            {request ? '保存并验证后继续' : '保存并验证'}
          </button>
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
            <button type="button" onClick={() => void model.cancelRequest(request.id)}>
              取消本轮
            </button>
          ) : (
            busy && (
              <button type="button" onClick={() => void model.cancelOperation(context.token)}>
                取消操作
              </button>
            )
          )}
        </div>
      )}
    </section>
  )
}
function CredentialPanel({ model, workspaces }) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot)
  const dialog = useRef(null)
  useEffect(() => {
    if (state.open) dialog.current?.showModal()
    else dialog.current?.close()
  }, [state.open])
  const request = state.requests.find((item) => item.id === state.requestId)
  const context =
    request?.context ?? state.datasources.find((item) => item.token === state.selected)
  return (
    <dialog
      ref={dialog}
      className="mc-dialog"
      onCancel={(event) => {
        event.preventDefault()
        model.close()
      }}
      aria-labelledby="marivo-credentials-title"
    >
      <style>{styles}</style>
      <div className="mc-content">
        <div className="mc-row">
          <h2 id="marivo-credentials-title">数据源与凭证</h2>
          <button type="button" onClick={() => model.close()}>
            收起
          </button>
        </div>
        <p className="mc-note">
          凭证由 DSH 保存。页面只展示配置状态，不回显已保存值；收起页面不会取消正在运行的操作。
        </p>
        {!request && (
          <div className="mc-row">
            <label>
              Workspace{' '}
              <select
                value={state.workspaceId}
                onChange={(event) => void model.selectWorkspace(event.target.value)}
              >
                <option value="">请选择</option>
                {workspaces.map((item) => (
                  <option key={item.workspaceId} value={item.workspaceId}>
                    {item.title ?? item.name ?? item.path ?? item.workspaceId}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={state.loading || !state.workspaceId}
              onClick={() => void model.selectWorkspace(state.workspaceId)}
            >
              刷新状态
            </button>
            <select
              aria-label="数据源"
              value={state.selected}
              onChange={(event) => model.select(event.target.value)}
            >
              <option value="">选择数据源</option>
              {state.datasources.map((item) => (
                <option key={item.token} value={item.token}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {state.requests.length > 0 && (
          <div className="mc-row">
            本会话待办：
            {state.requests.map((item) => (
              <button type="button" key={item.id} onClick={() => model.openRequest(item.id)}>
                {item.context.name} · {statusLabels[item.status]}
              </button>
            ))}
          </div>
        )}
        {state.error && (
          <p role="alert" className="mc-error">
            {state.error}
          </p>
        )}
        {state.loading && <p role="status">正在读取数据源与凭证状态…</p>}
        {!request &&
          state.workspaceId &&
          !state.loading &&
          !state.error &&
          state.datasources.length === 0 && <p>该 Workspace 没有已定义的数据源。</p>}
        {state.open && context && (
          <CredentialForm
            key={context.token}
            context={context}
            request={request}
            state={state}
            model={model}
          />
        )}
        {state.operations.length > 1 && (
          <fieldset className="mc-row">
            <legend>凭证操作</legend>
            {state.operations.map((entry) => (
              <button
                type="button"
                key={entry.handle.id}
                aria-pressed={state.handle?.id === entry.handle.id}
                onClick={() => model.selectOperation(entry.handle.id)}
              >
                {entry.name} ·{' '}
                {entry.error
                  ? '状态不可恢复'
                  : entry.operation && entry.operation.status !== 'running'
                    ? '已结束'
                    : '处理中'}
              </button>
            ))}
          </fieldset>
        )}
        {state.operation && (
          <div className="mc-status" role="status">
            <p>{state.operations.find((entry) => entry.handle.id === state.handle?.id)?.name}</p>
            <p>
              {state.operation.status === 'running'
                ? state.operation.phase === 'saving'
                  ? '正在保存'
                  : '正在验证连接'
                : '本次操作已结束'}
            </p>
            {state.operation.status === 'running' && (
              <button type="button" onClick={() => void model.cancelOperation()}>
                取消此操作
              </button>
            )}
            {state.operation.saved.length > 0 && (
              <p>
                已保存变更：{state.operation.saved.join('、')}。连接验证失败或取消不会回滚已保存值。
              </p>
            )}
            {state.operation.errors.length > 0 && (
              <p className="mc-error">{state.operation.errors.map(credentialMessage).join(' ')}</p>
            )}
            <TestResult
              result={state.operation.scope !== context?.token ? state.operation.result : undefined}
            />
          </div>
        )}
      </div>
    </dialog>
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
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register(
      { name: 'sidebar.footer.action', id: 'marivo-credentials', order: 110 },
      function Entry({ wide, useSessions, useWorkspaces }) {
        const sessionId = useSessions((state) => state.current) ?? ''
        const workspaces = useWorkspaces((state) => state.items)
        useEffect(() => model.session(sessionId), [sessionId])
        const selected =
          workspaces.find((item) => item.sessionIds.includes(sessionId))?.workspaceId ?? ''
        return (
          <button
            type="button"
            aria-label="打开数据源与凭证"
            title="数据源与凭证"
            onClick={() => model.show(selected)}
          >
            {wide ? '数据源与凭证' : '⚿'}
          </button>
        )
      },
    ),
  )
  ctx.slots.inject('conversation.session.header.actions', () =>
    ctx.slots.register(
      { name: 'conversation.session.header.actions', id: 'marivo-credential-requests', order: 110 },
      function Pending({ sessionId }) {
        const state = useSyncExternalStore(model.subscribe, model.getSnapshot)
        const request = state.requests.find(
          (item) => item.sessionId === sessionId && item.endedAt === undefined,
        )
        return request ? (
          <button type="button" onClick={() => model.openRequest(request.id)}>
            等待配置凭证
          </button>
        ) : null
      },
    ),
  )
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      { name: 'shell.overlay', id: 'marivo-credentials' },
      function Overlay({ useWorkspaces }) {
        return <CredentialPanel model={model} workspaces={useWorkspaces((state) => state.items)} />
      },
    ),
  )
}
