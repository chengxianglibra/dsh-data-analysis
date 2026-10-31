import type { FrameSections } from '../../presentation/contracts/snapshot.ts'
import { useCopy } from '../i18n/context.tsx'
import { sourceSemanticRef } from '../presentation/source-facts.ts'
import { kindLabels } from '../semantic-browser/labels.ts'
import { useAnalysisResources } from './context.tsx'

type Semantics = FrameSections['semantics']
type Origin = Extract<Semantics, { status: 'captured' }>['columns'][number]['valueOrigins'][number]

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

/** Semantic origins per column; links open the semantic browser when navigable. */
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
      {section.columns.map((column) => {
        const origins = [...column.valueOrigins, ...column.contextOrigins]
        if (origins.length === 0) return null
        return (
          <section key={`${column.role}-${column.id}`}>
            <h4>{column.id}</h4>
            <ul className="fv-origins">
              {origins.map((origin) => (
                <OriginItem
                  key={`${origin.kind}:${origin.path}:${origin.definitionId}`}
                  origin={origin}
                />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
