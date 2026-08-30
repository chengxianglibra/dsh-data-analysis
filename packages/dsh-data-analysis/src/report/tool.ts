import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { defineTool, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { MarivoEnvironmentError } from '../environment/errors.ts'
import { type MarivoReportBridgeSource, resolveMarivoReportBridge } from './bridge.ts'
import {
  COMPUTED_DATA_VERSION,
  parseReportDocument,
  REPORT_DOCUMENT_VERSION,
  type ReportBlockedStage,
  type ReportBlockedValue,
  type ReportCheck,
  type ReportCheckStatus,
  type ReportComputedDataSource,
  type ReportDocumentInspection,
  type ReportIssue,
  type ReportRenderValue,
} from './document.ts'
import {
  createReportComputedProjection,
  type ReportProjectionBundle,
  type ReportProjectionInspection,
} from './projection.ts'
import { publishReport } from './publish.ts'
import { compileReportVisuals, preflightReportVisuals } from './visual.ts'

export const MARIVO_REPORT_RENDER_TOOL_NAME = 'marivo_report_render'
export const REPORT_PRESENTATION_META_KIND = 'marivo-html-report'
export const REPORT_PRESENTATION_META_VERSION = 1
export const REPORT_DURABLE_CONTENT_KIND = 'marivo-report-card'

const REPORT_DOCUMENT_MINIMAL_JSON = JSON.stringify({
  version: REPORT_DOCUMENT_VERSION,
  title: 'Report title',
  locale: 'zh-CN',
  sections: [
    {
      id: 'summary',
      title: 'Summary',
      blocks: [{ kind: 'text', id: 'summary-text', text: 'Report summary' }],
    },
  ],
})

export interface ReportPresentationMetaV1 {
  readonly [key: string]: JsonValue
  readonly kind: typeof REPORT_PRESENTATION_META_KIND
  readonly version: typeof REPORT_PRESENTATION_META_VERSION
  readonly title: string
  readonly path: string
  readonly reportDigest: string
  readonly disclosures: string[]
}

const textBlockSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', const: 'text', required: true },
    id: {
      type: 'string',
      required: true,
      description: 'Document-wide unique lowercase ASCII kebab-case block ID.',
    },
    text: {
      type: 'string',
      required: true,
      description:
        'Non-empty reader-facing plain text of at most 20,000 Unicode characters. Lead with the takeaway and explain why it matters in the report locale. Markdown and HTML are escaped as literal text; blank lines start paragraphs and consecutive lines beginning with -, *, •, or 1. form semantic lists.',
    },
  },
} as const

const chartBlockSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', const: 'chart', required: true },
    id: {
      type: 'string',
      required: true,
      description: 'Document-wide unique lowercase ASCII kebab-case block ID.',
    },
    title: {
      type: 'string',
      required: true,
      description:
        'Neutral reader-facing label for what is plotted; put the analytical takeaway in an adjacent text block.',
    },
    subtitle: {
      type: 'string',
      description:
        'Optional reader-facing unit, scope, denominator, time window, comparison basis, or short interpretation. Do not use raw Artifact refs or implementation field names.',
    },
    data_ref: {
      type: 'string',
      required: true,
      description:
        'Exact ID of a data source declared in document.data. The source may be an Artifact or an inline computed table.',
    },
    view: {
      type: 'string',
      enum: ['auto', 'line', 'bar'],
      required: true,
      description:
        'Use auto only when one unambiguous mapping exists and omit x/y. For line or bar, provide both x and y explicitly.',
    },
    x: {
      type: 'string',
      description:
        'Exact public data source column name. Line requires a time or ordered numeric dimension; bar requires a categorical dimension. Point/category counts are not hard quality gates.',
    },
    y: {
      type: 'string',
      description:
        'Exact public numeric data source column name. The renderer does not aggregate, sample, apply Top-N, or combine additional grain.',
    },
  },
} as const

const tableBlockSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', const: 'table', required: true },
    id: {
      type: 'string',
      required: true,
      description: 'Document-wide unique lowercase ASCII kebab-case block ID.',
    },
    title: {
      type: 'string',
      required: true,
      description:
        'Neutral reader-facing table label. Explain the takeaway and implication in an adjacent text block.',
    },
    data_ref: {
      type: 'string',
      required: true,
      description:
        'Exact ID of a data source declared in document.data. The source may be an Artifact or an inline computed table.',
    },
    columns: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Optional list of one to 100 unique exact data source column names. Omit it to use all columns in contract order.',
    },
    max_rows: {
      type: 'integer',
      required: true,
      description:
        'Maximum displayed rows, from 1 to 100. The report discloses total and omitted rows.',
    },
  },
} as const

const artifactDataSourceSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: {
      type: 'string',
      required: true,
      description: 'Unique lowercase ASCII kebab-case data source ID.',
    },
    artifact_ref: {
      type: 'string',
      required: true,
      description: 'Exact canonical Artifact ref in session_id.',
    },
  },
} as const

const computedColumnSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', required: true },
    type: {
      type: 'string',
      enum: ['string', 'number', 'boolean', 'datetime'],
      required: true,
    },
    role: { type: 'string', enum: ['time', 'dimension', 'measure', 'value'] },
    unit: { type: 'string' },
    nullable: { type: 'boolean' },
  },
} as const

const computedDataSourceSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: {
      type: 'string',
      required: true,
      description: 'Unique lowercase ASCII kebab-case data source ID.',
    },
    computed: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        version: { type: 'string', const: COMPUTED_DATA_VERSION, required: true },
        columns: {
          type: 'array',
          required: true,
          items: { ...computedColumnSchema },
          description: 'One descriptor per returned column, at most 100 columns.',
        },
        rows: {
          type: 'array',
          required: true,
          items: { type: 'array', items: { type: 'json' } },
          description: 'Scalar JSON rows with the same width as columns, at most 2000 rows.',
        },
      },
    },
  },
} as const

const dataSourceSchema = { oneOf: [artifactDataSourceSchema, computedDataSourceSchema] } as const

const documentSchema = {
  type: 'object',
  additionalProperties: false,
  description: [
    `One complete immutable ${REPORT_DOCUMENT_VERSION}. Revisions submit another complete document.`,
    'Use the report locale throughout. For stakeholder reports, order sections as answer-first summary, conclusions with adjacent visual interpretation, next steps, further questions, and caveats.',
    'Use text for narrative conclusions and chart/table blocks. Register each Artifact or computed result once in data, then reference it with data_ref.',
    'Python results must be converted to dsh-computed-data/v1 with columns and scalar JSON rows. Computed data is an immutable caller-provided snapshot, not a Marivo Artifact.',
    `Minimal valid JSON: ${REPORT_DOCUMENT_MINIMAL_JSON}.`,
    'document.blocks is invalid; blocks must be nested under document.sections[].blocks.',
    'Provide 1-20 sections with 1-20 blocks each, at most 100 blocks total, and at most 20 data sources.',
  ].join(' '),
  properties: {
    version: { type: 'string', const: REPORT_DOCUMENT_VERSION, required: true },
    title: {
      type: 'string',
      required: true,
      description: 'Non-empty report title of at most 200 Unicode characters.',
    },
    subtitle: {
      type: 'string',
      description: 'Optional non-empty report subtitle of at most 200 Unicode characters.',
    },
    locale: { type: 'string', enum: ['zh-CN', 'en-US'], required: true },
    data: {
      type: 'array',
      items: dataSourceSchema,
      description: 'Optional catalog of up to 20 Artifact or computed data sources.',
    },
    sections: {
      type: 'array',
      required: true,
      description:
        'One to 20 ordered non-empty reader-facing sections. Use concise insight-led titles; the first stakeholder section is an executive summary.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: {
            type: 'string',
            required: true,
            description: 'Unique lowercase ASCII kebab-case section ID.',
          },
          title: { type: 'string', required: true },
          blocks: {
            type: 'array',
            required: true,
            description: 'One to 20 ordered blocks nested under this section.',
            items: {
              oneOf: [textBlockSchema, chartBlockSchema, tableBlockSchema],
            },
          },
        },
      },
    },
  },
} as const

const issueSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    code: { type: 'string', required: true },
    location: { type: 'string', required: true },
    message: { type: 'string', required: true },
    repair: { type: 'string', required: true },
  },
} as const

const checkSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    stage: { type: 'string', enum: ['document', 'source', 'visual', 'publish'], required: true },
    status: { type: 'string', enum: ['passed', 'failed', 'partial', 'skipped'], required: true },
    issues: { type: 'array', items: issueSchema, required: true },
    omitted_issue_count: { type: 'integer', required: true },
    reason: { type: 'string' },
  },
} as const

const outputSchema = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        status: { type: 'string', const: 'ready', required: true },
        title: { type: 'string', required: true },
        path: { type: 'string', required: true },
        report_digest: { type: 'string', required: true },
        document_digest: { type: 'string', required: true },
        artifact_refs: { type: 'array', items: { type: 'string' }, required: true },
        data_refs: { type: 'array', items: { type: 'string' }, required: true },
        computed_data_refs: { type: 'array', items: { type: 'string' }, required: true },
        disclosures: { type: 'array', items: { type: 'string' }, required: true },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        status: { type: 'string', const: 'blocked', required: true },
        checks: {
          type: 'array',
          items: checkSchema,
          required: true,
          description: 'Exactly document, source, visual, and publish checks in that order.',
        },
      },
    },
  ],
} as const

function recoverableReportArguments(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function attributeSourceIssues(
  issues: readonly ReportIssue[],
  inspection: ReportDocumentInspection,
  projection: ReportProjectionInspection,
): ReportIssue[] {
  const attributed: ReportIssue[] = []
  const addAtLocations = (item: ReportIssue, locations: readonly string[]): void => {
    if (locations.length === 0) attributed.push({ ...item })
    else for (const location of locations) attributed.push({ ...item, location })
  }
  for (const item of issues) {
    const artifact = /^(?:artifact_refs|artifacts)\[(\d+)\](?:\..*)?$/.exec(item.location)
    if (artifact !== null) {
      const ref = projection.checkedArtifactRefs[Number(artifact[1])]
      if (ref === undefined) {
        addAtLocations(item, [])
        continue
      }
      const locations = new Set<string>()
      const explicitIndex = inspection.artifactRefs.indexOf(ref)
      for (const location of inspection.artifactRefLocations[explicitIndex] ?? [])
        locations.add(location)
      addAtLocations(item, [...locations])
      continue
    }
    attributed.push({ ...item })
  }
  return attributed
}

const REPORT_STAGES = ['document', 'source', 'visual', 'publish'] as const
const MAX_STAGE_ISSUES = 100

function normalizedIssues(
  issues: readonly ReportIssue[],
  alreadyOmitted = 0,
): { issues: ReportIssue[]; omitted: number } {
  const unique = new Map<string, ReportIssue>()
  for (const item of issues) {
    const key = JSON.stringify([item.location, item.code, item.message, item.repair])
    if (!unique.has(key)) unique.set(key, { ...item })
  }
  const sorted = [...unique.values()].sort(
    (left, right) =>
      left.location.localeCompare(right.location) ||
      left.code.localeCompare(right.code) ||
      left.message.localeCompare(right.message),
  )
  const retained = sorted.slice(0, MAX_STAGE_ISSUES)
  return {
    issues: retained,
    omitted: alreadyOmitted + Math.max(0, sorted.length - retained.length),
  }
}

function reportCheck(
  stage: ReportBlockedStage,
  status: ReportCheckStatus,
  issues: readonly ReportIssue[] = [],
  options: { readonly omitted?: number; readonly reason?: string } = {},
): ReportCheck {
  const normalized = normalizedIssues(issues, options.omitted)
  const reason = options.reason?.trim()
  if ((status === 'partial' || status === 'skipped') && !reason) {
    throw new TypeError(`${stage} ${status} check requires a reason`)
  }
  if ((status === 'passed' || status === 'skipped') && normalized.issues.length > 0) {
    throw new TypeError(`${stage} ${status} check cannot contain issues`)
  }
  if (status === 'failed' && normalized.issues.length === 0 && normalized.omitted === 0) {
    throw new TypeError(`${stage} failed check requires an issue`)
  }
  return {
    stage,
    status,
    issues: normalized.issues,
    omitted_issue_count: normalized.omitted,
    ...(reason === undefined ? {} : { reason }),
  }
}

function blockedChecks(checks: readonly ReportCheck[]): ReportBlockedValue {
  if (
    checks.length !== REPORT_STAGES.length ||
    checks.some((check, index) => check.stage !== REPORT_STAGES[index])
  )
    throw new TypeError('blocked report checks must use the fixed stage order')
  return { status: 'blocked', checks: [...checks] as ReportBlockedValue['checks'] }
}

export function renderReportToolValue(value: ReportRenderValue): string {
  if (value.status === 'blocked') {
    return [
      'HTML report rendering is blocked after best-effort preflight.',
      ...value.checks.flatMap((check) => [
        `${check.stage}: ${check.status}${check.reason === undefined ? '' : ` (${check.reason})`}`,
        ...check.issues.map(
          (item) => `  ${item.location} [${item.code}]: ${item.message} Repair: ${item.repair}`,
        ),
        ...(check.omitted_issue_count === 0
          ? []
          : [`  Omitted ${check.omitted_issue_count} additional issue(s).`]),
      ]),
      `Retry: repair the specified paths, preserve unaffected content, and resubmit one complete ${REPORT_DOCUMENT_VERSION}. Never submit document.blocks alone.`,
      `Minimal valid document: ${REPORT_DOCUMENT_MINIMAL_JSON}`,
    ].join('\n')
  }
  return [
    `HTML report ready: ${value.title}`,
    `Path: ${value.path}`,
    `Report digest: ${value.report_digest}`,
    `Document digest: ${value.document_digest}`,
    ...value.disclosures.map((item) => `Disclosure: ${item}`),
  ].join('\n')
}

/** Project the replay-only report card summary without copying analytical payloads. */
export function reportPresentationMeta(value: ReportRenderValue): ReportPresentationMetaV1 | null {
  if (value.status !== 'ready') return null
  return {
    kind: REPORT_PRESENTATION_META_KIND,
    version: REPORT_PRESENTATION_META_VERSION,
    title: value.title,
    path: value.path,
    reportDigest: value.report_digest,
    disclosures: [...value.disclosures],
  }
}

function reportTurnForRootCall(dispatch: {
  readonly exec: { readonly rootCallId?: unknown }
  readonly agent?: { readonly session?: { readonly events?: readonly unknown[] } }
}): number | null {
  const rootCallId = String(dispatch.exec.rootCallId ?? '')
  if (rootCallId === '' || !Array.isArray(dispatch.agent?.session?.events)) return null
  let rootCall: { data?: { turn?: unknown } } | undefined
  for (let index = dispatch.agent.session.events.length - 1; index >= 0; index--) {
    const candidate = dispatch.agent.session.events[index]
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) continue
    const event = candidate as { type?: unknown; data?: { callId?: unknown; turn?: unknown } }
    if (event.type === 'tool/call' && String(event.data?.callId ?? '') === rootCallId) {
      rootCall = event
      break
    }
  }
  const turn = rootCall?.data?.turn
  return Number.isSafeInteger(turn) && (turn as number) >= 0 ? (turn as number) : null
}

/**
 * Preserve the ready card projection on Code Mode's durable sub-dispatch event.
 * Harness intentionally omits presentationMeta for nested calls; this custom
 * block changes only the logged copy and never the program value or model text.
 */
export function installMarivoReportCodeDelivery(ctx: Context): () => void {
  const pending = new Map<string, ReportPresentationMetaV1>()
  const stopResult = ctx.on('tools/result', (exec, result) => {
    if (exec.name !== MARIVO_REPORT_RENDER_TOOL_NAME || exec.parent === undefined || result.isError)
      return
    const meta = reportPresentationMeta(result.value as unknown as ReportRenderValue)
    if (meta !== null) pending.set(String(exec.callId), meta)
  })
  const stopDispatchLog = ctx.on(
    'tools/code-dispatch-log',
    async (dispatch, next) => {
      const content = await next()
      if (dispatch.name !== MARIVO_REPORT_RENDER_TOOL_NAME) return content
      const key = String(dispatch.subCallId)
      const meta = pending.get(key)
      pending.delete(key)
      if (dispatch.isError || meta === undefined) return content
      const turn = reportTurnForRootCall(dispatch)
      if (turn === null) return content
      const card = { type: REPORT_DURABLE_CONTENT_KIND, turn, meta } as unknown as ContentBlock
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

export interface MarivoReportToolOptions {
  readonly reportsRoot?: string
  readonly now?: () => Date
}

/** Build the server-only immutable HTML report Tool. */
export function createMarivoReportRenderTool(
  bridgeSource: MarivoReportBridgeSource,
  options: MarivoReportToolOptions = {},
): ToolDefinition {
  const executeReport = async (
    args: Record<string, unknown>,
    exec: ToolRunContext,
  ): Promise<ReportRenderValue> => {
    const bridge = await resolveMarivoReportBridge(bridgeSource)
    exec.signal.throwIfAborted()
    const parsed = parseReportDocument(args.document)
    const documentIssues = parsed.ok ? [] : [...parsed.issues]
    const rawSessionId = args.session_id
    const sessionId =
      typeof rawSessionId === 'string' &&
      rawSessionId.trim().length > 0 &&
      [...rawSessionId].length <= 512
        ? rawSessionId
        : undefined
    const invalidSessionId = rawSessionId !== undefined && sessionId === undefined
    if (invalidSessionId) {
      documentIssues.push({
        code: 'invalid-session-id',
        location: 'session_id',
        message: 'session_id must be a non-empty string of at most 512 Unicode characters.',
        repair: 'Use the exact bounded Marivo Session ID and retry the complete document.',
      })
    }
    if (parsed.inspection.artifactRefs.length > 0 && sessionId === undefined) {
      if (!invalidSessionId)
        documentIssues.push({
          code: 'invalid-session-id',
          location: 'session_id',
          message: 'session_id must be a non-empty string of at most 512 Unicode characters.',
          repair: 'Use the exact bounded Marivo Session ID and retry the complete document.',
        })
      return blockedChecks([
        reportCheck('document', 'failed', documentIssues),
        reportCheck('source', 'skipped', [], {
          reason: 'A valid session_id is required before Marivo checks can run.',
        }),
        reportCheck('visual', 'skipped', [], {
          reason: 'Visual checks require a checked Marivo projection.',
        }),
        reportCheck('publish', 'skipped', [], {
          reason: 'Publishing requires every preflight check to pass.',
        }),
      ])
    }
    exec.signal.throwIfAborted()
    const computed = parsed.ok
      ? (parsed.value.document.data ?? [])
          .filter((source): source is ReportComputedDataSource => 'computed' in source)
          .map(createReportComputedProjection)
      : []
    let projection: ReportProjectionInspection | undefined
    let projectionBundle: ReportProjectionBundle
    if (parsed.inspection.artifactRefs.length === 0) {
      projectionBundle = {
        sessionId: null,
        artifacts: [],
        computed,
        sessionDag: { jobs: [], artifacts: [] },
      }
    } else {
      if (sessionId === undefined) throw new Error('session_id was validated before projection')
      const checkedProjection = await bridge.project(
        sessionId,
        parsed.inspection.artifactRefs,
        exec.signal,
      )
      exec.signal.throwIfAborted()
      projection = checkedProjection
      projectionBundle = { ...checkedProjection.value, computed }
    }
    const documentCheck = reportCheck(
      'document',
      documentIssues.length === 0 ? 'passed' : 'failed',
      documentIssues,
    )
    const sourceIssues =
      projection === undefined
        ? []
        : attributeSourceIssues(projection.issues, parsed.inspection, projection)
    const sourceStatus: ReportCheckStatus =
      projection?.globalFailure === true
        ? 'failed'
        : parsed.inspection.skippedDataTargets > 0
          ? 'partial'
          : sourceIssues.length > 0 || (projection?.omittedIssueCount ?? 0) > 0
            ? 'failed'
            : parsed.ok
              ? 'passed'
              : 'skipped'
    const sourceCheck = reportCheck('source', sourceStatus, sourceIssues, {
      omitted: projection?.omittedIssueCount ?? 0,
      ...(sourceStatus === 'partial'
        ? {
            reason: `${parsed.inspection.skippedDataTargets} malformed data target(s) could not be safely rendered.`,
          }
        : sourceStatus === 'skipped'
          ? { reason: 'Source checks require a valid ReportDocument.' }
          : {}),
    })

    const visualPreflight = preflightReportVisuals(
      parsed.inspection.visualCandidates,
      parsed.ok
        ? parsed.value.document
        : { version: REPORT_DOCUMENT_VERSION, title: '', locale: 'en-US', sections: [] },
      projectionBundle,
    )
    const skippedVisualTargets =
      parsed.inspection.skippedVisualTargets + visualPreflight.skippedCount
    const visualStatus: ReportCheckStatus =
      projection?.globalFailure === true
        ? 'skipped'
        : skippedVisualTargets > 0
          ? visualPreflight.checkedCount === 0
            ? 'skipped'
            : 'partial'
          : visualPreflight.issues.length > 0
            ? 'failed'
            : 'passed'
    const visualCheck = reportCheck('visual', visualStatus, visualPreflight.issues, {
      ...(visualStatus === 'partial' || visualStatus === 'skipped'
        ? {
            reason:
              projection?.globalFailure === true
                ? 'Visual checks require a successfully resumed Marivo Session.'
                : `${skippedVisualTargets} visual target(s) depended on invalid document fields or unavailable data projections.`,
          }
        : {}),
    })
    const publishSkipped = reportCheck('publish', 'skipped', [], {
      reason: 'Publishing requires every preflight check to pass.',
    })
    if (
      documentCheck.status !== 'passed' ||
      sourceCheck.status !== 'passed' ||
      visualCheck.status !== 'passed'
    ) {
      return blockedChecks([documentCheck, sourceCheck, visualCheck, publishSkipped])
    }
    if (!parsed.ok || (projection !== undefined && !projection.complete)) {
      throw new MarivoEnvironmentError(
        'subprocess-failed',
        'Report preflight passed without a complete document and projection',
      )
    }
    const compiled = compileReportVisuals(parsed.value.document, projectionBundle)
    if (!compiled.ok) {
      return blockedChecks([
        documentCheck,
        sourceCheck,
        reportCheck('visual', 'failed', compiled.issues),
        publishSkipped,
      ])
    }
    const published = await publishReport(compiled.value, {
      environmentFingerprint: bridge.binding.fingerprint,
      marivoVersion: bridge.binding.marivoVersion,
      ...(options.reportsRoot === undefined ? {} : { reportsRoot: options.reportsRoot }),
      ...(options.now === undefined ? {} : { now: options.now }),
      signal: exec.signal,
    })
    if (!published.ok) {
      return blockedChecks([
        documentCheck,
        sourceCheck,
        visualCheck,
        reportCheck('publish', 'failed', published.issues),
      ])
    }
    const freshness =
      parsed.value.document.locale === 'zh-CN'
        ? 'Artifact admissible 不等于 datasource fresh。'
        : 'Artifact admissible does not mean datasource fresh.'
    const computedDisclosure =
      parsed.value.computedDataRefs.length > 0
        ? parsed.value.document.locale === 'zh-CN'
          ? 'computed 数据是调用方提供的结果快照，不声明 Python 执行证明、数据新鲜度或 Marivo lineage。'
          : 'Computed data is a caller-provided result snapshot; it does not attest Python execution, freshness, or Marivo lineage.'
        : undefined
    return {
      status: 'ready',
      title: parsed.value.document.title,
      path: published.path,
      report_digest: published.reportDigest,
      document_digest: published.documentDigest,
      artifact_refs: [...parsed.value.artifactRefs],
      data_refs: [...parsed.value.dataRefs],
      computed_data_refs: [...parsed.value.computedDataRefs],
      disclosures: [
        ...compiled.value.disclosures,
        ...(parsed.value.artifactRefs.length === 0 ? [] : [freshness]),
        ...(computedDisclosure === undefined ? [] : [computedDisclosure]),
      ],
    }
  }

  const tool = defineTool({
    name: MARIVO_REPORT_RENDER_TOOL_NAME,
    description: [
      'DSH data-analysis plugin Tool that renders a new immutable HTML report from registered Artifact or computed data sources.',
      'Use this live Tool schema as the exact report input contract; this Tool is not a marivo.help target, so do not call marivo_help for its contract.',
      'Call it only after the user requests or accepts a durable report deliverable, never for ordinary inline analysis.',
    ].join(' '),
    parameters: {
      session_id: {
        type: 'string',
        description:
          'Required only when document.data contains an Artifact source: exact non-empty Marivo analysis Session ID, at most 512 Unicode characters.',
      },
      document: { ...documentSchema, required: true },
    },
    output: {
      schema: outputSchema,
      render: (_args, value) => [
        { type: 'text', text: renderReportToolValue(value as ReportRenderValue) },
      ],
      presentationMeta: (_args, value) => reportPresentationMeta(value as ReportRenderValue),
    },
    timeoutMs: 135_000,
    execute: executeReport as never,
  })
  const strictExecute = tool.execute
  return {
    ...tool,
    execute(args, exec) {
      // Keep the closed schema as model guidance, while the richer parser owns
      // document-shape recovery instead of letting ToolArgsError hide repairs.
      if (recoverableReportArguments(args)) return executeReport(args, exec)
      return strictExecute(args, exec)
    },
  }
}

export function registerMarivoReportRenderTool(
  ctx: Context,
  bridgeSource: MarivoReportBridgeSource,
  options: MarivoReportToolOptions = {},
): () => void {
  return ctx.tools.register(createMarivoReportRenderTool(bridgeSource, options))
}
