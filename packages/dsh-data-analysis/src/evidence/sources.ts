import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue, Session } from '@deepseek-ai/dsh-session'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { type MarivoEnvironmentSource, resolveMarivoEnvironmentSource } from '../disclosure/help.ts'
import { MarivoEnvironmentError } from '../environment/errors.ts'

export const MARIVO_EVIDENCE_SOURCES_TOOL_NAME = 'marivo_evidence_sources'
export const MARIVO_EVIDENCE_SOURCES_META_KIND = 'marivo-evidence-sources'
export const MARIVO_EVIDENCE_SOURCES_META_VERSION = 1
export const MARIVO_EVIDENCE_SOURCES_DURABLE_CONTENT_KIND = 'marivo-evidence-sources-card'
export const MARIVO_EVIDENCE_SOURCES_MAX_PER_CALL = 20

const EVIDENCE_LIMITS = Object.freeze({
  timeoutMs: 30_000,
  stdoutMaxBytes: 1_048_576,
  stderrMaxBytes: 65_536,
})

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
  artifactId: string
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

interface FindingPayload {
  findingId: string
  findingType: string
  epistemicKind: string
  artifactId: string
  sessionId: string
  canonicalItemKey: string
  qualityStatus: string | null
  committedAt: string
  extractorVersion: string
  artifactSchemaVersion: string
  rendered: { en: string; zh: string }
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
    artifactId: { type: 'string', required: true },
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

function renderedText(value: unknown, field: string): string {
  const result = nonEmptyString(value, field, 8_192)
  if (/\r|\n/.test(result) || Buffer.byteLength(result, 'utf8') > 8_192) {
    throw new TypeError(`${field} must be one UTF-8 line of at most 8192 bytes`)
  }
  return result
}

function requestedFindingIds(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > MARIVO_EVIDENCE_SOURCES_MAX_PER_CALL
  ) {
    throw new TypeError(
      `marivo_evidence_sources finding_ids must contain 1-${MARIVO_EVIDENCE_SOURCES_MAX_PER_CALL} items`,
    )
  }
  const result = value.map((item, index) =>
    nonEmptyString(item, `marivo_evidence_sources finding_ids[${index}]`, 512),
  )
  if (new Set(result).size !== result.length) {
    throw new TypeError('marivo_evidence_sources finding_ids must be unique within one request')
  }
  return result
}

function jsonObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function parseFinding(value: unknown): FindingPayload {
  const item = jsonObject(value)
  if (item === undefined) throw new TypeError('finding must be an object')
  const qualityStatus =
    item.quality_status === null ? null : nonEmptyString(item.quality_status, 'quality_status', 128)
  return {
    findingId: nonEmptyString(item.finding_id, 'finding_id'),
    findingType: nonEmptyString(item.finding_type, 'finding_type'),
    epistemicKind: nonEmptyString(item.epistemic_kind, 'epistemic_kind'),
    artifactId: nonEmptyString(item.artifact_id, 'artifact_id'),
    sessionId: nonEmptyString(item.session_id, 'finding session_id'),
    canonicalItemKey: nonEmptyString(item.canonical_item_key, 'canonical_item_key'),
    qualityStatus,
    committedAt: nonEmptyString(item.committed_at, 'committed_at'),
    extractorVersion: nonEmptyString(item.extractor_version, 'extractor_version'),
    artifactSchemaVersion: nonEmptyString(item.artifact_schema_version, 'artifact_schema_version'),
    rendered: {
      en: renderedText(jsonObject(item.rendered)?.en, 'rendered.en'),
      zh: renderedText(jsonObject(item.rendered)?.zh, 'rendered.zh'),
    },
  }
}

function parseFindingsPayload(
  stdout: Buffer,
  expectedSessionId: string,
  expectedFindingIds: readonly string[],
): FindingPayload[] {
  try {
    const root = jsonObject(JSON.parse(stdout.toString('utf8')))
    if (
      root === undefined ||
      root.session_id !== expectedSessionId ||
      !Array.isArray(root.findings)
    ) {
      throw new TypeError('root fields are invalid')
    }
    const findings = root.findings.map(parseFinding)
    if (findings.length !== expectedFindingIds.length) throw new TypeError('finding count differs')
    for (let index = 0; index < findings.length; index++) {
      const finding = findings[index]
      if (
        finding === undefined ||
        finding.findingId !== expectedFindingIds[index] ||
        finding.sessionId !== expectedSessionId
      ) {
        throw new TypeError('finding identity or order differs')
      }
    }
    return findings
  } catch (cause) {
    throw new MarivoEnvironmentError(
      'subprocess-output-invalid',
      'Marivo Evidence reader returned an invalid Finding payload',
      { stdoutBytes: stdout.byteLength },
      { cause },
    )
  }
}

function evidenceSource(
  environmentFingerprint: string,
  finding: FindingPayload,
): MarivoEvidenceSource {
  return {
    environmentFingerprint,
    sessionId: finding.sessionId,
    findingId: finding.findingId,
    findingType: finding.findingType,
    epistemicKind: finding.epistemicKind,
    artifactId: finding.artifactId,
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
  environmentSource: MarivoEnvironmentSource,
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
      finding_ids: {
        type: 'array',
        required: true,
        description: `1-${MARIVO_EVIDENCE_SOURCES_MAX_PER_CALL} unique exact Finding IDs to attach.`,
        items: { type: 'string' },
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
      const findingIds = requestedFindingIds(args.finding_ids)
      const environment = await resolveMarivoEnvironmentSource(environmentSource)
      const result = await environment.runCheckedEvidenceFindings(
        sessionId,
        findingIds,
        EVIDENCE_LIMITS,
        exec.signal,
      )
      if (result.exitCode !== 0) {
        if (
          result.exitCode === 69 &&
          result.stderr.toString('utf8').includes('finding-render-unavailable')
        ) {
          throw new MarivoEnvironmentError(
            'shared-runtime-capability-missing',
            'Marivo Evidence sources require Finding.render(); upgrade the bound Marivo runtime and retry',
            { requiredCapability: 'finding-render-v1' },
          )
        }
        throw new MarivoEnvironmentError(
          'subprocess-failed',
          `Marivo Evidence read failed with exit code ${String(result.exitCode)}`,
          {
            exitCode: result.exitCode,
            stderr: result.stderr.toString('utf8').slice(0, 2_000),
          },
        )
      }
      const findings = parseFindingsPayload(result.stdout, sessionId, findingIds)
      return {
        status: 'ok',
        environment: {
          version: environment.binding.marivoVersion,
          fingerprint: environment.binding.fingerprint,
        },
        dshSessionId: String(session.id),
        sessionId,
        sources: findings.map((finding) =>
          evidenceSource(environment.binding.fingerprint, finding),
        ),
      }
    },
  })
}

export function registerMarivoEvidenceSourcesTool(
  ctx: Context,
  environmentSource: MarivoEnvironmentSource,
  session: Session,
): () => void {
  return ctx.tools.register(createMarivoEvidenceSourcesTool(environmentSource, session))
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
