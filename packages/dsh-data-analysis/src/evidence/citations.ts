import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue, Session } from '@deepseek-ai/dsh-session'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { MarivoEnvironmentError } from '../environment/errors.ts'
import {
  resolveMarivoEnvironmentSource,
  type MarivoEnvironmentSource,
} from '../disclosure/help.ts'

export const MARIVO_EVIDENCE_CITE_TOOL_NAME = 'marivo_evidence_cite'
export const MARIVO_CITATION_META_KIND = 'marivo-evidence-citations'
export const MARIVO_CITATION_META_VERSION = 1
export const MARIVO_CITATION_MAX_PER_CALL = 20
export const MARIVO_CITATION_MAX_HANDLES = 100

const EVIDENCE_LIMITS = Object.freeze({
  timeoutMs: 30_000,
  stdoutMaxBytes: 1_048_576,
  stderrMaxBytes: 65_536,
})

export interface MarivoEvidenceSource {
  [key: string]: JsonValue
  handle: string
  marker: string
  definition: string
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

export interface MarivoEvidenceCiteValue {
  [key: string]: JsonValue
  status: 'ok'
  environment: {
    version: string
    fingerprint: string
  }
  dshSessionId: string
  sessionId: string
  requested: MarivoEvidenceSource[]
  registry: MarivoEvidenceSource[]
}

export interface MarivoCitationMeta {
  [key: string]: JsonValue
  kind: typeof MARIVO_CITATION_META_KIND
  version: typeof MARIVO_CITATION_META_VERSION
  dshSessionId: string
  registry: MarivoEvidenceSource[]
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
}

function nonEmptyString(value: unknown, field: string, maxLength = 2_048): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maxLength) {
    throw new TypeError(`${field} must be a non-empty string of at most ${maxLength} characters`)
  }
  return value
}

function requestedFindingIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MARIVO_CITATION_MAX_PER_CALL) {
    throw new TypeError(
      `marivo_evidence_cite finding_ids must contain 1-${MARIVO_CITATION_MAX_PER_CALL} items`,
    )
  }
  const result = value.map((item, index) => nonEmptyString(
    item,
    `marivo_evidence_cite finding_ids[${index}]`,
    512,
  ))
  if (new Set(result).size !== result.length) {
    throw new TypeError('marivo_evidence_cite finding_ids must be unique within one request')
  }
  return result
}

function jsonObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function parseFinding(value: unknown): FindingPayload {
  const item = jsonObject(value)
  if (item === undefined) throw new TypeError('finding must be an object')
  const qualityStatus = item.quality_status === null
    ? null
    : nonEmptyString(item.quality_status, 'quality_status', 128)
  const findingType = nonEmptyString(item.finding_type, 'finding_type')
  const epistemicKind = nonEmptyString(item.epistemic_kind, 'epistemic_kind')
  return {
    findingId: nonEmptyString(item.finding_id, 'finding_id'),
    findingType,
    epistemicKind,
    artifactId: nonEmptyString(item.artifact_id, 'artifact_id'),
    sessionId: nonEmptyString(item.session_id, 'finding session_id'),
    canonicalItemKey: nonEmptyString(item.canonical_item_key, 'canonical_item_key'),
    qualityStatus,
    committedAt: nonEmptyString(item.committed_at, 'committed_at'),
    extractorVersion: nonEmptyString(item.extractor_version, 'extractor_version'),
    artifactSchemaVersion: nonEmptyString(item.artifact_schema_version, 'artifact_schema_version'),
  }
}

function parseFindingsPayload(
  stdout: Buffer,
  expectedSessionId: string,
  expectedFindingIds: readonly string[],
): FindingPayload[] {
  try {
    const root = jsonObject(JSON.parse(stdout.toString('utf8')))
    if (root === undefined || root.session_id !== expectedSessionId || !Array.isArray(root.findings)) {
      throw new TypeError('root fields are invalid')
    }
    const findings = root.findings.map(parseFinding)
    if (findings.length !== expectedFindingIds.length) throw new TypeError('finding count differs')
    for (let index = 0; index < findings.length; index++) {
      const finding = findings[index]
      if (
        finding === undefined
        || finding.findingId !== expectedFindingIds[index]
        || finding.sessionId !== expectedSessionId
      ) throw new TypeError('finding identity or order differs')
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

function handleNumber(handle: string): number | undefined {
  const match = /^F([1-9][0-9]{0,2})$/.exec(handle)
  if (match === null) return undefined
  const value = Number(match[1])
  return value <= MARIVO_CITATION_MAX_HANDLES ? value : undefined
}

function validSource(value: unknown): value is MarivoEvidenceSource {
  const source = jsonObject(value)
  if (source === undefined || handleNumber(String(source.handle)) === undefined) return false
  const handle = source.handle as string
  if (!(
    source.marker === `[^mv-${handle.toLowerCase()}]`
    && typeof source.definition === 'string'
    && source.definition.startsWith(`${source.marker}: `)
    && typeof source.environmentFingerprint === 'string'
    && source.environmentFingerprint !== ''
    && typeof source.sessionId === 'string'
    && source.sessionId !== ''
    && typeof source.findingId === 'string'
    && source.findingId !== ''
    && typeof source.findingType === 'string'
    && source.findingType !== ''
    && typeof source.epistemicKind === 'string'
    && source.epistemicKind !== ''
    && typeof source.artifactId === 'string'
    && source.artifactId !== ''
    && typeof source.canonicalItemKey === 'string'
    && source.canonicalItemKey !== ''
    && (source.qualityStatus === null || (
      typeof source.qualityStatus === 'string' && source.qualityStatus !== ''
    ))
    && typeof source.committedAt === 'string'
    && source.committedAt !== ''
    && typeof source.extractorVersion === 'string'
    && source.extractorVersion !== ''
    && typeof source.artifactSchemaVersion === 'string'
    && source.artifactSchemaVersion !== ''
  )) return false
  const typed = source as unknown as MarivoEvidenceSource
  const { definition: _definition, ...partial } = typed
  return typed.definition === definitionFor(partial)
}

function parseRegistryMeta(
  value: unknown,
  expectedDshSessionId: string,
): MarivoEvidenceSource[] | undefined {
  const meta = jsonObject(value)
  if (
    meta === undefined
    || meta.kind !== MARIVO_CITATION_META_KIND
    || meta.version !== MARIVO_CITATION_META_VERSION
    || meta.dshSessionId !== expectedDshSessionId
    || !Array.isArray(meta.registry)
    || meta.registry.length < 1
    || meta.registry.length > MARIVO_CITATION_MAX_HANDLES
    || !meta.registry.every(validSource)
  ) return undefined
  const handles = new Set<string>()
  const identities = new Set<string>()
  for (const [index, source] of meta.registry.entries()) {
    const identity = citationIdentity(
      source.environmentFingerprint,
      source.sessionId,
      source.findingId,
    )
    if (
      handleNumber(source.handle) !== index + 1
      || handles.has(source.handle)
      || identities.has(identity)
    ) return undefined
    handles.add(source.handle)
    identities.add(identity)
  }
  return meta.registry.map(source => ({ ...source }))
}

function citationIdentity(environmentFingerprint: string, sessionId: string, findingId: string): string {
  return JSON.stringify([environmentFingerprint, sessionId, findingId])
}

function definitionFor(source: Omit<MarivoEvidenceSource, 'definition'>): string {
  const quality = source.qualityStatus ?? '未标注'
  return `${source.marker}: Marivo Evidence ${source.handle}；Finding ${source.findingId}；Artifact ${source.artifactId}；类型 ${source.findingType}；epistemic ${source.epistemicKind}；quality ${quality}；提交 ${source.committedAt}。`
}

/** Per-DSH-Session stable handle registry restored solely from standard Tool result metadata. */
export class MarivoCitationRegistry {
  readonly session: Session
  #sources: MarivoEvidenceSource[]

  constructor(session: Session) {
    this.session = session
    this.#sources = this.#restore()
  }

  #restore(): MarivoEvidenceSource[] {
    for (let index = this.session.events.length - 1; index >= 0; index--) {
      const event = this.session.events[index]
      if (event?.type !== 'tool/result') continue
      const registry = parseRegistryMeta(event.data.meta, String(this.session.id))
      if (registry !== undefined) return registry
    }
    return []
  }

  snapshot(): MarivoEvidenceSource[] {
    return this.#sources.map(source => ({ ...source }))
  }

  issue(
    environment: { fingerprint: string; version: string },
    sessionId: string,
    findings: readonly FindingPayload[],
  ): MarivoEvidenceCiteValue {
    const byIdentity = new Map(this.#sources.map(source => [citationIdentity(
      source.environmentFingerprint,
      source.sessionId,
      source.findingId,
    ), source]))
    const requested: MarivoEvidenceSource[] = []
    const additions: MarivoEvidenceSource[] = []
    let nextHandle = this.#sources.reduce(
      (maximum, source) => Math.max(maximum, handleNumber(source.handle) ?? 0),
      0,
    ) + 1

    for (const finding of findings) {
      const identity = citationIdentity(environment.fingerprint, sessionId, finding.findingId)
      const existing = byIdentity.get(identity)
      if (existing !== undefined) {
        requested.push(existing)
        continue
      }
      if (nextHandle > MARIVO_CITATION_MAX_HANDLES) {
        throw new RangeError(
          `marivo_evidence_cite exceeds the per-DSH-Session limit of ${MARIVO_CITATION_MAX_HANDLES} handles`,
        )
      }
      const handle = `F${nextHandle}`
      const marker = `[^mv-${handle.toLowerCase()}]`
      const partial = {
        handle,
        marker,
        environmentFingerprint: environment.fingerprint,
        sessionId,
        findingId: finding.findingId,
        findingType: finding.findingType,
        epistemicKind: finding.epistemicKind,
        artifactId: finding.artifactId,
        canonicalItemKey: finding.canonicalItemKey,
        qualityStatus: finding.qualityStatus,
        committedAt: finding.committedAt,
        extractorVersion: finding.extractorVersion,
        artifactSchemaVersion: finding.artifactSchemaVersion,
      }
      const source: MarivoEvidenceSource = {
        ...partial,
        definition: definitionFor(partial),
      }
      additions.push(source)
      requested.push(source)
      byIdentity.set(identity, source)
      nextHandle++
    }

    // Commit only after every requested Finding can be assigned a valid handle.
    this.#sources = [...this.#sources, ...additions]
    return {
      status: 'ok',
      environment: { ...environment },
      dshSessionId: String(this.session.id),
      sessionId,
      requested: requested.map(source => ({ ...source })),
      registry: this.snapshot(),
    }
  }
}

function renderCitations(value: MarivoEvidenceCiteValue): string {
  const items = value.requested.flatMap(source => [
    `${source.handle}: marker ${source.marker}`,
    source.definition,
  ])
  return [
    'Marivo Evidence references issued. Copy each marker and definition verbatim; do not alter or invent handles.',
    ...items,
  ].join('\n')
}

/** Build the exact-Finding citation Tool for one Agent and its DSH Session. */
export function createMarivoEvidenceCiteTool(
  environmentSource: MarivoEnvironmentSource,
  session: Session,
): ToolDefinition {
  const registry = new MarivoCitationRegistry(session)
  return defineTool({
    name: MARIVO_EVIDENCE_CITE_TOOL_NAME,
    description: 'Optionally issue stable Markdown footnote references for exact persisted Marivo Evidence Findings. This identifies sources; it does not validate the surrounding conclusion.',
    parameters: {
      session_id: {
        type: 'string',
        required: true,
        description: 'Exact Marivo analysis Session ID containing the Findings.',
      },
      finding_ids: {
        type: 'array',
        required: true,
        description: `1-${MARIVO_CITATION_MAX_PER_CALL} unique exact Finding IDs, in desired handle order.`,
        items: { type: 'string' },
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{
        type: 'text',
        text: renderCitations(value as unknown as MarivoEvidenceCiteValue),
      }],
      presentationMeta: (_args, value) => {
        const result = value as unknown as MarivoEvidenceCiteValue
        return {
          kind: MARIVO_CITATION_META_KIND,
          version: MARIVO_CITATION_META_VERSION,
          dshSessionId: result.dshSessionId,
          registry: result.registry,
        }
      },
    },
    timeoutMs: 35_000,
    async execute(args, exec): Promise<MarivoEvidenceCiteValue> {
      const sessionId = nonEmptyString(args.session_id, 'marivo_evidence_cite session_id', 512)
      const findingIds = requestedFindingIds(args.finding_ids)
      const environment = await resolveMarivoEnvironmentSource(environmentSource)
      const result = await environment.runCheckedEvidenceFindings(
        sessionId,
        findingIds,
        EVIDENCE_LIMITS,
        exec.signal,
      )
      if (result.exitCode !== 0) {
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
      return registry.issue({
        version: environment.binding.marivoVersion,
        fingerprint: environment.binding.fingerprint,
      }, sessionId, findings)
    },
  })
}

export function registerMarivoEvidenceCiteTool(
  ctx: Context,
  environmentSource: MarivoEnvironmentSource,
  session: Session,
): () => void {
  return ctx.tools.register(createMarivoEvidenceCiteTool(environmentSource, session))
}
