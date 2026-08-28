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

export interface ReportProjectionInspection {
  readonly ok: boolean
  readonly value: ReportProjectionBundle
  readonly issues: readonly ReportIssueV1[]
  readonly omittedIssueCount: number
  readonly complete: boolean
  readonly globalFailure: boolean
  /** Artifact identities checked by the bridge, in artifact outcome order. */
  readonly checkedArtifactRefs: readonly string[]
  /** Backing Artifact identity discovered for each successfully resolved Finding. */
  readonly findingArtifactTargets: readonly {
    readonly findingId: string
    readonly artifactRef: string
  }[]
}

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

function issueArray(value: unknown, location: string): ReportIssueV1[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new TypeError(`${location} must contain between 1 and 100 issues`)
  }
  return value.map((item, index) => parseIssue(item, `${location}[${index}]`))
}

function omittedCount(value: unknown, location: string): number {
  return integer(value, location)
}

interface ParsedOutcome<T> {
  readonly ready: boolean
  readonly value?: T
  readonly issues: readonly ReportIssueV1[]
  readonly omitted: number
}

interface ParsedFindingOutcome extends ParsedOutcome<ReportFindingProjection> {
  readonly artifactRef?: string
}

function parseOutcome<T>(
  value: unknown,
  location: string,
  identityKey: 'group_index' | 'finding_id' | 'ref',
  expectedIdentity: number | string,
  parseValue: (value: unknown, location: string) => T,
): ParsedOutcome<T> {
  const source = object(value, location)
  if (source.status === 'ready') {
    exactKeys(source, ['status', 'value'], location)
    const parsed = parseValue(source.value, `${location}.value`)
    return { ready: true, value: parsed, issues: [], omitted: 0 }
  }
  if (source.status !== 'blocked') throw new TypeError(`${location}.status must be ready or blocked`)
  exactKeys(source, ['status', identityKey, 'issues', 'omitted_issue_count'], location)
  if (source[identityKey] !== expectedIdentity) {
    throw new TypeError(`${location}.${identityKey} does not match the requested identity`)
  }
  return {
    ready: false,
    issues: issueArray(source.issues, `${location}.issues`),
    omitted: omittedCount(source.omitted_issue_count, `${location}.omitted_issue_count`),
  }
}

function parseFindingOutcome(
  value: unknown,
  location: string,
  expectedId: string,
): ParsedFindingOutcome {
  const source = object(value, location)
  if (source.status === 'ready') {
    exactKeys(source, ['status', 'value'], location)
    const finding = parseFinding(source.value, `${location}.value`)
    return {
      ready: true,
      value: finding,
      artifactRef: finding.artifactId,
      issues: [],
      omitted: 0,
    }
  }
  if (source.status !== 'blocked') throw new TypeError(`${location}.status must be ready or blocked`)
  const hasArtifactRef = Object.hasOwn(source, 'artifact_ref')
  exactKeys(
    source,
    hasArtifactRef
      ? ['status', 'finding_id', 'artifact_ref', 'issues', 'omitted_issue_count']
      : ['status', 'finding_id', 'issues', 'omitted_issue_count'],
    location,
  )
  if (source.finding_id !== expectedId) {
    throw new TypeError(`${location}.finding_id does not match the requested identity`)
  }
  return {
    ready: false,
    ...(hasArtifactRef ? { artifactRef: string(source.artifact_ref, `${location}.artifact_ref`) } : {}),
    issues: issueArray(source.issues, `${location}.issues`),
    omitted: omittedCount(source.omitted_issue_count, `${location}.omitted_issue_count`),
  }
}

/** Validate the exhaustive checked/blocked outcomes returned by the report bridge. */
export function parseReportProjection(
  stdout: Buffer,
  expected: {
    readonly sessionId: string
    readonly artifactRefs: readonly string[]
    readonly findingIds: readonly string[]
    readonly findingGroups: readonly (readonly string[])[]
  },
): ReportProjectionInspection {
  let raw: unknown
  try {
    raw = JSON.parse(stdout.toString('utf8'))
  } catch (cause) {
    throw new TypeError('Marivo report projection returned invalid JSON', { cause })
  }
  const source = object(raw, 'projection')
  if (source.status === 'blocked') {
    exactKeys(source, ['status', 'issues', 'omitted_issue_count'], 'projection')
    return {
      ok: false,
      value: { sessionId: expected.sessionId, artifacts: [], findings: [], compatibilities: [] },
      issues: issueArray(source.issues, 'projection.issues'),
      omittedIssueCount: omittedCount(source.omitted_issue_count, 'projection.omitted_issue_count'),
      complete: false,
      globalFailure: true,
      checkedArtifactRefs: [],
      findingArtifactTargets: [],
    }
  }
  exactKeys(source, [
    'status', 'session_id', 'finding_group_outcomes', 'finding_outcomes', 'artifact_outcomes',
  ], 'projection')
  if (source.status !== 'checked') throw new TypeError('projection.status must be checked or blocked')
  if (source.session_id !== expected.sessionId) throw new TypeError('projection.session_id does not match the request')
  if (
    !Array.isArray(source.finding_group_outcomes)
    || !Array.isArray(source.finding_outcomes)
    || !Array.isArray(source.artifact_outcomes)
  ) {
    throw new TypeError('projection outcomes must be arrays')
  }
  if (source.finding_group_outcomes.length !== expected.findingGroups.length) {
    throw new TypeError('projection finding group outcome count does not match the request')
  }
  if (source.finding_outcomes.length !== expected.findingIds.length) {
    throw new TypeError('projection Finding outcome count does not match the request')
  }
  const compatibilities: ReportCompatibilityProjection[] = []
  const findings: ReportFindingProjection[] = []
  const findingArtifactTargets: { findingId: string; artifactRef: string }[] = []
  const issues: ReportIssueV1[] = []
  let omitted = 0
  let complete = true
  for (const [index, item] of source.finding_group_outcomes.entries()) {
    const outcome = parseOutcome(
      item, `projection.finding_group_outcomes[${index}]`, 'group_index', index,
      parseCompatibility,
    )
    if (outcome.ready) {
      const compatibility = outcome.value
      if (compatibility === undefined || compatibility.groupIndex !== index) {
        throw new TypeError(`projection.finding_group_outcomes[${index}] has the wrong group index`)
      }
      sameSet(compatibility.findingIds, expected.findingGroups[index] ?? [], `projection.finding_group_outcomes[${index}].value.finding_ids`)
      if (compatibility.status !== 'compatible') throw new TypeError(`projection.finding_group_outcomes[${index}] ready value is not compatible`)
      compatibilities.push(compatibility)
    } else {
      complete = false
      issues.push(...outcome.issues)
      omitted += outcome.omitted
    }
  }
  for (const [index, item] of source.finding_outcomes.entries()) {
    const expectedId = expected.findingIds[index]
    if (expectedId === undefined) throw new TypeError('projection Finding outcome is unexpected')
    const outcome = parseFindingOutcome(
      item, `projection.finding_outcomes[${index}]`, expectedId,
    )
    if (outcome.artifactRef !== undefined) {
      findingArtifactTargets.push({ findingId: expectedId, artifactRef: outcome.artifactRef })
    }
    if (outcome.ready) {
      const finding = outcome.value
      if (finding === undefined || finding.findingId !== expectedId) {
        throw new TypeError(`projection.finding_outcomes[${index}] has the wrong Finding ID`)
      }
      findings.push(finding)
    } else {
      complete = false
      issues.push(...outcome.issues)
      omitted += outcome.omitted
    }
  }
  if (findings.some(item => item.sessionId !== expected.sessionId)) throw new TypeError('projection Finding belongs to another Session')
  const expectedArtifactRefs = [...expected.artifactRefs]
  for (const target of findingArtifactTargets) {
    if (!expectedArtifactRefs.includes(target.artifactRef)) expectedArtifactRefs.push(target.artifactRef)
  }
  if (source.artifact_outcomes.length !== expectedArtifactRefs.length) {
    throw new TypeError('projection Artifact outcome count does not match the requested and discovered identities')
  }
  const artifacts: ReportArtifactProjection[] = []
  for (const [index, item] of source.artifact_outcomes.entries()) {
    const expectedRef = expectedArtifactRefs[index]
    if (expectedRef === undefined) throw new TypeError('projection Artifact outcome is unexpected')
    const outcome = parseOutcome(
      item, `projection.artifact_outcomes[${index}]`, 'ref', expectedRef,
      parseArtifact,
    )
    if (outcome.ready) {
      const artifact = outcome.value
      if (artifact === undefined || artifact.ref !== expectedRef) {
        throw new TypeError(`projection.artifact_outcomes[${index}] has the wrong Artifact ref`)
      }
      artifacts.push(artifact)
    } else {
      complete = false
      issues.push(...outcome.issues)
      omitted += outcome.omitted
    }
  }
  const displayRefs = new Set(expected.artifactRefs)
  for (const artifact of artifacts) {
    if (artifact.rowsProjected !== displayRefs.has(artifact.ref)) {
      throw new TypeError(`projection artifact ${artifact.ref} has the wrong row projection status`)
    }
  }
  return {
    ok: complete,
    value: { sessionId: expected.sessionId, artifacts, findings, compatibilities },
    issues,
    omittedIssueCount: omitted,
    complete,
    globalFailure: false,
    checkedArtifactRefs: expectedArtifactRefs,
    findingArtifactTargets,
  }
}
