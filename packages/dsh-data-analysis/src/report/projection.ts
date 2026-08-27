import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { ReportIssueV1 } from './document.ts'

export interface ReportArtifactColumn {
  readonly name: string
  readonly dtype: string
  readonly nullable: boolean
  readonly role: string
  readonly unit: string | null
}

export interface ReportArtifactProjection {
  readonly ref: string
  readonly family: string
  readonly shape: readonly [number, number]
  readonly columns: readonly ReportArtifactColumn[]
  readonly contentHash: string
  readonly artifactSchemaVersion: string
  readonly createdAt: string
  readonly contract: JsonValue
  readonly revalidation: JsonValue
  readonly lineage: JsonValue
  readonly rowsProjected: boolean
  readonly rows: readonly (readonly JsonValue[])[]
}

export interface ReportFindingProjection {
  readonly findingId: string
  readonly findingType: string
  readonly epistemicKind: string
  readonly artifactId: string
  readonly sessionId: string
  readonly qualityStatus: string | null
  readonly committedAt: string
  readonly value: JsonValue
  readonly subject: JsonValue
  readonly derivation: JsonValue
  readonly rendered: { readonly en: string; readonly zh: string }
}

export interface ReportCompatibilityProjection {
  readonly groupIndex: number
  readonly status: string
  readonly findingIds: readonly string[]
  readonly value: JsonValue
}

export interface ReportProjectionBundle {
  readonly sessionId: string
  readonly artifacts: readonly ReportArtifactProjection[]
  readonly findings: readonly ReportFindingProjection[]
  readonly compatibilities: readonly ReportCompatibilityProjection[]
}

export type ParseReportProjectionResult =
  | { readonly ok: true; readonly value: ReportProjectionBundle }
  | { readonly ok: false; readonly issues: readonly ReportIssueV1[] }

function object(value: unknown, location: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${location} must be an object`)
  }
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], location: string): void {
  const expected = new Set(keys)
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) throw new TypeError(`${location}.${key} is unknown`)
  }
  for (const key of keys) {
    if (!(key in value)) throw new TypeError(`${location}.${key} is required`)
  }
}

function string(value: unknown, location: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${location} must be a non-empty string`)
  return value
}

function integer(value: unknown, location: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new TypeError(`${location} must be a non-negative safe integer`)
  return value as number
}

function jsonValue(value: unknown, location: string): JsonValue {
  try {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) throw new TypeError('not JSON')
    return JSON.parse(serialized) as JsonValue
  } catch (cause) {
    throw new TypeError(`${location} must be lossless JSON`, { cause })
  }
}

function stableRevalidation(value: Record<string, unknown>, location: string): JsonValue {
  const { checked_at: _checkedAt, ...stable } = value
  return jsonValue(stable, location)
}

function stringArray(value: unknown, location: string): string[] {
  if (!Array.isArray(value)) throw new TypeError(`${location} must be an array`)
  return value.map((item, index) => string(item, `${location}[${index}]`))
}

function sameOrdered(actual: readonly string[], expected: readonly string[], location: string): void {
  if (actual.length !== expected.length || actual.some((item, index) => item !== expected[index])) {
    throw new TypeError(`${location} does not match the requested identities`)
  }
}

function sameSet(actual: readonly string[], expected: readonly string[], location: string): void {
  if (
    actual.length !== expected.length
    || new Set(actual).size !== actual.length
    || new Set(expected).size !== expected.length
    || actual.some(item => !expected.includes(item))
  ) {
    throw new TypeError(`${location} does not match the requested identity set`)
  }
}

function parseIssue(value: unknown, location: string): ReportIssueV1 {
  const source = object(value, location)
  exactKeys(source, ['code', 'location', 'message', 'repair'], location)
  return {
    code: string(source.code, `${location}.code`),
    location: string(source.location, `${location}.location`),
    message: string(source.message, `${location}.message`),
    repair: string(source.repair, `${location}.repair`),
  }
}

function parseColumn(value: unknown, location: string): ReportArtifactColumn {
  const source = object(value, location)
  exactKeys(source, ['name', 'dtype', 'nullable', 'role', 'unit'], location)
  if (typeof source.nullable !== 'boolean') throw new TypeError(`${location}.nullable must be boolean`)
  if (source.unit !== null && (typeof source.unit !== 'string' || source.unit.length === 0)) {
    throw new TypeError(`${location}.unit must be null or a non-empty string`)
  }
  return {
    name: string(source.name, `${location}.name`),
    dtype: string(source.dtype, `${location}.dtype`),
    nullable: source.nullable,
    role: string(source.role, `${location}.role`),
    unit: source.unit as string | null,
  }
}

function parseArtifact(value: unknown, location: string): ReportArtifactProjection {
  const source = object(value, location)
  exactKeys(source, [
    'ref', 'family', 'shape', 'columns', 'content_hash', 'artifact_schema_version',
    'created_at', 'contract', 'revalidation', 'lineage', 'rows_projected', 'rows',
  ], location)
  if (!Array.isArray(source.shape) || source.shape.length !== 2) throw new TypeError(`${location}.shape must contain two integers`)
  const rowCount = integer(source.shape[0], `${location}.shape[0]`)
  const columnCount = integer(source.shape[1], `${location}.shape[1]`)
  if (!Array.isArray(source.columns) || source.columns.length !== columnCount) {
    throw new TypeError(`${location}.columns must match the declared column count`)
  }
  const columns = source.columns.map((item, index) => parseColumn(item, `${location}.columns[${index}]`))
  if (new Set(columns.map(column => column.name)).size !== columns.length) throw new TypeError(`${location}.columns contains duplicate names`)
  if (typeof source.rows_projected !== 'boolean') throw new TypeError(`${location}.rows_projected must be boolean`)
  if (!Array.isArray(source.rows)) throw new TypeError(`${location}.rows must be an array`)
  if (source.rows_projected ? source.rows.length !== rowCount : source.rows.length !== 0) {
    throw new TypeError(`${location}.rows must match its projection status and declared row count`)
  }
  const rows = source.rows.map((row, rowIndex) => {
    if (!Array.isArray(row) || row.length !== columnCount) throw new TypeError(`${location}.rows[${rowIndex}] must match the declared columns`)
    return row.map((cell, columnIndex) => jsonValue(cell, `${location}.rows[${rowIndex}][${columnIndex}]`))
  })
  const revalidation = object(source.revalidation, `${location}.revalidation`)
  const ref = string(source.ref, `${location}.ref`)
  const contentHash = string(source.content_hash, `${location}.content_hash`)
  const artifactSchemaVersion = string(source.artifact_schema_version, `${location}.artifact_schema_version`)
  if (
    revalidation.status !== 'admissible'
    || revalidation.artifact_ref !== ref
    || revalidation.content_hash !== contentHash
    || revalidation.artifact_schema_version !== artifactSchemaVersion
  ) throw new TypeError(`${location}.revalidation identity is inconsistent`)
  return {
    ref,
    family: string(source.family, `${location}.family`),
    shape: [rowCount, columnCount],
    columns,
    contentHash,
    artifactSchemaVersion,
    createdAt: string(source.created_at, `${location}.created_at`),
    contract: jsonValue(source.contract, `${location}.contract`),
    revalidation: stableRevalidation(revalidation, `${location}.revalidation`),
    lineage: jsonValue(source.lineage, `${location}.lineage`),
    rowsProjected: source.rows_projected,
    rows,
  }
}

function parseFinding(value: unknown, location: string): ReportFindingProjection {
  const source = object(value, location)
  exactKeys(source, [
    'finding_id', 'finding_type', 'epistemic_kind', 'artifact_id', 'session_id',
    'quality_status', 'committed_at', 'value', 'subject', 'derivation', 'rendered',
  ], location)
  if (source.quality_status !== null && (typeof source.quality_status !== 'string' || source.quality_status.length === 0)) {
    throw new TypeError(`${location}.quality_status must be null or a non-empty string`)
  }
  const rendered = object(source.rendered, `${location}.rendered`)
  exactKeys(rendered, ['en', 'zh'], `${location}.rendered`)
  const english = string(rendered.en, `${location}.rendered.en`)
  const chinese = string(rendered.zh, `${location}.rendered.zh`)
  if (
    /\r|\n/.test(english) || /\r|\n/.test(chinese)
    || Buffer.byteLength(english, 'utf8') > 8_192 || Buffer.byteLength(chinese, 'utf8') > 8_192
  ) throw new TypeError(`${location}.rendered must contain single-line statements of at most 8192 UTF-8 bytes`)
  return {
    findingId: string(source.finding_id, `${location}.finding_id`),
    findingType: string(source.finding_type, `${location}.finding_type`),
    epistemicKind: string(source.epistemic_kind, `${location}.epistemic_kind`),
    artifactId: string(source.artifact_id, `${location}.artifact_id`),
    sessionId: string(source.session_id, `${location}.session_id`),
    qualityStatus: source.quality_status as string | null,
    committedAt: string(source.committed_at, `${location}.committed_at`),
    value: jsonValue(source.value, `${location}.value`),
    subject: jsonValue(source.subject, `${location}.subject`),
    derivation: jsonValue(source.derivation, `${location}.derivation`),
    rendered: { en: english, zh: chinese },
  }
}

function parseCompatibility(value: unknown, location: string): ReportCompatibilityProjection {
  const source = object(value, location)
  exactKeys(source, ['group_index', 'status', 'finding_ids', 'value'], location)
  return {
    groupIndex: integer(source.group_index, `${location}.group_index`),
    status: string(source.status, `${location}.status`),
    findingIds: stringArray(source.finding_ids, `${location}.finding_ids`),
    value: jsonValue(source.value, `${location}.value`),
  }
}

/** Validate the complete all-or-nothing JSON payload returned by the checked bridge. */
export function parseReportProjection(
  stdout: Buffer,
  expected: {
    readonly sessionId: string
    readonly artifactRefs: readonly string[]
    readonly findingIds: readonly string[]
    readonly findingGroups: readonly (readonly string[])[]
  },
): ParseReportProjectionResult {
  let raw: unknown
  try {
    raw = JSON.parse(stdout.toString('utf8'))
  } catch (cause) {
    throw new TypeError('Marivo report projection returned invalid JSON', { cause })
  }
  const source = object(raw, 'projection')
  if (source.status === 'blocked') {
    exactKeys(source, ['status', 'issues'], 'projection')
    if (!Array.isArray(source.issues) || source.issues.length < 1 || source.issues.length > 100) {
      throw new TypeError('projection.issues must contain between 1 and 100 issues')
    }
    return { ok: false, issues: source.issues.map((item, index) => parseIssue(item, `projection.issues[${index}]`)) }
  }
  exactKeys(source, ['status', 'session_id', 'artifacts', 'findings', 'compatibilities'], 'projection')
  if (source.status !== 'ready') throw new TypeError('projection.status must be ready or blocked')
  if (source.session_id !== expected.sessionId) throw new TypeError('projection.session_id does not match the request')
  if (!Array.isArray(source.artifacts) || !Array.isArray(source.findings) || !Array.isArray(source.compatibilities)) {
    throw new TypeError('projection collections must be arrays')
  }
  const artifacts = source.artifacts.map((item, index) => parseArtifact(item, `projection.artifacts[${index}]`))
  const findings = source.findings.map((item, index) => parseFinding(item, `projection.findings[${index}]`))
  const compatibilities = source.compatibilities.map((item, index) => parseCompatibility(item, `projection.compatibilities[${index}]`))
  sameOrdered(findings.map(item => item.findingId), expected.findingIds, 'projection.findings')
  if (findings.some(item => item.sessionId !== expected.sessionId)) throw new TypeError('projection Finding belongs to another Session')
  const expectedArtifactRefs = [...expected.artifactRefs]
  for (const finding of findings) {
    if (!expectedArtifactRefs.includes(finding.artifactId)) expectedArtifactRefs.push(finding.artifactId)
  }
  sameOrdered(artifacts.map(item => item.ref), expectedArtifactRefs, 'projection.artifacts')
  const displayRefs = new Set(expected.artifactRefs)
  for (const artifact of artifacts) {
    if (artifact.rowsProjected !== displayRefs.has(artifact.ref)) {
      throw new TypeError(`projection artifact ${artifact.ref} has the wrong row projection status`)
    }
  }
  if (compatibilities.length !== expected.findingGroups.length) throw new TypeError('projection compatibility count does not match the request')
  for (const [index, compatibility] of compatibilities.entries()) {
    if (compatibility.groupIndex !== index) throw new TypeError(`projection.compatibilities[${index}] has the wrong group index`)
    sameSet(compatibility.findingIds, expected.findingGroups[index] ?? [], `projection.compatibilities[${index}].finding_ids`)
    if (compatibility.status !== 'compatible') throw new TypeError(`projection.compatibilities[${index}] is not compatible`)
  }
  return { ok: true, value: { sessionId: expected.sessionId, artifacts, findings, compatibilities } }
}
