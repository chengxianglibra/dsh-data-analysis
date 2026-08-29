import { reportTimeEpoch } from './time.ts'

export const REPORT_DOCUMENT_VERSION = 'dsh-data-analysis-report/v3' as const
export const COMPUTED_DATA_VERSION = 'dsh-computed-data/v1' as const

export type ReportComputedColumnType = 'string' | 'number' | 'boolean' | 'datetime'
export type ReportComputedColumnRole = 'time' | 'dimension' | 'measure' | 'value'
export type ReportComputedCell = string | number | boolean | null

export interface ReportComputedColumn {
  readonly name: string
  readonly type: ReportComputedColumnType
  readonly role?: ReportComputedColumnRole
  readonly unit?: string
  readonly nullable?: boolean
}

export interface ReportComputedTable {
  readonly version: typeof COMPUTED_DATA_VERSION
  readonly columns: readonly ReportComputedColumn[]
  readonly rows: readonly (readonly ReportComputedCell[])[]
}

export interface ReportArtifactDataSource {
  readonly id: string
  readonly artifact_ref: string
}

export interface ReportComputedDataSource {
  readonly id: string
  readonly computed: ReportComputedTable
}

export type ReportDataSource = ReportArtifactDataSource | ReportComputedDataSource

export interface TextBlock {
  readonly kind: 'text'
  readonly id: string
  readonly text: string
}

export interface ChartBlock {
  readonly kind: 'chart'
  readonly id: string
  readonly title: string
  readonly subtitle?: string
  readonly data_ref: string
  readonly view: 'auto' | 'line' | 'bar'
  readonly x?: string
  readonly y?: string
}

export interface TableBlock {
  readonly kind: 'table'
  readonly id: string
  readonly title: string
  readonly data_ref: string
  readonly columns?: readonly string[]
  readonly max_rows: number
}

export type ReportBlock = TextBlock | ChartBlock | TableBlock

export interface ReportSection {
  readonly id: string
  readonly title: string
  readonly blocks: readonly ReportBlock[]
}

export interface ReportDocument {
  readonly version: typeof REPORT_DOCUMENT_VERSION
  readonly title: string
  readonly subtitle?: string
  readonly locale: 'zh-CN' | 'en-US'
  readonly data?: readonly ReportDataSource[]
  readonly sections: readonly ReportSection[]
}

export type ReportBlockedStage = 'document' | 'source' | 'visual' | 'publish'
export type ReportCheckStatus = 'passed' | 'failed' | 'partial' | 'skipped'

export interface ReportIssue {
  readonly code: string
  readonly location: string
  readonly message: string
  readonly repair: string
}

export interface ReportCheck {
  readonly stage: ReportBlockedStage
  readonly status: ReportCheckStatus
  readonly issues: ReportIssue[]
  readonly omitted_issue_count: number
  readonly reason?: string
}

export interface ReportReadyValue {
  readonly status: 'ready'
  readonly title: string
  readonly path: string
  readonly report_digest: string
  readonly document_digest: string
  readonly artifact_refs: string[]
  readonly data_refs: string[]
  readonly computed_data_refs: string[]
  readonly disclosures: string[]
}

export interface ReportBlockedValue {
  readonly status: 'blocked'
  readonly checks: [ReportCheck, ReportCheck, ReportCheck, ReportCheck]
}

export type ReportRenderValue = ReportReadyValue | ReportBlockedValue

export interface ParsedReportDocument {
  readonly document: ReportDocument
  readonly artifactRefs: readonly string[]
  readonly dataRefs: readonly string[]
  readonly computedDataRefs: readonly string[]
}

export interface ReportVisualCandidate {
  readonly block: ChartBlock | TableBlock
  readonly location: string
}

export interface ReportDocumentInspection {
  readonly artifactRefs: readonly string[]
  /** All original document paths for each de-duplicated Artifact ref. */
  readonly artifactRefLocations: readonly (readonly string[])[]
  readonly dataRefs: readonly string[]
  readonly computedDataRefs: readonly string[]
  readonly visualCandidates: readonly ReportVisualCandidate[]
  readonly skippedDataTargets: number
  readonly skippedVisualTargets: number
}

export type ParseReportDocumentResult =
  | {
      readonly ok: true
      readonly value: ParsedReportDocument
      readonly inspection: ReportDocumentInspection
    }
  | {
      readonly ok: false
      readonly issues: readonly ReportIssue[]
      readonly inspection: ReportDocumentInspection
    }

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_IDENTIFIER_CHARS = 512
const MAX_DATA_SOURCES = 20
const MAX_COMPUTED_COLUMNS = 100
const MAX_COMPUTED_ROWS = 2_000
const MAX_COMPUTED_PAYLOAD_BYTES = 16 * 1024 * 1024
const ISO_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/
const ISO_DATE_PART = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/
const ALLOWED_ROOT = new Set(['version', 'title', 'subtitle', 'locale', 'data', 'sections'])
const ALLOWED_SECTION = new Set(['id', 'title', 'blocks'])
const ALLOWED_DATA_SOURCE = new Set(['id', 'artifact_ref', 'computed'])
const ALLOWED_COMPUTED = new Set(['version', 'columns', 'rows'])
const ALLOWED_COMPUTED_COLUMN = new Set(['name', 'type', 'role', 'unit', 'nullable'])
const ALLOWED_BY_KIND: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  text: new Set(['kind', 'id', 'text']),
  chart: new Set(['kind', 'id', 'title', 'subtitle', 'data_ref', 'view', 'x', 'y']),
  table: new Set(['kind', 'id', 'title', 'data_ref', 'columns', 'max_rows']),
})

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function chars(value: string): number {
  return [...value].length
}

function issue(code: string, location: string, message: string, repair: string): ReportIssue {
  return { code, location, message, repair }
}

function rejectUnknown(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  location: string,
  issues: ReportIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issues.push(
        issue(
          'unknown-field',
          `${location}.${key}`,
          `Unknown ReportDocument field ${JSON.stringify(key)}.`,
          'Remove the unknown field and submit the complete document again.',
        ),
      )
    }
  }
}

function boundedString(
  value: unknown,
  location: string,
  maximum: number,
  issues: ReportIssue[],
): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push(
      issue(
        'invalid-string',
        location,
        `${location} must be a non-empty string.`,
        'Provide a non-empty string.',
      ),
    )
    return undefined
  }
  if (chars(value) > maximum) {
    issues.push(
      issue(
        'string-too-long',
        location,
        `${location} exceeds ${maximum} Unicode characters.`,
        `Shorten the value to at most ${maximum} characters.`,
      ),
    )
    return undefined
  }
  return value
}

function optionalBoundedString(
  value: unknown,
  location: string,
  maximum: number,
  issues: ReportIssue[],
): string | undefined {
  if (value === undefined) return undefined
  return boundedString(value, location, maximum, issues)
}

function kebabId(value: unknown, location: string, issues: ReportIssue[]): string | undefined {
  const id = boundedString(value, location, MAX_IDENTIFIER_CHARS, issues)
  if (id !== undefined && !ID.test(id)) {
    issues.push(
      issue(
        'invalid-id',
        location,
        `${location} must be non-empty ASCII kebab-case.`,
        'Use lowercase ASCII letters or digits separated by single hyphens.',
      ),
    )
    return undefined
  }
  return id
}

function identifier(value: unknown, location: string, issues: ReportIssue[]): string | undefined {
  return boundedString(value, location, MAX_IDENTIFIER_CHARS, issues)
}

function selectedColumns(
  value: unknown,
  location: string,
  issues: ReportIssue[],
): readonly string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_COMPUTED_COLUMNS) {
    issues.push(
      issue(
        'invalid-columns',
        location,
        `${location} must contain between 1 and ${MAX_COMPUTED_COLUMNS} column names.`,
        'Provide a non-empty list of unique column names.',
      ),
    )
    return undefined
  }
  const result: string[] = []
  const seen = new Set<string>()
  for (const [index, raw] of value.entries()) {
    const column = identifier(raw, `${location}[${index}]`, issues)
    if (column === undefined) continue
    if (seen.has(column)) {
      issues.push(
        issue(
          'duplicate-column',
          `${location}[${index}]`,
          `Column ${JSON.stringify(column)} is duplicated.`,
          'Keep each requested column once.',
        ),
      )
      continue
    }
    seen.add(column)
    result.push(column)
  }
  return result
}

function computedType(value: unknown): value is ReportComputedColumnType {
  return value === 'string' || value === 'number' || value === 'boolean' || value === 'datetime'
}

function computedRole(value: unknown): value is ReportComputedColumnRole {
  return value === 'time' || value === 'dimension' || value === 'measure' || value === 'value'
}

function validCalendarDate(value: string): boolean {
  const match = ISO_DATE_PART.exec(value)
  if (match === null) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1) return false
  const lastDay = new Date(0)
  lastDay.setUTCHours(0, 0, 0, 0)
  lastDay.setUTCFullYear(year, month, 0)
  return day <= lastDay.getUTCDate()
}

function isoDateTime(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    ISO_DATE_TIME.test(value) &&
    validCalendarDate(value) &&
    reportTimeEpoch(value) !== undefined
  )
}

function computedCell(
  value: unknown,
  type: ReportComputedColumnType,
  nullable: boolean,
  location: string,
  issues: ReportIssue[],
): ReportComputedCell | undefined {
  if (value === null) {
    if (!nullable) {
      issues.push(
        issue(
          'unexpected-null-cell',
          location,
          'Computed data contains null in a non-nullable column.',
          'Set nullable to true or replace the null value before rendering.',
        ),
      )
    }
    return null
  }
  const valid =
    (type === 'string' && typeof value === 'string') ||
    (type === 'number' && typeof value === 'number' && Number.isFinite(value)) ||
    (type === 'boolean' && typeof value === 'boolean') ||
    (type === 'datetime' && isoDateTime(value))
  if (!valid) {
    const expected = type === 'datetime' ? 'an ISO date/time string' : `a ${type}`
    issues.push(
      issue(
        'invalid-computed-cell',
        location,
        `Computed data must contain ${expected} values for this column.`,
        `Convert the value to ${expected} or use null for a nullable column.`,
      ),
    )
    return undefined
  }
  return value as ReportComputedCell
}

function parseComputedTable(
  value: unknown,
  location: string,
  issues: ReportIssue[],
): ReportComputedTable | undefined {
  const before = issues.length
  if (!isObject(value)) {
    issues.push(
      issue(
        'invalid-computed-data',
        location,
        'computed must be an object.',
        'Provide a dsh-computed-data/v1 object with columns and rows.',
      ),
    )
    return undefined
  }
  rejectUnknown(value, ALLOWED_COMPUTED, location, issues)
  if (value.version !== COMPUTED_DATA_VERSION) {
    issues.push(
      issue(
        'unsupported-computed-version',
        `${location}.version`,
        `computed.version must be ${COMPUTED_DATA_VERSION}.`,
        `Set computed.version to ${COMPUTED_DATA_VERSION}.`,
      ),
    )
  }
  if (
    !Array.isArray(value.columns) ||
    value.columns.length < 1 ||
    value.columns.length > MAX_COMPUTED_COLUMNS
  ) {
    issues.push(
      issue(
        'invalid-computed-columns',
        `${location}.columns`,
        `computed.columns must contain between 1 and ${MAX_COMPUTED_COLUMNS} columns.`,
        'Provide one descriptor for every returned column.',
      ),
    )
  }
  if (!Array.isArray(value.rows) || value.rows.length > MAX_COMPUTED_ROWS) {
    issues.push(
      issue(
        'invalid-computed-rows',
        `${location}.rows`,
        `computed.rows must contain at most ${MAX_COMPUTED_ROWS} rows.`,
        `Limit the computed result to at most ${MAX_COMPUTED_ROWS} rows.`,
      ),
    )
  }
  const rawColumns = Array.isArray(value.columns) ? value.columns : []
  const parsedColumns: Array<ReportComputedColumn | undefined> = []
  const columnNames = new Set<string>()
  for (const [index, rawColumn] of rawColumns.entries()) {
    const columnLocation = `${location}.columns[${index}]`
    if (!isObject(rawColumn)) {
      issues.push(
        issue(
          'invalid-computed-column',
          columnLocation,
          'Each computed column must be an object.',
          'Provide name and type for every computed column.',
        ),
      )
      parsedColumns.push(undefined)
      continue
    }
    rejectUnknown(rawColumn, ALLOWED_COMPUTED_COLUMN, columnLocation, issues)
    const name = identifier(rawColumn.name, `${columnLocation}.name`, issues)
    if (name !== undefined && columnNames.has(name)) {
      issues.push(
        issue(
          'duplicate-computed-column',
          `${columnLocation}.name`,
          `Computed column ${JSON.stringify(name)} is duplicated.`,
          'Keep every computed column name unique.',
        ),
      )
    }
    if (name !== undefined) columnNames.add(name)
    const type = computedType(rawColumn.type) ? rawColumn.type : undefined
    if (type === undefined) {
      issues.push(
        issue(
          'invalid-computed-column-type',
          `${columnLocation}.type`,
          'Computed column type must be string, number, boolean, or datetime.',
          'Choose one supported computed column type.',
        ),
      )
    }
    const role =
      rawColumn.role === undefined
        ? undefined
        : computedRole(rawColumn.role)
          ? rawColumn.role
          : undefined
    if (rawColumn.role !== undefined && role === undefined) {
      issues.push(
        issue(
          'invalid-computed-column-role',
          `${columnLocation}.role`,
          'Computed column role must be time, dimension, measure, or value.',
          'Choose one supported computed column role or omit role.',
        ),
      )
    }
    const unit = optionalBoundedString(rawColumn.unit, `${columnLocation}.unit`, 200, issues)
    if (rawColumn.nullable !== undefined && typeof rawColumn.nullable !== 'boolean') {
      issues.push(
        issue(
          'invalid-computed-nullable',
          `${columnLocation}.nullable`,
          'Computed column nullable must be boolean when provided.',
          'Use true, false, or omit nullable.',
        ),
      )
    }
    const nullable = typeof rawColumn.nullable === 'boolean' ? rawColumn.nullable : undefined
    parsedColumns.push(
      name === undefined || type === undefined
        ? undefined
        : {
            name,
            type,
            ...(role === undefined ? {} : { role }),
            ...(unit === undefined ? {} : { unit }),
            ...(nullable === undefined ? {} : { nullable }),
          },
    )
  }
  const rawRows = Array.isArray(value.rows) ? value.rows : []
  const rows: ReportComputedCell[][] = []
  for (const [rowIndex, rawRow] of rawRows.entries()) {
    const rowLocation = `${location}.rows[${rowIndex}]`
    if (!Array.isArray(rawRow) || rawRow.length !== rawColumns.length) {
      issues.push(
        issue(
          'computed-row-shape',
          rowLocation,
          'Each computed row must contain exactly one cell per column.',
          'Return rows with the same number of cells as computed.columns.',
        ),
      )
      continue
    }
    const parsedRow: ReportComputedCell[] = []
    for (const [columnIndex, cell] of rawRow.entries()) {
      const column = parsedColumns[columnIndex]
      if (column === undefined) continue
      const parsed = computedCell(
        cell,
        column.type,
        column.nullable ?? cell === null,
        `${rowLocation}[${columnIndex}]`,
        issues,
      )
      if (parsed !== undefined) parsedRow.push(parsed)
    }
    if (parsedRow.length === rawColumns.length) rows.push(parsedRow)
  }
  if (issues.length > before) return undefined
  const columns = parsedColumns.map((column, index) => {
    if (column === undefined) throw new Error(`computed column ${index} was not parsed`)
    return column.nullable === undefined
      ? { ...column, nullable: rows.some((row) => row[index] === null) }
      : column
  })
  const normalized: ReportComputedTable = {
    version: COMPUTED_DATA_VERSION,
    columns,
    rows,
  }
  const encodedBytes = new TextEncoder().encode(JSON.stringify(normalized)).byteLength
  if (encodedBytes > MAX_COMPUTED_PAYLOAD_BYTES) {
    issues.push(
      issue(
        'computed-data-too-large',
        location,
        `computed exceeds the ${MAX_COMPUTED_PAYLOAD_BYTES} byte payload limit.`,
        'Reduce computed rows or columns before rendering the report.',
      ),
    )
    return undefined
  }
  return normalized
}

function emptyInspection(): ReportDocumentInspection {
  return {
    artifactRefs: [],
    artifactRefLocations: [],
    dataRefs: [],
    computedDataRefs: [],
    visualCandidates: [],
    skippedDataTargets: 0,
    skippedVisualTargets: 0,
  }
}

/** Parse an untrusted JSON value into the complete closed v3 document contract. */
export function parseReportDocument(input: unknown): ParseReportDocumentResult {
  const issues: ReportIssue[] = []
  if (!isObject(input)) {
    return {
      ok: false,
      issues: [
        issue(
          'invalid-document',
          'document',
          'document must be an object.',
          'Submit one complete ReportDocument v3 object.',
        ),
      ],
      inspection: emptyInspection(),
    }
  }
  rejectUnknown(input, ALLOWED_ROOT, 'document', issues)
  if (input.version !== REPORT_DOCUMENT_VERSION) {
    issues.push(
      issue(
        'unsupported-version',
        'document.version',
        `document.version must be ${REPORT_DOCUMENT_VERSION}.`,
        `Set version to ${REPORT_DOCUMENT_VERSION}.`,
      ),
    )
  }
  const title = boundedString(input.title, 'document.title', 200, issues)
  const subtitle = optionalBoundedString(input.subtitle, 'document.subtitle', 200, issues)
  const locale = input.locale === 'zh-CN' || input.locale === 'en-US' ? input.locale : undefined
  if (locale === undefined) {
    issues.push(
      issue(
        'invalid-locale',
        'document.locale',
        'document.locale must be zh-CN or en-US.',
        'Choose one supported locale.',
      ),
    )
  }
  if (!Array.isArray(input.sections) || input.sections.length < 1 || input.sections.length > 20) {
    issues.push(
      issue(
        'invalid-sections',
        'document.sections',
        'document.sections must contain between 1 and 20 sections.',
        'Provide 1-20 non-empty sections.',
      ),
    )
  }
  if (
    input.data !== undefined &&
    (!Array.isArray(input.data) || input.data.length > MAX_DATA_SOURCES)
  ) {
    issues.push(
      issue(
        'invalid-data-sources',
        'document.data',
        `document.data must contain at most ${MAX_DATA_SOURCES} data sources.`,
        `Provide at most ${MAX_DATA_SOURCES} Artifact or computed data sources.`,
      ),
    )
  }

  const dataSources: ReportDataSource[] = []
  const dataById = new Map<string, ReportDataSource>()
  const dataRefs: string[] = []
  const computedDataRefs: string[] = []
  const artifactRefs: string[] = []
  const artifactSet = new Set<string>()
  const artifactLocations = new Map<string, string[]>()
  let computedPayloadBytes = 0
  const rawData = Array.isArray(input.data) ? input.data : []
  for (const [dataIndex, rawSource] of rawData.entries()) {
    const location = `document.data[${dataIndex}]`
    if (!isObject(rawSource)) {
      issues.push(
        issue(
          'invalid-data-source',
          location,
          'Each data source must be an object.',
          'Use { id, artifact_ref } or { id, computed }.',
        ),
      )
      continue
    }
    rejectUnknown(rawSource, ALLOWED_DATA_SOURCE, location, issues)
    const id = kebabId(rawSource.id, `${location}.id`, issues)
    const duplicateId = id !== undefined && dataById.has(id)
    if (duplicateId) {
      issues.push(
        issue(
          'duplicate-data-source-id',
          `${location}.id`,
          `Data source ID ${JSON.stringify(id)} is duplicated.`,
          'Use a unique data source ID.',
        ),
      )
    }
    const hasArtifact = 'artifact_ref' in rawSource
    const hasComputed = 'computed' in rawSource
    if (hasArtifact === hasComputed) {
      issues.push(
        issue(
          'invalid-data-source-kind',
          location,
          'Each data source must contain exactly one of artifact_ref or computed.',
          'Choose either an Artifact ref or one computed table.',
        ),
      )
      continue
    }
    if (id === undefined || duplicateId) continue
    if (hasArtifact) {
      const artifactRef = identifier(rawSource.artifact_ref, `${location}.artifact_ref`, issues)
      if (artifactRef === undefined) continue
      if (artifactSet.has(artifactRef)) {
        issues.push(
          issue(
            'duplicate-artifact-ref',
            `${location}.artifact_ref`,
            `Artifact ref ${JSON.stringify(artifactRef)} is already registered.`,
            'Register each Artifact once and reuse its data source ID in blocks.',
          ),
        )
        continue
      }
      artifactSet.add(artifactRef)
      artifactRefs.push(artifactRef)
      artifactLocations.set(artifactRef, [`${location}.artifact_ref`])
      const source: ReportArtifactDataSource = { id, artifact_ref: artifactRef }
      dataSources.push(source)
      dataById.set(id, source)
      dataRefs.push(id)
      continue
    }
    const computed = parseComputedTable(rawSource.computed, `${location}.computed`, issues)
    if (computed === undefined) continue
    const source: ReportComputedDataSource = { id, computed }
    dataSources.push(source)
    dataById.set(id, source)
    dataRefs.push(id)
    computedDataRefs.push(id)
    computedPayloadBytes += new TextEncoder().encode(JSON.stringify(computed)).byteLength
  }
  if (computedPayloadBytes > MAX_COMPUTED_PAYLOAD_BYTES) {
    issues.push(
      issue(
        'computed-data-budget-exceeded',
        'document.data',
        `Combined computed data exceeds the ${MAX_COMPUTED_PAYLOAD_BYTES} byte payload limit.`,
        'Reduce the total computed rows or columns before rendering the report.',
      ),
    )
  }

  const sectionIds = new Set<string>()
  const blockIds = new Set<string>()
  const sections: ReportSection[] = []
  const visualCandidates: ReportVisualCandidate[] = []
  let blockCount = 0
  let textChars = 0
  let skippedDataTargets = 0
  let skippedVisualTargets = 0
  const rawSections = Array.isArray(input.sections) ? input.sections : []
  for (const [sectionIndex, rawSection] of rawSections.entries()) {
    const sectionLocation = `document.sections[${sectionIndex}]`
    if (!isObject(rawSection)) {
      issues.push(
        issue(
          'invalid-section',
          sectionLocation,
          'Each section must be an object.',
          'Replace it with a complete section object.',
        ),
      )
      continue
    }
    rejectUnknown(rawSection, ALLOWED_SECTION, sectionLocation, issues)
    const sectionId = kebabId(rawSection.id, `${sectionLocation}.id`, issues)
    if (sectionId !== undefined) {
      if (sectionIds.has(sectionId)) {
        issues.push(
          issue(
            'duplicate-section-id',
            `${sectionLocation}.id`,
            `Section ID ${JSON.stringify(sectionId)} is duplicated.`,
            'Use a unique section ID.',
          ),
        )
      }
      sectionIds.add(sectionId)
    }
    const sectionTitle = boundedString(rawSection.title, `${sectionLocation}.title`, 200, issues)
    if (
      !Array.isArray(rawSection.blocks) ||
      rawSection.blocks.length < 1 ||
      rawSection.blocks.length > 20
    ) {
      issues.push(
        issue(
          'invalid-blocks',
          `${sectionLocation}.blocks`,
          'Each section must contain between 1 and 20 blocks.',
          'Provide 1-20 blocks in this section.',
        ),
      )
    }
    const parsedBlocks: ReportBlock[] = []
    const rawBlocks = Array.isArray(rawSection.blocks) ? rawSection.blocks : []
    blockCount += rawBlocks.length
    for (const [blockIndex, rawBlock] of rawBlocks.entries()) {
      const blockLocation = `${sectionLocation}.blocks[${blockIndex}]`
      if (!isObject(rawBlock) || typeof rawBlock.kind !== 'string') {
        issues.push(
          issue(
            'invalid-block',
            blockLocation,
            'Each block must be an object with a supported kind.',
            'Use text, chart, or table.',
          ),
        )
        continue
      }
      const allowed = Object.hasOwn(ALLOWED_BY_KIND, rawBlock.kind)
        ? ALLOWED_BY_KIND[rawBlock.kind]
        : undefined
      if (allowed === undefined) {
        issues.push(
          issue(
            'invalid-block-kind',
            `${blockLocation}.kind`,
            `Unsupported block kind ${JSON.stringify(rawBlock.kind)}.`,
            'Use text, chart, or table.',
          ),
        )
        continue
      }
      rejectUnknown(rawBlock, allowed, blockLocation, issues)
      const id = kebabId(rawBlock.id, `${blockLocation}.id`, issues)
      if (id !== undefined) {
        if (blockIds.has(id)) {
          issues.push(
            issue(
              'duplicate-block-id',
              `${blockLocation}.id`,
              `Block ID ${JSON.stringify(id)} is duplicated.`,
              'Use a document-wide unique block ID.',
            ),
          )
        }
        blockIds.add(id)
      }
      if (rawBlock.kind === 'text') {
        const text = boundedString(rawBlock.text, `${blockLocation}.text`, 20_000, issues)
        if (text !== undefined) textChars += chars(text)
        if (id !== undefined && text !== undefined) parsedBlocks.push({ kind: 'text', id, text })
        continue
      }
      const blockTitle = boundedString(rawBlock.title, `${blockLocation}.title`, 200, issues)
      const dataRef = identifier(rawBlock.data_ref, `${blockLocation}.data_ref`, issues)
      const dataSource = dataRef === undefined ? undefined : dataById.get(dataRef)
      if (dataRef !== undefined && dataSource === undefined) {
        issues.push(
          issue(
            'unknown-data-ref',
            `${blockLocation}.data_ref`,
            `No data source is registered for ${JSON.stringify(dataRef)}.`,
            'Add the data source to document.data or use an existing data source ID.',
          ),
        )
        skippedDataTargets += 1
      }
      if (dataSource !== undefined && 'artifact_ref' in dataSource) {
        const locations = artifactLocations.get(dataSource.artifact_ref) ?? []
        const blockPath = `${blockLocation}.data_ref`
        if (!locations.includes(blockPath)) locations.push(blockPath)
        artifactLocations.set(dataSource.artifact_ref, locations)
      }
      if (rawBlock.kind === 'table') {
        const tableColumns = selectedColumns(rawBlock.columns, `${blockLocation}.columns`, issues)
        const maximum = rawBlock.max_rows
        if (
          !Number.isSafeInteger(maximum) ||
          (maximum as number) < 1 ||
          (maximum as number) > 100
        ) {
          issues.push(
            issue(
              'invalid-max-rows',
              `${blockLocation}.max_rows`,
              'table.max_rows must be an integer from 1 to 100.',
              'Choose a max_rows value from 1 to 100.',
            ),
          )
        }
        if (
          id !== undefined &&
          blockTitle !== undefined &&
          dataRef !== undefined &&
          dataSource !== undefined &&
          Number.isSafeInteger(maximum) &&
          (maximum as number) >= 1 &&
          (maximum as number) <= 100
        ) {
          const block: TableBlock = {
            kind: 'table',
            id,
            title: blockTitle,
            data_ref: dataRef,
            max_rows: maximum as number,
            ...(tableColumns === undefined ? {} : { columns: tableColumns }),
          }
          parsedBlocks.push(block)
          visualCandidates.push({ block, location: blockLocation })
        } else {
          skippedVisualTargets += 1
        }
        continue
      }
      const subtitleValue = optionalBoundedString(
        rawBlock.subtitle,
        `${blockLocation}.subtitle`,
        200,
        issues,
      )
      const view =
        rawBlock.view === 'auto' || rawBlock.view === 'line' || rawBlock.view === 'bar'
          ? rawBlock.view
          : undefined
      if (view === undefined) {
        issues.push(
          issue(
            'invalid-chart-view',
            `${blockLocation}.view`,
            'chart.view must be auto, line, or bar.',
            'Choose one supported chart view.',
          ),
        )
      }
      const x =
        rawBlock.x === undefined ? undefined : identifier(rawBlock.x, `${blockLocation}.x`, issues)
      const y =
        rawBlock.y === undefined ? undefined : identifier(rawBlock.y, `${blockLocation}.y`, issues)
      if (view === 'auto' && (x !== undefined || y !== undefined)) {
        issues.push(
          issue(
            'auto-with-fields',
            blockLocation,
            'auto charts cannot specify x or y.',
            'Remove x/y or choose an explicit line/bar view.',
          ),
        )
      }
      if ((view === 'line' || view === 'bar') && (x === undefined || y === undefined)) {
        issues.push(
          issue(
            'explicit-chart-fields-required',
            blockLocation,
            'Explicit line/bar charts require both x and y.',
            'Provide both computed or Artifact column names.',
          ),
        )
      }
      const chartFieldsValid =
        view === 'auto'
          ? x === undefined && y === undefined
          : view === 'line' || view === 'bar'
            ? x !== undefined && y !== undefined
            : false
      if (
        id !== undefined &&
        blockTitle !== undefined &&
        dataRef !== undefined &&
        dataSource !== undefined &&
        view !== undefined &&
        chartFieldsValid
      ) {
        const block: ChartBlock = {
          kind: 'chart',
          id,
          title: blockTitle,
          data_ref: dataRef,
          view,
          ...(subtitleValue === undefined ? {} : { subtitle: subtitleValue }),
          ...(x === undefined ? {} : { x }),
          ...(y === undefined ? {} : { y }),
        }
        parsedBlocks.push(block)
        visualCandidates.push({ block, location: blockLocation })
      } else {
        skippedVisualTargets += 1
      }
    }
    if (sectionId !== undefined && sectionTitle !== undefined)
      sections.push({ id: sectionId, title: sectionTitle, blocks: parsedBlocks })
  }
  if (blockCount > 100) {
    issues.push(
      issue(
        'too-many-blocks',
        'document.sections',
        `ReportDocument contains ${blockCount} blocks; the maximum is 100.`,
        'Reduce the document to at most 100 blocks.',
      ),
    )
  }
  if (textChars > 100_000) {
    issues.push(
      issue(
        'text-budget-exceeded',
        'document.sections',
        `ReportDocument text contains ${textChars} characters; the maximum is 100000.`,
        'Shorten text blocks so their combined text is at most 100000 characters.',
      ),
    )
  }
  const inspection: ReportDocumentInspection = {
    artifactRefs,
    artifactRefLocations: artifactRefs.map((ref) => artifactLocations.get(ref) ?? []),
    dataRefs,
    computedDataRefs,
    visualCandidates,
    skippedDataTargets,
    skippedVisualTargets,
  }
  if (issues.length > 0 || title === undefined || locale === undefined)
    return { ok: false, issues, inspection }
  return {
    ok: true,
    value: {
      document: {
        version: REPORT_DOCUMENT_VERSION,
        title,
        locale,
        sections,
        ...(subtitle === undefined ? {} : { subtitle }),
        ...(dataSources.length === 0 ? {} : { data: dataSources }),
      },
      artifactRefs,
      dataRefs,
      computedDataRefs,
    },
    inspection,
  }
}
