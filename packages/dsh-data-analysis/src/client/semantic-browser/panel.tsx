// @ts-nocheck -- JSX is bundled by the plugin client build.

import {
  ArrowLeftIcon,
  BoxIcon,
  CalendarDaysIcon,
  ChevronDownIcon,
  Clock3Icon,
  Columns3Icon,
  CopyIcon,
  DatabaseIcon,
  FolderIcon,
  HashIcon,
  InfoIcon,
  KeyRoundIcon,
  Layers2Icon,
  Link2Icon,
  PlusIcon,
  RulerIcon,
  SearchIcon,
  Share2Icon,
  Table2Icon,
  TagIcon,
  TerminalIcon,
  UserRoundIcon,
} from 'lucide-react'
import { Fragment, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { refKey } from '../../semantic-reference/contracts.ts'
import { useCopy } from './../i18n/context.tsx'
import { Button } from '../ui/controls.tsx'
import { Alert, AlertDescription } from '../ui/primitives/alert.tsx'
import { Badge } from '../ui/primitives/badge.tsx'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../ui/primitives/card.tsx'
import { Empty, EmptyDescription } from '../ui/primitives/empty.tsx'
import { Field, FieldLabel } from '../ui/primitives/field.tsx'
import { Input } from '../ui/primitives/input.tsx'
import { NativeSelect } from '../ui/primitives/native-select.tsx'
import { TabsContent, TabsList, Tabs as TabsRoot, TabsTrigger } from '../ui/primitives/tabs.tsx'
import { ToggleGroup, ToggleGroupItem } from '../ui/primitives/toggle-group.tsx'
import { UIStyleSheet } from '../ui/theme.ts'
import { ComputationCard } from './computation.tsx'
import { ObjectGraph } from './graph.tsx'
import { fieldLabels, kindLabels } from './labels.ts'
import { countObjectsByKind, emptyView, filterObjects, PAGE_SIZE } from './model.ts'
import { FieldValue } from './reference-link.tsx'
import { browserStyles } from './styles.ts'

// The overview highlights declared facts needed to understand each kind. The
// definition tab retains the complete Catalog projection.
const overviewFields = {
  domain: ['owner', 'default'],
  datasource: ['backend_type'],
  entity: [
    'datasource',
    'source_kind',
    'source_table',
    'source_database',
    'primary_key',
    'default_time',
    'versioning',
  ],
  dimension: ['entity', 'unit', 'additivity', 'default_time', 'parse', 'sample_interval'],
  measure: ['entity', 'unit', 'additivity', 'default_time', 'parse', 'sample_interval'],
  time_dimension: ['entity', 'parse', 'is_default_time', 'sample_interval'],
  metric: ['roots', 'unit'],
  relationship: ['from_entity', 'to_entity', 'keys', 'cardinality'],
  period_calendar: ['date', 'boundary_timezone', 'coverage'],
  temporal_set: ['occurrence_id', 'start', 'end', 'category', 'boundary_timezone', 'coverage'],
}

const kindIcons = {
  domain: FolderIcon,
  datasource: DatabaseIcon,
  entity: Table2Icon,
  dimension: Columns3Icon,
  measure: RulerIcon,
  time_dimension: Clock3Icon,
  metric: HashIcon,
  relationship: Link2Icon,
  period_calendar: CalendarDaysIcon,
  temporal_set: CalendarDaysIcon,
}

const overviewFieldIcons = {
  domain: Layers2Icon,
  roots: BoxIcon,
  entity: BoxIcon,
  datasource: DatabaseIcon,
  backend_type: DatabaseIcon,
  source_kind: DatabaseIcon,
  source_table: Table2Icon,
  source_database: DatabaseIcon,
  primary_key: KeyRoundIcon,
  owner: UserRoundIcon,
  unit: TagIcon,
  default_time: Clock3Icon,
  is_default_time: Clock3Icon,
  date: CalendarDaysIcon,
  boundary_timezone: Clock3Icon,
  coverage: CalendarDaysIcon,
  sample_interval: Clock3Icon,
  from_entity: BoxIcon,
  to_entity: BoxIcon,
  keys: KeyRoundIcon,
  cardinality: Link2Icon,
  occurrence_id: KeyRoundIcon,
  start: Clock3Icon,
  end: Clock3Icon,
  category: TagIcon,
}

function OverviewFields({ fields, object, objects, navigate }) {
  const t = useCopy()
  return (
    <dl className="sb-overview-fields">
      {fields.map((field, index) => {
        const Icon = overviewFieldIcons[field.name] ?? Layers2Icon
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: Snapshot fields may repeat and do not contain component state.
          <div className="sb-overview-row" key={`${field.name}/${index}`}>
            <dt className="sb-overview-key" title={field.name}>
              <Icon className="sb-overview-icon" aria-hidden="true" />
              <span>{t(fieldLabels[field.name] ?? field.name)}</span>
            </dt>
            <dd className="sb-overview-value">
              <FieldValue field={field} object={object} objects={objects} navigate={navigate} />
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

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
  const KindIcon = kindIcons[object.ref.kind] ?? BoxIcon
  const definitionFields = object.fields.filter(
    (field) => field.value && !(object.computation && field.name === 'dependencies'),
  )
  const overviewNames = overviewFields[object.ref.kind] ?? []
  const summaryFields = overviewNames.flatMap((name) =>
    object.fields.filter((field) => field.name === name && field.value),
  )
  if (object.ref.kind !== 'domain' && object.ref.kind !== 'datasource') {
    summaryFields.unshift({
      name: 'domain',
      value: object.domain ?? t('marivo.semantic.no-domain-specified'),
    })
  }
  const relationGroups = new Map()
  for (const relation of object.relations) {
    const group = relationGroups.get(relation.field) ?? []
    group.push(relation)
    relationGroups.set(relation.field, group)
  }
  return (
    <Card>
      <CardContent className="sb-detail-content">
        <div className="sb-detail-navigation">
          <Button
            variant="outline"
            type="button"
            className="sb-back-list"
            onClick={() => model.patch({ selected: '' })}
          >
            <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
            {t('marivo.semantic.back-to-list')}
          </Button>
          {!!view.history.length && (
            <Button variant="ghost" type="button" onClick={() => model.back()}>
              <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
              {t('marivo.semantic.back-to-previous-object')}
            </Button>
          )}
        </div>
        <div className="sb-detail-top">
          <div className="sb-detail-identity">
            <span
              className="sb-kind-icon"
              role="img"
              aria-label={t(kindLabels[object.ref.kind] ?? object.ref.kind)}
            >
              <KindIcon aria-hidden="true" />
            </span>
            <CardHeader className="sb-identity-text">
              <CardTitle role="heading" aria-level={2}>
                {object.name}
              </CardTitle>
              <CardDescription className="sb-ref">{key}</CardDescription>
            </CardHeader>
          </div>
          <div className="sb-detail-actions">
            <Button variant="outline" type="button" onClick={() => copy(key)}>
              <CopyIcon data-icon="inline-start" aria-hidden="true" />
              {t('marivo.semantic.copy-reference')}
            </Button>
            <Button
              type="button"
              disabled={!onAsk || questionPending}
              onClick={onAsk}
              title={
                !onAsk
                  ? t('marivo.semantic.no-input-is-available-for-the-session-owning-this')
                  : undefined
              }
            >
              <PlusIcon data-icon="inline-start" aria-hidden="true" />
              {questionPending ? t('marivo.semantic.adding') : t('marivo.semantic.add-to-question')}
            </Button>
          </div>
        </div>
        <span role="status" className="sb-muted">
          {t(notice)}
        </span>
        <TabsRoot
          value={view.tab}
          onValueChange={(tab) => model.patch({ tab })}
          activationMode="manual"
        >
          <TabsList
            variant="line"
            className="sb-tabs"
            aria-label={t('marivo.semantic.object-detail-categories')}
          >
            {[
              ['overview', t('marivo.semantic.overview')],
              ['definition', t('marivo.semantic.definition')],
              ['relations', t('marivo.semantic.relationships-692')],
            ].map(([tab, label]) => (
              <TabsTrigger key={tab} value={tab}>
                {t(label)}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent
            value="overview"
            forceMount
            hidden={view.tab !== 'overview'}
            tabIndex={view.tab === 'overview' ? 0 : -1}
          >
            <div className="sb-overview">
              <section className="sb-overview-section">
                <h3>{t('marivo.semantic.business-definition')}</h3>
                <p className="sb-overview-description">
                  {object.definition || t('marivo.semantic.no-business-definition')}
                </p>
              </section>
              {!!summaryFields.length && (
                <section className="sb-overview-section">
                  <h3>{t('marivo.semantic.core-properties')}</h3>
                  <OverviewFields
                    object={object}
                    objects={objects}
                    navigate={navigate}
                    fields={summaryFields}
                  />
                </section>
              )}
              {!!object.guardrails.length && (
                <section className="sb-overview-section">
                  <h3>{t('marivo.semantic.usage-constraints')}</h3>
                  <ul className="sb-overview-guardrails">
                    {[...new Set(object.guardrails)].map((text) => (
                      <li key={text}>{text}</li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </TabsContent>
          <TabsContent
            value="definition"
            forceMount
            hidden={view.tab !== 'definition'}
            tabIndex={view.tab === 'definition' ? 0 : -1}
          >
            {object.computation && (
              <ComputationCard
                object={object}
                objects={objects}
                navigate={(key) => navigate(key)}
              />
            )}
            {!object.computation && !!definitionFields.length && (
              <section aria-label={t('marivo.semantic.additional-properties')}>
                <h3>{t('marivo.semantic.semantic-properties')}</h3>
                <Fields
                  fields={definitionFields}
                  object={object}
                  objects={objects}
                  navigate={navigate}
                />
              </section>
            )}
            {(source ||
              object.source.symbol ||
              (object.computation && definitionFields.length)) && (
              <details className="sb-source">
                <summary>
                  <TerminalIcon className="sb-fact-icon" aria-hidden="true" />
                  <span>
                    {t(
                      object.computation
                        ? 'marivo.semantic.properties-and-source'
                        : 'marivo.semantic.definition-location',
                    )}
                  </span>
                  <ChevronDownIcon className="sb-disclosure-icon" aria-hidden="true" />
                </summary>
                <div className="sb-source-content">
                  {object.computation && !!definitionFields.length && (
                    <section aria-label={t('marivo.semantic.additional-properties')}>
                      <h3>{t('marivo.semantic.additional-properties')}</h3>
                      <Fields
                        fields={definitionFields}
                        object={object}
                        objects={objects}
                        navigate={navigate}
                      />
                    </section>
                  )}
                  {(source || object.source.symbol) && object.computation && (
                    <h3>{t('marivo.semantic.definition-location')}</h3>
                  )}
                  {source && <p className="sb-ref">{source}</p>}
                  {object.source.symbol && <p className="sb-ref">{object.source.symbol}</p>}
                </div>
              </details>
            )}
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
          </TabsContent>
          <TabsContent
            value="relations"
            forceMount
            hidden={view.tab !== 'relations'}
            tabIndex={view.tab === 'relations' ? 0 : -1}
          >
            <div className="sb-relations">
              <Alert className="sb-relations-note" role="note">
                <InfoIcon className="sb-relations-note-icon" aria-hidden="true" />
                <div className="sb-relations-note-copy">
                  <strong>{t('marivo.semantic.declared-relations-title')}</strong>
                  <AlertDescription>
                    {t(
                      'marivo.semantic.catalog-declared-relationships-candidate-dimensions-do-not-mean-every',
                    )}
                  </AlertDescription>
                </div>
                {!!object.relations.length && (
                  <Button
                    className="sb-relations-graph-action"
                    variant="outline"
                    type="button"
                    aria-pressed={graph}
                    onClick={() => setGraph((x) => !x)}
                  >
                    <Share2Icon data-icon="inline-start" aria-hidden="true" />
                    {graph ? t('marivo.semantic.collapse-graph') : t('marivo.semantic.view-graph')}
                  </Button>
                )}
              </Alert>
              {!!object.relations.length && graph && (
                <ObjectGraph
                  object={object}
                  objects={objects}
                  navigate={(next) => navigate(next)}
                />
              )}
              <h3 className="sb-relations-heading">
                {t('marivo.semantic.relationship-groups-title')}
              </h3>
              {!object.relations.length && <p>{t('marivo.semantic.no-relationships-declared')}</p>}
              {[...relationGroups].map(([field, relations]) => (
                <details className="sb-relation-group" key={field} open={relations.length <= 6}>
                  <summary className="sb-relation-group-summary">
                    <Layers2Icon className="sb-relation-group-icon" aria-hidden="true" />
                    <span>{t(fieldLabels[field] ?? field)}</span>
                    <span className="sb-relation-count">
                      {relations.length} {t('marivo.semantic.objects')}
                    </span>
                    <ChevronDownIcon className="sb-disclosure-icon" aria-hidden="true" />
                  </summary>
                  <ul className="sb-relation-list">
                    {relations.map((relation) => {
                      const target = refKey(relation.ref)
                      const related = objects.get(target)
                      const RelatedIcon = kindIcons[relation.ref.kind] ?? BoxIcon
                      return (
                        <li className="sb-relation-item" key={target}>
                          <RelatedIcon className="sb-relation-item-icon" aria-hidden="true" />
                          <div className="sb-relation-item-body">
                            <Button
                              className="sb-relation-item-name"
                              variant="link"
                              type="button"
                              disabled={!related}
                              title={target}
                              onClick={() => navigate(target)}
                            >
                              {related?.name ?? target}
                            </Button>
                            {related?.definition && (
                              <span className="sb-relation-description">{related.definition}</span>
                            )}
                            {!related && (
                              <span className="sb-muted">
                                {t('marivo.semantic.object-not-included-in-this-catalog')}
                              </span>
                            )}
                          </div>
                          <span className="sb-relation-item-ref sb-ref">{target}</span>
                          <Button
                            className="sb-relation-copy"
                            variant="ghost"
                            size="icon"
                            type="button"
                            aria-label={`${t('marivo.semantic.copy-reference')}: ${target}`}
                            title={t('marivo.semantic.copy-reference')}
                            onClick={() => copy(target)}
                          >
                            <CopyIcon aria-hidden="true" />
                          </Button>
                        </li>
                      )
                    })}
                  </ul>
                </details>
              ))}
            </div>
          </TabsContent>
        </TabsRoot>
      </CardContent>
    </Card>
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
  const domainId = useId()

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
    const detail = panel.current?.querySelector('.sb-detail')
    if (view.selected && detail) detail.scrollTop = 0
  }, [view.selected])
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
      className="mv-ui sb-panel bg-background"
      aria-label={t('marivo.semantic.semantic-object-browser')}
    >
      <UIStyleSheet />
      <style>{browserStyles}</style>
      <div className="sb-shell">
        <CardHeader className="sb-header">
          <CardTitle role="heading" aria-level={1}>
            {t('marivo.navigation.semantic-layer')}
          </CardTitle>
          {snapshot && (
            <time className="sb-updated" dateTime={snapshot.loadedAt}>
              {t('marivo.semantic.updated')}
              {new Date(snapshot.loadedAt).toLocaleString(t.locale)}
            </time>
          )}
          <Button
            variant="ghost"
            className="sb-refresh"
            size="icon"
            type="button"
            aria-label={t('marivo.semantic.refresh-semantic-layer')}
            title={t('marivo.semantic.refresh-semantic-layer')}
            disabled={!state.workspaceId || !knownWorkspace || workspaceError || view.loading}
            onClick={() => void model.refresh()}
          >
            <svg
              width="16"
              height="16"
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
          </Button>
        </CardHeader>
        {state.fromReport && (
          <Alert role="status" className="sb-status">
            <AlertDescription>
              {t('marivo.semantic.current-semantic-definitions-are-shown-here-report-data-and')}
            </AlertDescription>
          </Alert>
        )}
        {workspaceError && (
          <Alert variant="destructive" role="alert" className="sb-status">
            <AlertDescription>
              {t('marivo.semantic.workspace-list-unavailable-check-the-host-connection')}
            </AlertDescription>
          </Alert>
        )}
        {view.loading && (
          <Alert role="status" className="sb-status">
            <AlertDescription>
              {t('marivo.semantic.loading-semantic-objects')}
              {snapshot ? t('marivo.semantic.previously-loaded-content-is-still-shown') : ''}
            </AlertDescription>
          </Alert>
        )}
        {view.error && (
          <Alert variant="destructive" role="alert" className="sb-status">
            <AlertDescription>
              {t(view.error)}
              {snapshot ? t('marivo.semantic.previously-loaded-content-is-still-shown-714') : ''}
            </AlertDescription>
          </Alert>
        )}
        {!state.workspaceId ? (
          <Empty className="sb-empty">
            <EmptyDescription>
              {workspacePhase !== 'ready'
                ? t('marivo.semantic.loading-workspaces')
                : t('marivo.semantic.this-session-has-no-workspace-return-to-the-session')}
            </EmptyDescription>
          </Empty>
        ) : !snapshot ? (
          <Empty className="sb-empty">
            <EmptyDescription>
              {view.loading
                ? t('marivo.semantic.loading-object-catalog')
                : t('marivo.semantic.object-catalog-not-loaded')}
            </EmptyDescription>
          </Empty>
        ) : !snapshot.objects.length && !view.selected ? (
          <Empty className="sb-empty">
            <EmptyDescription>
              {t('marivo.semantic.this-project-has-no-semantic-objects')}
            </EmptyDescription>
          </Empty>
        ) : (
          <div className={`sb-columns ${view.selected ? 'sb-has-selection' : ''}`}>
            <nav className="sb-nav" aria-label={t('marivo.semantic.object-categories')}>
              <Field orientation="horizontal" className="sb-domain">
                <FieldLabel htmlFor={domainId}>{t('marivo.semantic.domain')}</FieldLabel>
                <NativeSelect
                  id={domainId}
                  aria-label={t('marivo.semantic.filter-domains')}
                  value={view.domain}
                  onChange={(event) => model.patch({ domain: event.target.value, page: 0 })}
                >
                  <option value="">{t('marivo.semantic.all-domains')}</option>
                  {domains.map((domain) => (
                    <option key={domain}>{domain}</option>
                  ))}
                </NativeSelect>
              </Field>
              <span className="sb-kind-label">{t('marivo.semantic.kind-filter-label')}</span>
              <ToggleGroup
                className="sb-kinds"
                type="single"
                variant="outline"
                value={view.kind || 'all'}
                onValueChange={(kind) => {
                  if (kind) model.patch({ kind: kind === 'all' ? '' : kind, page: 0 })
                }}
              >
                <ToggleGroupItem value="all">
                  {t('marivo.semantic.all-objects')}
                  <span>{counts.total}</span>
                </ToggleGroupItem>
                {kinds.map((kind) => (
                  <ToggleGroupItem key={kind} value={kind}>
                    {t(kindLabels[kind] ?? kind)}
                    <span>{counts.byKind.get(kind) ?? 0}</span>
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </nav>
            <section className="sb-list" aria-label={t('marivo.semantic.object-list')}>
              <div className="sb-search-wrap">
                <SearchIcon aria-hidden="true" />
                <Input
                  className="sb-search"
                  aria-label={t('marivo.semantic.search-semantic-objects')}
                  placeholder={t(
                    'marivo.semantic.search-names-references-and-business-definitions',
                  )}
                  value={view.query}
                  onChange={(event) => model.patch({ query: event.target.value, page: 0 })}
                />
              </div>
              <p className="sb-count">
                {filtered.length}{' '}
                {view.kind ? t(kindLabels[view.kind] ?? view.kind) : t('marivo.semantic.objects')}
              </p>
              {!filtered.length && (
                <p>{t('marivo.semantic.no-matching-objects-adjust-the-search-or-filters')}</p>
              )}
              <ul className="sb-objects">
                {filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((item) => (
                  <li key={refKey(item.ref)}>
                    <Button
                      variant={view.selected === refKey(item.ref) ? 'secondary' : 'outline'}
                      type="button"
                      aria-pressed={view.selected === refKey(item.ref)}
                      onClick={() => navigate(refKey(item.ref))}
                    >
                      <span className="sb-object-title">
                        <strong>{item.name}</strong>
                        {!view.kind && (
                          <Badge variant="secondary">
                            {t(kindLabels[item.ref.kind] ?? item.ref.kind)}
                          </Badge>
                        )}
                      </span>
                      {item.definition && <span className="sb-summary">{item.definition}</span>}
                      <span className="sb-ref">{refKey(item.ref)}</span>
                    </Button>
                  </li>
                ))}
              </ul>
              {filtered.length > PAGE_SIZE && (
                <div className="sb-pager">
                  <Button
                    variant="outline"
                    type="button"
                    disabled={!page}
                    onClick={() => model.patch({ page: page - 1 })}
                  >
                    {t('marivo.presentation.previous-page')}
                  </Button>
                  <span>
                    {page + 1} / {Math.ceil(filtered.length / PAGE_SIZE)}
                  </span>
                  <Button
                    variant="outline"
                    type="button"
                    disabled={(page + 1) * PAGE_SIZE >= filtered.length}
                    onClick={() => model.patch({ page: page + 1 })}
                  >
                    {t('marivo.presentation.next-page')}
                  </Button>
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
                <Empty className="sb-empty">
                  <EmptyDescription>
                    {view.selected ? (
                      <>
                        <p>
                          {t('marivo.semantic.the-selected-object-is-no-longer-in-this-catalog')}
                        </p>
                        <p>{view.selected}</p>
                        <Button
                          variant="outline"
                          type="button"
                          onClick={() => model.patch({ selected: '' })}
                        >
                          {t('marivo.semantic.back-to-list')}
                        </Button>
                      </>
                    ) : (
                      t('marivo.semantic.select-an-object-to-view-its-business-definition-and')
                    )}
                  </EmptyDescription>
                </Empty>
              )}
            </section>
          </div>
        )}
      </div>
    </section>
  )
}
