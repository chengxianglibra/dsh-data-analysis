// @ts-nocheck -- JSX is bundled by the plugin client build.

import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { refKey } from '../../semantic-reference/contracts.ts'
import { useCopy } from './../i18n/context.tsx'
import { ComputationCard } from './computation.tsx'
import { ObjectGraph } from './graph.tsx'
import { fieldLabels, kindLabels } from './labels.ts'
import { countObjectsByKind, emptyView, filterObjects, PAGE_SIZE } from './model.ts'
import { FieldValue } from './reference-link.tsx'
import { browserStyles } from './styles.ts'

function Fields({ fields, object, objects, navigate }) {
  const t = useCopy()

  return (
    <dl className="sb-fields">
      {fields.map((field, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: Immutable snapshot fields may repeat by calendar level and carry no component state.
        <Fragment key={`${field.name}/${i}`}>
          <dt title={field.name}>{t(fieldLabels[field.name] ?? field.name)}</dt>
          <dd>
            <FieldValue field={field} object={object} objects={objects} navigate={navigate} />
          </dd>
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
  const t = useCopy()

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
      setNotice('marivo.presentation.copied')
    } catch {
      setNotice('marivo.semantic.copy-failed-select-the-text-to-copy-manually')
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
          {t('marivo.semantic.back-to-list')}
        </button>
        <button type="button" disabled={!view.history.length} onClick={() => model.back()}>
          {t('marivo.semantic.back-to-previous-object')}
        </button>
        <button type="button" onClick={() => copy(key)}>
          {t('marivo.semantic.copy-reference')}
        </button>
        <button
          type="button"
          disabled={!onAsk || questionPending}
          onClick={onAsk}
          title={
            !onAsk
              ? t('marivo.semantic.no-input-is-available-for-the-session-owning-this')
              : undefined
          }
        >
          {questionPending ? t('marivo.semantic.adding') : t('marivo.semantic.add-to-question')}
        </button>
        <span role="status" className="sb-muted">
          {t(notice)}
        </span>
      </div>
      <span className="sb-badge">{t(kindLabels[object.ref.kind] ?? object.ref.kind)}</span>
      <h2>{object.name}</h2>
      <div className="sb-ref">{key}</div>
      <nav className="sb-tabs" aria-label={t('marivo.semantic.object-detail-categories')}>
        {[
          ['overview', t('marivo.semantic.overview')],
          ['definition', t('marivo.semantic.definition')],
          ['relations', t('marivo.semantic.relationships-692')],
        ].map(([tab, label]) => (
          <button
            type="button"
            key={tab}
            aria-pressed={view.tab === tab}
            onClick={() => model.patch({ tab })}
          >
            {t(label)}
          </button>
        ))}
      </nav>
      {view.tab === 'overview' && (
        <>
          <h3>{t('marivo.semantic.business-definition')}</h3>
          <p>{object.definition || t('marivo.semantic.no-business-definition')}</p>
          <Fields
            object={object}
            objects={objects}
            navigate={navigate}
            fields={[
              { name: 'domain', value: object.domain ?? t('marivo.semantic.no-domain-specified') },
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
              <h3>{t('marivo.semantic.usage-constraints')}</h3>
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
            <section aria-label={t('marivo.semantic.additional-properties')}>
              <h3>
                {object.computation
                  ? t('marivo.semantic.additional-properties')
                  : t('marivo.semantic.semantic-properties')}
              </h3>
              <Fields
                fields={definitionFields}
                object={object}
                objects={objects}
                navigate={navigate}
              />
            </section>
          )}
          <h3>{t('marivo.semantic.definition-location')}</h3>
          <p className="sb-ref">{source}</p>
          <p className="sb-ref">{object.source.symbol}</p>
          {object.ref.kind === 'datasource' && (
            <p className="sb-muted">
              {t('marivo.semantic.only-the-datasource-type-is-shown-here-without-connection')}
            </p>
          )}
          {object.ref.kind === 'entity' && (
            <p className="sb-muted">
              {t('marivo.semantic.file-sources-show-only-their-type-file-addresses-and')}
            </p>
          )}
        </>
      )}
      {view.tab === 'relations' && (
        <>
          <p className="sb-muted">
            {t(
              'marivo.semantic.catalog-declared-relationships-candidate-dimensions-do-not-mean-every',
            )}
          </p>
          <button type="button" aria-pressed={graph} onClick={() => setGraph((x) => !x)}>
            {graph ? t('marivo.semantic.collapse-graph') : t('marivo.semantic.view-graph')}
          </button>
          {graph && (
            <ObjectGraph object={object} objects={objects} navigate={(next) => navigate(next)} />
          )}
          {!object.relations.length && <p>{t('marivo.semantic.no-relationships-declared')}</p>}
          <ul className="sb-relation-list">
            {object.relations.map((relation) => {
              const target = refKey(relation.ref),
                related = objects.get(target)
              return (
                <li key={`${relation.field}/${target}`}>
                  <span className="sb-muted">
                    {t(fieldLabels[relation.field] ?? relation.field)}
                  </span>
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
                    {!related ? t('marivo.semantic.object-not-included-in-this-catalog') : ''}
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
  onAsk,
}) {
  const t = useCopy()

  const navigate = (key) => model.navigate(key)
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot)
  const panel = useRef(null)
  const view = state.views[state.workspaceId] ?? emptyView()
  const snapshot = view.snapshot
  const objects = useMemo(
    () => new Map((snapshot?.objects ?? []).map((item) => [refKey(item.ref), item])),
    [snapshot],
  )
  const filtered = useMemo(
    () => filterObjects(snapshot?.objects ?? [], view, t.locale),
    [snapshot, view, t.locale],
  )
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
    <section
      ref={panel}
      className="sb-panel"
      aria-label={t('marivo.semantic.semantic-object-browser')}
    >
      <style>{browserStyles}</style>
      <div className="sb-shell">
        <header className="sb-header">
          <h1>{t('marivo.navigation.semantic-layer')}</h1>
          {snapshot && (
            <time className="sb-updated" dateTime={snapshot.loadedAt}>
              {t('marivo.semantic.updated')}
              {new Date(snapshot.loadedAt).toLocaleString(t.locale)}
            </time>
          )}
          <button
            className="sb-refresh"
            type="button"
            aria-label={t('marivo.semantic.refresh-semantic-layer')}
            title={t('marivo.semantic.refresh-semantic-layer')}
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
          <p className="sb-status">
            {t('marivo.semantic.current-semantic-definitions-are-shown-here-report-data-and')}
          </p>
        )}
        {workspaceError && (
          <div role="alert" className="sb-status">
            {t('marivo.semantic.workspace-list-unavailable-check-the-host-connection')}
          </div>
        )}
        {view.loading && (
          <div role="status" className="sb-status">
            {t('marivo.semantic.loading-semantic-objects')}
            {snapshot ? t('marivo.semantic.previously-loaded-content-is-still-shown') : ''}
          </div>
        )}
        {view.error && (
          <div role="alert" className="sb-status">
            {t(view.error)}
            {snapshot ? t('marivo.semantic.previously-loaded-content-is-still-shown-714') : ''}
          </div>
        )}
        {!state.workspaceId ? (
          <div className="sb-empty">
            {workspacePhase !== 'ready'
              ? t('marivo.semantic.loading-workspaces')
              : t('marivo.semantic.this-session-has-no-workspace-return-to-the-session')}
          </div>
        ) : !snapshot ? (
          <div className="sb-empty">
            {view.loading
              ? t('marivo.semantic.loading-object-catalog')
              : t('marivo.semantic.object-catalog-not-loaded')}
          </div>
        ) : !snapshot.objects.length && !view.selected ? (
          <div className="sb-empty">
            {t('marivo.semantic.this-project-has-no-semantic-objects')}
          </div>
        ) : (
          <div className={`sb-columns ${view.selected ? 'sb-has-selection' : ''}`}>
            <nav className="sb-nav" aria-label={t('marivo.semantic.object-categories')}>
              <label className="sb-domain">
                {t('marivo.semantic.domain')}
                <select
                  aria-label={t('marivo.semantic.filter-domains')}
                  value={view.domain}
                  onChange={(event) => model.patch({ domain: event.target.value, page: 0 })}
                >
                  <option value="">{t('marivo.semantic.all-domains')}</option>
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
                  {t('marivo.semantic.all-objects')}
                  <span>{counts.total}</span>
                </button>
                {kinds.map((kind) => (
                  <button
                    type="button"
                    key={kind}
                    aria-pressed={view.kind === kind}
                    onClick={() => model.patch({ kind, page: 0 })}
                  >
                    {t(kindLabels[kind] ?? kind)}
                    <span>{counts.byKind.get(kind) ?? 0}</span>
                  </button>
                ))}
              </div>
            </nav>
            <section className="sb-list" aria-label={t('marivo.semantic.object-list')}>
              <input
                className="sb-search"
                aria-label={t('marivo.semantic.search-semantic-objects')}
                placeholder={t('marivo.semantic.search-names-references-and-business-definitions')}
                value={view.query}
                onChange={(event) => model.patch({ query: event.target.value, page: 0 })}
              />
              <p className="sb-count">
                {filtered.length} {t('marivo.semantic.objects')}
              </p>
              {!filtered.length && (
                <p>{t('marivo.semantic.no-matching-objects-adjust-the-search-or-filters')}</p>
              )}
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
                          {t(kindLabels[item.ref.kind] ?? item.ref.kind)}
                        </span>
                      </span>
                      <span className="sb-summary">
                        {item.definition || t('marivo.semantic.no-business-definition')}
                      </span>
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
                    {t('marivo.presentation.previous-page')}
                  </button>
                  <span>
                    {page + 1} / {Math.ceil(filtered.length / PAGE_SIZE)}
                  </span>
                  <button
                    type="button"
                    disabled={(page + 1) * PAGE_SIZE >= filtered.length}
                    onClick={() => model.patch({ page: page + 1 })}
                  >
                    {t('marivo.presentation.next-page')}
                  </button>
                </div>
              )}
            </section>
            <section className="sb-detail" aria-label={t('marivo.semantic.object-details')}>
              {selected ? (
                <ObjectDetail
                  key={`${snapshot.fingerprint}/${view.selected}`}
                  onAsk={!view.loading && !view.error && !workspaceError ? onAsk : undefined}
                  questionPending={state.questionPending}
                  questionNotice={t(state.questionNotice)}
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
                      <p>{t('marivo.semantic.the-selected-object-is-no-longer-in-this-catalog')}</p>
                      <p>{view.selected}</p>
                      <button type="button" onClick={() => model.patch({ selected: '' })}>
                        {t('marivo.semantic.back-to-list')}
                      </button>
                    </>
                  ) : (
                    t('marivo.semantic.select-an-object-to-view-its-business-definition-and')
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
