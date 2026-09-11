// @ts-nocheck -- JSX is bundled by the plugin client build.

import { useState } from 'react'
import { refKey } from '../../semantic-reference/contracts.ts'
import { useCopy } from './../i18n/context.tsx'
import { message } from './../i18n/copy.ts'
import { RefLink } from './reference-link.tsx'

const units = {
  second: 'marivo.semantic.second',
  minute: 'marivo.semantic.minute',
  hour: 'marivo.semantic.hour',
  day: 'marivo.semantic.day',
  week: 'marivo.semantic.week',
  month: 'marivo.semantic.month',
  quarter: 'marivo.semantic.quarter',
  year: 'marivo.semantic.year',
}
const reasons = {
  unsupported_syntax: 'marivo.semantic.structured-display-is-not-yet-supported-for-this-expression',
  description_unavailable:
    'marivo.semantic.no-expression-description-is-available-for-this-definition',
  limit_exceeded: 'marivo.semantic.expression-exceeds-the-description-size-limit',
}
const kinds = {
  aggregate: 'marivo.semantic.aggregation',
  weighted_mean: 'weighted_mean',
  ratio: 'marivo.semantic.ratio',
  linear: 'marivo.semantic.linear-combination',
  cumulative: 'marivo.semantic.cumulative',
  expression: 'marivo.semantic.ibis-expression',
}
const filterOperators = { eq: '=', in: 'IN' }
const field = (object, name) => object?.fields.find((x) => x.name === name)?.value
const op = (t, operation) =>
  `${operation?.kind ?? t('marivo.semantic.not-declared')}${operation?.q === undefined ? '' : `(q=${operation.q})`}`
function AnchorText({ anchor, objects, navigate }) {
  const t = useCopy()
  if (anchor?.kind === 'all_history')
    return t('marivo.semantic.cumulative-from-the-beginning-of-all-history')
  if (anchor?.kind === 'trailing')
    return t('marivo.semantic.rolling-cumulative-over-value-value', {
      p0: anchor.count,
      p1: units[anchor.unit] ?? anchor.unit,
    })
  if (anchor?.kind === 'grain_to_date') {
    const grain = anchor.grain
    return grain.kind === 'semantic' ? (
      <>
        {t('marivo.semantic.from')}
        <RefLink refValue={grain.calendar} objects={objects} navigate={navigate} />{' '}
        {t('marivo.semantic.of')} {grain.level}{' '}
        {t('marivo.semantic.period-start-resetting-each-period')}
      </>
    ) : (
      t('marivo.semantic.cumulative-from-the-current-value-resetting-each-period', {
        p0: units[grain.unit] ?? grain.unit,
      })
    )
  }
  return t('marivo.semantic.this-cumulative-rule-cannot-be-displayed-yet')
}
function ExpressionCode({ node, objects, navigate }) {
  const t = useCopy()

  const [notice, setNotice] = useState('')
  const display = node.display
  if (display?.form !== 'normalized_ibis' || display.language !== 'python')
    return (
      <p className="sb-muted">
        {t(
          reasons[node.reason] ??
            'marivo.semantic.the-current-runtime-did-not-provide-displayable-ibis-expression',
        )}
      </p>
    )
  async function copy() {
    try {
      await navigator.clipboard.writeText(display.text)
      setNotice('marivo.semantic.expression-copied')
    } catch {
      setNotice('marivo.semantic.copy-failed-select-the-code-to-copy-manually')
    }
  }
  return (
    <section className="sb-expression" aria-label={t('marivo.semantic.ibis-expression')}>
      <div className="sb-expression-code">
        <button
          type="button"
          className="sb-expression-copy"
          aria-label={t('marivo.semantic.copy-ibis-expression')}
          title={t('marivo.semantic.copy-ibis-expression')}
          onClick={copy}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            aria-hidden="true"
          >
            <rect x="9" y="9" width="12" height="12" rx="2" />
            <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
          </svg>
        </button>
        <pre>
          <code>{display.text}</code>
        </pre>
      </div>
      <div className="sb-expression-bindings">
        {display.bindings.map((binding) => (
          <div key={binding.alias}>
            <code>{binding.alias}</code>
            <span> → </span>
            <RefLink refValue={binding.ref} objects={objects} navigate={navigate} />
          </div>
        ))}
      </div>
      {display.redacted_literals && (
        <p className="sb-muted">{t('marivo.semantic.constant-values-are-hidden-as-redacted')}</p>
      )}
      <span role="status">{t(notice)}</span>
    </section>
  )
}
function inputs(node) {
  switch (node.kind) {
    case 'aggregate':
      return [['marivo.semantic.aggregation-target', node.target]]
    case 'weighted_mean':
      return [
        ['marivo.semantic.value', node.value],
        ['marivo.semantic.weight', node.weight],
      ]
    case 'ratio':
      return [
        ['marivo.semantic.numerator', node.numerator],
        ['marivo.semantic.denominator', node.denominator],
      ]
    case 'linear':
      return node.terms.map((t, i) => [
        message('marivo.semantic.term-value-value', { p0: i + 1, p1: t.sign }),
        t.metric,
      ])
    case 'cumulative':
      return [['marivo.semantic.base-metric', node.base]]
    default:
      return []
  }
}
function referencedDefinitions(object, objects) {
  const seen = new Set([refKey(object.ref)])
  const queue = [object]
  const entries = []
  for (let index = 0; index < queue.length; index++) {
    for (const [, ref] of inputs(queue[index].computation.node)) {
      const key = refKey(ref)
      if (seen.has(key)) continue
      seen.add(key)
      const child = objects.get(key)
      if (!child?.computation) continue
      if (entries.length === 40) return { entries, limited: true }
      entries.push(child)
      queue.push(child)
    }
  }
  return { entries, limited: false }
}
function Formula({ node, objects, navigate }) {
  const t = useCopy()

  const link = (ref) => <RefLink refValue={ref} objects={objects} navigate={navigate} />
  switch (node.kind) {
    case 'aggregate':
      return (
        <>
          {op(t, node.operation)}({link(node.target)})
        </>
      )
    case 'ratio':
      return (
        <>
          {link(node.numerator)} ÷ {link(node.denominator)}
        </>
      )
    case 'linear':
      return node.terms.map((term, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: Authored terms preserve repeated refs and order.
        <span className="sb-formula-term" key={index}>
          {term.sign} {link(term.metric)}{' '}
        </span>
      ))
    case 'weighted_mean':
      return (
        <>
          weighted_mean({link(node.value)}, {link(node.weight)})
        </>
      )
    case 'cumulative':
      return (
        <>
          <AnchorText anchor={node.anchor} objects={objects} navigate={navigate} />
          <br />
          {t('marivo.semantic.base-metric-558')}
          {link(node.base)}
        </>
      )
    default:
      return t('marivo.semantic.this-computation-type-cannot-be-displayed-yet')
  }
}
function DefinitionNode({ object, objects, navigate }) {
  const t = useCopy()

  const definition = object.computation,
    node = definition?.node
  if (!node)
    return (
      <p className="sb-muted">
        {t('marivo.semantic.this-object-has-no-public-computation-definition')}
      </p>
    )
  const relationProps = { objects, navigate }
  return (
    <div className="sb-calculation-node">
      {node.kind === 'expression' ? (
        <ExpressionCode node={node} objects={objects} navigate={navigate} />
      ) : (
        <p className="sb-formula">
          <Formula node={node} objects={objects} navigate={navigate} />
        </p>
      )}
      {node.kind === 'cumulative' && (
        <dl className="sb-fields">
          <dt>{t('marivo.semantic.cumulative-time-axis')}</dt>
          <dd>
            {node.over.selection === 'explicit' ? (
              <RefLink refValue={node.over.ref} {...relationProps} />
            ) : (
              t('marivo.semantic.uses-the-default-time-axis-determined-by-observation-context')
            )}
          </dd>
          {node.over.selection === 'explicit' && (
            <>
              <dt>{t('marivo.semantic.time-grain-timezone')}</dt>
              <dd>
                {field(objects.get(refKey(node.over.ref)), 'granularity') ??
                  t('marivo.semantic.not-declared')}{' '}
                /{' '}
                {field(objects.get(refKey(node.over.ref)), 'timezone') ??
                  t('marivo.semantic.not-declared')}
              </dd>
            </>
          )}
          {node.anchor.kind === 'grain_to_date' && node.anchor.grain.kind === 'semantic' && (
            <>
              <dt>{t('marivo.semantic.period-calendar')}</dt>
              <dd>
                <RefLink refValue={node.anchor.grain.calendar} {...relationProps} />
              </dd>
              <dt>{t('marivo.semantic.calendar-level')}</dt>
              <dd>{node.anchor.grain.level}</dd>
              <dt>{t('marivo.semantic.calendar-boundary-timezone')}</dt>
              <dd>
                {field(objects.get(refKey(node.anchor.grain.calendar)), 'boundary_timezone') ??
                  t('marivo.semantic.not-declared')}
              </dd>
            </>
          )}
        </dl>
      )}
      {!!node.filter?.length && (
        <div>
          <h4>{t('marivo.semantic.filters-in-definition')}</h4>
          <ul>
            {node.filter.map((f) => (
              <li key={refKey(f.dimension)}>
                <RefLink refValue={f.dimension} {...relationProps} />{' '}
                {filterOperators[f.operator] ?? f.operator} {JSON.stringify(f.values ?? f.value)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
function TemporalRules({ temporal, objects, navigate }) {
  const t = useCopy()

  if (
    !temporal ||
    (temporal.declared.status === 'not_declared' &&
      temporal.override.status === 'not_declared' &&
      temporal.effective.status === 'not_applicable')
  )
    return null
  const row = (label, rule) => (
    <div>
      <strong>{t(label)}：</strong>
      {rule.over ? (
        <>
          <RefLink refValue={rule.over} objects={objects} navigate={navigate} /> ·{' '}
          {op(t, rule.fold)}
        </>
      ) : rule.fold ? (
        op(t, rule.fold)
      ) : rule.status === 'component_defined' ? (
        t('marivo.semantic.determined-by-the-formula-and-its-components')
      ) : rule.status === 'not_declared' ? (
        t('marivo.semantic.not-declared')
      ) : rule.status === 'not_applicable' ? (
        t('marivo.semantic.not-applicable')
      ) : (
        t('marivo.semantic.unsupported-rule-status-value', { p0: rule.status })
      )}
    </div>
  )
  return (
    <section className="sb-temporal" aria-label={t('marivo.semantic.time-fold-rule')}>
      <h4>{t('marivo.semantic.time-fold-rule')}</h4>
      {temporal.declared.status !== 'not_declared' &&
        row(t('marivo.semantic.declared-rule'), temporal.declared)}
      {temporal.override.status !== 'not_declared' &&
        row(t('marivo.semantic.metric-override'), temporal.override)}
      {temporal.effective.status !== 'not_applicable' &&
        row(t('marivo.semantic.effective-rule'), temporal.effective)}
    </section>
  )
}
export function ComputationCard({ object, objects, navigate }) {
  const t = useCopy()

  const node = object.computation?.node
  if (!node)
    return (
      <p className="sb-muted">
        {t('marivo.semantic.this-object-has-no-public-computation-definition')}
      </p>
    )
  const related = referencedDefinitions(object, objects)
  const entityRefs = object.relations
    .filter((r) => r.field === 'effective_entities' || r.field === 'entity')
    .map((r) => r.ref)
  const entityKeys = [...new Set(entityRefs.map(refKey))]
  return (
    <section className="sb-computation" aria-label={t('marivo.semantic.metric-computation')}>
      <div className="sb-computation-heading">
        <h3>{t('marivo.semantic.computation')}</h3>
        <span className="sb-badge">{t(kinds[node.kind] ?? node.kind)}</span>
        {field(object, 'unit') && <span>{field(object, 'unit')}</span>}
      </div>
      <DefinitionNode
        key={refKey(object.ref)}
        object={object}
        objects={objects}
        navigate={navigate}
      />
      <TemporalRules temporal={object.computation.temporal} objects={objects} navigate={navigate} />
      {!!related.entries.length && (
        <section
          className="sb-referenced-definitions"
          aria-label={t('marivo.semantic.referenced-object-definitions')}
        >
          <h3>{t('marivo.semantic.referenced-object-definitions')}</h3>
          {related.entries.map((child) => (
            <section
              className="sb-definition-entry"
              aria-label={refKey(child.ref)}
              key={refKey(child.ref)}
            >
              <div className="sb-definition-entry-heading">
                <h4>
                  <RefLink refValue={child.ref} objects={objects} navigate={navigate} />
                </h4>
                <span className="sb-badge">{t(kinds[child.computation.node.kind])}</span>
              </div>
              <DefinitionNode object={child} objects={objects} navigate={navigate} />
              {!!child.guardrails.length && (
                <ul className="sb-muted">
                  {[...new Set(child.guardrails)].map((text) => (
                    <li key={text}>{text}</li>
                  ))}
                </ul>
              )}
              <TemporalRules
                temporal={child.computation.temporal}
                objects={objects}
                navigate={navigate}
              />
            </section>
          ))}
          {related.limited && (
            <p className="sb-muted">
              {t('marivo.semantic.showing-the-first-40-referenced-definitions-click-an-object')}
            </p>
          )}
        </section>
      )}
      {!!entityKeys.length && (
        <section
          className="sb-definition-sources"
          aria-label={t('marivo.semantic.data-source-and-grain')}
        >
          <h3>{t('marivo.semantic.data-source-and-grain')}</h3>
          {entityKeys.map((key) => {
            const entity = objects.get(key)
            return (
              <div key={key}>
                <RefLink
                  refValue={entity?.ref ?? entityRefs.find((r) => refKey(r) === key)}
                  objects={objects}
                  navigate={navigate}
                />
                {field(entity, 'primary_key') && (
                  <span className="sb-muted">
                    {t('marivo.semantic.primary-key')}
                    {field(entity, 'primary_key')}
                  </span>
                )}
              </div>
            )
          })}
        </section>
      )}
    </section>
  )
}
