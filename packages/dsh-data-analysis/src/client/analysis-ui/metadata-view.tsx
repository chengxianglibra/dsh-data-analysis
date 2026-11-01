import type { FrameSections } from '../../presentation/contracts/snapshot.ts'
import { useCopy } from '../i18n/context.tsx'
import { sourceSemanticRef } from '../presentation/source-facts.ts'
import { kindLabels } from '../semantic-browser/labels.ts'
import { useAnalysisResources } from './context.tsx'

type Semantics = FrameSections['semantics']
type Origin = Extract<Semantics, { status: 'captured' }>['columns'][number]['valueOrigins'][number]

/** Show each concrete semantic object once, excluding its storage and owner containers. */
export function semanticObjects(section: Semantics): Origin[] {
  if (section.status !== 'captured') return []
  const objects = new Map<string, Origin>()
  for (const column of section.columns) {
    for (const origin of [...column.valueOrigins, ...column.contextOrigins]) {
      if (origin.kind === 'datasource' || origin.kind === 'entity') continue
      const key = JSON.stringify([origin.kind, origin.path, origin.definitionId])
      if (!objects.has(key)) objects.set(key, origin)
    }
  }
  return [...objects.values()]
}

function OriginItem({ origin }: { origin: Origin }) {
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
      )}
    </li>
  )
}

/** Concrete semantic objects; links open the semantic browser when navigable. */
export function SemanticOrigins({ section }: { section: Semantics }) {
  const t = useCopy()
  if (section.status === 'unavailable')
    return (
      <p className="pr-muted">
        {t(`marivo.presentation.ui-metadata-unavailable-${section.reason}`)}
      </p>
    )
  return (
    <div className="au-meta" data-meta="semantics">
      <ul className="fv-origins">
        {semanticObjects(section).map((origin) => (
          <OriginItem
            key={JSON.stringify([origin.kind, origin.path, origin.definitionId])}
            origin={origin}
          />
        ))}
      </ul>
    </div>
  )
}
