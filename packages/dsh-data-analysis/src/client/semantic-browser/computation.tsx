// @ts-nocheck -- JSX is bundled by the plugin client build.

import { BracesIcon, ChevronDownIcon, CopyIcon, Layers2Icon, SigmaIcon } from 'lucide-react'
import { useState } from 'react'
import { refKey } from '../../semantic-reference/contracts.ts'
import { useCopy } from '../i18n/context.tsx'
import { Button } from '../ui/controls.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/primitives/card.tsx'
import { fieldIcon, kindIcon } from './icons.ts'
import { fieldLabels, kindLabels } from './labels.ts'
import { representedByRelations } from './presentation.ts'
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
  const summary = fields.map((field, index) => {
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
  return (
    <div>
      {summary}
      <details>
        <summary>{t('marivo.semantic.time-binding-details')}</summary>
        <FieldValue field={fact} object={object} objects={objects} navigate={navigate} />
      </details>
    </div>
  )
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
    let branch = branches.find((candidate) => item.startsWith(`${candidate}: `))
    if (!branch) {
      // Some snapshots omit a matching reduction. Only split on a known, fully
      // recognized policy suffix; arbitrary vendor text must remain unchanged.
      for (const marker of [
        ': nulls=ignore: ignore NULL contributions; ',
        ': nulls=error: assert non-NULL demanded contributions; a demanded NULL raises an error; ',
        ': count counts source rows; empty input returns zero',
      ]) {
        const index = item.lastIndexOf(marker)
        if (index > 0 && readableNullRule(item.slice(index + 2), t) !== null) {
          branch = item.slice(0, index)
          break
        }
      }
    }
    const rule = branch ? item.slice(branch.length + 2) : item
    return { branch, raw: item, rule, text: readableNullRule(rule, t) }
  })
  if (!rules.length) return t('marivo.semantic.not-declared')
  if (rules.every((rule) => rule.text !== null && rule.text === rules[0].text)) return rules[0].text
  if (rules.length === 1)
    return (
      <ExpressionText value={rules[0].raw} object={object} objects={objects} navigate={navigate} />
    )
  const summaries = [...new Map(rules.map((rule) => [rule.text ?? rule.rule, rule])).values()]
  const branchRules = [
    ...new Map(rules.filter((rule) => rule.branch).map((rule) => [rule.raw, rule])).values(),
  ]
  return (
    <div className="sb-null-rules">
      <ul className="sb-null-rule-summary">
        {summaries.map((rule) => (
          <li key={rule.text ?? rule.rule}>
            {rule.text ?? (
              <ExpressionText
                value={rule.rule}
                object={object}
                objects={objects}
                navigate={navigate}
              />
            )}
          </li>
        ))}
      </ul>
      {!!branchRules.length && (
        <details className="sb-null-rule-branches">
          <summary>{t('marivo.semantic.null-rule-branches')}</summary>
          {branchRules.map((rule) => (
            <div key={rule.raw}>
              <ExpressionText
                value={rule.branch}
                object={object}
                objects={objects}
                navigate={navigate}
              />
              :{' '}
              {rule.text ?? (
                <ExpressionText
                  value={rule.rule}
                  object={object}
                  objects={objects}
                  navigate={navigate}
                />
              )}
            </div>
          ))}
        </details>
      )}
    </div>
  )
}

const factOrder = [
  'unit',
  'additivity',
  'time_bindings',
  'null_rules',
  'conditions',
  'reductions',
  'facts',
]

export function measureDefinitionFields(object) {
  return object.ref.kind === 'measure'
    ? (object.fields ?? []).filter(
        (field) => (field.name === 'unit' || field.name === 'additivity') && field.value,
      )
    : []
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

// Captured calculation facts include references from transitive dependencies.
// Follow only Catalog-declared dependency edges, retaining missing targets as links.
function computationReferences(object, objects) {
  const seen = new Set([refKey(object.ref)])
  const queue = [object]
  const relations = new Map()
  for (let index = 0; index < queue.length; index++) {
    for (const relation of queue[index].relations ?? []) {
      const key = refKey(relation.ref)
      relations.set(key, relation)
      if (relation.field !== 'dependencies' || seen.has(key)) continue
      seen.add(key)
      const dependency = objects.get(key)
      if (dependency) queue.push(dependency)
    }
  }
  return { ...object, relations: [...relations.values()] }
}

function distinctConditions(fact) {
  if (fact.name !== 'conditions' || !fact.structured) return fact
  const value = JSON.parse(fact.value)
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) return fact
  return { ...fact, value: JSON.stringify([...new Set(value)]) }
}

function DefinitionNode({ object, objects, navigate }) {
  const t = useCopy()
  const [notice, setNotice] = useState('')
  const definition = object.computation
  const linkedObject = computationReferences(object, objects)
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
                object={linkedObject}
                objects={objects}
                navigate={navigate}
              />
            </code>
          </pre>
        </div>
      )}
      <span role="status">{t(notice)}</span>
      {[...measureDefinitionFields(object), ...definition.facts]
        .filter((fact) => !repeatsExpression(fact, definition.expression))
        .sort((a, b) => factOrder.indexOf(a.name) - factOrder.indexOf(b.name))
        .map((fact) => {
          const Icon = fieldIcon(fact.name)
          if (['unit', 'additivity', 'time_bindings', 'null_rules'].includes(fact.name)) {
            return (
              <div className="sb-fact sb-fact-row" key={fact.name}>
                <Icon className="sb-fact-icon" aria-hidden="true" />
                <span className="sb-fact-label">{t(fieldLabels[fact.name] ?? fact.name)}</span>
                <div className="sb-fact-value">
                  {fact.name === 'time_bindings' ? (
                    <TimeBindingValue
                      fact={fact}
                      object={linkedObject}
                      objects={objects}
                      navigate={navigate}
                    />
                  ) : fact.name === 'null_rules' ? (
                    <NullRuleValue
                      fact={fact}
                      expression={definition.expression}
                      reductions={
                        Array.isArray(reductions)
                          ? reductions.filter((item) => typeof item === 'string')
                          : []
                      }
                      object={linkedObject}
                      objects={objects}
                      navigate={navigate}
                    />
                  ) : (
                    <FieldValue
                      field={fact}
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
            ...linkedObject,
            relations: linkedObject.relations.map((relation) => ({
              ...relation,
              field: fact.name,
            })),
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
                  field={distinctConditions(fact)}
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
  const hasContent = (item) =>
    item.computation.expression ||
    item.computation.facts.length ||
    measureDefinitionFields(item).length
  const visibleRelated = related.filter(hasContent)
  const dependencies = object.fields?.find(
    (field) =>
      field.name === 'dependencies' && field.value && !representedByRelations(field, object),
  )
  if (!hasContent(object) && !visibleRelated.length && !limited && !dependencies) return null
  return (
    <Card
      role="region"
      className="sb-computation"
      aria-label={t('marivo.semantic.metric-computation')}
    >
      <CardHeader>
        <CardTitle className="sb-section-heading">
          <SigmaIcon aria-hidden="true" />
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
            <h3 className="sb-section-heading">
              <BracesIcon aria-hidden="true" />
              {t('marivo.semantic.referenced-object-definitions')} ({visibleRelated.length}
              {limited ? '+' : ''})
            </h3>
            <ul className="sb-definition-entries">
              {visibleRelated.map((child) => {
                const Icon = kindIcon(child.ref.kind)
                return (
                  <li className="sb-definition-entry" key={refKey(child.ref)}>
                    <Icon className="sb-related-icon" aria-hidden="true" />
                    <Button
                      type="button"
                      variant="link"
                      className="sb-related-name"
                      title={refKey(child.ref)}
                      aria-description={refKey(child.ref)}
                      onClick={() => navigate(refKey(child.ref))}
                    >
                      {refDisplayName(child.ref, objects)}
                    </Button>
                    <span className="sb-sr-only">
                      {t(kindLabels[child.ref.kind] ?? child.ref.kind)}
                    </span>
                  </li>
                )
              })}
            </ul>
            {limited && (
              <p>
                {t('marivo.semantic.showing-the-first-40-referenced-definitions-click-an-object')}
              </p>
            )}
          </section>
        )}
      </CardContent>
    </Card>
  )
}
