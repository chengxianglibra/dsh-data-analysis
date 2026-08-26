/** Configuration accepted by the MVP environment resolver. */
export interface MarivoEnvironmentConfig {
  projectRoot: string
  pythonExecutable?: string
}

/** Configuration for the one DSH-home-owned Marivo runtime shared by every Workspace. */
export interface SharedMarivoRuntimeConfig {
  runtimeRoot?: string
  pythonExecutable?: string
  uvExecutable?: string
  installTimeoutMs?: number
}

/** Validated identity and stable skill root of the shared Marivo installation. */
export interface SharedMarivoRuntime {
  runtimeRoot: string
  pythonExecutable: string
  marivoVersion: string
  packagePath: string
  skillsRoot: string
  installationPath: string
}

/** Result of idempotently preparing one Workspace for Marivo. */
export interface MarivoWorkspaceLayout {
  projectRoot: string
  manifestPath: string
  modelsPath: string
  statePath: string
  created: readonly string[]
}

export type DoctorStatus = 'ok' | 'info' | 'warning' | 'fail' | 'skipped'
export type DoctorOverallStatus = 'ok' | 'warning' | 'fail'

export interface DoctorCheck {
  id: string
  status: DoctorStatus
  summary: string
  details?: Record<string, unknown>
}

export interface DoctorSection {
  id: string
  status: DoctorStatus
  checks: DoctorCheck[]
}

export interface DoctorReport {
  status: DoctorOverallStatus
  project_root: string
  python_executable: string
  marivo: {
    version: string
    package_path: string
  }
  sections: DoctorSection[]
}

/** Stable, non-secret identity retained by a successful binding. */
export interface MarivoEnvironmentBinding {
  projectRoot: string
  pythonExecutable: string
  marivoVersion: string
  packagePath: string
  subprocessPolicyId: string
  fingerprint: string
}

export interface SubprocessLimits {
  timeoutMs: number
  stdoutMaxBytes: number
  stderrMaxBytes: number
  terminateGraceMs: number
}

export interface SubprocessRequest {
  executable: string
  args: readonly string[]
  /** Per-call environment values layered over the frozen binding snapshot. */
  environmentOverlay?: Readonly<NodeJS.ProcessEnv>
  limits?: Partial<SubprocessLimits>
  signal?: AbortSignal
}

export interface SubprocessResult {
  exitCode: number | null
  signal: NodeJS.Signals | null
  stdout: Buffer
  stderr: Buffer
  durationMs: number
}

export interface ImportIdentity {
  pythonExecutable: string
  marivoVersion: string
  packagePath: string
}
