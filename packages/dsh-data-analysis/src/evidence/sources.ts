import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue, Session } from '@deepseek-ai/dsh-session'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import {
  type MarivoEvidenceBridgeSource,
  type MarivoFindingProjection,
  type MarivoFindingSelection,
  resolveMarivoEvidenceBridge,
} from './bridge.ts'

export const MARIVO_EVIDENCE_SOURCES_TOOL_NAME = 'marivo_evidence_sources'
export const MARIVO_EVIDENCE_SOURCES_META_KIND = 'marivo-evidence-sources'
export const MARIVO_EVIDENCE_SOURCES_META_VERSION = 2
export const MARIVO_EVIDENCE_SOURCES_DURABLE_CONTENT_KIND = 'marivo-evidence-sources-card'
export const MARIVO_EVIDENCE_SOURCES_MAX_PER_CALL = 20

export interface MarivoEvidenceSource {
  [key: string]: JsonValue
  status: 'available' | 'missing' | 'unsupported'
  title: string
  locator: string
  excerpt: string | null
  truncated: boolean
  environmentFingerprint: string
  sessionId: string
  findingId: string
  findingType: string | null
  epistemicKind: string | null
  artifactRef: string
  canonicalItemKey: string | null
  committedAt: string | null
  sourceRefs: string[]
  revalidation: {
    [key: string]: JsonValue
    status: string
    semanticStatus: string | null
    evidenceStatus: string | null
    dependencyStatus: string | null
  } | null
}

export interface MarivoEvidenceSourcesValue {
  [key: string]: JsonValue
  status: 'ok'
  environment: {
    version: string
    fingerprint: string
  }
  dshSessionId: string
  sessionId: string
  sources: MarivoEvidenceSource[]
}

export interface MarivoEvidenceSourcesMeta {
  [key: string]: JsonValue
  kind: typeof MARIVO_EVIDENCE_SOURCES_META_KIND
  version: typeof MARIVO_EVIDENCE_SOURCES_META_VERSION
  dshSessionId: string
  sources: MarivoEvidenceSource[]
}

const nullableStringSchema = { oneOf: [{ type: 'string' }, { type: 'null' }] } as const

const evidenceSourceSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: {
      oneOf: [
        { type: 'string', const: 'available' },
        { type: 'string', const: 'missing' },
        { type: 'string', const: 'unsupported' },
      ],
      required: true,
    },
    title: { type: 'string', required: true },
    locator: { type: 'string', required: true },
    excerpt: { ...nullableStringSchema, required: true },
    truncated: { type: 'boolean', required: true },
    environmentFingerprint: { type: 'string', required: true },
    sessionId: { type: 'string', required: true },
    findingId: { type: 'string', required: true },
    findingType: { ...nullableStringSchema, required: true },
    epistemicKind: { ...nullableStringSchema, required: true },
    artifactRef: { type: 'string', required: true },
    canonicalItemKey: { ...nullableStringSchema, required: true },
    committedAt: { ...nullableStringSchema, required: true },
    sourceRefs: { type: 'array', items: { type: 'string' }, required: true },
    revalidation: {
      oneOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            status: { type: 'string', required: true },
            semanticStatus: { ...nullableStringSchema, required: true },
            evidenceStatus: { ...nullableStringSchema, required: true },
            dependencyStatus: { ...nullableStringSchema, required: true },
          },
        },
      ],
      required: true,
    },
  },
} as const

const evidenceSourcesOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', const: 'ok', required: true },
    environment: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        version: { type: 'string', required: true },
        fingerprint: { type: 'string', required: true },
      },
    },
    dshSessionId: { type: 'string', required: true },
    sessionId: { type: 'string', required: true },
    sources: { type: 'array', items: evidenceSourceSchema, required: true },
  },
} as const

function nonEmptyString(value: unknown, field: string, maxLength = 2_048): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maxLength) {
    throw new TypeError(`${field} must be a non-empty string of at most ${maxLength} characters`)
  }
  return value
}

function requestedSources(value: unknown): MarivoFindingSelection[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > MARIVO_EVIDENCE_SOURCES_MAX_PER_CALL
  ) {
    throw new TypeError(
      `marivo_evidence_sources sources must contain 1-${MARIVO_EVIDENCE_SOURCES_MAX_PER_CALL} items`,
    )
  }
  const result = value.map((item, index) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new TypeError(`marivo_evidence_sources sources[${index}] must be an object`)
    }
    const source = item as Record<string, unknown>
    if (
      Object.keys(source).length !== 2 ||
      !Object.hasOwn(source, 'artifact_ref') ||
      !Object.hasOwn(source, 'finding_id')
    ) {
      throw new TypeError(
        `marivo_evidence_sources sources[${index}] must contain exactly artifact_ref and finding_id`,
      )
    }
    return {
      artifactRef: nonEmptyString(
        source.artifact_ref,
        `marivo_evidence_sources sources[${index}].artifact_ref`,
        512,
      ),
      findingId: nonEmptyString(
        source.finding_id,
        `marivo_evidence_sources sources[${index}].finding_id`,
        512,
      ),
    }
  })
  if (new Set(result.map((item) => JSON.stringify(item))).size !== result.length) {
    throw new TypeError('marivo_evidence_sources sources must be unique within one request')
  }
  return result
}

function evidenceSource(
  environmentFingerprint: string,
  finding: MarivoFindingProjection,
): MarivoEvidenceSource {
  return {
    status: finding.status,
    title: finding.title,
    locator: finding.locator,
    excerpt: finding.excerpt,
    truncated: finding.truncated,
    environmentFingerprint,
    sessionId: finding.sessionId,
    findingId: finding.findingId,
    findingType: finding.findingType,
    epistemicKind: finding.epistemicKind,
    artifactRef: finding.artifactRef,
    canonicalItemKey: finding.canonicalItemKey,
    committedAt: finding.committedAt,
    sourceRefs: [...finding.sourceRefs],
    revalidation: finding.revalidation === null ? null : { ...finding.revalidation },
  }
}

function renderSources(value: MarivoEvidenceSourcesValue): string {
  const lines = [
    `Exact Marivo Evidence sources (${value.sources.length})`,
    `Marivo Session: ${value.sessionId}`,
  ]
  value.sources.forEach((source, index) => {
    lines.push('', `${index + 1}. ${source.title}`, `   status: ${source.status}`)
    lines.push(`   locator: ${source.locator}`)
    lines.push(`   excerpt: ${source.excerpt ?? 'unavailable'}`)
    lines.push(`   excerpt_state: ${source.truncated ? 'truncated' : 'complete'}`)
    const revalidation = source.revalidation
    lines.push(`   revalidation: ${revalidation === null ? 'unavailable' : revalidation.status}`)
    if (revalidation !== null) {
      lines.push(
        `   semantic_status: ${revalidation.semanticStatus ?? 'unavailable'}`,
        `   evidence_status: ${revalidation.evidenceStatus ?? 'unavailable'}`,
        `   dependency_status: ${revalidation.dependencyStatus ?? 'unavailable'}`,
      )
    }
    lines.push(
      `   source_refs: ${source.sourceRefs.length === 0 ? 'none' : source.sourceRefs.join(', ')}`,
    )
  })
  lines.push(
    '',
    'Boundary: source identity and availability do not prove that an entire conclusion, calculation, or business judgment is correct.',
  )
  return lines.join('\n')
}

export function evidenceSourcesMeta(value: MarivoEvidenceSourcesValue): MarivoEvidenceSourcesMeta {
  return {
    kind: MARIVO_EVIDENCE_SOURCES_META_KIND,
    version: MARIVO_EVIDENCE_SOURCES_META_VERSION,
    dshSessionId: value.dshSessionId,
    sources: value.sources.map((source) => ({
      ...source,
      sourceRefs: [...source.sourceRefs],
      revalidation: source.revalidation === null ? null : { ...source.revalidation },
    })),
  }
}

/** Build the exact-Finding source attachment Tool for one Agent and DSH Session. */
export function createMarivoEvidenceSourcesTool(
  bridgeSource: MarivoEvidenceBridgeSource,
  session: Session,
): ToolDefinition {
  return defineTool({
    name: MARIVO_EVIDENCE_SOURCES_TOOL_NAME,
    description:
      'Attach exact persisted Marivo Evidence sources to the current turn only when the user explicitly requests sources, provenance, or audit details. This identifies sources; it does not validate the surrounding conclusion.',
    parameters: {
      session_id: {
        type: 'string',
        required: true,
        description: 'Exact Marivo analysis Session ID containing the Findings.',
      },
      sources: {
        type: 'array',
        required: true,
        description: `1-${MARIVO_EVIDENCE_SOURCES_MAX_PER_CALL} unique exact Artifact/Finding pairs to attach.`,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            artifact_ref: { type: 'string', required: true },
            finding_id: { type: 'string', required: true },
          },
        },
      },
    },
    output: {
      schema: evidenceSourcesOutputSchema,
      render: (_args, value) => [
        { type: 'text', text: renderSources(value as unknown as MarivoEvidenceSourcesValue) },
      ],
      presentationMeta: (_args, value) =>
        evidenceSourcesMeta(value as unknown as MarivoEvidenceSourcesValue),
    },
    timeoutMs: 35_000,
    async execute(args, exec): Promise<MarivoEvidenceSourcesValue> {
      const sessionId = nonEmptyString(args.session_id, 'marivo_evidence_sources session_id', 512)
      const selections = requestedSources(args.sources)
      const bridge = await resolveMarivoEvidenceBridge(bridgeSource)
      const findings = await bridge.findings(sessionId, selections, exec.signal)
      return {
        status: 'ok',
        environment: {
          version: bridge.binding.marivoVersion,
          fingerprint: bridge.binding.fingerprint,
        },
        dshSessionId: String(session.id),
        sessionId,
        sources: findings.map((finding) => evidenceSource(bridge.binding.fingerprint, finding)),
      }
    },
  })
}

export function registerMarivoEvidenceSourcesTool(
  ctx: Context,
  bridgeSource: MarivoEvidenceBridgeSource,
  session: Session,
): () => void {
  return ctx.tools.register(createMarivoEvidenceSourcesTool(bridgeSource, session))
}

function sourceTurnForRootCall(dispatch: {
  readonly exec: { readonly rootCallId?: unknown }
  readonly agent?: { readonly session?: { readonly events?: readonly unknown[] } }
}): number | null {
  const rootCallId = String(dispatch.exec.rootCallId ?? '')
  if (rootCallId === '' || !Array.isArray(dispatch.agent?.session?.events)) return null
  for (let index = dispatch.agent.session.events.length - 1; index >= 0; index--) {
    const candidate = dispatch.agent.session.events[index]
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) continue
    const event = candidate as { type?: unknown; data?: { callId?: unknown; turn?: unknown } }
    if (event.type !== 'tool/call' || String(event.data?.callId ?? '') !== rootCallId) continue
    const turn = event.data?.turn
    return Number.isSafeInteger(turn) && (turn as number) >= 0 ? (turn as number) : null
  }
  return null
}

/** Preserve nested Code Mode source metadata on the durable sub-dispatch event. */
export function installMarivoEvidenceSourcesCodeDelivery(ctx: Context): () => void {
  const pending = new Map<string, MarivoEvidenceSourcesMeta>()
  const stopResult = ctx.on('tools/result', (exec, result) => {
    if (
      exec.name !== MARIVO_EVIDENCE_SOURCES_TOOL_NAME ||
      exec.parent === undefined ||
      result.isError
    ) {
      return
    }
    pending.set(
      String(exec.callId),
      evidenceSourcesMeta(result.value as unknown as MarivoEvidenceSourcesValue),
    )
  })
  const stopDispatchLog = ctx.on(
    'tools/code-dispatch-log',
    async (dispatch, next) => {
      const content = await next()
      if (dispatch.name !== MARIVO_EVIDENCE_SOURCES_TOOL_NAME) return content
      const key = String(dispatch.subCallId)
      const meta = pending.get(key)
      pending.delete(key)
      if (dispatch.isError || meta === undefined) return content
      const turn = sourceTurnForRootCall(dispatch)
      if (turn === null) return content
      const card = {
        type: MARIVO_EVIDENCE_SOURCES_DURABLE_CONTENT_KIND,
        turn,
        meta,
      } as unknown as ContentBlock
      return [...content, card]
    },
    { prepend: true },
  )
  let active = true
  return () => {
    if (!active) return
    active = false
    stopDispatchLog()
    stopResult()
    pending.clear()
  }
}
