import type { FrameSections } from '../../presentation/contracts/snapshot.ts'
import { useCopy } from '../i18n/context.tsx'
import { sourceSemanticRef } from '../presentation/source-facts.ts'
import { kindLabels } from '../semantic-browser/labels.ts'
import { useAnalysisResources } from './context.tsx'

type Section<K extends keyof FrameSections> = FrameSections[K]
type Captured<K extends keyof FrameSections> = Extract<Section<K>, { status: 'captured' }>
type Scope = Captured<'evidence'>['items'][number]['scope']
type Fact = { name: string; value: string | null }

function SectionState({ section }: { section: Section<keyof FrameSections> }) {
  const t = useCopy()
  if (section === 'not-captured')
    return <p className="pr-muted">{t('marivo.presentation.ui-metadata-not-captured')}</p>
  if (section.status === 'unavailable')
    return (
      <p className="pr-muted">
        {t(`marivo.presentation.ui-metadata-unavailable-${section.reason}`)}
      </p>
    )
  return null
}

function Facts({ items }: { items: Fact[] }) {
  if (items.length === 0) return null
  return (
    <dl>
      {items.map((item, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: Immutable saved facts may repeat names and carry no component state.
        <div key={`${i}-${item.name}`} className="au-meta-fact">
          <dt>{item.name}</dt>
          <dd>{item.value ?? 'NULL'}</dd>
        </div>
      ))}
    </dl>
  )
}

function ScopeNote({ scope }: { scope: Scope }) {
  const t = useCopy()
  return (
    <p className="pr-muted">
      {scope.kind === 'row'
        ? t('marivo.presentation.ui-metadata-scope-row', { p0: scope.rowIndex + 1 })
        : t(`marivo.presentation.ui-metadata-scope-${scope.kind}`)}
    </p>
  )
}

function Coordinates({ items }: { items: Captured<'evidence'>['items'][number]['coordinates'] }) {
  return <Facts items={items.map((c) => ({ name: c.name ?? c.slotId, value: c.value }))} />
}

function PageHeading({ label, page }: { label: string; page: Captured<'evidence' | 'findings'> }) {
  const t = useCopy()
  return (
    <>
      <h4>
        {label}{' '}
        {t('marivo.presentation.ui-metadata-read-count', {
          p0: page.items.length,
          p1: page.totalCount,
        })}
      </h4>
      {page.hasMore && (
        <p className="pr-muted">{t('marivo.presentation.ui-metadata-first-page')}</p>
      )}
    </>
  )
}

function Truncated({ value }: { value?: true }) {
  const t = useCopy()
  return value ? <p className="pr-muted">{t('marivo.presentation.ui-metadata-truncated')}</p> : null
}

function Evidence({ section }: { section: Section<'evidence'> }) {
  const t = useCopy()
  const label = t('marivo.presentation.ui-metadata-evidence')
  if (typeof section !== 'object' || section.status !== 'captured')
    return (
      <section className="au-meta" data-meta="evidence">
        <h4>{label}</h4>
        <SectionState section={section} />
      </section>
    )
  return (
    <section className="au-meta" data-meta="evidence">
      <PageHeading label={label} page={section} />
      {section.items.length === 0 && (
        <p className="pr-muted">{t('marivo.presentation.ui-metadata-empty')}</p>
      )}
      <ol>
        {section.items.map((item, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: Saved Evidence has no identity; the immutable page order is the key.
          <li key={i}>
            <p>
              <strong>{t(`marivo.presentation.ui-metadata-evidence-${item.kind}`)}</strong>{' '}
              {item.summary}
            </p>
            <Facts items={item.values} />
            <Coordinates items={item.coordinates} />
            <ScopeNote scope={item.scope} />
            <Truncated value={item.truncated} />
          </li>
        ))}
      </ol>
    </section>
  )
}

function Findings({ section }: { section: Section<'findings'> }) {
  const t = useCopy()
  const label = t('marivo.presentation.ui-metadata-findings')
  if (typeof section !== 'object' || section.status !== 'captured')
    return (
      <section className="au-meta" data-meta="findings">
        <h4>{label}</h4>
        <SectionState section={section} />
      </section>
    )
  return (
    <section className="au-meta" data-meta="findings">
      <PageHeading label={label} page={section} />
      {section.items.length === 0 && (
        <p className="pr-muted">{t('marivo.presentation.ui-metadata-empty')}</p>
      )}
      <ol>
        {section.items.map((item) => (
          <li key={item.findingId}>
            <p>
              <strong>{item.type}</strong> <code>{item.findingId}</code>{' '}
              <span className="pr-muted">{item.committedAt}</span>
            </p>
            <Facts items={item.values} />
            <Coordinates items={item.coordinates} />
            <ScopeNote scope={item.scope} />
            <Truncated value={item.truncated} />
          </li>
        ))}
      </ol>
    </section>
  )
}

function Methods({ section }: { section: Section<'methods'> }) {
  const t = useCopy()
  const label = t('marivo.presentation.ui-metadata-methods')
  if (typeof section !== 'object' || section.status !== 'captured')
    return (
      <section className="au-meta" data-meta="methods">
        <h4>{label}</h4>
        <SectionState section={section} />
      </section>
    )
  return (
    <section className="au-meta" data-meta="methods">
      <h4>
        {label}{' '}
        {t('marivo.presentation.ui-metadata-read-count', {
          p0: section.items.length,
          p1: section.totalCount,
        })}
      </h4>
      {section.items.length === 0 && (
        <p className="pr-muted">{t('marivo.presentation.ui-metadata-empty')}</p>
      )}
      <ol>
        {section.items.map((item, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: Saved method facts may share an origin result and carry no component state.
          <li key={`${i}-${item.originResultId}`}>
            <p>
              <strong>{item.kind}</strong> <code>{item.originResultId}</code>
            </p>
            <Facts
              items={[
                ...item.targets.map((target) => ({ name: target.kind, value: target.path })),
                {
                  name: t('marivo.presentation.ui-metadata-method-parents'),
                  value: String(item.parentCount),
                },
                {
                  name: t('marivo.presentation.ui-metadata-method-coordinates'),
                  value: String(item.coordinateCount),
                },
              ]}
            />
            <Truncated value={item.truncated} />
          </li>
        ))}
      </ol>
    </section>
  )
}

function Origin({
  origin,
}: {
  origin: Captured<'semantics'>['columns'][number]['valueOrigins'][number]
}) {
  const t = useCopy()
  const { openSemanticRef } = useAnalysisResources()
  const ref = sourceSemanticRef(origin.kind, origin.path)
  const kind = kindLabels[origin.kind]
  const label = `${kind ? t(kind) : origin.kind}: ${origin.path}`
  return (
    <li>
      {ref && openSemanticRef ? (
        <button type="button" onClick={() => openSemanticRef(ref)}>
          {label}
        </button>
      ) : (
        <span>{label}</span>
      )}{' '}
      <code className="pr-muted">{origin.definitionId}</code>
    </li>
  )
}

function Semantics({ section }: { section: Section<'semantics'> }) {
  const t = useCopy()
  const label = t('marivo.presentation.ui-metadata-semantics')
  if (typeof section !== 'object' || section.status !== 'captured')
    return (
      <section className="au-meta" data-meta="semantics">
        <h4>{label}</h4>
        <SectionState section={section} />
      </section>
    )
  return (
    <section className="au-meta" data-meta="semantics">
      <h4>{label}</h4>
      <p className="pr-muted">{t('marivo.presentation.ui-metadata-semantics-note')}</p>
      {section.columns.map((column) => (
        <div key={`${column.role}-${column.id}`}>
          <p>
            <strong>{column.id}</strong>{' '}
            <span className="pr-muted">
              {t(`marivo.presentation.ui-metadata-role-${column.role}`)}
            </span>
          </p>
          {column.valueOrigins.length + column.contextOrigins.length === 0 && (
            <p className="pr-muted">{t('marivo.presentation.ui-metadata-empty')}</p>
          )}
          {column.valueOrigins.length > 0 && (
            <>
              <p className="pr-muted">{t('marivo.presentation.ui-metadata-value-origins')}</p>
              <ul>
                {column.valueOrigins.map((origin) => (
                  <Origin
                    key={`${origin.kind}:${origin.path}:${origin.definitionId}`}
                    origin={origin}
                  />
                ))}
              </ul>
            </>
          )}
          {column.contextOrigins.length > 0 && (
            <>
              <p className="pr-muted">{t('marivo.presentation.ui-metadata-context-origins')}</p>
              <ul>
                {column.contextOrigins.map((origin) => (
                  <Origin
                    key={`${origin.kind}:${origin.path}:${origin.definitionId}`}
                    origin={origin}
                  />
                ))}
              </ul>
            </>
          )}
          {column.omittedOrigins > 0 && (
            <p className="pr-muted">
              {t('marivo.presentation.ui-metadata-omitted-origins', { p0: column.omittedOrigins })}
            </p>
          )}
        </div>
      ))}
    </section>
  )
}

/** Saved Frame metadata as captured; it never upgrades static lineage or a first page to proof. */
export function FrameMetadata({ sections }: { sections: FrameSections }) {
  return (
    <div className="au-metadata">
      <Evidence section={sections.evidence} />
      <Findings section={sections.findings} />
      <Methods section={sections.methods} />
      <Semantics section={sections.semantics} />
    </div>
  )
}
