// @ts-nocheck -- browser contracts are supplied by the DSH module table at runtime.

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { useCallback, useEffect, useMemo, useState } from 'react'

const TOOL_NAME = 'marivo_test'
const REPORT_TOOL_NAME = 'marivo_report_render'
const REPORT_META_KIND = 'marivo-html-report'
const REPORT_META_VERSION = 1
const REPORT_DURABLE_CONTENT_KIND = 'marivo-report-card'
const REPORT_DELIVERY_DEFINITION_KIND = 'marivo-report-delivery'
const REPORT_TURN_DATA_KEY = REPORT_DELIVERY_DEFINITION_KIND
const CITATION_META_KIND = 'marivo-evidence-citations'
const CITATION_META_VERSION = 2
const CITATION_REGISTRY_DEFINITION_KIND = 'marivo-citation-registry'
const CITATION_ANSWER_DEFINITION_KIND = 'marivo-citations'
const CITATION_TURN_DATA_KEY = CITATION_ANSWER_DEFINITION_KIND
const CITATION_LOCALE_NAMESPACE = 'marivo-citations'
const CITATION_ZH = {
  'source.title': 'Marivo 来源',
  'source.quality': 'quality: {value}',
  'source.unlabeled': '未标注',
  'source.unknown': '未知 handle：最近的完整 Marivo registry 中没有该来源。',
  'source.finding': 'Finding {id}',
  'source.artifact': 'Artifact {id}',
  'source.session': 'Marivo Session {id} · 提交 {committedAt}',
  'source.audit': '审计详情',
  'source.item': 'canonical item: {id}',
  'source.versions': 'extractor {extractor} · Artifact schema {schema}',
  'source.missingDefinition': '回答中缺少工具签发的 footnote definition。',
  'source.mismatchedDefinition': '回答中的 footnote definition 与工具签发内容不一致。',
  'source.disclaimer': '来源卡片确认 Evidence 身份，不等于验证整句话或业务判断。',
}
const CITATION_EN = {
  'source.title': 'Marivo sources',
  'source.quality': 'quality: {value}',
  'source.unlabeled': 'not labeled',
  'source.unknown': 'Unknown handle: the nearest complete Marivo registry has no matching source.',
  'source.finding': 'Finding {id}',
  'source.artifact': 'Artifact {id}',
  'source.session': 'Marivo Session {id} · committed {committedAt}',
  'source.audit': 'Audit details',
  'source.item': 'canonical item: {id}',
  'source.versions': 'extractor {extractor} · Artifact schema {schema}',
  'source.missingDefinition': 'The answer is missing the footnote definition issued by the tool.',
  'source.mismatchedDefinition':
    'The footnote definition in the answer does not match the tool-issued content.',
  'source.disclaimer':
    'This card confirms Evidence identity; it does not validate the whole statement or business judgment.',
}
const openedCalls = new Set<string>()

export interface MarivoCitationSource {
  handle: string
  marker: string
  rendered: { en: string; zh: string }
  environmentFingerprint: string
  sessionId: string
  findingId: string
  findingType: string
  epistemicKind: string
  artifactId: string
  canonicalItemKey: string
  qualityStatus: string | null
  committedAt: string
  extractorVersion: string
  artifactSchemaVersion: string
}

export interface ParsedMarivoFootnotes {
  references: string[]
  definitions: Array<{ handle: string; body: string }>
}

export interface MarivoReportPresentationMeta {
  readonly kind: typeof REPORT_META_KIND
  readonly version: typeof REPORT_META_VERSION
  readonly title: string
  readonly path: string
  readonly reportDigest: string
  readonly disclosures: readonly string[]
}

export interface MarivoReportCardModel {
  readonly state: 'running' | 'ready' | 'fallback'
  readonly summary: string
  readonly report: MarivoReportPresentationMeta | null
}

export interface MarivoReportTurnDelivery {
  readonly seq: number
  readonly report: MarivoReportPresentationMeta
}

export interface MarivoReportTurnData {
  readonly deliveries: readonly MarivoReportTurnDelivery[]
}

interface MarivoReportTurnState {
  readonly turn: number
  readonly calls: ReadonlyMap<string, string>
  readonly deliveries: readonly MarivoReportTurnDelivery[]
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  interface ConversationTurnDataMap {
    /** Ready Marivo reports collected from this exact Turn. */
    'marivo-report-delivery': MarivoReportTurnData
  }
}

export interface MarivoResolvedCitation {
  handle: string
  definitionStatus: 'matched' | 'missing' | 'mismatch'
  language: 'en' | 'zh' | null
  statement: string | null
  source: MarivoCitationSource | null
}

export interface MarivoCitationTurnData {
  seq: number
  messageId: string
  citations: MarivoResolvedCitation[]
}

function citationHandle(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /^F([1-9][0-9]{0,2})$/.exec(value)
  return match !== null && Number(match[1]) <= 100 ? value : null
}

function utf8ByteLength(value: string): number {
  let bytes = 0
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        index++
      } else bytes += 3
    } else bytes += 3
  }
  return bytes
}

function citationSource(value: unknown): MarivoCitationSource | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const handle = citationHandle(source.handle)
  if (handle === null) return null
  const marker = `[^mv-${handle.toLowerCase()}]`
  if (
    source.marker !== marker ||
    typeof source.rendered !== 'object' ||
    source.rendered === null ||
    Array.isArray(source.rendered) ||
    typeof source.environmentFingerprint !== 'string' ||
    source.environmentFingerprint === '' ||
    typeof source.sessionId !== 'string' ||
    source.sessionId === '' ||
    typeof source.findingId !== 'string' ||
    source.findingId === '' ||
    typeof source.findingType !== 'string' ||
    source.findingType === '' ||
    typeof source.epistemicKind !== 'string' ||
    source.epistemicKind === '' ||
    typeof source.artifactId !== 'string' ||
    source.artifactId === '' ||
    typeof source.canonicalItemKey !== 'string' ||
    source.canonicalItemKey === '' ||
    (source.qualityStatus !== null &&
      (typeof source.qualityStatus !== 'string' || source.qualityStatus === '')) ||
    typeof source.committedAt !== 'string' ||
    source.committedAt === '' ||
    typeof source.extractorVersion !== 'string' ||
    source.extractorVersion === '' ||
    typeof source.artifactSchemaVersion !== 'string' ||
    source.artifactSchemaVersion === ''
  )
    return null
  const rendered = source.rendered as Record<string, unknown>
  if (
    typeof rendered.en !== 'string' ||
    rendered.en.trim() === '' ||
    /\r|\n/.test(rendered.en) ||
    utf8ByteLength(rendered.en) > 8_192 ||
    typeof rendered.zh !== 'string' ||
    rendered.zh.trim() === '' ||
    /\r|\n/.test(rendered.zh) ||
    utf8ByteLength(rendered.zh) > 8_192
  )
    return null
  return {
    ...source,
    rendered: { en: rendered.en, zh: rendered.zh },
  } as unknown as MarivoCitationSource
}

function escapeMarkdownInline(value: string): string {
  return value.replaceAll('\\', '\\\\').replace(/([`*_[\]<>])/g, '\\$1')
}

/** Parse and validate the complete registry persisted in a standard Tool result meta field. */
export function parseCitationRegistryMeta(value: unknown): MarivoCitationSource[] | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const meta = value as Record<string, unknown>
  if (
    meta.kind !== CITATION_META_KIND ||
    meta.version !== CITATION_META_VERSION ||
    typeof meta.dshSessionId !== 'string' ||
    meta.dshSessionId === '' ||
    !Array.isArray(meta.registry) ||
    meta.registry.length < 1 ||
    meta.registry.length > 100
  )
    return null
  const result: MarivoCitationSource[] = []
  const handles = new Set<string>()
  const identities = new Set<string>()
  for (const [index, value] of meta.registry.entries()) {
    const source = citationSource(value)
    if (source === null) return null
    const identity = JSON.stringify([
      source.environmentFingerprint,
      source.sessionId,
      source.findingId,
    ])
    if (
      citationHandle(source.handle) !== `F${index + 1}` ||
      handles.has(source.handle) ||
      identities.has(identity)
    )
      return null
    handles.add(source.handle)
    identities.add(identity)
    result.push(source)
  }
  return result
}

function countRun(text: string, at: number, character: string): number {
  let end = at
  while (text[end] === character) end++
  return end - at
}

function closingBacktickRun(text: string, start: number, length: number): number {
  for (let index = start; index < text.length; ) {
    const next = text.indexOf('`', index)
    if (next === -1) return -1
    const run = countRun(text, next, '`')
    if (run === length) return next
    index = next + run
  }
  return -1
}

function scanInlineFootnotes(
  text: string,
  definitionCandidates: ReadonlyMap<number, { handle: string; body: string }>,
  references: string[],
  seenReferences: Set<string>,
  definitions: Array<{ handle: string; body: string }>,
): void {
  for (let index = 0; index < text.length; ) {
    if (text[index] === '\\') {
      index += 2
      continue
    }
    if (text[index] === '`') {
      const run = countRun(text, index, '`')
      const closing = closingBacktickRun(text, index + run, run)
      index = closing === -1 ? index + run : closing + run
      continue
    }
    if (text.startsWith('[^mv-f', index)) {
      const match = /^\[\^mv-f([1-9][0-9]{0,2})\]/.exec(text.slice(index))
      if (match !== null && Number(match[1]) <= 100) {
        const handle = `F${match[1]}`
        const definition = definitionCandidates.get(index)
        if (definition !== undefined) {
          definitions.push(definition)
        } else if (definition === undefined && !seenReferences.has(handle)) {
          seenReferences.add(handle)
          references.push(handle)
        }
        index += match[0].length
        continue
      }
    }
    index++
  }
}

/** Lightweight Markdown scan that ignores fenced code, inline code, and escaped markers. */
export function parseMarivoFootnotes(text: string): ParsedMarivoFootnotes {
  const references: string[] = []
  const definitions: Array<{ handle: string; body: string }> = []
  const seenReferences = new Set<string>()
  let fence: { character: string; length: number } | null = null
  let segmentLines: string[] = []

  const scanSegment = () => {
    if (segmentLines.length === 0) return
    const segment = segmentLines.join('\n')
    const definitionCandidates = new Map<number, { handle: string; body: string }>()
    let offset = 0
    for (const line of segmentLines) {
      const definitionMatch = /^ {0,3}\[\^mv-f([1-9][0-9]{0,2})\]:[ \t]?(.*)$/.exec(line)
      if (definitionMatch !== null && Number(definitionMatch[1]) <= 100) {
        const handle = `F${definitionMatch[1]}`
        definitionCandidates.set(offset + definitionMatch[0].indexOf('[^'), {
          handle,
          body: definitionMatch[2],
        })
      }
      offset += line.length + 1
    }
    scanInlineFootnotes(segment, definitionCandidates, references, seenReferences, definitions)
    segmentLines = []
  }

  for (const line of text.split(/\r?\n/)) {
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (fence !== null) {
      const close = new RegExp(`^ {0,3}${fence.character}{${fence.length},}\\s*$`)
      if (close.test(line)) fence = null
      continue
    }
    if (fenceMatch !== null && !(fenceMatch[1][0] === '`' && fenceMatch[2].includes('`'))) {
      scanSegment()
      const token = fenceMatch[1]
      fence = { character: token[0], length: token.length }
      continue
    }
    segmentLines.push(line)
  }
  scanSegment()
  return { references, definitions }
}

function assistantFootnotes(event: any): {
  references: string[]
  definitions: ReadonlyMap<string, { present: boolean; body: string | null }>
} {
  const references: string[] = []
  const definitions = new Map<string, { present: boolean; body: string | null }>()
  if (event?.type !== 'assistant/message' || !Array.isArray(event.data?.message?.content)) {
    return { references, definitions }
  }
  for (const block of event.data.message.content) {
    if (block?.type !== 'text' || typeof block.text !== 'string') continue
    const parsed = parseMarivoFootnotes(block.text)
    const localDefinitions = new Map<string, string[]>()
    for (const definition of parsed.definitions) {
      const bodies = localDefinitions.get(definition.handle) ?? []
      bodies.push(definition.body)
      localDefinitions.set(definition.handle, bodies)
    }
    for (const handle of parsed.references) {
      const bodies = localDefinitions.get(handle) ?? []
      const observed =
        bodies.length === 0
          ? { present: false, body: null }
          : { present: true, body: bodies.length === 1 ? bodies[0]! : null }
      const current = definitions.get(handle)
      if (current === undefined) {
        references.push(handle)
        definitions.set(handle, observed)
      } else if (!observed.present) {
        definitions.set(handle, { present: false, body: null })
      } else if (current.present && current.body !== observed.body) {
        definitions.set(handle, { present: true, body: null })
      }
    }
  }
  return { references, definitions }
}

function resolveDefinition(
  source: MarivoCitationSource | null,
  observed: { present: boolean; body: string | null } | undefined,
): Pick<MarivoResolvedCitation, 'definitionStatus' | 'language' | 'statement'> {
  if (observed?.present !== true) {
    return { definitionStatus: 'missing', language: null, statement: null }
  }
  if (source !== null && observed.body === escapeMarkdownInline(source.rendered.en)) {
    return { definitionStatus: 'matched', language: 'en', statement: source.rendered.en }
  }
  if (source !== null && observed.body === escapeMarkdownInline(source.rendered.zh)) {
    return { definitionStatus: 'matched', language: 'zh', statement: source.rendered.zh }
  }
  return { definitionStatus: 'mismatch', language: null, statement: null }
}

function isClosingCitationMessage(event: any): boolean {
  if (event?.type !== 'assistant/message' || !Array.isArray(event.data?.message?.content))
    return false
  if (event.data.message.content.some((block: any) => block?.type === 'tool-call')) return false
  return assistantFootnotes(event).references.length > 0
}

export const marivoCitationRegistryDefinition = {
  kind: CITATION_REGISTRY_DEFINITION_KIND,
  match(event: any) {
    if (event?.type !== 'tool/result') return null
    return parseCitationRegistryMeta(event.data?.meta) === null
      ? null
      : { id: String(event.seq), role: 'start' }
  },
  start(_context: any, match: any) {
    const registry = parseCitationRegistryMeta(match.event.data.meta)
    if (registry === null) throw new Error('Marivo citation registry start requires valid meta')
    return { registry }
  },
  update(context: any) {
    return context.state
  },
}

export const marivoAnswerCitationsDefinition = {
  kind: CITATION_ANSWER_DEFINITION_KIND,
  match(event: any) {
    return isClosingCitationMessage(event)
      ? { id: String(event.data.message.id), role: 'start' }
      : null
  },
  start(_context: any, match: any, reader: any): MarivoCitationTurnData & { turn: number } {
    const parsed = assistantFootnotes(match.event)
    const previous = reader.previous(CITATION_REGISTRY_DEFINITION_KIND)
    const registry: MarivoCitationSource[] = previous?.state?.registry ?? []
    const sources = new Map(registry.map((source) => [source.handle, source]))
    return {
      turn: match.event.data.turn,
      seq: match.event.seq,
      messageId: String(match.event.data.message.id),
      citations: parsed.references.map((handle) => {
        const source = sources.get(handle) ?? null
        return {
          handle,
          source,
          ...resolveDefinition(source, parsed.definitions.get(handle)),
        }
      }),
    }
  },
  update(context: any) {
    return context.state
  },
  buildLocationData(context: any, scope: string) {
    if (scope !== 'turn' || context.state === undefined) return null
    const { turn, seq, messageId, citations } = context.state
    return {
      kind: 'turn',
      turn,
      key: CITATION_TURN_DATA_KEY,
      value: { seq, messageId, citations },
    }
  },
}

/** Claim the turn-tail slot only for citations attached to this exact closing message. */
export function selectMarivoCitations(owner: any): MarivoResolvedCitation[] | null {
  const data = owner?.turn?.data?.get?.(CITATION_TURN_DATA_KEY) as
    | MarivoCitationTurnData
    | undefined
  return data === undefined || data.seq !== owner.seq || data.citations.length === 0
    ? null
    : data.citations
}

export interface NeedsCredentialsResult {
  status: 'needs-credentials'
  name: string
  refs: string[]
}

export function parseNeedsCredentials(text: string): NeedsCredentialsResult | null {
  try {
    const value = JSON.parse(text) as unknown
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
    const candidate = value as Record<string, unknown>
    if (
      candidate.status !== 'needs-credentials' ||
      typeof candidate.name !== 'string' ||
      !Array.isArray(candidate.refs) ||
      !candidate.refs.every((ref) => typeof ref === 'string' && ref !== '')
    )
      return null
    return {
      status: 'needs-credentials',
      name: candidate.name,
      refs: [...new Set(candidate.refs as string[])],
    }
  } catch {
    return null
  }
}

export function shouldAutoOpen(
  sessionId: string,
  callId: string,
  result: NeedsCredentialsResult | null,
): boolean {
  const key = `${sessionId}\u0000${callId}`
  if (result === null || openedCalls.has(key)) return false
  openedCalls.add(key)
  return true
}

export function blankCredentialValues(refs: readonly string[]): Record<string, string> {
  return Object.fromEntries(refs.map((ref) => [ref, '']))
}

function messageOf(value: unknown): string {
  if (value instanceof Error) return value.message
  return typeof value === 'string' ? value : '凭证保存失败'
}

function redact(text: string, values: readonly string[]): string {
  let result = text
  for (const value of values) {
    if (value !== '') result = result.split(value).join('[REDACTED]')
  }
  return result
}

export class CredentialDialogController {
  readonly api: any

  constructor(api: any) {
    this.api = api
  }

  async describe(refs: readonly string[]): Promise<Record<string, { configured: boolean }>> {
    const response = await this.api.credentials.describe({ refs: [...refs] })
    if (!response.result.ok) throw new Error(response.result.error.message)
    return response.result.value.credentials
  }

  async save(values: Readonly<Record<string, string>>): Promise<{
    ok: boolean
    saved: string[]
    errors: Record<string, string>
  }> {
    const entries = Object.entries(values)
    const secretValues = entries.map(([, value]) => value)
    const saved: string[] = []
    const errors: Record<string, string> = {}
    for (const [ref, value] of entries) {
      if (value === '') {
        errors[ref] = '请输入凭证'
        continue
      }
      try {
        const response = await this.api.credentials.set({ ref, value })
        if (response.result.ok) saved.push(ref)
        else errors[ref] = redact(response.result.error.message, secretValues)
      } catch (error) {
        errors[ref] = redact(messageOf(error), secretValues)
      }
    }
    return { ok: saved.length === entries.length, saved, errors }
  }
}

function settledText(block: any): string {
  if (block === null || typeof block !== 'object' || !('kind' in block)) return ''
  return block.content
    .filter((item: any) => item?.type === 'text')
    .map((item: any) => item.text)
    .join('')
}

/** Parse the closed replay contract persisted by marivo_report_render. */
export function parseReportPresentationMeta(value: unknown): MarivoReportPresentationMeta | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const meta = value as Record<string, unknown>
  const allowed = new Set(['kind', 'version', 'title', 'path', 'reportDigest', 'disclosures'])
  if (
    Object.keys(meta).some((key) => !allowed.has(key)) ||
    Object.keys(meta).length !== allowed.size ||
    meta.kind !== REPORT_META_KIND ||
    meta.version !== REPORT_META_VERSION ||
    typeof meta.title !== 'string' ||
    meta.title === '' ||
    typeof meta.path !== 'string' ||
    meta.path === '' ||
    typeof meta.reportDigest !== 'string' ||
    !/^[0-9a-f]{64}$/.test(meta.reportDigest) ||
    !Array.isArray(meta.disclosures) ||
    !meta.disclosures.every((item) => typeof item === 'string')
  )
    return null
  return Object.freeze({
    kind: REPORT_META_KIND,
    version: REPORT_META_VERSION,
    title: meta.title,
    path: meta.path,
    reportDigest: meta.reportDigest,
    disclosures: Object.freeze([...(meta.disclosures as string[])]),
  })
}

/** Decode the Code Mode-only card block from a persisted sub-dispatch result. */
export function parseReportDurableContent(value: unknown): MarivoReportPresentationMeta | null {
  if (!Array.isArray(value)) return null
  const cards = value.filter(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      !Array.isArray(item) &&
      (item as Record<string, unknown>).type === REPORT_DURABLE_CONTENT_KIND,
  ) as Array<Record<string, unknown>>
  if (cards.length !== 1) return null
  const card = cards[0]!
  if (
    Object.keys(card).length !== 3 ||
    !Object.hasOwn(card, 'meta') ||
    !Number.isSafeInteger(card.turn) ||
    (card.turn as number) < 0
  )
    return null
  return parseReportPresentationMeta(card.meta)
}

function codeReportDelivery(
  event: any,
): (MarivoReportTurnDelivery & { readonly turn: number }) | null {
  if (
    event?.type !== 'tool/code-dispatch' ||
    event.data?.name !== REPORT_TOOL_NAME ||
    event.data?.isError === true
  )
    return null
  const report = parseReportDurableContent(event.data.content)
  if (report === null) return null
  const card = event.data.content.find((item: any) => item?.type === REPORT_DURABLE_CONTENT_KIND)
  return { turn: card.turn, seq: event.seq, report }
}

/** Recover one ready report from its native Tool result or durable Code Mode dispatch. */
export function reportDeliveryFromEvent(
  event: any,
  calls: ReadonlyMap<string, string> = new Map(),
): MarivoReportTurnDelivery | null {
  if (event?.type === 'tool/result') {
    if (event.surfaceOp !== 'append' || !Array.isArray(event.data?.message?.content)) return null
    const blocks = event.data.message.content.filter((item: any) => item?.type === 'tool-result')
    if (blocks.length !== 1 || blocks[0].isError === true) return null
    const callId = String(event.data.message.source?.callId ?? '')
    if (calls.get(callId) !== REPORT_TOOL_NAME) return null
    const report = parseReportPresentationMeta(event.data.meta)
    return report === null ? null : { seq: event.seq, report }
  }
  const delivery = codeReportDelivery(event)
  return delivery === null ? null : { seq: delivery.seq, report: delivery.report }
}

/** Aggregate immutable native and Code Mode reports under one Harness-owned Turn key. */
export const marivoReportDeliveryDefinition = {
  kind: REPORT_DELIVERY_DEFINITION_KIND,
  match(event: any) {
    if (event?.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event?.type === 'tool/call') return { id: String(event.data.turn), role: 'update' }
    if (event?.type === 'tool/result' && event.surfaceOp === 'append') {
      return { id: String(event.data.turn), role: 'update' }
    }
    const delivery = codeReportDelivery(event)
    return delivery === null ? null : { id: String(delivery.turn), role: 'update' }
  },
  start(_context: any, match: any): MarivoReportTurnState {
    if (match.event.type !== 'turn/start') {
      throw new Error('Marivo report delivery start requires turn/start')
    }
    return { turn: match.event.data.turn, calls: new Map(), deliveries: [] }
  },
  update(context: any, match: any): MarivoReportTurnState {
    if (match.event.type === 'tool/call') {
      const calls = new Map(context.state.calls)
      calls.set(String(match.event.data.callId), String(match.event.data.name))
      return { ...context.state, calls }
    }
    const delivery = reportDeliveryFromEvent(match.event, context.state.calls)
    return delivery === null
      ? context.state
      : { ...context.state, deliveries: [...context.state.deliveries, delivery] }
  },
  buildLocationData(context: any, scope: string) {
    if (scope !== 'turn' || context.state === undefined) return null
    return {
      kind: 'turn',
      turn: context.state.turn,
      key: REPORT_TURN_DATA_KEY,
      value: { deliveries: context.state.deliveries },
    }
  },
}

/** Ready reports completed before this exact closing Assistant message. */
export function reportsForClosing(owner: any): readonly MarivoReportPresentationMeta[] {
  const data = owner?.turn?.data?.get?.(REPORT_TURN_DATA_KEY)
  if (typeof data !== 'object' || data === null || !Array.isArray(data.deliveries)) return []
  const deliveries: MarivoReportTurnDelivery[] = []
  for (const value of data.deliveries) {
    if (
      typeof value !== 'object' ||
      value === null ||
      typeof value.seq !== 'number' ||
      value.seq > owner.seq
    )
      continue
    const report = parseReportPresentationMeta(value.report)
    if (report !== null) deliveries.push({ seq: value.seq, report })
  }
  deliveries.sort((left, right) => left.seq - right.seq)
  const seen = new Set<string>()
  return deliveries.flatMap(({ report }) => {
    if (seen.has(report.reportDigest)) return []
    seen.add(report.reportDigest)
    return [report]
  })
}

/** Claim the turn tail only when its closing branch produced a ready report. */
export function selectMarivoReports(owner: any): readonly MarivoReportPresentationMeta[] | null {
  const reports = reportsForClosing(owner)
  return reports.length === 0 ? null : reports
}

/** Derive one live-or-replayed card solely from the frozen Tool call slice. */
export function marivoReportCardModel(block: any): MarivoReportCardModel {
  if (block === null || typeof block !== 'object' || !('kind' in block)) {
    return { state: 'running', summary: '正在生成 HTML 报告…', report: null }
  }
  const text = settledText(block)
  if (block.isError !== true) {
    const report =
      parseReportPresentationMeta(block.meta) ??
      (block.meta === undefined ? parseReportDurableContent(block.content) : null)
    if (report !== null) return { state: 'ready', summary: report.title, report }
  }
  const error = block.error
  const fallback =
    text ||
    (typeof error?.name === 'string' && typeof error?.code === 'string'
      ? `${error.name}: ${error.code}`
      : '报告工具已结束，但没有可打开的报告。')
  return { state: 'fallback', summary: fallback, report: null }
}

function reportOpenError(value: unknown): string {
  if (value instanceof Error && value.message !== '') return value.message
  return typeof value === 'string' && value !== '' ? value : '无法打开报告。'
}

/** Invoke the privileged Host handoff and reject every non-canonical response. */
export async function openMarivoReport(api: any, path: string): Promise<void> {
  const response = await api.host.openPath({ path })
  if (response?.result?.ok !== true) {
    throw new Error(
      typeof response?.result?.error?.message === 'string'
        ? response.result.error.message
        : 'Host 拒绝打开报告。',
    )
  }
  if (response.result.value?.opened !== true) {
    throw new Error('Host 返回了无效的打开报告响应。')
  }
}

const rowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 32,
  padding: '4px 8px',
  borderRadius: 8,
  color: 'var(--dsw-alias-text-primary, inherit)',
}
const summaryStyle = { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }
const fieldStyle = { display: 'grid', gap: 6, marginBottom: 14 }
const labelStyle = { display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }
const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid var(--dsw-alias-border-subtle, #d0d0d0)',
  color: 'inherit',
  background: 'var(--dsw-alias-surface-primary, transparent)',
}
const errorStyle = { color: 'var(--dsw-alias-text-error, #c22)', fontSize: 12, margin: 0 }

export function MarivoTestToolView({ sessionId, callId, block, connection }: any) {
  const text = settledText(block)
  const missing = useMemo(() => parseNeedsCredentials(text), [text])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [savedNotice, setSavedNotice] = useState(false)
  const [values, setValues] = useState<Record<string, string>>({})
  const [configured, setConfigured] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const controller = useMemo(() => new CredentialDialogController(connection.api), [connection.api])

  const openDialog = useCallback(() => {
    if (missing === null) return
    setValues(blankCredentialValues(missing.refs))
    setConfigured(Object.fromEntries(missing.refs.map((ref) => [ref, false])))
    setErrors({})
    setSavedNotice(false)
    setOpen(true)
  }, [missing])

  useEffect(() => {
    if (shouldAutoOpen(sessionId, callId, missing)) openDialog()
  }, [sessionId, callId, missing, openDialog])

  useEffect(() => {
    if (!open || missing === null) return
    let current = true
    controller
      .describe(missing.refs)
      .then((info) => {
        if (!current) return
        setConfigured(
          Object.fromEntries(missing.refs.map((ref) => [ref, info[ref]?.configured === true])),
        )
      })
      .catch(() => {
        if (current) setConfigured(Object.fromEntries(missing.refs.map((ref) => [ref, false])))
      })
    return () => {
      current = false
    }
  }, [open, missing, controller])

  const save = async () => {
    if (missing === null) return
    setBusy(true)
    setErrors({})
    const pendingValues = Object.fromEntries(
      missing.refs.filter((ref) => configured[ref] !== true).map((ref) => [ref, values[ref] ?? '']),
    )
    const outcome = await controller.save(pendingValues)
    setValues(blankCredentialValues(missing.refs))
    setConfigured((current) => ({
      ...current,
      ...Object.fromEntries(outcome.saved.map((ref) => [ref, true])),
    }))
    setErrors(outcome.errors)
    setBusy(false)
    if (outcome.ok) {
      setOpen(false)
      setSavedNotice(true)
    }
  }

  const summary =
    missing === null
      ? text || ('kind' in block ? '连接测试已完成' : '正在测试连接…')
      : `缺少凭证：${missing.refs.join(', ')}`

  return (
    <>
      <div style={rowStyle} data-marivo-test-call={callId}>
        <span aria-hidden="true">●</span>
        <strong>Marivo 连接测试</strong>
        <span style={summaryStyle}>{savedNotice ? '凭证已保存，请重试 marivo_test' : summary}</span>
        {missing !== null && !savedNotice ? (
          <Button size="sm" variant="outline" onClick={openDialog}>
            配置凭证
          </Button>
        ) : null}
      </div>
      <Modal
        open={open}
        onClose={() => {
          if (!busy) setOpen(false)
        }}
        title={`配置 ${missing?.name ?? ''} 凭证`}
        description="凭证由 DSH 凭证服务保存；Marivo 插件不会写入 ~/.marivo/secrets.toml。"
        closeLabel="取消"
        footer={
          <>
            <Button disabled={busy} onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => {
                void save()
              }}
            >
              {busy ? '保存中…' : '保存'}
            </Button>
          </>
        }
      >
        {missing?.refs.map((ref) => (
          <label key={ref} style={fieldStyle}>
            <span style={labelStyle}>
              <code>{ref}</code>
              <span>{configured[ref] ? '已配置' : '未配置'}</span>
            </span>
            <input
              style={inputStyle}
              type="password"
              autoComplete="new-password"
              value={values[ref] ?? ''}
              aria-label={ref}
              disabled={busy || configured[ref] === true}
              onChange={(event) =>
                setValues((current) => ({ ...current, [ref]: event.target.value }))
              }
            />
            {errors[ref] === undefined ? null : <p style={errorStyle}>{errors[ref]}</p>}
          </label>
        ))}
      </Modal>
    </>
  )
}

const reportCardStyle = {
  display: 'grid',
  gap: 10,
  padding: '12px 14px',
  borderRadius: 10,
  border: '1px solid var(--dsw-alias-border-subtle, #d7d7d7)',
  background: 'var(--dsw-alias-surface-secondary, rgba(127, 127, 127, 0.06))',
  color: 'var(--dsw-alias-text-primary, inherit)',
}
const reportHeadingStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
}
const reportPathStyle = {
  margin: 0,
  overflowWrap: 'anywhere',
  color: 'var(--dsw-alias-text-secondary, #666)',
  fontSize: 12,
}
const reportDisclosureStyle = {
  display: 'grid',
  gap: 4,
  margin: 0,
  paddingLeft: 18,
  color: 'var(--dsw-alias-text-secondary, #666)',
  fontSize: 12,
}
const reportFallbackStyle = {
  margin: 0,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  fontFamily: 'inherit',
  color: 'var(--dsw-alias-text-secondary, #666)',
  fontSize: 12,
}

/** Durable report handoff under the closing answer, independent of its prose. */
export function MarivoReportTurnDelivery({ matched: reports, openFile }: any) {
  return (
    <section style={reportCardStyle} data-marivo-report-deliveries>
      <strong>HTML 分析报告</strong>
      {reports.map((report: MarivoReportPresentationMeta) => (
        <div key={report.reportDigest} style={{ display: 'grid', gap: 6 }}>
          <div style={reportHeadingStyle}>
            <span>{report.title}</span>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                openFile(report.path)
              }}
            >
              打开报告
            </Button>
          </div>
          <p style={reportPathStyle}>{report.path}</p>
        </div>
      ))}
    </section>
  )
}

/** Replay-safe immutable report card with a click-time Host handoff. */
export function MarivoReportToolView({ callId, block, connection }: any) {
  const model = useMemo(() => marivoReportCardModel(block), [block])
  const [busy, setBusy] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)

  if (model.state === 'running') {
    return (
      <div style={rowStyle} data-marivo-report-call={callId}>
        <span aria-hidden="true">▣</span>
        <strong>HTML 分析报告</strong>
        <span style={summaryStyle}>{model.summary}</span>
      </div>
    )
  }

  if (model.report === null) {
    return (
      <section style={reportCardStyle} data-marivo-report-call={callId}>
        <strong>HTML 分析报告</strong>
        <pre style={reportFallbackStyle}>{model.summary}</pre>
      </section>
    )
  }

  const open = async () => {
    setBusy(true)
    setOpenError(null)
    try {
      await openMarivoReport(connection.api, model.report.path)
    } catch (error) {
      setOpenError(reportOpenError(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section style={reportCardStyle} data-marivo-report-call={callId}>
      <div style={reportHeadingStyle}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--dsw-alias-text-secondary, #666)' }}>
            HTML 分析报告
          </div>
          <strong>{model.report.title}</strong>
        </div>
        <Button
          variant="primary"
          size="sm"
          disabled={busy}
          onClick={() => {
            void open()
          }}
        >
          {busy ? '正在打开…' : '打开报告'}
        </Button>
      </div>
      <p style={reportPathStyle}>{model.report.path}</p>
      {model.report.disclosures.length === 0 ? null : (
        <ul style={reportDisclosureStyle}>
          {[...new Set(model.report.disclosures)].map((disclosure) => (
            <li key={disclosure}>{disclosure}</li>
          ))}
        </ul>
      )}
      {openError === null ? null : (
        <p role="alert" style={errorStyle}>
          {openError}
        </p>
      )}
    </section>
  )
}

const sourceCardStyle = {
  marginTop: 10,
  padding: '10px 12px',
  border: '1px solid var(--dsw-alias-border-subtle, #d7d7d7)',
  borderRadius: 8,
  background: 'var(--dsw-alias-surface-secondary, rgba(127, 127, 127, 0.06))',
  color: 'var(--dsw-alias-text-primary, inherit)',
  fontSize: 12,
}
const sourceHeadingStyle = { fontWeight: 600, marginBottom: 8 }
const sourceListStyle = { display: 'grid', gap: 8, margin: 0, padding: 0, listStyle: 'none' }
const sourceItemStyle = {
  display: 'grid',
  gap: 3,
  paddingTop: 8,
  borderTop: '1px solid var(--dsw-alias-border-subtle, #e2e2e2)',
}
const sourceIdentityStyle = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }
const sourceBadgeStyle = {
  padding: '1px 5px',
  borderRadius: 999,
  background: 'var(--dsw-alias-surface-tertiary, rgba(127, 127, 127, 0.12))',
}
const sourceSecondaryStyle = {
  color: 'var(--dsw-alias-text-secondary, #666)',
  overflowWrap: 'anywhere',
}
const sourceWarningStyle = { color: 'var(--dsw-alias-text-warning, #9a6700)' }
const sourceStatementStyle = { margin: 0, fontSize: 13, lineHeight: 1.55 }
const sourceAuditStyle = { marginTop: 5 }
const sourceAuditBodyStyle = { display: 'grid', gap: 3, paddingTop: 6 }

export function MarivoSourceCard({
  matched: citations,
  t,
}: {
  matched: MarivoResolvedCitation[]
  t: (key: string, values?: Record<string, string>) => string
}) {
  return (
    <aside style={sourceCardStyle} aria-label={t('source.title')} data-marivo-source-card>
      <div style={sourceHeadingStyle}>{t('source.title')}</div>
      <ul style={sourceListStyle}>
        {citations.map((citation) => (
          <li key={citation.handle} style={sourceItemStyle}>
            {citation.statement === null ? null : (
              <p style={sourceStatementStyle}>{citation.statement}</p>
            )}
            <div style={sourceIdentityStyle}>
              <strong>{citation.handle}</strong>
            </div>
            {citation.source === null ? (
              <span style={sourceWarningStyle}>{t('source.unknown')}</span>
            ) : (
              <details style={sourceAuditStyle}>
                <summary>{t('source.audit')}</summary>
                <div style={sourceAuditBodyStyle}>
                  <div style={sourceIdentityStyle}>
                    <span style={sourceBadgeStyle}>{citation.source.findingType}</span>
                    <span style={sourceBadgeStyle}>{citation.source.epistemicKind}</span>
                    <span style={sourceBadgeStyle}>
                      {t('source.quality', {
                        value: citation.source.qualityStatus ?? t('source.unlabeled'),
                      })}
                    </span>
                  </div>
                  <span style={sourceSecondaryStyle}>
                    {t('source.finding', { id: citation.source.findingId })}
                  </span>
                  <span style={sourceSecondaryStyle}>
                    {t('source.artifact', { id: citation.source.artifactId })}
                  </span>
                  <span style={sourceSecondaryStyle}>
                    {t('source.item', { id: citation.source.canonicalItemKey })}
                  </span>
                  <span style={sourceSecondaryStyle}>
                    {t('source.session', {
                      id: citation.source.sessionId,
                      committedAt: citation.source.committedAt,
                    })}
                  </span>
                  <span style={sourceSecondaryStyle}>
                    {t('source.versions', {
                      extractor: citation.source.extractorVersion,
                      schema: citation.source.artifactSchemaVersion,
                    })}
                  </span>
                </div>
              </details>
            )}
            {citation.definitionStatus === 'missing' ? (
              <span style={sourceWarningStyle}>{t('source.missingDefinition')}</span>
            ) : citation.definitionStatus === 'mismatch' ? (
              <span style={sourceWarningStyle}>{t('source.mismatchedDefinition')}</span>
            ) : null}
          </li>
        ))}
      </ul>
      <div style={{ ...sourceSecondaryStyle, marginTop: 8 }}>{t('source.disclaimer')}</div>
    </aside>
  )
}

export const inject = ['connection', 'slots', 'locale', 'conversationEvents']

export function apply(ctx: Context): void {
  const connection = ctx.get('connection')
  const BoundMarivoTestToolView = (props: any) => (
    <MarivoTestToolView {...props} connection={connection} />
  )
  const BoundMarivoReportToolView = (props: any) => (
    <MarivoReportToolView {...props} connection={connection} />
  )
  ctx.slots.inject('tool.call.toolview', () =>
    ctx.slots.register(
      {
        name: 'tool.call.toolview',
        key: TOOL_NAME,
      },
      BoundMarivoTestToolView,
    ),
  )
  ctx.slots.inject('tool.call.toolview', () =>
    ctx.slots.register(
      {
        name: 'tool.call.toolview',
        key: REPORT_TOOL_NAME,
      },
      BoundMarivoReportToolView,
    ),
  )
  ctx.conversationEvents.register(marivoReportDeliveryDefinition)
  ctx.conversationEvents.register(marivoCitationRegistryDefinition)
  ctx.conversationEvents.register(marivoAnswerCitationsDefinition)
  ctx.effect(
    () =>
      ctx.locale.register(CITATION_LOCALE_NAMESPACE, {
        zh: CITATION_ZH,
        en: CITATION_EN,
      }),
    'dsh-data-analysis: Evidence citation dictionaries',
  )
  ctx.slots.inject('conversation.chat.turnTail', () =>
    ctx.slots.register(
      {
        name: 'conversation.chat.turnTail',
        select: selectMarivoReports,
      },
      MarivoReportTurnDelivery,
    ),
  )
  ctx.slots.inject('conversation.chat.turnTail', () =>
    ctx.slots.register(
      {
        name: 'conversation.chat.turnTail',
        select: selectMarivoCitations,
        locale: CITATION_LOCALE_NAMESPACE,
      },
      MarivoSourceCard,
    ),
  )
}
