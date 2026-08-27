import type { JsonValue } from '@deepseek-ai/dsh-session'

export const REPORT_DOCUMENT_VERSION = 'dsh-data-analysis-report/v1' as const

export interface TextBlockV1 {
  readonly kind: 'text'
  readonly id: string
  readonly text: string
  readonly finding_ids?: readonly string[]
}

export interface ChartBlockV1 {
  readonly kind: 'chart'
  readonly id: string
  readonly title: string
  readonly subtitle?: string
  readonly artifact_ref: string
  readonly view: 'auto' | 'line' | 'bar'
  readonly x?: string
  readonly y?: string
  readonly finding_ids?: readonly string[]
}

export interface TableBlockV1 {
  readonly kind: 'table'
  readonly id: string
  readonly title: string
  readonly artifact_ref: string
  readonly columns?: readonly string[]
  readonly max_rows: number
  readonly finding_ids?: readonly string[]
}

export interface EvidenceBlockV1 {
  readonly kind: 'evidence'
  readonly id: string
  readonly title: string
  readonly finding_ids: readonly string[]
}

export type ReportBlockV1 = TextBlockV1 | ChartBlockV1 | TableBlockV1 | EvidenceBlockV1

export interface ReportSectionV1 {
  readonly id: string
  readonly title: string
  readonly blocks: readonly ReportBlockV1[]
}

export interface ReportDocumentV1 {
  readonly version: typeof REPORT_DOCUMENT_VERSION
  readonly title: string
  readonly subtitle?: string
  readonly locale: 'zh-CN' | 'en-US'
  readonly sections: readonly ReportSectionV1[]
}

export type ReportBlockedStage = 'document' | 'marivo' | 'visual' | 'publish'

export interface ReportIssueV1 {
  readonly code: string
  readonly location: string
  readonly message: string
  readonly repair: string
}

export interface ReportReadyValueV1 {
  readonly status: 'ready'
  readonly title: string
  readonly path: string
  readonly report_digest: string
  readonly document_digest: string
  readonly artifact_refs: string[]
  readonly finding_ids: string[]
  readonly disclosures: string[]
}

export interface ReportBlockedValueV1 {
  readonly status: 'blocked'
  readonly stage: ReportBlockedStage
  readonly issues: ReportIssueV1[]
}

export type ReportRenderValueV1 = ReportReadyValueV1 | ReportBlockedValueV1

export interface ParsedReportDocument {
  readonly document: ReportDocumentV1
  readonly artifactRefs: readonly string[]
  readonly findingIds: readonly string[]
  /** Finding groups in block order; empty groups are omitted. */
  readonly findingGroups: readonly (readonly string[])[]
}

export type ParseReportDocumentResult =
  | { readonly ok: true; readonly value: ParsedReportDocument }
  | { readonly ok: false; readonly issues: readonly ReportIssueV1[] }

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_IDENTIFIER_CHARS = 512
const ALLOWED_ROOT = new Set(['version', 'title', 'subtitle', 'locale', 'sections'])
const ALLOWED_SECTION = new Set(['id', 'title', 'blocks'])
const ALLOWED_BY_KIND: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  text: new Set(['kind', 'id', 'text', 'finding_ids']),
  chart: new Set([
    'kind', 'id', 'title', 'subtitle', 'artifact_ref', 'view', 'x', 'y', 'finding_ids',
  ]),
  table: new Set(['kind', 'id', 'title', 'artifact_ref', 'columns', 'max_rows', 'finding_ids']),
  evidence: new Set(['kind', 'id', 'title', 'finding_ids']),
})

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function chars(value: string): number {
  return [...value].length
}

function issue(
  code: string,
  location: string,
  message: string,
  repair: string,
): ReportIssueV1 {
  return { code, location, message, repair }
}

function rejectUnknown(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  location: string,
  issues: ReportIssueV1[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issues.push(issue(
        'unknown-field',
        `${location}.${key}`,
        `Unknown ReportDocument field ${JSON.stringify(key)}.`,
        'Remove the unknown field and submit the complete document again.',
      ))
    }
  }
}

function boundedString(
  value: unknown,
  location: string,
  maximum: number,
  issues: ReportIssueV1[],
): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push(issue(
      'invalid-string', location, `${location} must be a non-empty string.`,
      'Provide a non-empty string.',
    ))
    return undefined
  }
  if (chars(value) > maximum) {
    issues.push(issue(
      'string-too-long', location, `${location} exceeds ${maximum} Unicode characters.`,
      `Shorten the value to at most ${maximum} characters.`,
    ))
    return undefined
  }
  return value
}

function optionalBoundedString(
  value: unknown,
  location: string,
  maximum: number,
  issues: ReportIssueV1[],
): string | undefined {
  if (value === undefined) return undefined
  return boundedString(value, location, maximum, issues)
}

function kebabId(value: unknown, location: string, issues: ReportIssueV1[]): string | undefined {
  const id = boundedString(value, location, MAX_IDENTIFIER_CHARS, issues)
  if (id !== undefined && !ID.test(id)) {
    issues.push(issue(
      'invalid-id', location, `${location} must be non-empty ASCII kebab-case.`,
      'Use lowercase ASCII letters or digits separated by single hyphens.',
    ))
    return undefined
  }
  return id
}

function identifier(value: unknown, location: string, issues: ReportIssueV1[]): string | undefined {
  return boundedString(value, location, MAX_IDENTIFIER_CHARS, issues)
}

function findingIds(
  value: unknown,
  location: string,
  required: boolean,
  issues: ReportIssueV1[],
): readonly string[] | undefined {
  if (value === undefined && !required) return undefined
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    issues.push(issue(
      'invalid-finding-ids', location, `${location} must contain between 1 and 20 Finding IDs.`,
      'Provide a non-empty list of at most 20 unique Finding IDs.',
    ))
    return undefined
  }
  const result: string[] = []
  const seen = new Set<string>()
  for (const [index, raw] of value.entries()) {
    const id = identifier(raw, `${location}[${index}]`, issues)
    if (id === undefined) continue
    if (seen.has(id)) {
      issues.push(issue(
        'duplicate-finding-id', `${location}[${index}]`, `Finding ID ${JSON.stringify(id)} is duplicated in one block.`,
        'Keep each Finding ID once in this block.',
      ))
      continue
    }
    seen.add(id)
    result.push(id)
  }
  return result
}

function columns(
  value: unknown,
  location: string,
  issues: ReportIssueV1[],
): readonly string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    issues.push(issue(
      'invalid-columns', location, `${location} must contain between 1 and 100 column names.`,
      'Provide a non-empty list of unique public Artifact columns.',
    ))
    return undefined
  }
  const result: string[] = []
  const seen = new Set<string>()
  for (const [index, raw] of value.entries()) {
    const column = identifier(raw, `${location}[${index}]`, issues)
    if (column === undefined) continue
    if (seen.has(column)) {
      issues.push(issue(
        'duplicate-column', `${location}[${index}]`, `Column ${JSON.stringify(column)} is duplicated.`,
        'Keep each requested column once.',
      ))
      continue
    }
    seen.add(column)
    result.push(column)
  }
  return result
}

/** Parse an untrusted JSON value into the complete closed v1 document contract. */
export function parseReportDocument(input: JsonValue | unknown): ParseReportDocumentResult {
  const issues: ReportIssueV1[] = []
  if (!isObject(input)) {
    return { ok: false, issues: [issue(
      'invalid-document', 'document', 'document must be an object.',
      'Submit one complete ReportDocument v1 object.',
    )] }
  }
  rejectUnknown(input, ALLOWED_ROOT, 'document', issues)
  if (input.version !== REPORT_DOCUMENT_VERSION) {
    issues.push(issue(
      'unsupported-version', 'document.version', `document.version must be ${REPORT_DOCUMENT_VERSION}.`,
      `Set version to ${REPORT_DOCUMENT_VERSION}.`,
    ))
  }
  const title = boundedString(input.title, 'document.title', 200, issues)
  const subtitle = optionalBoundedString(input.subtitle, 'document.subtitle', 200, issues)
  const locale = input.locale === 'zh-CN' || input.locale === 'en-US' ? input.locale : undefined
  if (locale === undefined) {
    issues.push(issue(
      'invalid-locale', 'document.locale', 'document.locale must be zh-CN or en-US.',
      'Choose one supported locale.',
    ))
  }
  if (!Array.isArray(input.sections) || input.sections.length < 1 || input.sections.length > 20) {
    issues.push(issue(
      'invalid-sections', 'document.sections', 'document.sections must contain between 1 and 20 sections.',
      'Provide 1-20 non-empty sections.',
    ))
  }

  const sectionIds = new Set<string>()
  const blockIds = new Set<string>()
  const artifacts: string[] = []
  const artifactSet = new Set<string>()
  const findings: string[] = []
  const findingSet = new Set<string>()
  const groups: string[][] = []
  const sections: ReportSectionV1[] = []
  let blockCount = 0
  let textChars = 0

  const rawSections = Array.isArray(input.sections) ? input.sections : []
  for (const [sectionIndex, rawSection] of rawSections.entries()) {
    const sectionLocation = `document.sections[${sectionIndex}]`
    if (!isObject(rawSection)) {
      issues.push(issue('invalid-section', sectionLocation, 'Each section must be an object.', 'Replace it with a complete section object.'))
      continue
    }
    rejectUnknown(rawSection, ALLOWED_SECTION, sectionLocation, issues)
    const sectionId = kebabId(rawSection.id, `${sectionLocation}.id`, issues)
    if (sectionId !== undefined) {
      if (sectionIds.has(sectionId)) {
        issues.push(issue('duplicate-section-id', `${sectionLocation}.id`, `Section ID ${JSON.stringify(sectionId)} is duplicated.`, 'Use a unique section ID.'))
      }
      sectionIds.add(sectionId)
    }
    const sectionTitle = boundedString(rawSection.title, `${sectionLocation}.title`, 200, issues)
    if (!Array.isArray(rawSection.blocks) || rawSection.blocks.length < 1 || rawSection.blocks.length > 20) {
      issues.push(issue(
        'invalid-blocks', `${sectionLocation}.blocks`, 'Each section must contain between 1 and 20 blocks.',
        'Provide 1-20 blocks in this section.',
      ))
    }
    const parsedBlocks: ReportBlockV1[] = []
    const rawBlocks = Array.isArray(rawSection.blocks) ? rawSection.blocks : []
    blockCount += rawBlocks.length

    for (const [blockIndex, rawBlock] of rawBlocks.entries()) {
      const blockLocation = `${sectionLocation}.blocks[${blockIndex}]`
      if (!isObject(rawBlock) || typeof rawBlock.kind !== 'string') {
        issues.push(issue('invalid-block', blockLocation, 'Each block must be an object with a supported kind.', 'Use text, chart, table, or evidence.'))
        continue
      }
      const allowed = ALLOWED_BY_KIND[rawBlock.kind]
      if (allowed === undefined) {
        issues.push(issue('invalid-block-kind', `${blockLocation}.kind`, `Unsupported block kind ${JSON.stringify(rawBlock.kind)}.`, 'Use text, chart, table, or evidence.'))
        continue
      }
      rejectUnknown(rawBlock, allowed, blockLocation, issues)
      const id = kebabId(rawBlock.id, `${blockLocation}.id`, issues)
      if (id !== undefined) {
        if (blockIds.has(id)) {
          issues.push(issue('duplicate-block-id', `${blockLocation}.id`, `Block ID ${JSON.stringify(id)} is duplicated.`, 'Use a document-wide unique block ID.'))
        }
        blockIds.add(id)
      }
      const ids = findingIds(rawBlock.finding_ids, `${blockLocation}.finding_ids`, rawBlock.kind === 'evidence', issues)
      if (ids !== undefined) {
        groups.push([...ids])
        for (const finding of ids) {
          if (!findingSet.has(finding)) {
            findingSet.add(finding)
            findings.push(finding)
          }
        }
      }

      if (rawBlock.kind === 'text') {
        const text = boundedString(rawBlock.text, `${blockLocation}.text`, 20_000, issues)
        if (text !== undefined) textChars += chars(text)
        if (id !== undefined && text !== undefined) {
          parsedBlocks.push({ kind: 'text', id, text, ...(ids === undefined ? {} : { finding_ids: ids }) })
        }
        continue
      }

      const blockTitle = boundedString(rawBlock.title, `${blockLocation}.title`, 200, issues)
      if (rawBlock.kind === 'evidence') {
        if (id !== undefined && blockTitle !== undefined && ids !== undefined) {
          parsedBlocks.push({ kind: 'evidence', id, title: blockTitle, finding_ids: ids })
        }
        continue
      }

      const artifactRef = identifier(rawBlock.artifact_ref, `${blockLocation}.artifact_ref`, issues)
      if (artifactRef !== undefined && !artifactSet.has(artifactRef)) {
        artifactSet.add(artifactRef)
        artifacts.push(artifactRef)
      }
      if (rawBlock.kind === 'table') {
        const selectedColumns = columns(rawBlock.columns, `${blockLocation}.columns`, issues)
        const maximum = rawBlock.max_rows
        if (!Number.isSafeInteger(maximum) || (maximum as number) < 1 || (maximum as number) > 100) {
          issues.push(issue('invalid-max-rows', `${blockLocation}.max_rows`, 'table.max_rows must be an integer from 1 to 100.', 'Choose a max_rows value from 1 to 100.'))
        }
        if (id !== undefined && blockTitle !== undefined && artifactRef !== undefined && Number.isSafeInteger(maximum) && (maximum as number) >= 1 && (maximum as number) <= 100) {
          parsedBlocks.push({
            kind: 'table', id, title: blockTitle, artifact_ref: artifactRef,
            max_rows: maximum as number,
            ...(selectedColumns === undefined ? {} : { columns: selectedColumns }),
            ...(ids === undefined ? {} : { finding_ids: ids }),
          })
        }
        continue
      }

      const subtitleValue = optionalBoundedString(rawBlock.subtitle, `${blockLocation}.subtitle`, 200, issues)
      const view = rawBlock.view === 'auto' || rawBlock.view === 'line' || rawBlock.view === 'bar'
        ? rawBlock.view
        : undefined
      if (view === undefined) {
        issues.push(issue('invalid-chart-view', `${blockLocation}.view`, 'chart.view must be auto, line, or bar.', 'Choose one supported chart view.'))
      }
      const x = rawBlock.x === undefined ? undefined : identifier(rawBlock.x, `${blockLocation}.x`, issues)
      const y = rawBlock.y === undefined ? undefined : identifier(rawBlock.y, `${blockLocation}.y`, issues)
      if (view === 'auto' && (x !== undefined || y !== undefined)) {
        issues.push(issue('auto-with-fields', blockLocation, 'auto charts cannot specify x or y.', 'Remove x/y or choose an explicit line/bar view.'))
      }
      if ((view === 'line' || view === 'bar') && (x === undefined || y === undefined)) {
        issues.push(issue('explicit-chart-fields-required', blockLocation, 'Explicit line/bar charts require both x and y.', 'Provide both public Artifact column names.'))
      }
      if (id !== undefined && blockTitle !== undefined && artifactRef !== undefined && view !== undefined) {
        parsedBlocks.push({
          kind: 'chart', id, title: blockTitle, artifact_ref: artifactRef, view,
          ...(subtitleValue === undefined ? {} : { subtitle: subtitleValue }),
          ...(x === undefined ? {} : { x }), ...(y === undefined ? {} : { y }),
          ...(ids === undefined ? {} : { finding_ids: ids }),
        })
      }
    }
    if (sectionId !== undefined && sectionTitle !== undefined) {
      sections.push({ id: sectionId, title: sectionTitle, blocks: parsedBlocks })
    }
  }

  if (blockCount > 100) {
    issues.push(issue('too-many-blocks', 'document.sections', `ReportDocument contains ${blockCount} blocks; the maximum is 100.`, 'Reduce the document to at most 100 blocks.'))
  }
  if (textChars > 100_000) {
    issues.push(issue('text-budget-exceeded', 'document.sections', `ReportDocument text contains ${textChars} characters; the maximum is 100000.`, 'Shorten text blocks so their combined text is at most 100000 characters.'))
  }
  if (artifacts.length > 20) {
    issues.push(issue('too-many-artifacts', 'document.sections', `ReportDocument references ${artifacts.length} unique Artifacts; the maximum is 20.`, 'Reduce unique Artifact references to at most 20.'))
  }
  if (findings.length > 20) {
    issues.push(issue('too-many-findings', 'document.sections', `ReportDocument references ${findings.length} unique Findings; the maximum is 20.`, 'Reduce unique Finding references to at most 20.'))
  }
  if (issues.length > 0 || title === undefined || locale === undefined) return { ok: false, issues }
  return {
    ok: true,
    value: {
      document: {
        version: REPORT_DOCUMENT_VERSION, title, locale, sections,
        ...(subtitle === undefined ? {} : { subtitle }),
      },
      artifactRefs: artifacts,
      findingIds: findings,
      findingGroups: groups,
    },
  }
}
