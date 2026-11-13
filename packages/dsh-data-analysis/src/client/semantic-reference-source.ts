import type { Context } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
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
import { semanticReference } from './semantic-reference.ts'

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
  'reference-context-changed': '语义引用所属会话或工作区已变化。请在当前工作区重新选择引用。',
  'catalog-load-failed': '无法加载语义目录。请在语义层浏览器检查当前项目，再重试。',
  'reference-runtime-unavailable': '当前工作区的 Marivo Runtime 不可用。请检查绑定后重试。',
  ...semanticKindLabels,
}
const en = {
  recent: 'Frequently selected in the last 7 days',
  strict: 'Semantic objects',
  fuzzy: 'Similar text',
  'reference-context-changed':
    'The semantic reference context changed. Select it again in the current Workspace.',
  'catalog-load-failed':
    'Cannot load the semantic Catalog. Check the current project in the semantic browser, then retry.',
  'reference-runtime-unavailable':
    'The current Workspace Marivo Runtime is unavailable. Check its binding, then retry.',
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
  notify?: (sessionId: SessionId, message: string) => void,
): InputTriggerSource {
  const lastFailure = new Map<SessionId, string>()
  const call = async (
    endpoint: string,
    payload: unknown,
    signal: AbortSignal,
    sessionId?: SessionId,
  ): Promise<unknown> => {
    signal.throwIfAborted()
    const result = await rpc.call(CHANNEL, `semantic-references/${endpoint}`, payload, signal)
    signal.throwIfAborted()
    if (!result.ok) {
      const failure =
        result.error && typeof result.error === 'object'
          ? Reflect.get(result.error, 'message')
          : undefined
      const key =
        failure === 'reference-context-changed' || failure === 'catalog-load-failed'
          ? failure
          : 'reference-runtime-unavailable'
      if (sessionId !== undefined && lastFailure.get(sessionId) !== key) {
        lastFailure.clear()
        lastFailure.set(sessionId, key)
        notify?.(sessionId, translate(key))
      }
      throw new Error(translate(key))
    }
    if (sessionId !== undefined) lastFailure.delete(sessionId)
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
          session.sessionId,
        ),
      )
      return response.items.map((item) => {
        const kind = Object.hasOwn(zh, item.ref.kind) ? translate(item.ref.kind) : item.ref.kind
        const prefix = `${kind} · `
        const path = item.ref.path
        // The Catalog name is often already the last path segment. Only use a
        // separate title when it adds information: the Host renders `name`
        // alongside a different `label` as an alias.
        const distinctName = item.name !== path && item.name !== path.split('.').at(-1)
        const envelope: Envelope = {
          schema: 'dsh-data-analysis-semantic-reference/v1',
          sessionId: session.sessionId,
          environmentFingerprint: response.environmentFingerprint,
          ref: item.ref,
        }
        return {
          name: `${prefix}${path}`,
          ...(distinctName ? { label: item.name } : {}),
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
        insert: semanticReference(envelope),
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
export function installSemanticReferenceSource(
  ctx: Pick<Context, 'effect' | 'locale' | 'inputTriggers'> & {
    sessions: Pick<ISessions, 'scope'>
    conversation: Pick<IConversation, 'input'>
  },
  rpc: RpcPort,
): void {
  ctx.effect(() => ctx.locale.register('marivo.semantic-reference', { zh, en }))
  ctx.effect(() => {
    const controller = new AbortController()
    const remove = ctx.inputTriggers.registerSource(
      createSemanticReferenceSource(
        rpc,
        (key) => ctx.locale.bind('marivo.semantic-reference')(key as keyof typeof zh),
        controller.signal,
        (sessionId, message) => {
          const scope = ctx.sessions.scope(sessionId)
          if (scope) ctx.conversation.input.for(scope).notify('error', message)
        },
      ),
    )
    return () => {
      controller.abort()
      remove()
    }
  })
}
