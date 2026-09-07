import { Fragment } from 'react'
import type { SourceSnapshot } from '../../presentation/contracts/types.ts'
import type { ReaderMode } from './model.ts'

function SourceFacts({ source }: { source: SourceSnapshot }) {
  return (
    <>
      <dl className="pr-facts">
        <dt>Session</dt>
        <dd>{source.ref.sessionId}</dd>
        <dt>Artifact</dt>
        <dd>{source.ref.artifactRef}</dd>
        {source.ref.findingId && (
          <>
            <dt>Finding</dt>
            <dd>{source.ref.findingId}</dd>
          </>
        )}
        {source.status === 'available' &&
          source.facts.map((fact, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: Immutable source facts may repeat both label and value.
            <Fragment key={`${index}-${fact.label}`}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </Fragment>
          ))}
      </dl>
      {source.status === 'unavailable' && <p className="pr-notice">{source.reason}</p>}
    </>
  )
}

export function Sources({
  sources,
  mode,
  origin,
}: {
  sources: SourceSnapshot[]
  mode: ReaderMode
  origin?: 'artifact' | 'computed'
}) {
  const content = (
    <>
      {origin === 'computed' && <p className="pr-muted">computed · 以下为声明来源。</p>}
      {!sources.length && <p className="pr-muted">未声明来源。</p>}
      {sources.map((source) => {
        const label = source.status === 'available' ? source.label : source.id
        const title = (
          <>
            {label}{' '}
            <span className="pr-source-status">
              {source.status === 'available' ? '已保存快照' : 'unavailable · 来源不可用'}
            </span>
          </>
        )
        return mode === 'static' ? (
          <section
            key={source.id}
            className="pr-source"
            data-source-id={source.id}
            data-source-status={source.status}
          >
            <h3>{title}</h3>
            <SourceFacts source={source} />
          </section>
        ) : (
          <details
            key={source.id}
            className="pr-source"
            data-source-id={source.id}
            data-source-status={source.status}
          >
            <summary>{title}</summary>
            <SourceFacts source={source} />
          </details>
        )
      })}
    </>
  )
  return mode === 'static' ? (
    <div className="pr-sources">
      <h2>来源（{sources.length}）</h2>
      {content}
    </div>
  ) : (
    <details className="pr-sources">
      <summary>来源（{sources.length}）</summary>
      {content}
    </details>
  )
}
