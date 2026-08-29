export const REPORT_DOCUMENT_VERSION = 'dsh-data-analysis-report/v2' as const

export interface TextBlockV2 {
  readonly kind: 'text'
  readonly id: string
  readonly text: string
}

export interface ChartBlockV2 {
  readonly kind: 'chart'
  readonly id: string
  readonly title: string
  readonly subtitle?: string
  readonly artifact_ref: string
  readonly view: 'auto' | 'line' | 'bar'
  readonly x?: string
  readonly y?: string
}

export interface TableBlockV2 {
  readonly kind: 'table'
  readonly id: string
  readonly title: string
  readonly artifact_ref: string
  readonly columns?: readonly string[]
  readonly max_rows: number
}

export type ReportBlockV2 = TextBlockV2 | ChartBlockV2 | TableBlockV2

export interface ReportSectionV2 {
  readonly id: string
  readonly title: string
  readonly blocks: readonly ReportBlockV2[]
}

export interface ReportDocumentV2 {
  readonly version: typeof REPORT_DOCUMENT_VERSION
  readonly title: string
  readonly subtitle?: string
  readonly locale: 'zh-CN' | 'en-US'
  readonly sections: readonly ReportSectionV2[]
}

export type ReportBlockedStage = 'document' | 'marivo' | 'visual' | 'publish'

export type ReportCheckStatus = 'passed' | 'failed' | 'partial' | 'skipped'

export interface ReportIssueV2 {
  readonly code: string
  readonly location: string
  readonly message: string
  readonly repair: string
}

export interface ReportCheckV2 {
  readonly stage: ReportBlockedStage
  readonly status: ReportCheckStatus
  readonly issues: ReportIssueV2[]
  readonly omitted_issue_count: number
  readonly reason?: string
}

export interface ReportReadyValueV2 {
  readonly status: 'ready'
  readonly title: string
  readonly path: string
  readonly report_digest: string
  readonly document_digest: string
  readonly artifact_refs: string[]
  readonly disclosures: string[]
}

export interface ReportBlockedValueV2 {
  readonly status: 'blocked'
  readonly checks: [ReportCheckV2, ReportCheckV2, ReportCheckV2, ReportCheckV2]
}

export type ReportRenderValueV2 = ReportReadyValueV2 | ReportBlockedValueV2

export interface ParsedReportDocument {
  readonly document: ReportDocumentV2
  readonly artifactRefs: readonly string[]
}

export interface ReportVisualCandidate {
  readonly block: ChartBlockV2 | TableBlockV2
  readonly location: string
}

export interface ReportDocumentInspection {
  readonly artifactRefs: readonly string[]
  /** All original document paths for each de-duplicated Artifact ref. */
  readonly artifactRefLocations: readonly (readonly string[])[]
  readonly visualCandidates: readonly ReportVisualCandidate[]
  readonly skippedMarivoTargets: number
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
      readonly issues: readonly ReportIssueV2[]
      readonly inspection: ReportDocumentInspection
    }

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_IDENTIFIER_CHARS = 512
const ALLOWED_ROOT = new Set(['version', 'title', 'subtitle', 'locale', 'sections'])
const ALLOWED_SECTION = new Set(['id', 'title', 'blocks'])
const ALLOWED_BY_KIND: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  text: new Set(['kind', 'id', 'text']),
  chart: new Set(['kind', 'id', 'title', 'subtitle', 'artifact_ref', 'view', 'x', 'y']),
  table: new Set(['kind', 'id', 'title', 'artifact_ref', 'columns', 'max_rows']),
})

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function chars(value: string): number {
  return [...value].length
}

function issue(code: string, location: string, message: string, repair: string): ReportIssueV2 {
  return { code, location, message, repair }
}

function rejectUnknown(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  location: string,
  issues: ReportIssueV2[],
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
  issues: ReportIssueV2[],
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
  issues: ReportIssueV2[],
): string | undefined {
  if (value === undefined) return undefined
  return boundedString(value, location, maximum, issues)
}

function kebabId(value: unknown, location: string, issues: ReportIssueV2[]): string | undefined {
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

function identifier(value: unknown, location: string, issues: ReportIssueV2[]): string | undefined {
  return boundedString(value, location, MAX_IDENTIFIER_CHARS, issues)
}

function columns(
  value: unknown,
  location: string,
  issues: ReportIssueV2[],
): readonly string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    issues.push(
      issue(
        'invalid-columns',
        location,
        `${location} must contain between 1 and 100 column names.`,
        'Provide a non-empty list of unique public Artifact columns.',
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

/** Parse an untrusted JSON value into the complete closed v2 document contract. */
export function parseReportDocument(input: unknown): ParseReportDocumentResult {
  const issues: ReportIssueV2[] = []
  if (!isObject(input)) {
    return {
      ok: false,
      issues: [
        issue(
          'invalid-document',
          'document',
          'document must be an object.',
          'Submit one complete ReportDocument v2 object.',
        ),
      ],
      inspection: {
        artifactRefs: [],
        artifactRefLocations: [],
        visualCandidates: [],
        skippedMarivoTargets: 0,
        skippedVisualTargets: 0,
      },
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

  const sectionIds = new Set<string>()
  const blockIds = new Set<string>()
  const artifacts: string[] = []
  const artifactSet = new Set<string>()
  const artifactLocations = new Map<string, string[]>()
  const sections: ReportSectionV2[] = []
  const visualCandidates: ReportVisualCandidate[] = []
  let blockCount = 0
  let textChars = 0
  let skippedMarivoTargets = 0
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
    const parsedBlocks: ReportBlockV2[] = []
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
      const allowed = ALLOWED_BY_KIND[rawBlock.kind]
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
        if (id !== undefined && text !== undefined) {
          parsedBlocks.push({
            kind: 'text',
            id,
            text,
          })
        }
        continue
      }

      const blockTitle = boundedString(rawBlock.title, `${blockLocation}.title`, 200, issues)
      const artifactRef = identifier(rawBlock.artifact_ref, `${blockLocation}.artifact_ref`, issues)
      if (artifactRef !== undefined) {
        if (!artifactSet.has(artifactRef)) {
          artifactSet.add(artifactRef)
          artifacts.push(artifactRef)
        }
        const location = `${blockLocation}.artifact_ref`
        const locations = artifactLocations.get(artifactRef) ?? []
        if (!locations.includes(location)) locations.push(location)
        artifactLocations.set(artifactRef, locations)
      }
      if (artifactRef === undefined) skippedMarivoTargets += 1
      if (rawBlock.kind === 'table') {
        const selectedColumns = columns(rawBlock.columns, `${blockLocation}.columns`, issues)
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
          artifactRef !== undefined &&
          Number.isSafeInteger(maximum) &&
          (maximum as number) >= 1 &&
          (maximum as number) <= 100
        ) {
          const block: TableBlockV2 = {
            kind: 'table',
            id,
            title: blockTitle,
            artifact_ref: artifactRef,
            max_rows: maximum as number,
            ...(selectedColumns === undefined ? {} : { columns: selectedColumns }),
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
            'Provide both public Artifact column names.',
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
        artifactRef !== undefined &&
        view !== undefined &&
        chartFieldsValid
      ) {
        const block: ChartBlockV2 = {
          kind: 'chart',
          id,
          title: blockTitle,
          artifact_ref: artifactRef,
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
    if (sectionId !== undefined && sectionTitle !== undefined) {
      sections.push({ id: sectionId, title: sectionTitle, blocks: parsedBlocks })
    }
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
  if (artifacts.length > 20) {
    issues.push(
      issue(
        'too-many-artifacts',
        'document.sections',
        `ReportDocument references ${artifacts.length} unique Artifacts; the maximum is 20.`,
        'Reduce unique Artifact references to at most 20.',
      ),
    )
  }
  const inspection: ReportDocumentInspection = {
    artifactRefs: artifacts,
    artifactRefLocations: artifacts.map((ref) => artifactLocations.get(ref) ?? []),
    visualCandidates,
    skippedMarivoTargets,
    skippedVisualTargets,
  }
  if (issues.length > 0 || title === undefined || locale === undefined) {
    return { ok: false, issues, inspection }
  }
  return {
    ok: true,
    value: {
      document: {
        version: REPORT_DOCUMENT_VERSION,
        title,
        locale,
        sections,
        ...(subtitle === undefined ? {} : { subtitle }),
      },
      artifactRefs: artifacts,
    },
    inspection,
  }
}
