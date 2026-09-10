/** Configuration accepted by the MVP environment resolver. */
export interface MarivoEnvironmentConfig {
  projectRoot: string
  pythonExecutable?: string
}

/** Configuration for the one DSH-home-owned Marivo runtime shared by every Workspace. */
export interface SharedMarivoRuntimeConfig {
  runtimeRoot?: string
  pythonExecutable?: string
  /** Absolute local Python for venv creation; defaults to python3 (Windows: python). */
  bootstrapPythonExecutable?: string
  installTimeoutMs?: number
}

/** Validated identity and stable skill root of the shared Marivo installation. */
export interface SharedMarivoRuntime {
  runtimeRoot: string
  pythonExecutable: string
  marivoVersion: string
  packagePath: string
  presentationKitVersion: string
  presentationKitPackagePath: string
  skillsRoot: string
  installationPath: string
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
  /** Present only for bindings admitted through the shared presentation Runtime. */
  presentationKit?: Readonly<{ version: string; packagePath: string }>
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
  /** Host-only pipe input. Never part of argv or the environment. */
  stdin?: string

  executable: string
  args: readonly string[]
  /** Per-call environment values layered over the frozen binding snapshot. */
  environmentOverlay?: Readonly<NodeJS.ProcessEnv>
  limits?: Partial<SubprocessLimits>
  signal?: AbortSignal
}

/** One identity-checked Python operation executed by a bound Environment. */
export interface MarivoCheckedRunRequest {
  /** Host-only pipe input; callers own its short operation lifetime. */
  stdin?: string
  /** Values to redact from captured output, never passed through the environment. */
  secretValues?: readonly string[]

  program: string
  args?: readonly string[]
  /** Per-operation values; every non-empty value is redacted from captured output. */
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

/** Narrow execution contract consumed by domain bridge adapters. */
export interface MarivoCheckedRunner {
  readonly binding: Readonly<MarivoEnvironmentBinding>
  readonly status: 'ready' | 'failed'
  runChecked(request: MarivoCheckedRunRequest): Promise<SubprocessResult>
}
