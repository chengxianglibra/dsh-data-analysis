import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { defineTool, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { MarivoEnvironmentError } from '../environment/errors.ts'
import {
  resolveMarivoEnvironmentSource,
  type MarivoEnvironmentSource,
} from '../disclosure/help.ts'
import {
  parseReportDocument,
  type ReportBlockedValueV1,
  type ReportDocumentV1,
  type ReportIssueV1,
  type ReportRenderValueV1,
} from './document.ts'
import { parseReportProjection } from './projection.ts'
import { publishReport } from './publish.ts'
import { compileReportVisuals } from './visual.ts'

export const MARIVO_REPORT_RENDER_TOOL_NAME = 'marivo_report_render'
export const REPORT_PRESENTATION_META_KIND = 'marivo-html-report'
export const REPORT_PRESENTATION_META_VERSION = 1
export const REPORT_DURABLE_CONTENT_KIND = 'marivo-report-card'

const REPORT_DOCUMENT_MINIMAL_JSON = '{"version":"dsh-data-analysis-report/v1","title":"Report title","locale":"zh-CN","sections":[{"id":"summary","title":"Summary","blocks":[{"kind":"text","id":"summary-text","text":"Report summary"}]}]}'

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

const findingIdsSchema = {
  type: 'array',
  items: { type: 'string' },
  description: [
    'One to 20 unique exact persisted Finding IDs shown as adjacent sources for this block.',
    'Every Finding attached to one block must be mechanically compatible; call session.evidence.compatibility before combining multiple IDs.',
  ].join(' '),
} as const

const textBlockSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    kind: { type: 'string', const: 'text', required: true },
    id: {
      type: 'string', required: true,
      description: 'Document-wide unique lowercase ASCII kebab-case block ID.',
    },
    text: {
      type: 'string', required: true,
      description: 'Non-empty plain text of at most 20,000 Unicode characters. Markdown and HTML are escaped as literal text; newlines start paragraphs.',
    },
    finding_ids: findingIdsSchema,
  },
} as const

const chartBlockSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    kind: { type: 'string', const: 'chart', required: true },
    id: {
      type: 'string', required: true,
      description: 'Document-wide unique lowercase ASCII kebab-case block ID.',
    },
    title: { type: 'string', required: true },
    subtitle: { type: 'string' },
    artifact_ref: {
      type: 'string', required: true,
      description: 'Exact canonical ref of an admissible Artifact in session_id; the Artifact must expose projected rows and a public artifact_schema.',
    },
    view: {
      type: 'string', enum: ['auto', 'line', 'bar'], required: true,
      description: 'Use auto only when one unambiguous mapping exists and omit x/y. For line or bar, provide both x and y explicitly.',
    },
    x: {
      type: 'string',
      description: 'Exact public Artifact column name. Line requires a time or ordered numeric dimension with at least four unique points; bar requires a categorical dimension with at most 30 categories.',
    },
    y: {
      type: 'string',
      description: 'Exact public numeric Artifact column name. The renderer does not aggregate, sample, apply Top-N, or combine additional grain.',
    },
    finding_ids: findingIdsSchema,
  },
} as const

const tableBlockSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    kind: { type: 'string', const: 'table', required: true },
    id: {
      type: 'string', required: true,
      description: 'Document-wide unique lowercase ASCII kebab-case block ID.',
    },
    title: { type: 'string', required: true },
    artifact_ref: {
      type: 'string', required: true,
      description: 'Exact canonical ref of an admissible Artifact in session_id; the Artifact must expose projected rows and a public artifact_schema.',
    },
    columns: {
      type: 'array', items: { type: 'string' },
      description: 'Optional list of one to 100 unique exact public Artifact column names. Omit it to use all public columns in contract order.',
    },
    max_rows: {
      type: 'integer', required: true,
      description: 'Maximum displayed rows, from 1 to 100. The report discloses total and omitted rows.',
    },
    finding_ids: findingIdsSchema,
  },
} as const

const evidenceBlockSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    kind: { type: 'string', const: 'evidence', required: true },
    id: {
      type: 'string', required: true,
      description: 'Document-wide unique lowercase ASCII kebab-case block ID.',
    },
    title: { type: 'string', required: true },
    finding_ids: { ...findingIdsSchema, required: true },
  },
} as const

const documentSchema = {
  type: 'object', additionalProperties: false,
  description: [
    'One complete immutable ReportDocument v1. Revisions submit another complete document.',
    `Minimal valid JSON: ${REPORT_DOCUMENT_MINIMAL_JSON}.`,
    'document.blocks is invalid; blocks must be nested under document.sections[].blocks.',
    'Provide 1-20 sections with 1-20 blocks each and at most 100 blocks total; reference at most 20 unique Artifacts and 20 unique Findings.',
  ].join(' '),
  properties: {
    version: { type: 'string', const: 'dsh-data-analysis-report/v1', required: true },
    title: {
      type: 'string', required: true,
      description: 'Non-empty report title of at most 200 Unicode characters.',
    },
    subtitle: {
      type: 'string',
      description: 'Optional non-empty report subtitle of at most 200 Unicode characters.',
    },
    locale: { type: 'string', enum: ['zh-CN', 'en-US'], required: true },
    sections: {
      type: 'array', required: true,
      description: 'One to 20 ordered non-empty sections.',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          id: {
            type: 'string', required: true,
            description: 'Unique lowercase ASCII kebab-case section ID.',
          },
          title: { type: 'string', required: true },
          blocks: {
            type: 'array', required: true,
            description: 'One to 20 ordered blocks nested under this section.',
            items: { oneOf: [textBlockSchema, chartBlockSchema, tableBlockSchema, evidenceBlockSchema] },
          },
        },
      },
    },
  },
} as const

const issueSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    code: { type: 'string', required: true },
    location: { type: 'string', required: true },
    message: { type: 'string', required: true },
    repair: { type: 'string', required: true },
  },
} as const

const outputSchema = {
  oneOf: [
    {
      type: 'object', additionalProperties: false,
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
      type: 'object', additionalProperties: false,
      properties: {
        status: { type: 'string', const: 'blocked', required: true },
        stage: { type: 'string', enum: ['document', 'marivo', 'visual', 'publish'], required: true },
        issues: { type: 'array', items: issueSchema, required: true },
      },
    },
  ],
} as const

function blockedDocument(message: string, repair: string): ReportBlockedValueV1 {
  return {
    status: 'blocked', stage: 'document', issues: [{
      code: 'invalid-session-id', location: 'session_id', message, repair,
    }],
  }
}

function findingGroupLocations(document: ReportDocumentV1): string[] {
  const locations: string[] = []
  for (const [sectionIndex, section] of document.sections.entries()) {
    for (const [blockIndex, block] of section.blocks.entries()) {
      if (block.finding_ids !== undefined) {
        locations.push(`document.sections[${sectionIndex}].blocks[${blockIndex}].finding_ids`)
      }
    }
  }
  return locations
}

function recoverableReportArguments(value: unknown): value is {
  readonly session_id: string
  readonly document: unknown
} {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && typeof (value as Record<string, unknown>).session_id === 'string'
    && Object.hasOwn(value, 'document')
}

function attributeFindingGroupIssues(
  issues: readonly ReportIssueV1[],
  locations: readonly string[],
): ReportIssueV1[] {
  return issues.map((item) => {
    if (item.code !== 'evidence-not-compatible') return { ...item }
    const match = /^finding_groups\[(\d+)\]$/.exec(item.location)
    if (match === null) return { ...item }
    const location = locations[Number(match[1])]
    return location === undefined ? { ...item } : { ...item, location }
  })
}

export function renderReportToolValue(value: ReportRenderValueV1): string {
  if (value.status === 'blocked') {
    return [
      `HTML report rendering is blocked at stage ${value.stage}.`,
      ...value.issues.map(item => `${item.location} [${item.code}]: ${item.message} Repair: ${item.repair}`),
      'Retry: repair the specified paths, preserve unaffected content, and resubmit one complete ReportDocument v1. Never submit document.blocks alone.',
      `Minimal valid document: ${REPORT_DOCUMENT_MINIMAL_JSON}`,
    ].join('\n')
  }
  return [
    `HTML report ready: ${value.title}`,
    `Path: ${value.path}`,
    `Report digest: ${value.report_digest}`,
    `Document digest: ${value.document_digest}`,
    ...value.disclosures.map(item => `Disclosure: ${item}`),
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
  return Number.isSafeInteger(turn) && (turn as number) >= 0 ? turn as number : null
}

/**
 * Preserve the ready card projection on Code Mode's durable sub-dispatch event.
 * Harness intentionally omits presentationMeta for nested calls; this custom
 * block changes only the logged copy and never the program value or model text.
 */
export function installMarivoReportCodeDelivery(ctx: Context): () => void {
  const pending = new Map<string, ReportPresentationMetaV1>()
  const stopResult = ctx.on('tools/result', (exec, result) => {
    if (
      exec.name !== MARIVO_REPORT_RENDER_TOOL_NAME
      || exec.parent === undefined
      || result.isError
    ) return
    const meta = reportPresentationMeta(result.value as unknown as ReportRenderValueV1)
    if (meta !== null) pending.set(String(exec.callId), meta)
  })
  const stopDispatchLog = ctx.on('tools/code-dispatch-log', async (dispatch, next) => {
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
  }, { prepend: true })
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
    args: { readonly session_id: string; readonly document: unknown },
    exec: ToolRunContext,
  ): Promise<ReportRenderValueV1> => {
    exec.signal.throwIfAborted()
    if (args.session_id.trim().length === 0 || [...args.session_id].length > 512) {
      return blockedDocument('session_id must be non-empty and at most 512 Unicode characters.', 'Use the exact bounded Marivo Session ID and retry the complete document.')
    }
    const parsed = parseReportDocument(args.document)
    if (!parsed.ok) return { status: 'blocked', stage: 'document', issues: [...parsed.issues] }
    const environment = await resolveMarivoEnvironmentSource(environmentSource)
    exec.signal.throwIfAborted()
    const child = await environment.runCheckedReportProjection(
      args.session_id,
      parsed.value.artifactRefs,
      parsed.value.findingGroups,
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
    let projection
    try {
      projection = parseReportProjection(child.stdout, {
        sessionId: args.session_id,
        artifactRefs: parsed.value.artifactRefs,
        findingIds: parsed.value.findingIds,
        findingGroups: parsed.value.findingGroups,
      })
    } catch (cause) {
      throw new MarivoEnvironmentError(
        'subprocess-failed',
        'Marivo report projection returned an invalid payload',
        { stdoutBytes: child.stdout.byteLength },
        { cause },
      )
    }
    if (!projection.ok) {
      return {
        status: 'blocked', stage: 'marivo',
        issues: attributeFindingGroupIssues(
          projection.issues,
          findingGroupLocations(parsed.value.document),
        ),
      }
    }
    const compiled = compileReportVisuals(parsed.value.document, projection.value)
    if (!compiled.ok) return { status: 'blocked', stage: 'visual', issues: [...compiled.issues] }
    const published = await publishReport(compiled.value, {
      environmentFingerprint: environment.binding.fingerprint,
      marivoVersion: environment.binding.marivoVersion,
      ...(options.reportsRoot === undefined ? {} : { reportsRoot: options.reportsRoot }),
      ...(options.now === undefined ? {} : { now: options.now }),
      signal: exec.signal,
    })
    if (!published.ok) return published.value
    const freshness = parsed.value.document.locale === 'zh-CN'
      ? 'Artifact admissible 不等于 datasource fresh。'
      : 'Artifact admissible does not mean datasource fresh.'
    return {
      status: 'ready', title: parsed.value.document.title, path: published.path,
      report_digest: published.reportDigest, document_digest: published.documentDigest,
      artifact_refs: [...parsed.value.artifactRefs], finding_ids: [...parsed.value.findingIds],
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
        type: 'string', required: true,
        description: 'Exact non-empty Marivo analysis Session ID, at most 512 Unicode characters, containing every referenced Artifact and Finding.',
      },
      document: { ...documentSchema, required: true },
    },
    output: {
      schema: outputSchema,
      render: (_args, value) => [{ type: 'text', text: renderReportToolValue(value as ReportRenderValueV1) }],
      presentationMeta: (_args, value) => reportPresentationMeta(value as ReportRenderValueV1),
    },
    timeoutMs: 135_000,
    execute: executeReport,
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
