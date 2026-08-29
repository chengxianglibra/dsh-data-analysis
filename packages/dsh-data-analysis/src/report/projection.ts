import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { ReportComputedDataSource, ReportIssue } from './document.ts'

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
  readonly rows: readonly (readonly JsonValue[])[]
}

export interface ReportComputedProjection {
  readonly id: string
  readonly formatVersion: string
  readonly shape: readonly [number, number]
  readonly columns: readonly ReportArtifactColumn[]
  readonly rows: readonly (readonly JsonValue[])[]
}

export interface ReportDagQueryProjection {
  readonly queryId: string
  readonly datasource: string
  readonly dialect: string
  readonly sql: string
  readonly sqlDigest: string
  readonly rowCount: number
  readonly durationMs: number
  readonly startedAt: string
  readonly finishedAt: string
  readonly status: string
  readonly outputRef: string | null
}

export interface ReportDagJobProjection {
  readonly id: string
  readonly intent: string
  readonly status: 'succeeded'
  readonly startedAt: string
  readonly finishedAt: string | null
  readonly durationMs: number
  readonly analysisPurpose: string | null
  readonly params: JsonValue
  readonly inputArtifactRefs: readonly string[]
  readonly outputArtifactRef: string
  readonly reusedArtifact: boolean
  readonly queries: readonly ReportDagQueryProjection[]
  readonly queryIssues: readonly ReportIssue[]
}

export type ReportDagArtifactStatus = 'ready' | 'unavailable' | 'boundary'

export interface ReportDagArtifactProjection {
  readonly ref: string
  readonly status: ReportDagArtifactStatus
  readonly family: string | null
  readonly shape: readonly [number, number] | null
  readonly columns: readonly ReportArtifactColumn[]
  readonly contentHash: string | null
  readonly artifactSchemaVersion: string | null
  readonly createdAt: string | null
  readonly contract: JsonValue | null
  readonly revalidation: JsonValue | null
  readonly lineage: JsonValue | null
  readonly previewRows: readonly (readonly JsonValue[])[]
  readonly totalRows: number | null
  readonly omittedRows: number | null
  readonly issues: readonly ReportIssue[]
}

export interface ReportSessionDagProjection {
  readonly jobs: readonly ReportDagJobProjection[]
  readonly artifacts: readonly ReportDagArtifactProjection[]
}

export interface ReportProjectionBundle {
  readonly sessionId: string | null
  readonly artifacts: readonly ReportArtifactProjection[]
  readonly computed: readonly ReportComputedProjection[]
  readonly sessionDag: ReportSessionDagProjection
}

function computedDtype(
  type: ReportComputedDataSource['computed']['columns'][number]['type'],
): string {
  if (type === 'datetime') return 'datetime64[ns]'
  return type
}

function computedRole(column: ReportComputedDataSource['computed']['columns'][number]): string {
  if (column.role !== undefined) return column.role
  if (column.type === 'datetime') return 'time'
  if (column.type === 'number') return 'measure'
  return 'dimension'
}

/** Convert a validated inline computed table into the projection shape shared by visuals. */
export function createReportComputedProjection(
  source: ReportComputedDataSource,
): ReportComputedProjection {
  const { computed } = source
  return {
    id: source.id,
    formatVersion: computed.version,
    shape: [computed.rows.length, computed.columns.length],
    columns: computed.columns.map((column, index) => ({
      name: column.name,
      dtype: computedDtype(column.type),
      nullable: column.nullable ?? computed.rows.some((row) => row[index] === null),
      role: computedRole(column),
      unit: column.unit ?? null,
    })),
    rows: computed.rows.map((row) => [...row]),
  }
}

export interface ReportProjectionInspection {
  readonly ok: boolean
  readonly value: ReportProjectionBundle
  readonly issues: readonly ReportIssue[]
  readonly omittedIssueCount: number
  readonly complete: boolean
  readonly globalFailure: boolean
  /** Artifact identities checked by the bridge, in artifact outcome order. */
  readonly checkedArtifactRefs: readonly string[]
}

function object(value: unknown, location: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${location} must be an object`)
  }
  return value as Record<string, unknown>
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  location: string,
): void {
  const expected = new Set(keys)
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) throw new TypeError(`${location}.${key} is unknown`)
  }
  for (const key of keys) {
    if (!(key in value)) throw new TypeError(`${location}.${key} is required`)
  }
}

function string(value: unknown, location: string): string {
  if (typeof value !== 'string' || value.length === 0)
    throw new TypeError(`${location} must be a non-empty string`)
  return value
}

function timestamp(value: unknown, location: string): string {
  const result = string(value, location)
  if (!Number.isFinite(Date.parse(result)))
    throw new TypeError(`${location} must be an ISO timestamp`)
  return result
}

function integer(value: unknown, location: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new TypeError(`${location} must be a non-negative safe integer`)
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

function parseIssue(value: unknown, location: string): ReportIssue {
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
  if (typeof source.nullable !== 'boolean')
    throw new TypeError(`${location}.nullable must be boolean`)
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
  exactKeys(
    source,
    [
      'ref',
      'family',
      'shape',
      'columns',
      'content_hash',
      'artifact_schema_version',
      'created_at',
      'contract',
      'revalidation',
      'lineage',
      'rows',
    ],
    location,
  )
  if (!Array.isArray(source.shape) || source.shape.length !== 2)
    throw new TypeError(`${location}.shape must contain two integers`)
  const rowCount = integer(source.shape[0], `${location}.shape[0]`)
  const columnCount = integer(source.shape[1], `${location}.shape[1]`)
  if (!Array.isArray(source.columns) || source.columns.length !== columnCount) {
    throw new TypeError(`${location}.columns must match the declared column count`)
  }
  const columns = source.columns.map((item, index) =>
    parseColumn(item, `${location}.columns[${index}]`),
  )
  if (new Set(columns.map((column) => column.name)).size !== columns.length)
    throw new TypeError(`${location}.columns contains duplicate names`)
  if (!Array.isArray(source.rows)) throw new TypeError(`${location}.rows must be an array`)
  if (source.rows.length !== rowCount)
    throw new TypeError(`${location}.rows must match the declared row count`)
  const rows = source.rows.map((row, rowIndex) => {
    if (!Array.isArray(row) || row.length !== columnCount)
      throw new TypeError(`${location}.rows[${rowIndex}] must match the declared columns`)
    return row.map((cell, columnIndex) =>
      jsonValue(cell, `${location}.rows[${rowIndex}][${columnIndex}]`),
    )
  })
  const revalidation = object(source.revalidation, `${location}.revalidation`)
  const ref = string(source.ref, `${location}.ref`)
  const contentHash = string(source.content_hash, `${location}.content_hash`)
  const artifactSchemaVersion = string(
    source.artifact_schema_version,
    `${location}.artifact_schema_version`,
  )
  if (
    revalidation.status !== 'admissible' ||
    revalidation.artifact_ref !== ref ||
    revalidation.content_hash !== contentHash ||
    revalidation.artifact_schema_version !== artifactSchemaVersion
  )
    throw new TypeError(`${location}.revalidation identity is inconsistent`)
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
    rows,
  }
}

function nullableString(value: unknown, location: string): string | null {
  if (value === null) return null
  return string(value, location)
}

function parseDagQuery(value: unknown, location: string): ReportDagQueryProjection {
  const source = object(value, location)
  exactKeys(
    source,
    [
      'query_id',
      'datasource',
      'dialect',
      'sql',
      'sql_digest',
      'row_count',
      'duration_ms',
      'started_at',
      'finished_at',
      'status',
      'output_ref',
    ],
    location,
  )
  return {
    queryId: string(source.query_id, `${location}.query_id`),
    datasource: string(source.datasource, `${location}.datasource`),
    dialect: string(source.dialect, `${location}.dialect`),
    sql: string(source.sql, `${location}.sql`),
    sqlDigest: string(source.sql_digest, `${location}.sql_digest`),
    rowCount: integer(source.row_count, `${location}.row_count`),
    durationMs: integer(source.duration_ms, `${location}.duration_ms`),
    startedAt: timestamp(source.started_at, `${location}.started_at`),
    finishedAt: timestamp(source.finished_at, `${location}.finished_at`),
    status: string(source.status, `${location}.status`),
    outputRef: nullableString(source.output_ref, `${location}.output_ref`),
  }
}

function parseDagJob(value: unknown, location: string): ReportDagJobProjection {
  const source = object(value, location)
  exactKeys(
    source,
    [
      'id',
      'intent',
      'status',
      'started_at',
      'finished_at',
      'duration_ms',
      'analysis_purpose',
      'params',
      'input_artifact_refs',
      'output_artifact_ref',
      'reused_artifact',
      'queries',
      'query_issues',
    ],
    location,
  )
  if (source.status !== 'succeeded') throw new TypeError(`${location}.status must be succeeded`)
  if (typeof source.reused_artifact !== 'boolean') {
    throw new TypeError(`${location}.reused_artifact must be boolean`)
  }
  if (!Array.isArray(source.queries)) throw new TypeError(`${location}.queries must be an array`)
  if (!Array.isArray(source.query_issues))
    throw new TypeError(`${location}.query_issues must be an array`)
  const inputArtifactRefs = stringArray(
    source.input_artifact_refs,
    `${location}.input_artifact_refs`,
  )
  if (new Set(inputArtifactRefs).size !== inputArtifactRefs.length)
    throw new TypeError(`${location}.input_artifact_refs contains duplicates`)
  return {
    id: string(source.id, `${location}.id`),
    intent: string(source.intent, `${location}.intent`),
    status: 'succeeded',
    startedAt: timestamp(source.started_at, `${location}.started_at`),
    finishedAt:
      source.finished_at === null ? null : timestamp(source.finished_at, `${location}.finished_at`),
    durationMs: integer(source.duration_ms, `${location}.duration_ms`),
    analysisPurpose: nullableString(source.analysis_purpose, `${location}.analysis_purpose`),
    params: jsonValue(source.params, `${location}.params`),
    inputArtifactRefs,
    outputArtifactRef: string(source.output_artifact_ref, `${location}.output_artifact_ref`),
    reusedArtifact: source.reused_artifact,
    queries: source.queries.map((item, index) =>
      parseDagQuery(item, `${location}.queries[${index}]`),
    ),
    queryIssues: source.query_issues.map((item, index) =>
      parseIssue(item, `${location}.query_issues[${index}]`),
    ),
  }
}

function parseNullableShape(value: unknown, location: string): readonly [number, number] | null {
  if (value === null) return null
  if (!Array.isArray(value) || value.length !== 2)
    throw new TypeError(`${location} must be null or contain two integers`)
  return [integer(value[0], `${location}[0]`), integer(value[1], `${location}[1]`)]
}

function parseDagArtifact(value: unknown, location: string): ReportDagArtifactProjection {
  const source = object(value, location)
  exactKeys(
    source,
    [
      'ref',
      'status',
      'family',
      'shape',
      'columns',
      'content_hash',
      'artifact_schema_version',
      'created_at',
      'contract',
      'revalidation',
      'lineage',
      'preview_rows',
      'total_rows',
      'omitted_rows',
      'issues',
    ],
    location,
  )
  if (source.status !== 'ready' && source.status !== 'unavailable' && source.status !== 'boundary')
    throw new TypeError(`${location}.status is invalid`)
  if (!Array.isArray(source.columns)) throw new TypeError(`${location}.columns must be an array`)
  if (!Array.isArray(source.preview_rows))
    throw new TypeError(`${location}.preview_rows must be an array`)
  if (!Array.isArray(source.issues)) throw new TypeError(`${location}.issues must be an array`)
  const shape = parseNullableShape(source.shape, `${location}.shape`)
  const columns = source.columns.map((item, index) =>
    parseColumn(item, `${location}.columns[${index}]`),
  )
  if (shape !== null && columns.length !== shape[1])
    throw new TypeError(`${location}.columns must match shape`)
  const previewRows = source.preview_rows.map((row, rowIndex) => {
    if (!Array.isArray(row) || row.length !== columns.length)
      throw new TypeError(`${location}.preview_rows[${rowIndex}] must match columns`)
    return row.map((cell, columnIndex) =>
      jsonValue(cell, `${location}.preview_rows[${rowIndex}][${columnIndex}]`),
    )
  })
  const totalRows =
    source.total_rows === null ? null : integer(source.total_rows, `${location}.total_rows`)
  const omittedRows =
    source.omitted_rows === null ? null : integer(source.omitted_rows, `${location}.omitted_rows`)
  if (
    source.status === 'ready' &&
    (shape === null ||
      totalRows === null ||
      omittedRows === null ||
      totalRows !== shape[0] ||
      omittedRows !== totalRows - previewRows.length)
  )
    throw new TypeError(`${location} ready preview identity is inconsistent`)
  if (source.status !== 'ready' && previewRows.length > 0)
    throw new TypeError(`${location} unavailable preview must be empty`)
  const nullableJson = (item: unknown, itemLocation: string): JsonValue | null =>
    item === null ? null : jsonValue(item, itemLocation)
  return {
    ref: string(source.ref, `${location}.ref`),
    status: source.status,
    family: nullableString(source.family, `${location}.family`),
    shape,
    columns,
    contentHash: nullableString(source.content_hash, `${location}.content_hash`),
    artifactSchemaVersion: nullableString(
      source.artifact_schema_version,
      `${location}.artifact_schema_version`,
    ),
    createdAt: nullableString(source.created_at, `${location}.created_at`),
    contract: nullableJson(source.contract, `${location}.contract`),
    revalidation:
      source.revalidation === null
        ? null
        : stableRevalidation(
            object(source.revalidation, `${location}.revalidation`),
            `${location}.revalidation`,
          ),
    lineage: nullableJson(source.lineage, `${location}.lineage`),
    previewRows,
    totalRows,
    omittedRows,
    issues: source.issues.map((item, index) => parseIssue(item, `${location}.issues[${index}]`)),
  }
}

function parseSessionDag(value: unknown, location: string): ReportSessionDagProjection {
  const source = object(value, location)
  exactKeys(source, ['jobs', 'artifacts'], location)
  if (!Array.isArray(source.jobs)) throw new TypeError(`${location}.jobs must be an array`)
  if (!Array.isArray(source.artifacts))
    throw new TypeError(`${location}.artifacts must be an array`)
  const jobs = source.jobs.map((item, index) => parseDagJob(item, `${location}.jobs[${index}]`))
  const artifacts = source.artifacts.map((item, index) =>
    parseDagArtifact(item, `${location}.artifacts[${index}]`),
  )
  if (new Set(jobs.map((item) => item.id)).size !== jobs.length)
    throw new TypeError(`${location}.jobs contains duplicate IDs`)
  if (new Set(artifacts.map((item) => item.ref)).size !== artifacts.length)
    throw new TypeError(`${location}.artifacts contains duplicate refs`)
  return { jobs, artifacts }
}

function issueArray(value: unknown, location: string): ReportIssue[] {
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
  readonly issues: readonly ReportIssue[]
  readonly omitted: number
}

function parseOutcome<T>(
  value: unknown,
  location: string,
  expectedIdentity: string,
  parseValue: (value: unknown, location: string) => T,
): ParsedOutcome<T> {
  const source = object(value, location)
  if (source.status === 'ready') {
    exactKeys(source, ['status', 'value'], location)
    const parsed = parseValue(source.value, `${location}.value`)
    return { ready: true, value: parsed, issues: [], omitted: 0 }
  }
  if (source.status !== 'blocked')
    throw new TypeError(`${location}.status must be ready or blocked`)
  exactKeys(source, ['status', 'ref', 'issues', 'omitted_issue_count'], location)
  if (source.ref !== expectedIdentity) {
    throw new TypeError(`${location}.ref does not match the requested identity`)
  }
  return {
    ready: false,
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
      value: {
        sessionId: expected.sessionId,
        artifacts: [],
        computed: [],
        sessionDag: { jobs: [], artifacts: [] },
      },
      issues: issueArray(source.issues, 'projection.issues'),
      omittedIssueCount: omittedCount(source.omitted_issue_count, 'projection.omitted_issue_count'),
      complete: false,
      globalFailure: true,
      checkedArtifactRefs: [],
    }
  }
  exactKeys(source, ['status', 'session_id', 'artifact_outcomes', 'session_dag'], 'projection')
  if (source.status !== 'checked')
    throw new TypeError('projection.status must be checked or blocked')
  if (source.session_id !== expected.sessionId)
    throw new TypeError('projection.session_id does not match the request')
  if (!Array.isArray(source.artifact_outcomes))
    throw new TypeError('projection.artifact_outcomes must be an array')
  const issues: ReportIssue[] = []
  let omitted = 0
  let complete = true
  if (source.artifact_outcomes.length !== expected.artifactRefs.length)
    throw new TypeError('projection Artifact outcome count does not match the request')
  const artifacts: ReportArtifactProjection[] = []
  for (const [index, item] of source.artifact_outcomes.entries()) {
    const expectedRef = expected.artifactRefs[index]
    if (expectedRef === undefined) throw new TypeError('projection Artifact outcome is unexpected')
    const outcome = parseOutcome(
      item,
      `projection.artifact_outcomes[${index}]`,
      expectedRef,
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
  const sessionDag = parseSessionDag(source.session_dag, 'projection.session_dag')
  const graphRefs = new Set(sessionDag.artifacts.map((item) => item.ref))
  for (const job of sessionDag.jobs) {
    for (const ref of [...job.inputArtifactRefs, job.outputArtifactRef]) {
      if (!graphRefs.has(ref))
        throw new TypeError(`projection.session_dag is missing Artifact ${JSON.stringify(ref)}`)
    }
  }
  return {
    ok: complete,
    value: { sessionId: expected.sessionId, artifacts, computed: [], sessionDag },
    issues,
    omittedIssueCount: omitted,
    complete,
    globalFailure: false,
    checkedArtifactRefs: expected.artifactRefs,
  }
}
