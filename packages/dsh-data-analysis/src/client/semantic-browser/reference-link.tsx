// @ts-nocheck -- JSX is bundled by the plugin client build.

import { Fragment } from 'react'
import { refKey } from '../../semantic-reference/contracts.ts'
import { useCopy } from './../i18n/context.tsx'
import { Button } from '../ui/controls.tsx'
import { fieldLabels } from './labels.ts'

/** Add the shortest necessary scope when another declared object shares the name. */
export function refDisplayName(refValue, objects, additionalRefs = []) {
  const key = refKey(refValue)
  const candidates = new Map()
  for (const object of objects.values()) {
    if (object.ref) candidates.set(refKey(object.ref), object.ref)
  }
  for (const ref of additionalRefs) candidates.set(refKey(ref), ref)
  candidates.delete(key)
  const parts = refValue.path.split('.')
  for (let length = 1; length <= parts.length; length++) {
    const suffix = parts.slice(-length).join('.')
    if (
      ![...candidates.values()].some(
        (candidate) => candidate.path.split('.').slice(-length).join('.') === suffix,
      )
    )
      return suffix
  }
  return key
}

export function RefLink({ refValue, objects, navigate, children }) {
  const t = useCopy()

  if (!refValue) return <span>{t('marivo.semantic.not-declared')}</span>
  const key = refKey(refValue)
  const object = objects.get(key)
  return (
    <Button
      variant="link"
      type="button"
      className="sb-definition-link"
      disabled={!object}
      title={key}
      aria-description={key}
      onClick={() => navigate(key)}
    >
      {children ?? refValue.path}
      {!object ? t('marivo.semantic.not-in-this-catalog') : ''}
    </Button>
  )
}

/** Only link exact references declared for this field by the Catalog projection. */
function LinkedText({ value, refs, objects, navigate }) {
  if (!refs.size) return value || '—'
  const pattern = [...refs.keys()]
    .sort((a, b) => b.length - a.length)
    .map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')
  const matcher = new RegExp(`(?<![\\p{L}\\p{N}_.:])(${pattern})(?![\\p{L}\\p{N}_.:])`, 'gu')
  const parts = []
  let offset = 0
  for (const match of value.matchAll(matcher)) {
    parts.push(value.slice(offset, match.index))
    parts.push(
      <RefLink
        key={match.index}
        refValue={refs.get(match[0])}
        objects={objects}
        navigate={navigate}
      >
        {refDisplayName(refs.get(match[0]), objects, refs.values())}
      </RefLink>,
    )
    offset = match.index + match[0].length
  }
  parts.push(value.slice(offset))
  return <Fragment>{parts}</Fragment>
}

/** Link only Catalog-declared references and preserve the underlying formula for copying. */
export function ExpressionText({ value, object, objects, navigate }) {
  const refs = new Map(object.relations.map(({ ref }) => [refKey(ref), ref]))
  return <LinkedText value={value} refs={refs} objects={objects} navigate={navigate} />
}

function StructuredValue({ value, refs, objects, navigate, context }) {
  const t = useCopy()
  if (Array.isArray(value)) {
    if (!value.length) return '—'
    const entry = (item, index) => (
      <li key={index}>
        <StructuredValue
          value={item}
          refs={refs}
          objects={objects}
          navigate={navigate}
          context={context}
        />
      </li>
    )
    return (
      <ul className="sb-value-list">
        {value.slice(0, 8).map(entry)}
        {value.length > 8 && (
          <li className="sb-value-more">
            <details>
              <summary>
                {t('marivo.semantic.show-remaining-values', { p0: value.length - 8 })}
              </summary>
              <ul className="sb-value-list">
                {value.slice(8).map((item, index) => entry(item, index + 8))}
              </ul>
            </details>
          </li>
        )}
      </ul>
    )
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
    if (!entries.length) return '—'
    return (
      <dl className="sb-value-map">
        {entries.map(([key, item]) => (
          <Fragment key={key}>
            <dt className="sb-value-key">{t(fieldLabels[key] ?? key)}</dt>
            <dd>
              {context === 'time_bindings' &&
              key === 'source' &&
              ['entity_default', 'explicit', 'none'].includes(item) ? (
                t(`marivo.semantic.binding-source-${item}`)
              ) : context === 'time_bindings' &&
                key === 'branch' &&
                (typeof item === 'string' || Array.isArray(item)) ? (
                <details>
                  <summary>
                    {t('marivo.semantic.view-calculation-branch')}
                    {Array.isArray(item) ? ` (${item.length})` : ''}
                  </summary>
                  <StructuredValue
                    value={item}
                    refs={refs}
                    objects={objects}
                    navigate={navigate}
                    context={context}
                  />
                </details>
              ) : (
                <StructuredValue
                  value={item}
                  refs={refs}
                  objects={objects}
                  navigate={navigate}
                  context={context}
                />
              )}
            </dd>
          </Fragment>
        ))}
      </dl>
    )
  }
  if (typeof value === 'string' && refs.has(value)) {
    return (
      <RefLink refValue={refs.get(value)} objects={objects} navigate={navigate}>
        {refDisplayName(refs.get(value), objects, refs.values())}
      </RefLink>
    )
  }
  return (
    <LinkedText
      value={value === null ? '—' : String(value)}
      refs={refs}
      objects={objects}
      navigate={navigate}
    />
  )
}

export function FieldValue({ field, object, objects, navigate }) {
  const t = useCopy()
  if (field.name === 'cardinality' && object.ref?.kind === 'relationship' && !field.structured) {
    const labels = {
      one_to_one: 'marivo.semantic.cardinality-one-to-one',
      one_to_many: 'marivo.semantic.cardinality-one-to-many',
      many_to_one: 'marivo.semantic.cardinality-many-to-one',
      many_to_many: 'marivo.semantic.cardinality-many-to-many',
    }
    if (Object.hasOwn(labels, field.value)) return t(labels[field.value])
  }
  if (
    (field.name === 'is_default_time' || field.name === 'default') &&
    (field.value === 'true' || field.value === 'false') &&
    !field.structured
  )
    return t(field.value === 'true' ? 'marivo.semantic.yes' : 'marivo.semantic.no')
  if (field.name === 'domain' && object.domain) {
    const domain = objects.get(`domain:${object.domain}`)
    if (domain)
      return (
        <RefLink refValue={domain.ref} objects={objects} navigate={navigate}>
          {field.value}
        </RefLink>
      )
  }
  const refs = new Map(
    object.relations
      .filter((relation) => relation.field === field.name)
      .map((relation) => [refKey(relation.ref), relation.ref]),
  )
  if (field.structured) {
    const value = JSON.parse(field.value)
    if (
      field.name === 'keys' &&
      object.ref?.kind === 'relationship' &&
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((item) => Array.isArray(item) && item.length === 2)
    )
      return (
        <ol className="sb-value-list">
          {value.map(([from, to], index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: Catalog pairs are immutable and may repeat.
            <li key={index}>
              <dl className="sb-value-map">
                <dt className="sb-value-key">{t('marivo.semantic.join-source-key')}</dt>
                <dd>
                  <StructuredValue value={from} refs={refs} objects={objects} navigate={navigate} />
                </dd>
                <dt className="sb-value-key">{t('marivo.semantic.join-target-key')}</dt>
                <dd>
                  <StructuredValue value={to} refs={refs} objects={objects} navigate={navigate} />
                </dd>
              </dl>
            </li>
          ))}
        </ol>
      )
    if (
      (field.name === 'levels' || field.name === 'facts') &&
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((item) => Array.isArray(item) && item.length === 2)
    )
      return (
        <dl className="sb-value-map">
          {value.map(([key, item], index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: Catalog pairs are immutable and may repeat.
            <Fragment key={index}>
              <dt className="sb-value-key">
                {field.name === 'facts' && typeof key === 'string' && fieldLabels[key] ? (
                  t(
                    key === 'default_time' && (item === 'true' || item === 'false')
                      ? 'marivo.semantic.is-default-time-dimension'
                      : fieldLabels[key],
                  )
                ) : (
                  <StructuredValue value={key} refs={refs} objects={objects} navigate={navigate} />
                )}
              </dt>
              <dd>
                {field.name === 'facts' &&
                key === 'default_time' &&
                (item === 'true' || item === 'false') ? (
                  t(item === 'true' ? 'marivo.semantic.yes' : 'marivo.semantic.no')
                ) : (
                  <StructuredValue value={item} refs={refs} objects={objects} navigate={navigate} />
                )}
              </dd>
            </Fragment>
          ))}
        </dl>
      )
    return (
      <StructuredValue
        value={value}
        refs={refs}
        objects={objects}
        navigate={navigate}
        context={field.name}
      />
    )
  }
  return <LinkedText value={field.value} refs={refs} objects={objects} navigate={navigate} />
}
