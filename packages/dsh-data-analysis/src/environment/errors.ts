export type EnvironmentFailureCode =
  | 'project-root-invalid'
  | 'python-path-relative'
  | 'python-unavailable'
  | 'shared-runtime-config-invalid'
  | 'shared-runtime-lock-timeout'
  | 'shared-runtime-install-failed'
  | 'shared-runtime-identity-mismatch'
  | 'shared-runtime-version-unsupported'
  | 'shared-runtime-pandas-unsupported'
  | 'shared-runtime-report-kit-unsupported'
  | 'shared-runtime-report-kit-wheel-invalid'
  | 'shared-runtime-report-kit-wheel-unavailable'
  | 'shared-runtime-package-unavailable'
  | 'shared-runtime-skills-invalid'
  | 'workspace-initialization-failed'
  | 'subprocess-start-failed'
  | 'subprocess-timeout'
  | 'subprocess-cancelled'
  | 'subprocess-output-limit'
  | 'subprocess-output-invalid'
  | 'subprocess-failed'
  | 'datasource-credential-ref-invalid'
  | 'shell-credential-injection-unsupported'
  | 'doctor-json-invalid'
  | 'doctor-admission-failed'
  | 'binding-identity-mismatch'
  | 'binding-failed'

/** Stable failure envelope for config, subprocess, doctor, and identity errors. */
export class MarivoEnvironmentError extends Error {
  readonly code: EnvironmentFailureCode
  readonly details: Readonly<Record<string, unknown>>

  constructor(
    code: EnvironmentFailureCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'MarivoEnvironmentError'
    this.code = code
    this.details = details
  }
}
