import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ReportCheckIssueV1, ReportCheckResultV1 } from './types.ts'
import { checkWorkspaceReport } from './workspace.ts'

export const DSH_DATA_ANALYSIS_REPORT_CHECK_TOOL_NAME = 'dsh_data_analysis_report_check'

const nullableInteger = {
  oneOf: [{ type: 'integer' }, { type: 'null' }],
} as const

const issueSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    severity: { type: 'string', enum: ['error', 'warning', 'info'], required: true },
    code: { type: 'string', required: true },
    path: { type: 'string', required: true },
    line: { ...nullableInteger, required: true },
    column: { ...nullableInteger, required: true },
    message: { type: 'string', required: true },
    repair: {
      oneOf: [{ type: 'string' }, { type: 'null' }],
      required: true,
    },
  },
} as const

const resultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    schema: { type: 'string', const: 'dsh-data-analysis-report-check/v1', required: true },
    status: { type: 'string', enum: ['passed_static', 'failed_static'], required: true },
    entry_path: { type: 'string', required: true },
    bundle_root: { type: 'string', required: true },
    checked_at: { type: 'string', required: true },
    coverage: {
      type: 'object',
      required: true,
      additionalProperties: false,
      properties: {
        static: { type: 'string', enum: ['complete', 'incomplete'], required: true },
        external: {
          type: 'string',
          enum: ['none_observed', 'not_checked'],
          required: true,
        },
        browser: { type: 'string', const: 'not_run', required: true },
        visual: { type: 'string', const: 'not_run', required: true },
        analysis: { type: 'string', const: 'not_checked', required: true },
      },
    },
    summary: {
      type: 'object',
      required: true,
      additionalProperties: false,
      properties: {
        errors: { type: 'integer', required: true },
        warnings: { type: 'integer', required: true },
        infos: { type: 'integer', required: true },
        files_checked: { type: 'integer', required: true },
        bytes_checked: { type: 'integer', required: true },
      },
    },
    issues: { type: 'array', items: issueSchema, required: true },
    omitted_issue_count: { type: 'integer', required: true },
  },
} as const

function issueLine(issue: ReportCheckIssueV1): string {
  const location =
    issue.line === null ? issue.path : `${issue.path}:${issue.line}:${issue.column ?? 1}`
  return `[${issue.severity}] ${issue.code} ${location} — ${issue.message}`
}

export function renderReportCheckResult(value: ReportCheckResultV1, issueLimit = 20): string {
  const lines = [
    `${value.status}: ${value.entry_path}`,
    `static=${value.coverage.static}; external=${value.coverage.external}; errors=${value.summary.errors}; warnings=${value.summary.warnings}; infos=${value.summary.infos}; files=${value.summary.files_checked}`,
  ]
  lines.push(...value.issues.slice(0, issueLimit).map(issueLine))
  const hidden = Math.max(0, value.issues.length - issueLimit) + value.omitted_issue_count
  if (hidden > 0)
    lines.push(`${hidden} additional issue(s) are not shown in this compact rendering.`)
  lines.push(
    'This result is a static check only; it does not assert browser, visual, analytical, safety, or publication readiness.',
  )
  return lines.join('\n')
}

/** Build the report Checker Tool definition without registering it into any Agent scope. */
export function createDshDataAnalysisReportCheckTool(): ToolDefinition {
  return defineTool({
    name: DSH_DATA_ANALYSIS_REPORT_CHECK_TOOL_NAME,
    description:
      'Read-only static check for one Workspace HTML report bundle. It reports passed_static or failed_static and never claims browser, visual, analytical, safety, or publication readiness.',
    parameters: {
      entry_path: {
        type: 'string',
        required: true,
        description: 'Workspace path to the report index.html entry file.',
      },
    },
    output: {
      schema: resultSchema,
      render: (_args, value) => [
        {
          type: 'text',
          text: renderReportCheckResult(value as unknown as ReportCheckResultV1),
        },
      ],
    },
    timeoutMs: 30_000,
    isConcurrencySafe: () => true,
    async execute(args, exec): Promise<ReportCheckResultV1> {
      if (exec.agent === undefined) {
        throw new TypeError('dsh_data_analysis_report_check requires an Agent Workspace')
      }
      if (typeof args.entry_path !== 'string') {
        throw new TypeError('dsh_data_analysis_report_check entry_path must be a string')
      }
      const workspaceRoot = exec.agent.session.header.cwd
      if (workspaceRoot === undefined || workspaceRoot === '') {
        throw new TypeError('dsh_data_analysis_report_check requires a session Workspace cwd')
      }
      return checkWorkspaceReport({
        workspaceRoot,
        entryPath: args.entry_path,
        signal: exec.signal,
      })
    },
  })
}
