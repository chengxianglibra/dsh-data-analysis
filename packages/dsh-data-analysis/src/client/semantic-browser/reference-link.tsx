// @ts-nocheck -- JSX is bundled by the plugin client build.

import { Fragment } from 'react'
import { refKey } from '../../semantic-reference/contracts.ts'
import { useCopy } from './../i18n/context.tsx'

export function RefLink({ refValue, objects, navigate, children }) {
  const t = useCopy()

  if (!refValue) return <span>{t('marivo.semantic.not-declared')}</span>
  const key = refKey(refValue)
  const object = objects.get(key)
  return (
    <button
      type="button"
      className="sb-definition-link"
      disabled={!object}
      title={key}
      onClick={() => navigate(key)}
    >
      {children ?? refValue.path}
      {!object ? t('marivo.semantic.not-in-this-catalog') : ''}
    </button>
  )
}

/** Only link exact references declared for this field by the Catalog projection. */
export function FieldValue({ field, object, objects, navigate }) {
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
  if (!refs.size) return field.value || '—'
  const pattern = [...refs.keys()]
    .sort((a, b) => b.length - a.length)
    .map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')
  const matcher = new RegExp(`(?<![\\p{L}\\p{N}_.:])(${pattern})(?![\\p{L}\\p{N}_.:])`, 'gu')
  const parts = []
  let offset = 0
  for (const match of field.value.matchAll(matcher)) {
    parts.push(field.value.slice(offset, match.index))
    parts.push(
      <RefLink
        key={match.index}
        refValue={refs.get(match[0])}
        objects={objects}
        navigate={navigate}
      >
        {match[0]}
      </RefLink>,
    )
    offset = match.index + match[0].length
  }
  parts.push(field.value.slice(offset))
  return <Fragment>{parts}</Fragment>
}
