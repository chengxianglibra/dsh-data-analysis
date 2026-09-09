import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import {
  boundedText,
  CHANNEL,
  closed,
  type Envelope,
  envelopeJson,
  parseCandidatesResponse,
  parseEnvelope,
  parseJson,
  refKey,
  SOURCE,
} from '../semantic-reference/contracts.ts'
import { semanticKindLabels } from '../semantic-reference/labels.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'marivo.semantic-reference': keyof typeof zh
  }
}
interface RpcPort {
  call(
    channel: string,
    endpoint: string,
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<{ ok: true; value: unknown } | { ok: false; error: unknown }>
}
const zh = {
  recent: '最近 7 天常用',
  strict: '语义对象',
  fuzzy: '相近结果',
  ...semanticKindLabels,
}
const en = {
  recent: 'Frequently selected in the last 7 days',
  strict: 'Semantic objects',
  fuzzy: 'Similar text',
  domain: 'Domain',
  datasource: 'Datasource',
  entity: 'Entity',
  dimension: 'Dimension',
  measure: 'Measure',
  time_dimension: 'Time dimension',
  metric: 'Metric',
  relationship: 'Relationship',
  event: 'Event',
  state_model: 'State model',
  period_calendar: 'Period calendar',
  temporal_set: 'Temporal set',
  work_schedule: 'Work schedule',
}
export function createSemanticReferenceSource(
  rpc: RpcPort,
  translate: (key: string) => string = (key) => zh[key as keyof typeof zh] ?? key,
  lifetime = new AbortController().signal,
): InputTriggerSource {
  const call = async (
    endpoint: string,
    payload: unknown,
    signal: AbortSignal,
  ): Promise<unknown> => {
    signal.throwIfAborted()
    const result = await rpc.call(CHANNEL, `semantic-references/${endpoint}`, payload, signal)
    signal.throwIfAborted()
    if (!result.ok) throw new Error('Marivo semantic reference request failed')
    return result.value
  }
  return {
    trigger: '@',
    name: SOURCE,
    order: -20,
    async candidates(session, request) {
      const signal = AbortSignal.any([request.signal, lifetime])
      const response = parseCandidatesResponse(
        await call(
          'candidates',
          {
            version: 1,
            sessionId: session.sessionId,
            query: request.query,
            quoted: request.quoted ?? false,
          },
          signal,
        ),
      )
      return response.items.map((item) => {
        const kind = Object.hasOwn(zh, item.ref.kind) ? translate(item.ref.kind) : item.ref.kind
        const envelope: Envelope = {
          schema: 'dsh-data-analysis-semantic-reference/v1',
          sessionId: session.sessionId,
          environmentFingerprint: response.environmentFingerprint,
          ref: item.ref,
        }
        return {
          name: `${kind} · ${item.ref.path}`,
          ...(item.businessDefinition ? { description: item.businessDefinition } : {}),
          section: item.section === 'kind' ? kind : translate(item.section),
          value: envelopeJson(envelope),
        }
      })
    },
    onPick(pick) {
      lifetime.throwIfAborted()
      const envelope = parseEnvelope(parseJson(pick.candidate.value))
      if (envelope.sessionId !== pick.session.sessionId)
        throw new Error('invalid-reference-session')
      void call('selected', { envelope }, lifetime).catch(() => {
        if (!lifetime.aborted) console.warn('Marivo semantic reference usage unavailable')
      })
      return {
        insert: {
          source: SOURCE,
          ref: envelopeJson(envelope),
          label: refKey(envelope.ref),
          clipboardText: `@${refKey(envelope.ref)}`,
        },
      }
    },
    codec: {
      clipboardText(ref) {
        return `@${refKey(parseEnvelope(parseJson(ref)).ref)}`
      },
      async serialize(ref, caller) {
        const envelope = parseEnvelope(parseJson(ref))
        const response = closed(
          await call('serialize', { envelope }, AbortSignal.any([caller, lifetime])),
          ['text'],
        )
        return boundedText(response.text, 16_384)
      },
    },
  }
}
export function installSemanticReferenceSource(ctx: Context, rpc: RpcPort): void {
  ctx.effect(() => ctx.locale.register('marivo.semantic-reference', { zh, en }))
  ctx.effect(() => {
    const controller = new AbortController()
    const remove = ctx.inputTriggers.registerSource(
      createSemanticReferenceSource(
        rpc,
        (key) => ctx.locale.bind('marivo.semantic-reference')(key as keyof typeof zh),
        controller.signal,
      ),
    )
    return () => {
      controller.abort()
      remove()
    }
  })
}
