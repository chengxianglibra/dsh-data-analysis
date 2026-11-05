// @ts-nocheck -- JSX is bundled by the plugin client build.

import {
  BanIcon,
  BracesIcon,
  CalendarDaysIcon,
  ChartColumnIcon,
  ChevronDownIcon,
  CopyIcon,
  DatabaseIcon,
  FilterIcon,
  Layers2Icon,
  SigmaIcon,
} from 'lucide-react'
import { useState } from 'react'
import { refKey } from '../../semantic-reference/contracts.ts'
import { useCopy } from '../i18n/context.tsx'
import { Button } from '../ui/controls.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/primitives/card.tsx'
import { fieldLabels, kindLabels } from './labels.ts'
import { ExpressionText, FieldValue, RefLink, refDisplayName } from './reference-link.tsx'

// Translate only the exact policies emitted by the public Catalog. Unknown rules
// remain visible verbatim so this presentation never invents semantics.
function readableNullRule(rule, t) {
  if (rule === 'count counts source rows; empty input returns zero')
    return t('marivo.semantic.null-rule-count-rows')
  const ignoreEndings = {
    'no valid pairs or zero paired weight sum returns NULL': 'marivo.semantic.null-rule-weighted',
    'empty input returns typed zero; nonempty all-NULL input returns NULL':
      'marivo.semantic.null-rule-empty-zero-all-null',
    'empty input returns zero; all-NULL input returns zero':
      'marivo.semantic.null-rule-empty-zero-all-zero',
    'empty input returns NULL; all-NULL input returns NULL':
      'marivo.semantic.null-rule-empty-null-all-null',
  }
  const errorEndings = {
    'no valid pairs or zero paired weight sum returns NULL': 'marivo.semantic.null-rule-weighted',
    'empty input returns typed zero': 'marivo.semantic.null-rule-empty-zero',
    'empty input returns zero': 'marivo.semantic.null-rule-empty-zero',
    'empty input returns NULL': 'marivo.semantic.null-rule-empty-null',
  }
  const policies = [
    [
      'nulls=ignore: ignore NULL contributions; ',
      'marivo.semantic.null-rule-ignore',
      ignoreEndings,
    ],
    [
      'nulls=error: assert non-NULL demanded contributions; a demanded NULL raises an error; ',
      'marivo.semantic.null-rule-error',
      errorEndings,
    ],
  ]
  for (const [prefix, key, endings] of policies) {
    if (rule.startsWith(prefix)) {
      const end = rule.slice(prefix.length)
      if (Object.hasOwn(endings, end))
        return `${t(key)}${t('marivo.semantic.null-rule-separator')}${t(endings[end])}`
    }
  }
  return null
}

function TimeBindingValue({ fact, object, objects, navigate }) {
  const t = useCopy()
  const value = fact.structured ? JSON.parse(fact.value) : null
  if (
    !Array.isArray(value) ||
    !value.every(
      (item) =>
        item &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        Object.hasOwn(item, 'field') &&
        (item.field === null || typeof item.field === 'string'),
    )
  ) {
    return <FieldValue field={fact} object={object} objects={objects} navigate={navigate} />
  }
  const fields = [...new Set(value.map((item) => item.field))]
  if (!fields.length) return t('marivo.semantic.not-declared')
  return fields.map((field, index) => {
    const relation = object.relations.find(
      (item) => item.ref.kind === 'time_dimension' && refKey(item.ref) === field,
    )
    return (
      <span key={field ?? 'unbound'}>
        {index > 0 && ' · '}
        {field === null ? (
          t('marivo.semantic.not-declared')
        ) : relation ? (
          <RefLink refValue={relation.ref} objects={objects} navigate={navigate}>
            {refDisplayName(
              relation.ref,
              objects,
              object.relations.map((item) => item.ref),
            )}
          </RefLink>
        ) : (
          field
        )}
      </span>
    )
  })
}

function NullRuleValue({ fact, expression, reductions, object, objects, navigate }) {
  const t = useCopy()
  const value = fact.structured ? JSON.parse(fact.value) : null
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string'))
    return <FieldValue field={fact} object={object} objects={objects} navigate={navigate} />
  const branches = [...new Set([expression, ...reductions].filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  )
  const rules = value.map((item) => {
    const branch = branches.find((candidate) => item.startsWith(`${candidate}: `))
    const rule = branch ? item.slice(branch.length + 2) : item
    return { branch, raw: item, text: readableNullRule(rule, t) }
  })
  if (!rules.length) return t('marivo.semantic.not-declared')
  if (rules.every((rule) => rule.text !== null && rule.text === rules[0].text)) return rules[0].text
  return [...new Map(rules.map((rule) => [rule.raw, rule])).values()].map((rule) => (
    <div key={rule.raw}>
      {rule.text === null ? (
        <ExpressionText value={rule.raw} object={object} objects={objects} navigate={navigate} />
      ) : (
        <>
          {rules.length > 1 && rule.branch && (
            <>
              <ExpressionText
                value={rule.branch}
                object={object}
                objects={objects}
                navigate={navigate}
              />
              :{' '}
            </>
          )}
          {rule.text}
        </>
      )}
    </div>
  ))
}

const factIcons = {
  time_bindings: CalendarDaysIcon,
  null_rules: BanIcon,
  conditions: FilterIcon,
  reductions: SigmaIcon,
  facts: BracesIcon,
}
const factOrder = ['time_bindings', 'null_rules', 'conditions', 'reductions', 'facts']

function relatedIcon(kind) {
  if (kind === 'time_dimension') return CalendarDaysIcon
  if (kind === 'measure') return ChartColumnIcon
  if (kind === 'entity' || kind === 'datasource') return DatabaseIcon
  return Layers2Icon
}

function repeatsExpression(fact, expression) {
  if (fact.name !== 'reductions' || !fact.structured || !expression) return false
  const value = JSON.parse(fact.value)
  return Array.isArray(value) && value.length === 1 && value[0] === expression
}

function dependencyPreview(field, object, t) {
  if (!field?.structured) return ''
  const values = JSON.parse(field.value)
  if (!Array.isArray(values)) return ''
  const declared = new Map(
    object.relations
      .filter((relation) => relation.field === 'dependencies')
      .map((relation) => [refKey(relation.ref), relation.ref.kind]),
  )
  const counts = new Map()
  for (const value of values) {
    const kind = declared.get(value)
    if (!kind) return String(values.length)
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  return [...counts].map(([kind, count]) => `${count} ${t(kindLabels[kind] ?? kind)}`).join(' · ')
}

function DefinitionNode({ object, objects, navigate }) {
  const t = useCopy()
  const [notice, setNotice] = useState('')
  const definition = object.computation
  const reductionsFact = definition.facts.find((fact) => fact.name === 'reductions')
  const reductions = reductionsFact?.structured ? JSON.parse(reductionsFact.value) : []
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
      {!!definition.expression && (
        <div className="sb-expression-code">
          <Button
            variant="ghost"
            type="button"
            className="sb-expression-copy"
            size="sm"
            onClick={copy}
            aria-label={t('marivo.presentation.copy-code')}
          >
            <CopyIcon aria-hidden="true" />
            <span>{t('marivo.presentation.copy-code')}</span>
          </Button>
          <pre>
            <code>
              <ExpressionText
                value={definition.expression}
                object={object}
                objects={objects}
                navigate={navigate}
              />
            </code>
          </pre>
        </div>
      )}
      <span role="status">{t(notice)}</span>
      {[...definition.facts]
        .filter((fact) => !repeatsExpression(fact, definition.expression))
        .sort((a, b) => factOrder.indexOf(a.name) - factOrder.indexOf(b.name))
        .map((fact) => {
          const Icon = factIcons[fact.name] ?? BracesIcon
          if (fact.name === 'time_bindings' || fact.name === 'null_rules') {
            return (
              <div className="sb-fact sb-fact-row" key={fact.name}>
                <Icon className="sb-fact-icon" aria-hidden="true" />
                <span className="sb-fact-label">{t(fieldLabels[fact.name] ?? fact.name)}</span>
                <div className="sb-fact-value">
                  {fact.name === 'time_bindings' ? (
                    <TimeBindingValue
                      fact={fact}
                      object={object}
                      objects={objects}
                      navigate={navigate}
                    />
                  ) : (
                    <NullRuleValue
                      fact={fact}
                      expression={definition.expression}
                      reductions={
                        Array.isArray(reductions)
                          ? reductions.filter((item) => typeof item === 'string')
                          : []
                      }
                      object={object}
                      objects={objects}
                      navigate={navigate}
                    />
                  )}
                </div>
              </div>
            )
          }
          // Calculation strings may refer to any declared dependency, not only
          // the time-binding field. Never create links for undeclared text.
          const factObject = {
            ...object,
            relations: object.relations.map((relation) => ({ ...relation, field: fact.name })),
          }
          return (
            <details className="sb-fact" key={fact.name}>
              <summary>
                <Icon className="sb-fact-icon" aria-hidden="true" />
                <span className="sb-fact-label">{t(fieldLabels[fact.name] ?? fact.name)}</span>
                <ChevronDownIcon className="sb-disclosure-icon" aria-hidden="true" />
              </summary>
              <div className="sb-fact-content">
                <FieldValue
                  field={fact}
                  object={factObject}
                  objects={objects}
                  navigate={navigate}
                />
              </div>
            </details>
          )
        })}
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
  const hasContent = (item) => item.computation.expression || item.computation.facts.length
  const visibleRelated = related.filter(hasContent)
  const dependencies = object.fields?.find((field) => field.name === 'dependencies' && field.value)
  if (!hasContent(object) && !visibleRelated.length && !limited && !dependencies) return null
  return (
    <Card
      role="region"
      className="sb-computation"
      aria-label={t('marivo.semantic.metric-computation')}
    >
      <CardHeader>
        <CardTitle>
          {t(
            object.computation.expression
              ? 'marivo.semantic.formula'
              : 'marivo.semantic.computation',
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="sb-computation-content">
        {hasContent(object) && (
          <DefinitionNode
            key={refKey(object.ref)}
            object={object}
            objects={objects}
            navigate={navigate}
          />
        )}
        {dependencies && (
          <details className="sb-fact sb-dependencies">
            <summary>
              <Layers2Icon className="sb-fact-icon" aria-hidden="true" />
              <span className="sb-fact-label">{t('marivo.semantic.declared-dependencies')}</span>
              <span className="sb-fact-preview">{dependencyPreview(dependencies, object, t)}</span>
              <ChevronDownIcon className="sb-disclosure-icon" aria-hidden="true" />
            </summary>
            <div className="sb-fact-content">
              <FieldValue
                field={dependencies}
                object={object}
                objects={objects}
                navigate={navigate}
              />
            </div>
          </details>
        )}
        {(!!visibleRelated.length || limited) && (
          <section
            className="sb-referenced-definitions"
            aria-label={t('marivo.semantic.referenced-object-definitions')}
          >
            <h3>
              {t('marivo.semantic.referenced-object-definitions')} ({visibleRelated.length}
              {limited ? '+' : ''})
            </h3>
            <div className="sb-definition-entries">
              {visibleRelated.map((child) => {
                const Icon = relatedIcon(child.ref.kind)
                return (
                  <details className="sb-definition-entry" key={refKey(child.ref)}>
                    <summary>
                      <Icon className="sb-related-icon" aria-hidden="true" />
                      <span className="sb-related-body">
                        <Button
                          type="button"
                          variant="link"
                          className="sb-related-name"
                          title={refKey(child.ref)}
                          aria-description={refKey(child.ref)}
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            navigate(refKey(child.ref))
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
                          }}
                        >
                          {refDisplayName(child.ref, objects)}
                        </Button>
                        {child.definition && <span className="sb-muted">{child.definition}</span>}
                      </span>
                      <span className="sb-sr-only">
                        {t(kindLabels[child.ref.kind] ?? child.ref.kind)}
                      </span>
                      <ChevronDownIcon className="sb-disclosure-icon" aria-hidden="true" />
                    </summary>
                    <section aria-label={refKey(child.ref)}>
                      <DefinitionNode object={child} objects={objects} navigate={navigate} />
                      {!!child.guardrails.length && (
                        <ul>
                          {[...new Set(child.guardrails)].map((text) => (
                            <li key={text}>{text}</li>
                          ))}
                        </ul>
                      )}
                    </section>
                  </details>
                )
              })}
              {limited && (
                <p>
                  {t('marivo.semantic.showing-the-first-40-referenced-definitions-click-an-object')}
                </p>
              )}
            </div>
          </section>
        )}
      </CardContent>
    </Card>
  )
}
