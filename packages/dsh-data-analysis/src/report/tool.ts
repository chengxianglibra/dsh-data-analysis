import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { MarivoEnvironmentError } from '../environment/errors.ts'
import {
  resolveMarivoEnvironmentSource,
  type MarivoEnvironmentSource,
} from '../disclosure/help.ts'
import {
  parseReportDocument,
  type ReportBlockedValueV1,
  type ReportRenderValueV1,
} from './document.ts'
import { parseReportProjection } from './projection.ts'
import { publishReport } from './publish.ts'
import { compileReportVisuals } from './visual.ts'

export const MARIVO_REPORT_RENDER_TOOL_NAME = 'marivo_report_render'

const REPORT_LIMITS = Object.freeze({
  timeoutMs: 120_000,
  stdoutMaxBytes: 16 * 1024 * 1024 + 65_536,
  stderrMaxBytes: 65_536,
})

const findingIdsSchema = {
  type: 'array',
  items: { type: 'string' },
  description: 'Exact persisted Finding IDs shown as adjacent sources for this block.',
} as const

const textBlockSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    kind: { type: 'string', const: 'text', required: true },
    id: { type: 'string', required: true },
    text: { type: 'string', required: true },
    finding_ids: findingIdsSchema,
  },
} as const

const chartBlockSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    kind: { type: 'string', const: 'chart', required: true },
    id: { type: 'string', required: true },
    title: { type: 'string', required: true },
    subtitle: { type: 'string' },
    artifact_ref: { type: 'string', required: true },
    view: { type: 'string', enum: ['auto', 'line', 'bar'], required: true },
    x: { type: 'string' },
    y: { type: 'string' },
    finding_ids: findingIdsSchema,
  },
} as const

const tableBlockSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    kind: { type: 'string', const: 'table', required: true },
    id: { type: 'string', required: true },
    title: { type: 'string', required: true },
    artifact_ref: { type: 'string', required: true },
    columns: { type: 'array', items: { type: 'string' } },
    max_rows: { type: 'integer', required: true },
    finding_ids: findingIdsSchema,
  },
} as const

const evidenceBlockSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    kind: { type: 'string', const: 'evidence', required: true },
    id: { type: 'string', required: true },
    title: { type: 'string', required: true },
    finding_ids: { ...findingIdsSchema, required: true },
  },
} as const

const documentSchema = {
  type: 'object', additionalProperties: false,
  description: 'One complete immutable ReportDocument v1. Revisions submit another complete document.',
  properties: {
    version: { type: 'string', const: 'dsh-data-analysis-report/v1', required: true },
    title: { type: 'string', required: true },
    subtitle: { type: 'string' },
    locale: { type: 'string', enum: ['zh-CN', 'en-US'], required: true },
    sections: {
      type: 'array', required: true,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          title: { type: 'string', required: true },
          blocks: {
            type: 'array', required: true,
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

export function renderReportToolValue(value: ReportRenderValueV1): string {
  if (value.status === 'blocked') {
    return [
      `HTML report rendering is blocked at stage ${value.stage}.`,
      ...value.issues.map(item => `${item.location} [${item.code}]: ${item.message} Repair: ${item.repair}`),
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

export interface MarivoReportToolOptions {
  readonly reportsRoot?: string
  readonly now?: () => Date
}

/** Build the server-only immutable HTML report Tool. */
export function createMarivoReportRenderTool(
  environmentSource: MarivoEnvironmentSource,
  options: MarivoReportToolOptions = {},
): ToolDefinition {
  return defineTool({
    name: MARIVO_REPORT_RENDER_TOOL_NAME,
    description: 'Render a new immutable HTML report after the user has requested or accepted a durable report deliverable. Do not use for ordinary inline analysis.',
    parameters: {
      session_id: {
        type: 'string', required: true,
        description: 'Exact Marivo analysis Session ID containing every referenced Artifact and Finding.',
      },
      document: { ...documentSchema, required: true },
    },
    output: {
      schema: outputSchema,
      render: (_args, value) => [{ type: 'text', text: renderReportToolValue(value as ReportRenderValueV1) }],
    },
    timeoutMs: 135_000,
    async execute(args, exec): Promise<ReportRenderValueV1> {
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
      if (!projection.ok) return { status: 'blocked', stage: 'marivo', issues: [...projection.issues] }
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
    },
  })
}

export function registerMarivoReportRenderTool(
  ctx: Context,
  environmentSource: MarivoEnvironmentSource,
  options: MarivoReportToolOptions = {},
): () => void {
  return ctx.tools.register(createMarivoReportRenderTool(environmentSource, options))
}
