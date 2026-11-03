// @ts-nocheck -- JSX is bundled by the plugin client build.

import { useState } from 'react'
import { refKey } from '../../semantic-reference/contracts.ts'
import { useCopy } from '../i18n/context.tsx'
import { Button } from '../ui/controls.tsx'
import { fieldLabels } from './labels.ts'
import { RefLink } from './reference-link.tsx'

function DefinitionNode({ object }) {
  const t = useCopy()
  const [notice, setNotice] = useState('')
  const definition = object.computation
  async function copy() {
    try {
      await navigator.clipboard.writeText(definition.expression)
      setNotice('marivo.semantic.expression-copied')
    } catch {
      setNotice('marivo.semantic.copy-failed-select-the-code-to-copy-manually')
    }
  }
  return (
    <div className="sb-calculation-node sb-expression">
      <div className="sb-expression-code">
        <Button
          type="button"
          className="sb-expression-copy"
          onClick={copy}
          aria-label={t('marivo.presentation.copy-code')}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            aria-hidden="true"
          >
            <rect x="9" y="9" width="12" height="12" rx="2" />
            <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
          </svg>
        </Button>
        <pre>
          <code>{definition.expression}</code>
        </pre>
      </div>
      <span role="status">{t(notice)}</span>
      {definition.facts.map((fact) => (
        <section className="sb-temporal" key={fact.name}>
          <h4>{t(fieldLabels[fact.name] ?? fact.name)}</h4>
          <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{fact.value}</pre>
        </section>
      ))}
    </div>
  )
}

export function ComputationCard({ object, objects, navigate }) {
  const t = useCopy()
  if (!object.computation) return null
  const seen = new Set([refKey(object.ref)]),
    queue = [object],
    related = []
  let limited = false
  for (let index = 0; index < queue.length; index++) {
    for (const relation of queue[index].relations) {
      if (relation.field !== 'dependencies') continue
      const key = refKey(relation.ref)
      if (seen.has(key)) continue
      seen.add(key)
      const child = objects.get(key)
      if (!child?.computation) continue
      if (related.length === 40) {
        limited = true
        continue
      }
      related.push(child)
      queue.push(child)
    }
  }
  return (
    <section className="sb-computation" aria-label={t('marivo.semantic.metric-computation')}>
      <h3>{t('marivo.semantic.computation')}</h3>
      <DefinitionNode key={refKey(object.ref)} object={object} />
      {!!related.length && (
        <section
          className="sb-referenced-definitions"
          aria-label={t('marivo.semantic.referenced-object-definitions')}
        >
          <h3>{t('marivo.semantic.referenced-object-definitions')}</h3>
          {related.map((child) => (
            <section
              className="sb-definition-entry"
              key={refKey(child.ref)}
              aria-label={refKey(child.ref)}
            >
              <h4>
                <RefLink refValue={child.ref} objects={objects} navigate={navigate} />
              </h4>
              <DefinitionNode object={child} />
              {!!child.guardrails.length && (
                <ul>
                  {[...new Set(child.guardrails)].map((text) => (
                    <li key={text}>{text}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
          {limited && (
            <p>
              {t('marivo.semantic.showing-the-first-40-referenced-definitions-click-an-object')}
            </p>
          )}
        </section>
      )}
    </section>
  )
}
