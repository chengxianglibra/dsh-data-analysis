// @ts-nocheck -- JSX is bundled by the plugin client build.
import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { refKey } from '../../semantic-reference/contracts.ts'
import { ComputationCard } from './computation.tsx'
import { ObjectGraph } from './graph.tsx'
import { fieldLabels, kindLabels } from './labels.ts'
import { countObjectsByKind, emptyView, filterObjects, PAGE_SIZE } from './model.ts'
import { browserStyles } from './styles.ts'

function Fields({ fields }) {
  return (
    <dl className="sb-fields">
      {fields.map((field, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: Immutable snapshot fields may repeat by calendar level and carry no component state.
        <Fragment key={`${field.name}/${i}`}>
          <dt title={field.name}>{fieldLabels[field.name] ?? field.name}</dt>
          <dd>{field.value || '—'}</dd>
        </Fragment>
      ))}
    </dl>
  )
}

function ObjectDetail({
  object,
  objects,
  view,
  model,
  navigate,
  onAsk,
  questionPending,
  questionNotice,
}) {
  const [notice, setNotice] = useState('')
  const [graph, setGraph] = useState(false)
  useEffect(
    () => setNotice(questionPending ? '' : (questionNotice ?? '')),
    [questionNotice, questionPending],
  )
  const key = refKey(object.ref)
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text)
      setNotice('已复制')
    } catch {
      setNotice('复制失败，请手动选择文字复制。')
    }
  }
  const source = `${object.source.file}${object.source.line ? `:${object.source.line}` : ''}`
  const representedFields = new Set([
    'unit',
    'metric_type',
    'aggregation',
    'aggregation_target',
    'aggregation_target_kind',
    'measure',
    'filter',
    'weighted_mean_value',
    'weighted_mean_weight',
    'composition',
    'components',
    'linear_terms',
    'effective_entities',
    'entity',
    'fold',
    'status_time_dimension',
    'candidate_dimensions',
    'candidate_time_dimensions',
    'measure_lineage',
    'required_relationships',
  ])
  const definitionFields = object.fields.filter(
    (field) => field.value && (!object.computation || !representedFields.has(field.name)),
  )
  return (
    <>
      <div className="sb-actions">
        <button
          type="button"
          className="sb-back-list"
          onClick={() => model.patch({ selected: '' })}
        >
          返回列表
        </button>
        <button type="button" disabled={!view.history.length} onClick={() => model.back()}>
          返回上个对象
        </button>
        <button type="button" onClick={() => copy(key)}>
          复制引用
        </button>
        <button
          type="button"
          disabled={!onAsk || questionPending}
          onClick={onAsk}
          title={!onAsk ? '当前页面没有可用的所属会话输入框' : undefined}
        >
          {questionPending ? '正在加入…' : '加入提问'}
        </button>
        <span role="status" className="sb-muted">
          {notice}
        </span>
      </div>
      <span className="sb-badge">{kindLabels[object.ref.kind] ?? object.ref.kind}</span>
      <h2>{object.name}</h2>
      <div className="sb-ref">{key}</div>
      <nav className="sb-tabs" aria-label="对象详情分类">
        {[
          ['overview', '概览'],
          ['definition', '定义'],
          ['relations', '关系'],
        ].map(([tab, label]) => (
          <button
            type="button"
            key={tab}
            aria-pressed={view.tab === tab}
            onClick={() => model.patch({ tab })}
          >
            {label}
          </button>
        ))}
      </nav>
      {view.tab === 'overview' && (
        <>
          <h3>业务定义</h3>
          <p>{object.definition || '未填写业务定义'}</p>
          <Fields
            fields={[
              { name: 'domain', value: object.domain ?? '未指定业务域' },
              ...object.fields.filter((field) =>
                [
                  'unit',
                  'metric_type',
                  'entity',
                  'datasource',
                  'backend_type',
                  'owner',
                  'granularity',
                  'additivity',
                ].includes(field.name),
              ),
            ]}
          />
          {!!object.guardrails.length && (
            <>
              <h3>使用约束</h3>
              <ul>
                {[...new Set(object.guardrails)].map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      {view.tab === 'definition' && (
        <>
          {object.computation && (
            <ComputationCard object={object} objects={objects} navigate={(key) => navigate(key)} />
          )}
          {!!definitionFields.length && (
            <section aria-label="补充属性">
              <h3>{object.computation ? '补充属性' : '语义属性'}</h3>
              <Fields fields={definitionFields} />
            </section>
          )}
          <h3>定义位置</h3>
          <p className="sb-ref">{source}</p>
          <p className="sb-ref">{object.source.symbol}</p>
          {object.ref.kind === 'datasource' && (
            <p className="sb-muted">此处仅展示数据源类型，不展示连接配置或凭证。</p>
          )}
          {object.ref.kind === 'entity' && (
            <p className="sb-muted">文件来源仅展示类型；文件地址与请求配置不在此页面披露。</p>
          )}
        </>
      )}
      {view.tab === 'relations' && (
        <>
          <p className="sb-muted">Catalog 声明的对象关系。候选维度不代表任意查询组合已通过验证。</p>
          <button type="button" aria-pressed={graph} onClick={() => setGraph((x) => !x)}>
            {graph ? '收起关系图' : '查看关系图'}
          </button>
          {graph && (
            <ObjectGraph object={object} objects={objects} navigate={(next) => navigate(next)} />
          )}
          {!object.relations.length && <p>没有声明关联对象。</p>}
          <ul className="sb-relation-list">
            {object.relations.map((relation) => {
              const target = refKey(relation.ref),
                related = objects.get(target)
              return (
                <li key={`${relation.field}/${target}`}>
                  <span className="sb-muted">{fieldLabels[relation.field] ?? relation.field}</span>
                  <button
                    type="button"
                    disabled={!related}
                    title={target}
                    onClick={() => navigate(target)}
                  >
                    {related?.name ?? target}
                  </button>
                  <span className="sb-ref">
                    {target}
                    {!related ? ' · 当前目录未包含此对象' : ''}
                  </span>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </>
  )
}

export function SemanticBrowserPanel({
  model,
  workspaces,
  workspacePhase = 'ready',
  workspaceError = false,
  onOpenObject,
  onAsk,
}) {
  const navigate = (key) => model.navigate(key)
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot)
  const panel = useRef(null)
  const view = state.views[state.workspaceId] ?? emptyView()
  const snapshot = view.snapshot
  const objects = useMemo(
    () => new Map((snapshot?.objects ?? []).map((item) => [refKey(item.ref), item])),
    [snapshot],
  )
  const filtered = useMemo(() => filterObjects(snapshot?.objects ?? [], view), [snapshot, view])
  const counts = useMemo(
    () => countObjectsByKind(snapshot?.objects ?? [], view.domain),
    [snapshot, view.domain],
  )
  const page = Math.min(view.page, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1))
  const selected = objects.get(view.selected)
  useEffect(() => {
    if (state.open && state.fromReport && snapshot && view.selected)
      panel.current
        ?.querySelector('.sb-objects [aria-pressed="true"]')
        ?.scrollIntoView({ block: 'nearest' })
  }, [state.open, state.fromReport, snapshot, view.selected])
  const knownWorkspace = workspaces.some((item) => item.workspaceId === state.workspaceId)
  useEffect(() => {
    if (
      state.open &&
      state.workspaceId &&
      workspacePhase === 'ready' &&
      !knownWorkspace &&
      !workspaceError
    )
      model.unavailable()
  }, [state.open, state.workspaceId, knownWorkspace, workspacePhase, workspaceError, model])
  const domains = [
    ...new Set((snapshot?.objects ?? []).map((item) => item.domain).filter(Boolean)),
  ].sort()
  const kinds = (snapshot?.kinds ?? []).filter((kind) =>
    snapshot.objects.some((item) => item.ref.kind === kind),
  )
  if (!state.open) return null
  return (
    <section ref={panel} className="sb-panel" aria-label="语义层对象浏览器">
      <style>{browserStyles}</style>
      <div className="sb-shell">
        <header className="sb-header">
          <h1>语义层</h1>
          {snapshot && (
            <time className="sb-updated" dateTime={snapshot.loadedAt}>
              更新于 {new Date(snapshot.loadedAt).toLocaleString()}
            </time>
          )}
          <button
            className="sb-refresh"
            type="button"
            aria-label="刷新语义层"
            title="刷新语义层"
            disabled={!state.workspaceId || !knownWorkspace || workspaceError || view.loading}
            onClick={() => void model.refresh()}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M20 7v5h-5M4 17v-5h5" />
              <path d="M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 17.9 17" />
            </svg>
          </button>
        </header>
        {state.fromReport && (
          <p className="sb-status">此处展示当前语义定义；报告数据与来源仍是生成时的快照。</p>
        )}
        {workspaceError && (
          <div role="alert" className="sb-status">
            Workspace 列表暂不可用，请检查 Host 连接。
          </div>
        )}
        {view.loading && (
          <div role="status" className="sb-status">
            正在读取语义层对象…{snapshot ? '当前仍显示上次加载内容。' : ''}
          </div>
        )}
        {view.error && (
          <div role="alert" className="sb-status">
            {view.error}
            {snapshot ? ' 当前显示上次成功加载的内容。' : ''}
          </div>
        )}
        {!state.workspaceId ? (
          <div className="sb-empty">
            {workspacePhase !== 'ready'
              ? '正在读取 Workspace 列表…'
              : '当前会话未绑定 Workspace，请返回会话后重试。'}
          </div>
        ) : !snapshot ? (
          <div className="sb-empty">{view.loading ? '正在加载对象目录' : '尚未加载对象目录'}</div>
        ) : !snapshot.objects.length && !view.selected ? (
          <div className="sb-empty">当前项目没有语义层对象。</div>
        ) : (
          <div className={`sb-columns ${view.selected ? 'sb-has-selection' : ''}`}>
            <nav className="sb-nav" aria-label="对象分类">
              <label className="sb-domain">
                业务域
                <select
                  aria-label="筛选业务域"
                  value={view.domain}
                  onChange={(event) => model.patch({ domain: event.target.value, page: 0 })}
                >
                  <option value="">全部业务域</option>
                  {domains.map((domain) => (
                    <option key={domain}>{domain}</option>
                  ))}
                </select>
              </label>
              <div className="sb-kinds">
                <button
                  type="button"
                  aria-pressed={!view.kind}
                  onClick={() => model.patch({ kind: '', page: 0 })}
                >
                  全部对象 <span>{counts.total}</span>
                </button>
                {kinds.map((kind) => (
                  <button
                    type="button"
                    key={kind}
                    aria-pressed={view.kind === kind}
                    onClick={() => model.patch({ kind, page: 0 })}
                  >
                    {kindLabels[kind] ?? kind}
                    <span>{counts.byKind.get(kind) ?? 0}</span>
                  </button>
                ))}
              </div>
            </nav>
            <section className="sb-list" aria-label="对象列表">
              <input
                className="sb-search"
                aria-label="搜索语义对象"
                placeholder="搜索名称、引用、业务定义"
                value={view.query}
                onChange={(event) => model.patch({ query: event.target.value, page: 0 })}
              />
              <p className="sb-count">{filtered.length} 个对象</p>
              {!filtered.length && <p>没有匹配对象，请调整搜索或筛选条件。</p>}
              <ul className="sb-objects">
                {filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((item) => (
                  <li key={refKey(item.ref)}>
                    <button
                      type="button"
                      aria-pressed={view.selected === refKey(item.ref)}
                      onClick={() => navigate(refKey(item.ref))}
                    >
                      <span className="sb-object-title">
                        <strong>{item.name}</strong>
                        <span className="sb-badge">
                          {kindLabels[item.ref.kind] ?? item.ref.kind}
                        </span>
                      </span>
                      <span className="sb-summary">{item.definition || '未填写业务定义'}</span>
                      <span className="sb-ref">{refKey(item.ref)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {filtered.length > PAGE_SIZE && (
                <div className="sb-pager">
                  <button
                    type="button"
                    disabled={!page}
                    onClick={() => model.patch({ page: page - 1 })}
                  >
                    上一页
                  </button>
                  <span>
                    {page + 1} / {Math.ceil(filtered.length / PAGE_SIZE)}
                  </span>
                  <button
                    type="button"
                    disabled={(page + 1) * PAGE_SIZE >= filtered.length}
                    onClick={() => model.patch({ page: page + 1 })}
                  >
                    下一页
                  </button>
                </div>
              )}
            </section>
            <section className="sb-detail" aria-label="对象详情">
              {selected && onOpenObject && (
                <button type="button" onClick={() => onOpenObject(selected.ref)}>
                  在独立标签页打开
                </button>
              )}
              {selected ? (
                <ObjectDetail
                  key={`${snapshot.fingerprint}/${view.selected}`}
                  onAsk={!view.loading && !view.error && !workspaceError ? onAsk : undefined}
                  questionPending={state.questionPending}
                  questionNotice={state.questionNotice}
                  object={selected}
                  objects={objects}
                  view={view}
                  model={model}
                  navigate={navigate}
                />
              ) : (
                <div className="sb-empty">
                  {view.selected ? (
                    <>
                      <p>所选对象已不在当前 Catalog 中，请重新选择。</p>
                      <p>{view.selected}</p>
                      <button type="button" onClick={() => model.patch({ selected: '' })}>
                        返回列表
                      </button>
                    </>
                  ) : (
                    '选择一个对象，查看业务定义与关联。'
                  )}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </section>
  )
}
