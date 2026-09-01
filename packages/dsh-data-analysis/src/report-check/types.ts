export type ReportCheckSeverity = 'error' | 'warning' | 'info'

export interface ReportCheckIssueV1 {
  severity: ReportCheckSeverity
  code: string
  path: string
  line: number | null
  column: number | null
  message: string
  repair: string | null
}

export interface ReportCheckResultV1 {
  schema: 'dsh-data-analysis-report-check/v1'
  status: 'passed_static' | 'failed_static'
  entry_path: string
  bundle_root: string
  checked_at: string
  coverage: {
    static: 'complete' | 'incomplete'
    external: 'none_observed' | 'not_checked'
    browser: 'not_run'
    visual: 'not_run'
    analysis: 'not_checked'
  }
  summary: {
    errors: number
    warnings: number
    infos: number
    files_checked: number
    bytes_checked: number
  }
  issues: ReportCheckIssueV1[]
  omitted_issue_count: number
}

export interface ReportCheckFileStat {
  kind: 'file' | 'directory' | 'other'
  size: number
}

/** Absolute-path, read-only file access injected into the deterministic checker core. */
export interface ReportCheckFileAccess {
  realpath(target: string, signal: AbortSignal): Promise<string>
  stat(target: string, signal: AbortSignal): Promise<ReportCheckFileStat>
  readFile(target: string, signal: AbortSignal): Promise<Uint8Array>
}

export interface ReportCheckLimits {
  maxFiles: number
  maxDepth: number
  maxTextFileBytes: number
  maxTotalTextBytes: number
  maxDataUrlBytes: number
  maxIssues: number
}

export interface ReportCheckOptions {
  /** Canonical absolute Workspace root. */
  workspaceRoot: string
  /** Canonical absolute entry path, already admitted within the Workspace. */
  entryPath: string
  files: ReportCheckFileAccess
  signal: AbortSignal
  now?: () => Date
  limits?: Partial<ReportCheckLimits>
}

export type ReportContractKind = 'dataset' | 'revalidation' | 'trace'

export interface ReportContractValidation {
  valid: boolean
  errors: string[]
  schemaErrors: string[]
  semanticErrors: string[]
}

export class ReportCheckInvocationError extends Error {
  readonly code:
    | 'entry-path-invalid'
    | 'workspace-boundary-invalid'
    | 'io-failed'
    | 'aborted'
    | 'checker-internal'

  constructor(code: ReportCheckInvocationError['code'], message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ReportCheckInvocationError'
    this.code = code
  }
}
