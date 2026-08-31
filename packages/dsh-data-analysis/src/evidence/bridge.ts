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
  findingId: string
  findingType: string
  epistemicKind: string
  artifactRef: string
  sessionId: string
  canonicalItemKey: string
  qualityStatus: string | null
  committedAt: string
  extractorVersion: string
  artifactSchemaVersion: string
  rendered: { en: string; zh: string }
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

function renderedText(value: unknown, field: string): string {
  const result = nonEmptyString(value, field, 8_192)
  if (/\r|\n/.test(result) || Buffer.byteLength(result, 'utf8') > 8_192) {
    throw new TypeError(`${field} must be one UTF-8 line of at most 8192 bytes`)
  }
  return result
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
      'finding_type',
      'epistemic_kind',
      'artifact_ref',
      'session_id',
      'canonical_item_key',
      'quality_status',
      'committed_at',
      'extractor_version',
      'artifact_schema_version',
      'rendered',
    ],
    'finding',
  )
  const rendered = jsonObject(item.rendered)
  if (rendered === undefined) throw new TypeError('rendered must be an object')
  exactKeys(rendered, ['en', 'zh'], 'rendered')
  const qualityStatus =
    item.quality_status === null ? null : nonEmptyString(item.quality_status, 'quality_status', 128)
  return {
    findingId: nonEmptyString(item.finding_id, 'finding_id'),
    findingType: nonEmptyString(item.finding_type, 'finding_type'),
    epistemicKind: nonEmptyString(item.epistemic_kind, 'epistemic_kind'),
    artifactRef: nonEmptyString(item.artifact_ref, 'artifact_ref'),
    sessionId: nonEmptyString(item.session_id, 'finding session_id'),
    canonicalItemKey: nonEmptyString(item.canonical_item_key, 'canonical_item_key'),
    qualityStatus,
    committedAt: nonEmptyString(item.committed_at, 'committed_at'),
    extractorVersion: nonEmptyString(item.extractor_version, 'extractor_version'),
    artifactSchemaVersion: nonEmptyString(item.artifact_schema_version, 'artifact_schema_version'),
    rendered: {
      en: renderedText(rendered.en, 'rendered.en'),
      zh: renderedText(rendered.zh, 'rendered.zh'),
    },
  }
}

function parseFindingsPayload(
  stdout: Buffer,
  expectedSessionId: string,
  expectedSelections: readonly MarivoFindingSelection[],
): MarivoFindingProjection[] {
  try {
    const root = jsonObject(JSON.parse(stdout.toString('utf8')))
    if (root !== undefined) exactKeys(root, ['session_id', 'findings'], 'root')
    if (
      root === undefined ||
      root.session_id !== expectedSessionId ||
      !Array.isArray(root.findings)
    ) {
      throw new TypeError('root fields are invalid')
    }
    const findings = root.findings.map(parseFinding)
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
