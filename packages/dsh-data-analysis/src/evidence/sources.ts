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
export const MARIVO_EVIDENCE_SOURCES_META_VERSION = 1
export const MARIVO_EVIDENCE_SOURCES_DURABLE_CONTENT_KIND = 'marivo-evidence-sources-card'
export const MARIVO_EVIDENCE_SOURCES_MAX_PER_CALL = 20

export interface MarivoEvidenceSource {
  [key: string]: JsonValue
  rendered: {
    [key: string]: JsonValue
    en: string
    zh: string
  }
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

const renderedSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    en: { type: 'string', required: true },
    zh: { type: 'string', required: true },
  },
} as const

const evidenceSourceSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    rendered: { ...renderedSchema, required: true },
    environmentFingerprint: { type: 'string', required: true },
    sessionId: { type: 'string', required: true },
    findingId: { type: 'string', required: true },
    findingType: { type: 'string', required: true },
    epistemicKind: { type: 'string', required: true },
    artifactRef: { type: 'string', required: true },
    canonicalItemKey: { type: 'string', required: true },
    qualityStatus: {
      oneOf: [{ type: 'string' }, { type: 'null' }],
      required: true,
    },
    committedAt: { type: 'string', required: true },
    extractorVersion: { type: 'string', required: true },
    artifactSchemaVersion: { type: 'string', required: true },
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
    environmentFingerprint,
    sessionId: finding.sessionId,
    findingId: finding.findingId,
    findingType: finding.findingType,
    epistemicKind: finding.epistemicKind,
    artifactRef: finding.artifactRef,
    canonicalItemKey: finding.canonicalItemKey,
    qualityStatus: finding.qualityStatus,
    committedAt: finding.committedAt,
    extractorVersion: finding.extractorVersion,
    artifactSchemaVersion: finding.artifactSchemaVersion,
    rendered: { ...finding.rendered },
  }
}

function renderSources(value: MarivoEvidenceSourcesValue): string {
  return [
    `${value.sources.length} exact Marivo Evidence source(s) attached to this turn.`,
    'The source request is fulfilled by the Web source panel. Never copy or restate the supported fact, any numeric or textual value from it, Finding statements, or any Session, Finding, Artifact, canonical item, schema, extractor, or Environment identifier from Skill context, Tool arguments, or Tool results into the final answer, even when the user requested audit details.',
    'Do not add markers, footnotes, technical fields, or a source appendix; the Web source panel renders them on demand.',
    'Do not announce this Tool call, describe the panel, or say where details can be viewed. If the request is solely for sources, the final answer must be only one brief acknowledgement that the source details are attached; it must not mention the Web, a panel, or any display location.',
  ].join(' ')
}

export function evidenceSourcesMeta(value: MarivoEvidenceSourcesValue): MarivoEvidenceSourcesMeta {
  return {
    kind: MARIVO_EVIDENCE_SOURCES_META_KIND,
    version: MARIVO_EVIDENCE_SOURCES_META_VERSION,
    dshSessionId: value.dshSessionId,
    sources: value.sources.map((source) => ({
      ...source,
      rendered: { ...source.rendered },
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
