// @ts-nocheck -- browser contracts are supplied by the DSH module table at runtime.

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const TOOL_NAME = 'marivo_datasource_test'
const EVIDENCE_SOURCES_TOOL_NAME = 'marivo_evidence_sources'
const EVIDENCE_SOURCES_META_KIND = 'marivo-evidence-sources'
const EVIDENCE_SOURCES_META_VERSION = 1
const EVIDENCE_SOURCES_DURABLE_CONTENT_KIND = 'marivo-evidence-sources-card'
const EVIDENCE_SOURCES_DEFINITION_KIND = 'marivo-evidence-sources-delivery'
const EVIDENCE_SOURCES_TURN_DATA_KEY = EVIDENCE_SOURCES_DEFINITION_KIND
const EVIDENCE_SOURCES_LOCALE_NAMESPACE = 'marivo-evidence-sources'
const EVIDENCE_SOURCES_ZH = {
  'source.language': 'zh',
  'source.title': '数据来源',
  'source.summary': '{artifacts} 个分析结果 · {findings} 条 Evidence',
  'source.artifact': '分析结果 {index}',
  'source.findings': '{count} 条 Evidence',
  'source.quality': 'quality: {value}',
  'source.unlabeled': '未标注',
  'source.finding': 'Finding {id}',
  'source.artifactRef': 'Artifact {id}',
  'source.session': 'Marivo Session {id}',
  'source.committed': '提交 {committedAt}',
  'source.audit': '审计详情',
  'source.item': 'canonical item: {id}',
  'source.versions': 'extractor {extractor} · Artifact schema {schema}',
  'source.environment': 'Environment {fingerprint}',
  'source.disclaimer': '来源面板确认 Evidence 身份，不等于验证整句话、计算或业务判断。',
}
const EVIDENCE_SOURCES_EN = {
  'source.language': 'en',
  'source.title': 'Data sources',
  'source.summary': '{artifacts} analysis results · {findings} Evidence findings',
  'source.artifact': 'Analysis result {index}',
  'source.findings': '{count} Evidence findings',
  'source.quality': 'quality: {value}',
  'source.unlabeled': 'not labeled',
  'source.finding': 'Finding {id}',
  'source.artifactRef': 'Artifact {id}',
  'source.session': 'Marivo Session {id}',
  'source.committed': 'committed {committedAt}',
  'source.audit': 'Audit details',
  'source.item': 'canonical item: {id}',
  'source.versions': 'extractor {extractor} · Artifact schema {schema}',
  'source.environment': 'Environment {fingerprint}',
  'source.disclaimer':
    'This panel confirms Evidence identity; it does not validate the whole statement, calculation, or business judgment.',
}
const openedCalls = new Set<string>()

export interface MarivoEvidenceSource {
  rendered: { en: string; zh: string }
  environmentFingerprint: string
  sessionId: string
  findingId: string
  findingType: string
  epistemicKind: string
  artifactRef: string
  canonicalItemKey: string
  qualityStatus: string | null
  committedAt: string
  extractorVersion: string
  artifactSchemaVersion: string
}

export interface MarivoEvidenceSourcesMeta {
  readonly kind: typeof EVIDENCE_SOURCES_META_KIND
  readonly version: typeof EVIDENCE_SOURCES_META_VERSION
  readonly dshSessionId: string
  readonly sources: readonly MarivoEvidenceSource[]
}

export interface MarivoEvidenceSourcesTurnDelivery {
  readonly seq: number
  readonly sources: readonly MarivoEvidenceSource[]
}

export interface MarivoEvidenceSourcesTurnData {
  readonly deliveries: readonly MarivoEvidenceSourcesTurnDelivery[]
}

interface MarivoEvidenceSourcesTurnState {
  readonly turn: number
  readonly calls: ReadonlyMap<string, string>
  readonly deliveries: readonly MarivoEvidenceSourcesTurnDelivery[]
}

export interface MarivoEvidenceArtifactGroup {
  readonly key: string
  readonly environmentFingerprint: string
  readonly sessionId: string
  readonly artifactRef: string
  readonly sources: readonly MarivoEvidenceSource[]
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  interface ConversationTurnDataMap {
    /** Explicitly requested Marivo Evidence sources collected from this exact Turn. */
    'marivo-evidence-sources-delivery': MarivoEvidenceSourcesTurnData
  }
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

function evidenceSourceIdentity(source: MarivoEvidenceSource): string {
  return JSON.stringify([source.environmentFingerprint, source.sessionId, source.findingId])
}

function evidenceSource(value: unknown): MarivoEvidenceSource | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const allowed = new Set([
    'rendered',
    'environmentFingerprint',
    'sessionId',
    'findingId',
    'findingType',
    'epistemicKind',
    'artifactRef',
    'canonicalItemKey',
    'qualityStatus',
    'committedAt',
    'extractorVersion',
    'artifactSchemaVersion',
  ])
  if (
    Object.keys(source).length !== allowed.size ||
    Object.keys(source).some((key) => !allowed.has(key)) ||
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
    typeof source.artifactRef !== 'string' ||
    source.artifactRef === '' ||
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
    Object.keys(rendered).length !== 2 ||
    Object.keys(rendered).some((key) => key !== 'en' && key !== 'zh') ||
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
  } as unknown as MarivoEvidenceSource
}

/** Parse the closed per-call source attachment persisted in Tool result metadata. */
export function parseEvidenceSourcesMeta(value: unknown): MarivoEvidenceSourcesMeta | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const meta = value as Record<string, unknown>
  const allowed = new Set(['kind', 'version', 'dshSessionId', 'sources'])
  if (
    Object.keys(meta).length !== allowed.size ||
    Object.keys(meta).some((key) => !allowed.has(key)) ||
    meta.kind !== EVIDENCE_SOURCES_META_KIND ||
    meta.version !== EVIDENCE_SOURCES_META_VERSION ||
    typeof meta.dshSessionId !== 'string' ||
    meta.dshSessionId === '' ||
    !Array.isArray(meta.sources) ||
    meta.sources.length < 1 ||
    meta.sources.length > 20
  )
    return null
  const result: MarivoEvidenceSource[] = []
  const identities = new Set<string>()
  for (const value of meta.sources) {
    const source = evidenceSource(value)
    if (source === null) return null
    const identity = evidenceSourceIdentity(source)
    if (identities.has(identity)) return null
    identities.add(identity)
    result.push(source)
  }
  return Object.freeze({
    kind: EVIDENCE_SOURCES_META_KIND,
    version: EVIDENCE_SOURCES_META_VERSION,
    dshSessionId: meta.dshSessionId,
    sources: Object.freeze(result),
  })
}

/** Decode the Code Mode-only source attachment from a durable sub-dispatch result. */
export function parseEvidenceSourcesDurableContent(value: unknown): {
  readonly turn: number
  readonly meta: MarivoEvidenceSourcesMeta
} | null {
  if (!Array.isArray(value)) return null
  const cards = value.filter(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      !Array.isArray(item) &&
      (item as Record<string, unknown>).type === EVIDENCE_SOURCES_DURABLE_CONTENT_KIND,
  ) as Array<Record<string, unknown>>
  if (cards.length !== 1) return null
  const card = cards[0]!
  if (
    Object.keys(card).length !== 3 ||
    !Number.isSafeInteger(card.turn) ||
    (card.turn as number) < 0
  ) {
    return null
  }
  const meta = parseEvidenceSourcesMeta(card.meta)
  return meta === null ? null : { turn: card.turn as number, meta }
}

function codeEvidenceSourcesDelivery(
  event: any,
): (MarivoEvidenceSourcesTurnDelivery & { readonly turn: number }) | null {
  if (
    event?.type !== 'tool/code-dispatch' ||
    event.data?.name !== EVIDENCE_SOURCES_TOOL_NAME ||
    event.data?.isError === true
  ) {
    return null
  }
  const card = parseEvidenceSourcesDurableContent(event.data.content)
  return card === null ? null : { turn: card.turn, seq: event.seq, sources: card.meta.sources }
}

/** Recover one successful native or nested source attachment. */
export function evidenceSourcesDeliveryFromEvent(
  event: any,
  calls: ReadonlyMap<string, string> = new Map(),
): MarivoEvidenceSourcesTurnDelivery | null {
  if (event?.type === 'tool/result') {
    if (event.surfaceOp !== 'append' || !Array.isArray(event.data?.message?.content)) return null
    const blocks = event.data.message.content.filter((item: any) => item?.type === 'tool-result')
    if (blocks.length !== 1 || blocks[0].isError === true) return null
    const callId = String(event.data.message.source?.callId ?? '')
    if (calls.get(callId) !== EVIDENCE_SOURCES_TOOL_NAME) return null
    const meta = parseEvidenceSourcesMeta(event.data.meta)
    return meta === null ? null : { seq: event.seq, sources: meta.sources }
  }
  const delivery = codeEvidenceSourcesDelivery(event)
  return delivery === null ? null : { seq: delivery.seq, sources: delivery.sources }
}

/** Aggregate explicit source attachments under one Harness-owned Turn key. */
export const marivoEvidenceSourcesDeliveryDefinition = {
  kind: EVIDENCE_SOURCES_DEFINITION_KIND,
  match(event: any) {
    if (event?.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event?.type === 'tool/call') return { id: String(event.data.turn), role: 'update' }
    if (event?.type === 'tool/result' && event.surfaceOp === 'append') {
      return { id: String(event.data.turn), role: 'update' }
    }
    const delivery = codeEvidenceSourcesDelivery(event)
    return delivery === null ? null : { id: String(delivery.turn), role: 'update' }
  },
  start(_context: any, match: any): MarivoEvidenceSourcesTurnState {
    if (match.event.type !== 'turn/start') {
      throw new Error('Marivo Evidence source delivery start requires turn/start')
    }
    return { turn: match.event.data.turn, calls: new Map(), deliveries: [] }
  },
  update(context: any, match: any): MarivoEvidenceSourcesTurnState {
    if (match.event.type === 'tool/call') {
      const calls = new Map(context.state.calls)
      calls.set(String(match.event.data.callId), String(match.event.data.name))
      return { ...context.state, calls }
    }
    const delivery = evidenceSourcesDeliveryFromEvent(match.event, context.state.calls)
    return delivery === null
      ? context.state
      : { ...context.state, deliveries: [...context.state.deliveries, delivery] }
  },
  buildLocationData(context: any, scope: string) {
    if (scope !== 'turn' || context.state === undefined) return null
    return {
      kind: 'turn',
      turn: context.state.turn,
      key: EVIDENCE_SOURCES_TURN_DATA_KEY,
      value: { deliveries: context.state.deliveries },
    }
  },
}

/** Successful sources completed before this exact closing Assistant message. */
export function evidenceSourcesForClosing(owner: any): readonly MarivoEvidenceSource[] {
  const data = owner?.turn?.data?.get?.(EVIDENCE_SOURCES_TURN_DATA_KEY)
  if (typeof data !== 'object' || data === null || !Array.isArray(data.deliveries)) return []
  const deliveries: MarivoEvidenceSourcesTurnDelivery[] = []
  for (const value of data.deliveries) {
    if (
      typeof value !== 'object' ||
      value === null ||
      typeof value.seq !== 'number' ||
      value.seq > owner.seq ||
      !Array.isArray(value.sources)
    ) {
      continue
    }
    const parsed = value.sources.map(evidenceSource)
    if (parsed.every((source) => source !== null)) {
      deliveries.push({ seq: value.seq, sources: parsed as MarivoEvidenceSource[] })
    }
  }
  deliveries.sort((left, right) => left.seq - right.seq)
  const seen = new Set<string>()
  return deliveries.flatMap(({ sources }) =>
    sources.flatMap((source) => {
      const identity = evidenceSourceIdentity(source)
      if (seen.has(identity)) return []
      seen.add(identity)
      return [source]
    }),
  )
}

export function selectMarivoEvidenceSources(owner: any): readonly MarivoEvidenceSource[] | null {
  const sources = evidenceSourcesForClosing(owner)
  return sources.length === 0 ? null : sources
}

/** Group source presentation only; this does not infer Evidence equivalence or compatibility. */
export function groupMarivoEvidenceSources(
  sources: readonly MarivoEvidenceSource[],
): readonly MarivoEvidenceArtifactGroup[] {
  const groups = new Map<string, MarivoEvidenceSource[]>()
  for (const source of sources) {
    const key = JSON.stringify([
      source.environmentFingerprint,
      source.sessionId,
      source.artifactRef,
    ])
    const current = groups.get(key) ?? []
    current.push(source)
    groups.set(key, current)
  }
  return [...groups.entries()].map(([key, grouped]) => ({
    key,
    environmentFingerprint: grouped[0]!.environmentFingerprint,
    sessionId: grouped[0]!.sessionId,
    artifactRef: grouped[0]!.artifactRef,
    sources: grouped,
  }))
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

  async inspect(refs: readonly string[]): Promise<{
    configured: Record<string, boolean>
    missing: string[]
    shouldOpen: boolean
  }> {
    const info = await this.describe(refs)
    const configured = Object.fromEntries(refs.map((ref) => [ref, info[ref]?.configured === true]))
    return {
      configured,
      missing: refs.filter((ref) => configured[ref] !== true),
      shouldOpen: refs.some((ref) => configured[ref] !== true),
    }
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

export function MarivoDatasourceTestToolView({ sessionId, callId, block, connection }: any) {
  const text = settledText(block)
  const missing = useMemo(() => parseNeedsCredentials(text), [text])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [credentialsReady, setCredentialsReady] = useState(false)
  const [values, setValues] = useState<Record<string, string>>({})
  const [configured, setConfigured] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const controller = useMemo(() => new CredentialDialogController(connection.api), [connection.api])
  const inspectionGeneration = useRef(0)
  const inspectionContext = useRef({ sessionId, callId, missing, controller })
  const autoInspectionKey = useRef<string | null>(null)
  inspectionContext.current = { sessionId, callId, missing, controller }

  const openDialog = useCallback(async () => {
    if (missing === null) return
    const generation = ++inspectionGeneration.current
    const isCurrent = () => {
      const current = inspectionContext.current
      return (
        generation === inspectionGeneration.current &&
        current.sessionId === sessionId &&
        current.callId === callId &&
        current.missing === missing &&
        current.controller === controller
      )
    }
    setBusy(true)
    setValues(blankCredentialValues(missing.refs))
    setErrors({})
    try {
      const status = await controller.inspect(missing.refs)
      if (!isCurrent()) return
      setConfigured(status.configured)
      if (!status.shouldOpen) {
        setOpen(false)
        setCredentialsReady(true)
      } else {
        setCredentialsReady(false)
        setOpen(true)
      }
    } catch {
      if (!isCurrent()) return
      setConfigured(Object.fromEntries(missing.refs.map((ref) => [ref, false])))
      setCredentialsReady(false)
      setOpen(true)
    } finally {
      if (isCurrent()) setBusy(false)
    }
  }, [sessionId, callId, missing, controller])

  useEffect(() => {
    if (missing === null) return
    const key = `${sessionId}\u0000${callId}`
    if (!shouldAutoOpen(sessionId, callId, missing) && autoInspectionKey.current !== key) return
    autoInspectionKey.current = key
    void openDialog()
  }, [sessionId, callId, missing, openDialog])

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
      setCredentialsReady(true)
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
        <span style={summaryStyle}>
          {credentialsReady ? '凭证已配置，请重试 marivo_datasource_test' : summary}
        </span>
        {missing !== null && !credentialsReady ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              void openDialog()
            }}
          >
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

const sourcePanelStyle = {
  marginTop: 10,
  padding: '10px 12px',
  border: '1px solid var(--dsw-alias-border-subtle, #d7d7d7)',
  borderRadius: 8,
  background: 'var(--dsw-alias-surface-secondary, rgba(127, 127, 127, 0.06))',
  color: 'var(--dsw-alias-text-primary, inherit)',
  fontSize: 12,
}
const sourcePanelSummaryStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  gap: 8,
  cursor: 'pointer',
}
const sourceGroupListStyle = {
  display: 'grid',
  gap: 10,
  margin: '10px 0 0',
  padding: 0,
  listStyle: 'none',
}
const sourceGroupStyle = {
  display: 'grid',
  gap: 6,
  paddingTop: 10,
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
const sourceStatementStyle = { margin: 0, fontSize: 13, lineHeight: 1.55 }
const sourceAuditStyle = { marginTop: 5 }
const sourceAuditBodyStyle = { display: 'grid', gap: 8, paddingTop: 8 }
const sourceFindingStyle = {
  display: 'grid',
  gap: 4,
  paddingTop: 8,
  borderTop: '1px solid var(--dsw-alias-border-subtle, #e2e2e2)',
}

export function MarivoEvidenceSourcesPanel({
  matched: sources,
  t,
}: {
  matched: readonly MarivoEvidenceSource[]
  t: (key: string, values?: Record<string, string>) => string
}) {
  const groups = groupMarivoEvidenceSources(sources)
  const language = t('source.language') === 'zh' ? 'zh' : 'en'
  return (
    <details style={sourcePanelStyle} aria-label={t('source.title')} data-marivo-sources-panel>
      <summary style={sourcePanelSummaryStyle}>
        <strong>{t('source.title')}</strong>
        <span style={sourceSecondaryStyle}>
          {t('source.summary', {
            artifacts: String(groups.length),
            findings: String(sources.length),
          })}
        </span>
      </summary>
      <ul style={sourceGroupListStyle}>
        {groups.map((group, index) => {
          const qualities = [
            ...new Set(
              group.sources.map((source) => source.qualityStatus ?? t('source.unlabeled')),
            ),
          ]
          const committed = [...new Set(group.sources.map((source) => source.committedAt))]
          return (
            <li key={group.key} style={sourceGroupStyle}>
              <strong>{t('source.artifact', { index: String(index + 1) })}</strong>
              <div style={sourceIdentityStyle}>
                <span style={sourceSecondaryStyle}>
                  {t('source.findings', { count: String(group.sources.length) })}
                </span>
                {qualities.map((quality) => (
                  <span key={quality} style={sourceBadgeStyle}>
                    {t('source.quality', { value: quality })}
                  </span>
                ))}
                {committed.length === 1 ? (
                  <span style={sourceSecondaryStyle}>
                    {t('source.committed', { committedAt: committed[0]! })}
                  </span>
                ) : null}
              </div>
              <details style={sourceAuditStyle}>
                <summary>{t('source.audit')}</summary>
                <div style={sourceAuditBodyStyle}>
                  <span style={sourceSecondaryStyle}>
                    {t('source.artifactRef', { id: group.artifactRef })}
                  </span>
                  <span style={sourceSecondaryStyle}>
                    {t('source.session', { id: group.sessionId })}
                  </span>
                  <span style={sourceSecondaryStyle}>
                    {t('source.environment', { fingerprint: group.environmentFingerprint })}
                  </span>
                  {group.sources.map((source) => (
                    <div key={evidenceSourceIdentity(source)} style={sourceFindingStyle}>
                      <p style={sourceStatementStyle}>{source.rendered[language]}</p>
                      <div style={sourceIdentityStyle}>
                        <span style={sourceBadgeStyle}>{source.findingType}</span>
                        <span style={sourceBadgeStyle}>{source.epistemicKind}</span>
                        <span style={sourceBadgeStyle}>
                          {t('source.quality', {
                            value: source.qualityStatus ?? t('source.unlabeled'),
                          })}
                        </span>
                      </div>
                      <span style={sourceSecondaryStyle}>
                        {t('source.finding', { id: source.findingId })}
                      </span>
                      <span style={sourceSecondaryStyle}>
                        {t('source.item', { id: source.canonicalItemKey })}
                      </span>
                      <span style={sourceSecondaryStyle}>
                        {t('source.committed', { committedAt: source.committedAt })}
                      </span>
                      <span style={sourceSecondaryStyle}>
                        {t('source.versions', {
                          extractor: source.extractorVersion,
                          schema: source.artifactSchemaVersion,
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            </li>
          )
        })}
      </ul>
      <div style={{ ...sourceSecondaryStyle, marginTop: 10 }}>{t('source.disclaimer')}</div>
    </details>
  )
}

export const inject = ['connection', 'slots', 'locale', 'conversationEvents']

export function apply(ctx: Context): void {
  const connection = ctx.get('connection')
  const BoundMarivoDatasourceTestToolView = (props: any) => (
    <MarivoDatasourceTestToolView {...props} connection={connection} />
  )
  ctx.slots.inject('tool.call.toolview', () =>
    ctx.slots.register(
      {
        name: 'tool.call.toolview',
        key: TOOL_NAME,
      },
      BoundMarivoDatasourceTestToolView,
    ),
  )
  ctx.conversationEvents.register(marivoEvidenceSourcesDeliveryDefinition)
  ctx.effect(
    () =>
      ctx.locale.register(EVIDENCE_SOURCES_LOCALE_NAMESPACE, {
        zh: EVIDENCE_SOURCES_ZH,
        en: EVIDENCE_SOURCES_EN,
      }),
    'dsh-data-analysis: Evidence source dictionaries',
  )
  ctx.slots.inject('conversation.chat.turnTail', () =>
    ctx.slots.register(
      {
        name: 'conversation.chat.turnTail',
        select: selectMarivoEvidenceSources,
        locale: EVIDENCE_SOURCES_LOCALE_NAMESPACE,
      },
      MarivoEvidenceSourcesPanel,
    ),
  )
}
