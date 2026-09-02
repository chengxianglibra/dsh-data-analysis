import { MarivoEnvironmentError } from '../environment/errors.ts'
import type { MarivoBridgeSource } from '../environment/source.ts'
import { resolveMarivoBridgeSource } from '../environment/source.ts'
import type { MarivoCheckedRunner, MarivoEnvironmentBinding } from '../environment/types.ts'
import { MARIVO_EVIDENCE_FINDINGS_PROGRAM } from './bridge-program.ts'

const EVIDENCE_LIMITS = Object.freeze({
  timeoutMs: 30_000,
  stdoutMaxBytes: 1_048_576,
  stderrMaxBytes: 65_536,
})

export interface MarivoFindingProjection {
  status: 'available' | 'missing' | 'unsupported'
  title: string
  locator: string
  excerpt: string | null
  truncated: boolean
  findingId: string
  findingType: string | null
  epistemicKind: string | null
  artifactRef: string
  sessionId: string
  canonicalItemKey: string | null
  committedAt: string | null
  sourceRefs: string[]
  revalidation: {
    status: string
    semanticStatus: string | null
    evidenceStatus: string | null
    dependencyStatus: string | null
  } | null
}

export interface MarivoFindingSelection {
  artifactRef: string
  findingId: string
}

export interface MarivoEvidenceBridgePort {
  readonly binding: Readonly<Pick<MarivoEnvironmentBinding, 'fingerprint' | 'marivoVersion'>>
  findings(
    sessionId: string,
    selections: readonly MarivoFindingSelection[],
    signal?: AbortSignal,
  ): Promise<MarivoFindingProjection[]>
}

export type MarivoEvidenceBridgeSource = MarivoBridgeSource<MarivoEvidenceBridgePort>

function nonEmptyString(value: unknown, field: string, maxChars = 2_048): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maxChars) {
    throw new TypeError(`${field} must be a bounded non-empty string`)
  }
  return value
}

function boundedText(value: unknown, field: string, maxBytes = 4_096): string {
  const result = nonEmptyString(value, field, maxBytes)
  if (Buffer.byteLength(result, 'utf8') > maxBytes) {
    throw new TypeError(`${field} must be at most ${maxBytes} UTF-8 bytes`)
  }
  return result
}

function nullableString(value: unknown, field: string, maxChars = 2_048): string | null {
  return value === null ? null : nonEmptyString(value, field, maxChars)
}

function parseRevalidation(value: unknown): MarivoFindingProjection['revalidation'] {
  if (value === null) return null
  const item = jsonObject(value)
  if (item === undefined) throw new TypeError('revalidation must be an object or null')
  exactKeys(
    item,
    ['status', 'semantic_status', 'evidence_status', 'dependency_status'],
    'revalidation',
  )
  return {
    status: nonEmptyString(item.status, 'revalidation.status', 128),
    semanticStatus: nullableString(item.semantic_status, 'revalidation.semantic_status', 128),
    evidenceStatus: nullableString(item.evidence_status, 'revalidation.evidence_status', 128),
    dependencyStatus: nullableString(item.dependency_status, 'revalidation.dependency_status', 128),
  }
}

function jsonObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], field: string): void {
  const expected = new Set(keys)
  if (Object.keys(value).some((key) => !expected.has(key)) || keys.some((key) => !(key in value))) {
    throw new TypeError(`${field} must contain exactly the expected fields`)
  }
}

function parseFinding(value: unknown): MarivoFindingProjection {
  const item = jsonObject(value)
  if (item === undefined) throw new TypeError('finding must be an object')
  exactKeys(
    item,
    [
      'finding_id',
      'status',
      'title',
      'locator',
      'excerpt',
      'truncated',
      'finding_type',
      'epistemic_kind',
      'artifact_ref',
      'session_id',
      'canonical_item_key',
      'committed_at',
      'source_refs',
      'revalidation',
    ],
    'finding',
  )
  if (!['available', 'missing', 'unsupported'].includes(String(item.status))) {
    throw new TypeError('status must be available, missing, or unsupported')
  }
  if (typeof item.truncated !== 'boolean') throw new TypeError('truncated must be boolean')
  if (!Array.isArray(item.source_refs) || item.source_refs.length > 100) {
    throw new TypeError('source_refs must be a bounded array')
  }
  const parsed: MarivoFindingProjection = {
    status: item.status as MarivoFindingProjection['status'],
    title: boundedText(item.title, 'title', 2_048),
    locator: boundedText(item.locator, 'locator', 2_048),
    excerpt: item.excerpt === null ? null : boundedText(item.excerpt, 'excerpt'),
    truncated: item.truncated,
    findingId: nonEmptyString(item.finding_id, 'finding_id'),
    findingType: nullableString(item.finding_type, 'finding_type'),
    epistemicKind: nullableString(item.epistemic_kind, 'epistemic_kind'),
    artifactRef: nonEmptyString(item.artifact_ref, 'artifact_ref'),
    sessionId: nonEmptyString(item.session_id, 'finding session_id'),
    canonicalItemKey: nullableString(item.canonical_item_key, 'canonical_item_key'),
    committedAt: nullableString(item.committed_at, 'committed_at'),
    sourceRefs: item.source_refs.map((ref, index) =>
      nonEmptyString(ref, `source_refs[${index}]`, 2_048),
    ),
    revalidation: parseRevalidation(item.revalidation),
  }
  if (
    (parsed.status === 'available' &&
      (parsed.excerpt === null ||
        parsed.findingType === null ||
        parsed.epistemicKind === null ||
        parsed.canonicalItemKey === null ||
        parsed.committedAt === null)) ||
    (parsed.status === 'missing' &&
      (parsed.excerpt !== null ||
        parsed.truncated ||
        parsed.findingType !== null ||
        parsed.epistemicKind !== null ||
        parsed.canonicalItemKey !== null ||
        parsed.committedAt !== null)) ||
    (parsed.status === 'unsupported' && parsed.excerpt !== null) ||
    (parsed.truncated && parsed.excerpt === null)
  ) {
    throw new TypeError('finding status fields are inconsistent')
  }
  return parsed
}

function parseFindingsPayload(
  stdout: Buffer,
  expectedSessionId: string,
  expectedSelections: readonly MarivoFindingSelection[],
): MarivoFindingProjection[] {
  try {
    const root = jsonObject(JSON.parse(stdout.toString('utf8')))
    if (root !== undefined) exactKeys(root, ['session_id', 'sources'], 'root')
    if (
      root === undefined ||
      root.session_id !== expectedSessionId ||
      !Array.isArray(root.sources)
    ) {
      throw new TypeError('root fields are invalid')
    }
    const findings = root.sources.map(parseFinding)
    if (findings.length !== expectedSelections.length) throw new TypeError('finding count differs')
    for (let index = 0; index < findings.length; index++) {
      const finding = findings[index]
      const selection = expectedSelections[index]
      if (
        finding === undefined ||
        selection === undefined ||
        finding.findingId !== selection.findingId ||
        finding.artifactRef !== selection.artifactRef ||
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

/** Identity-checked adapter for exact persisted Marivo Findings. */
export class MarivoEvidenceBridge {
  readonly binding: Readonly<MarivoEnvironmentBinding>
  readonly #runner: MarivoCheckedRunner

  constructor(runner: MarivoCheckedRunner) {
    this.#runner = runner
    this.binding = runner.binding
  }

  async findings(
    sessionId: string,
    selections: readonly MarivoFindingSelection[],
    signal?: AbortSignal,
  ): Promise<MarivoFindingProjection[]> {
    const result = await this.#runner.runChecked({
      program: MARIVO_EVIDENCE_FINDINGS_PROGRAM,
      args: [sessionId, JSON.stringify(selections)],
      limits: EVIDENCE_LIMITS,
      signal,
    })
    if (result.exitCode !== 0) {
      throw new MarivoEnvironmentError(
        'subprocess-failed',
        `Marivo Evidence read failed with exit code ${String(result.exitCode)}`,
        { exitCode: result.exitCode, stderr: result.stderr.toString('utf8').slice(0, 2_000) },
      )
    }
    return parseFindingsPayload(result.stdout, sessionId, selections)
  }
}

export function resolveMarivoEvidenceBridge(
  source: MarivoEvidenceBridgeSource,
): Promise<MarivoEvidenceBridgePort> {
  return resolveMarivoBridgeSource(source)
}
