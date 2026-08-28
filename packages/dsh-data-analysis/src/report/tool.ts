import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { defineTool, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { type MarivoEnvironmentSource, resolveMarivoEnvironmentSource } from '../disclosure/help.ts'
import { MarivoEnvironmentError } from '../environment/errors.ts'
import {
  parseReportDocument,
  type ReportBlockedStage,
  type ReportBlockedValueV1,
  type ReportCheckStatus,
  type ReportCheckV1,
  type ReportDocumentInspection,
  type ReportIssueV1,
  type ReportRenderValueV1,
} from './document.ts'
import { parseReportProjection, type ReportProjectionInspection } from './projection.ts'
import { publishReport } from './publish.ts'
import { compileReportVisuals, preflightReportVisuals } from './visual.ts'

export const MARIVO_REPORT_RENDER_TOOL_NAME = 'marivo_report_render'
export const REPORT_PRESENTATION_META_KIND = 'marivo-html-report'
export const REPORT_PRESENTATION_META_VERSION = 1
export const REPORT_DURABLE_CONTENT_KIND = 'marivo-report-card'

const REPORT_DOCUMENT_MINIMAL_JSON =
  '{"version":"dsh-data-analysis-report/v1","title":"Report title","locale":"zh-CN","sections":[{"id":"summary","title":"Summary","blocks":[{"kind":"text","id":"summary-text","text":"Report summary"}]}]}'

export interface ReportPresentationMetaV1 {
  readonly [key: string]: JsonValue
  readonly kind: typeof REPORT_PRESENTATION_META_KIND
  readonly version: typeof REPORT_PRESENTATION_META_VERSION
  readonly title: string
  readonly path: string
  readonly reportDigest: string
  readonly disclosures: string[]
}

const REPORT_LIMITS = Object.freeze({
  timeoutMs: 120_000,
  stdoutMaxBytes: 16 * 1024 * 1024 + 65_536,
  stderrMaxBytes: 65_536,
})

const optionalFindingIdsSchema = {
  type: 'array',
  items: { type: 'string' },
  description: [
    'Optional adjacent sources. Omit finding_ids or pass [] when this block has no exact Finding support; [] is canonicalized to omission.',
    'Otherwise provide one to 20 unique exact persisted Finding IDs used as compact adjacent sources for this block.',
    'The reader shows the locale-matched human Finding statement first and keeps IDs, raw values, derivation, and Artifact identity in the collapsed audit trail.',
    'Every Finding attached to one block must be mechanically compatible; call session.evidence.compatibility before combining multiple IDs.',
  ].join(' '),
} as const

const requiredFindingIdsSchema = {
  type: 'array',
  items: { type: 'string' },
  required: true,
  description: [
    'Required for an evidence block; [] is invalid. Provide one to 20 unique exact persisted Finding IDs.',
    'The reader shows the locale-matched human Finding statement first and keeps IDs, raw values, derivation, and Artifact identity in the collapsed audit trail.',
    'Every Finding attached to one block must be mechanically compatible; call session.evidence.compatibility before combining multiple IDs.',
  ].join(' '),
} as const

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
    finding_ids: optionalFindingIdsSchema,
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
    artifact_ref: {
      type: 'string',
      required: true,
      description:
        'Exact canonical ref of an admissible Artifact in session_id; the Artifact must expose projected rows and a public artifact_schema.',
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
        'Exact public Artifact column name. Line requires a time or ordered numeric dimension; bar requires a categorical dimension. Point/category counts are not hard quality gates.',
    },
    y: {
      type: 'string',
      description:
        'Exact public numeric Artifact column name. The renderer does not aggregate, sample, apply Top-N, or combine additional grain.',
    },
    finding_ids: optionalFindingIdsSchema,
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
    artifact_ref: {
      type: 'string',
      required: true,
      description:
        'Exact canonical ref of an admissible Artifact in session_id; the Artifact must expose projected rows and a public artifact_schema.',
    },
    columns: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Optional list of one to 100 unique exact public Artifact column names. Omit it to use all public columns in contract order.',
    },
    max_rows: {
      type: 'integer',
      required: true,
      description:
        'Maximum displayed rows, from 1 to 100. The report discloses total and omitted rows.',
    },
    finding_ids: optionalFindingIdsSchema,
  },
} as const

const evidenceBlockSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', const: 'evidence', required: true },
    id: {
      type: 'string',
      required: true,
      description: 'Document-wide unique lowercase ASCII kebab-case block ID.',
    },
    title: {
      type: 'string',
      required: true,
      description:
        'Reader-facing title for an explicitly requested source inventory. Prefer attaching finding_ids to narrative or visual blocks instead of adding a duplicate Evidence appendix.',
    },
    finding_ids: requiredFindingIdsSchema,
  },
} as const

const documentSchema = {
  type: 'object',
  additionalProperties: false,
  description: [
    'One complete immutable ReportDocument v1. Revisions submit another complete document.',
    'Use the report locale throughout. For stakeholder reports, order sections as answer-first summary, findings with adjacent visual interpretation, next steps, further questions, and caveats.',
    'Finding IDs belong in finding_ids metadata, not in narrative text; do not duplicate all Findings in an Evidence appendix unless the user asked for it.',
    `Minimal valid JSON: ${REPORT_DOCUMENT_MINIMAL_JSON}.`,
    'document.blocks is invalid; blocks must be nested under document.sections[].blocks.',
    'Provide 1-20 sections with 1-20 blocks each and at most 100 blocks total; reference at most 20 unique explicit Artifacts and 100 unique Findings across the document, with at most 20 Findings in any one block.',
  ].join(' '),
  properties: {
    version: { type: 'string', const: 'dsh-data-analysis-report/v1', required: true },
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
              oneOf: [textBlockSchema, chartBlockSchema, tableBlockSchema, evidenceBlockSchema],
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
    stage: { type: 'string', enum: ['document', 'marivo', 'visual', 'publish'], required: true },
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
        finding_ids: { type: 'array', items: { type: 'string' }, required: true },
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
          description: 'Exactly document, marivo, visual, and publish checks in that order.',
        },
      },
    },
  ],
} as const

function recoverableReportArguments(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function attributeMarivoIssues(
  issues: readonly ReportIssueV1[],
  inspection: ReportDocumentInspection,
  projection: ReportProjectionInspection,
): ReportIssueV1[] {
  const attributed: ReportIssueV1[] = []
  const addAtLocations = (item: ReportIssueV1, locations: readonly string[]): void => {
    if (locations.length === 0) attributed.push({ ...item })
    else for (const location of locations) attributed.push({ ...item, location })
  }
  for (const item of issues) {
    const group = /^finding_groups\[(\d+)\]$/.exec(item.location)
    if (group !== null) {
      const location = inspection.findingGroupLocations[Number(group[1])]
      addAtLocations(item, location === undefined ? [] : [location])
      continue
    }
    const finding = /^finding_ids\[(\d+)\]$/.exec(item.location)
    if (finding !== null) {
      addAtLocations(item, inspection.findingIdLocations[Number(finding[1])] ?? [])
      continue
    }
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
      for (const target of projection.findingArtifactTargets) {
        if (target.artifactRef !== ref) continue
        const findingIndex = inspection.findingIds.indexOf(target.findingId)
        for (const location of inspection.findingIdLocations[findingIndex] ?? [])
          locations.add(location)
      }
      addAtLocations(item, [...locations])
      continue
    }
    attributed.push({ ...item })
  }
  return attributed
}

const REPORT_STAGES = ['document', 'marivo', 'visual', 'publish'] as const
const MAX_STAGE_ISSUES = 100

function normalizedIssues(
  issues: readonly ReportIssueV1[],
  alreadyOmitted = 0,
): { issues: ReportIssueV1[]; omitted: number } {
  const unique = new Map<string, ReportIssueV1>()
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
  issues: readonly ReportIssueV1[] = [],
  options: { readonly omitted?: number; readonly reason?: string } = {},
): ReportCheckV1 {
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

function blockedChecks(checks: readonly ReportCheckV1[]): ReportBlockedValueV1 {
  if (
    checks.length !== REPORT_STAGES.length ||
    checks.some((check, index) => check.stage !== REPORT_STAGES[index])
  )
    throw new TypeError('blocked report checks must use the fixed stage order')
  return { status: 'blocked', checks: [...checks] as ReportBlockedValueV1['checks'] }
}

export function renderReportToolValue(value: ReportRenderValueV1): string {
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
      'Retry: repair the specified paths, preserve unaffected content, and resubmit one complete ReportDocument v1. Never submit document.blocks alone.',
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
export function reportPresentationMeta(
  value: ReportRenderValueV1,
): ReportPresentationMetaV1 | null {
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
    const meta = reportPresentationMeta(result.value as unknown as ReportRenderValueV1)
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
  environmentSource: MarivoEnvironmentSource,
  options: MarivoReportToolOptions = {},
): ToolDefinition {
  const executeReport = async (
    args: Record<string, unknown>,
    exec: ToolRunContext,
  ): Promise<ReportRenderValueV1> => {
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
    if (sessionId === undefined) {
      documentIssues.push({
        code: 'invalid-session-id',
        location: 'session_id',
        message: 'session_id must be a non-empty string of at most 512 Unicode characters.',
        repair: 'Use the exact bounded Marivo Session ID and retry the complete document.',
      })
      return blockedChecks([
        reportCheck('document', 'failed', documentIssues),
        reportCheck('marivo', 'skipped', [], {
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
    const environment = await resolveMarivoEnvironmentSource(environmentSource)
    exec.signal.throwIfAborted()
    const child = await environment.runCheckedReportProjection(
      sessionId,
      parsed.inspection.artifactRefs,
      parsed.inspection.findingGroups,
      REPORT_LIMITS,
      exec.signal,
    )
    exec.signal.throwIfAborted()
    if (child.exitCode !== 0) {
      throw new MarivoEnvironmentError(
        'subprocess-failed',
        `Marivo report projection failed with exit code ${String(child.exitCode)}`,
        { exitCode: child.exitCode, stderr: child.stderr.toString('utf8').slice(0, 2_000) },
      )
    }
    let projection: ReportProjectionInspection
    try {
      projection = parseReportProjection(child.stdout, {
        sessionId,
        artifactRefs: parsed.inspection.artifactRefs,
        findingIds: parsed.inspection.findingIds,
        findingGroups: parsed.inspection.findingGroups,
      })
    } catch (cause) {
      throw new MarivoEnvironmentError(
        'subprocess-failed',
        'Marivo report projection returned an invalid payload',
        { stdoutBytes: child.stdout.byteLength },
        { cause },
      )
    }
    const documentCheck = reportCheck(
      'document',
      documentIssues.length === 0 ? 'passed' : 'failed',
      documentIssues,
    )
    const marivoIssues = attributeMarivoIssues(projection.issues, parsed.inspection, projection)
    const marivoStatus: ReportCheckStatus = projection.globalFailure
      ? 'failed'
      : parsed.inspection.skippedMarivoTargets > 0
        ? 'partial'
        : marivoIssues.length > 0 || projection.omittedIssueCount > 0
          ? 'failed'
          : 'passed'
    const marivoCheck = reportCheck('marivo', marivoStatus, marivoIssues, {
      omitted: projection.omittedIssueCount,
      ...(marivoStatus === 'partial'
        ? {
            reason: `${parsed.inspection.skippedMarivoTargets} malformed document target(s) could not be safely sent to Marivo.`,
          }
        : {}),
    })

    const visualPreflight = preflightReportVisuals(
      parsed.inspection.visualCandidates,
      projection.value,
    )
    const skippedVisualTargets =
      parsed.inspection.skippedVisualTargets + visualPreflight.skippedCount
    const visualStatus: ReportCheckStatus = projection.globalFailure
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
            reason: projection.globalFailure
              ? 'Visual checks require a successfully resumed Marivo Session.'
              : `${skippedVisualTargets} visual target(s) depended on invalid document fields or unavailable Artifact projections.`,
          }
        : {}),
    })
    const publishSkipped = reportCheck('publish', 'skipped', [], {
      reason: 'Publishing requires every preflight check to pass.',
    })
    if (
      documentCheck.status !== 'passed' ||
      marivoCheck.status !== 'passed' ||
      visualCheck.status !== 'passed'
    ) {
      return blockedChecks([documentCheck, marivoCheck, visualCheck, publishSkipped])
    }
    if (!parsed.ok || !projection.complete) {
      throw new MarivoEnvironmentError(
        'subprocess-failed',
        'Report preflight passed without a complete document and projection',
      )
    }
    const compiled = compileReportVisuals(parsed.value.document, projection.value)
    if (!compiled.ok) {
      return blockedChecks([
        documentCheck,
        marivoCheck,
        reportCheck('visual', 'failed', compiled.issues),
        publishSkipped,
      ])
    }
    const published = await publishReport(compiled.value, {
      environmentFingerprint: environment.binding.fingerprint,
      marivoVersion: environment.binding.marivoVersion,
      ...(options.reportsRoot === undefined ? {} : { reportsRoot: options.reportsRoot }),
      ...(options.now === undefined ? {} : { now: options.now }),
      signal: exec.signal,
    })
    if (!published.ok) {
      return blockedChecks([
        documentCheck,
        marivoCheck,
        visualCheck,
        reportCheck('publish', 'failed', published.issues),
      ])
    }
    const freshness =
      parsed.value.document.locale === 'zh-CN'
        ? 'Artifact admissible 不等于 datasource fresh。'
        : 'Artifact admissible does not mean datasource fresh.'
    return {
      status: 'ready',
      title: parsed.value.document.title,
      path: published.path,
      report_digest: published.reportDigest,
      document_digest: published.documentDigest,
      artifact_refs: [...parsed.value.artifactRefs],
      finding_ids: [...parsed.value.findingIds],
      disclosures: [...compiled.value.disclosures, freshness],
    }
  }

  const tool = defineTool({
    name: MARIVO_REPORT_RENDER_TOOL_NAME,
    description: [
      'DSH data-analysis plugin Tool that renders a new immutable HTML report from one Marivo analysis Session.',
      'Use this live Tool schema as the exact report input contract; this Tool is not a marivo.help target, so do not call marivo_help for its contract.',
      'Call it only after the user requests or accepts a durable report deliverable, never for ordinary inline analysis.',
    ].join(' '),
    parameters: {
      session_id: {
        type: 'string',
        required: true,
        description:
          'Exact non-empty Marivo analysis Session ID, at most 512 Unicode characters, containing every referenced Artifact and Finding.',
      },
      document: { ...documentSchema, required: true },
    },
    output: {
      schema: outputSchema,
      render: (_args, value) => [
        { type: 'text', text: renderReportToolValue(value as ReportRenderValueV1) },
      ],
      presentationMeta: (_args, value) => reportPresentationMeta(value as ReportRenderValueV1),
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
  environmentSource: MarivoEnvironmentSource,
  options: MarivoReportToolOptions = {},
): () => void {
  return ctx.tools.register(createMarivoReportRenderTool(environmentSource, options))
}
