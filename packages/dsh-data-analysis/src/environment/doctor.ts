import path from 'node:path'
import { MarivoEnvironmentError } from './errors.ts'
import type {
  DoctorCheck,
  DoctorOverallStatus,
  DoctorReport,
  DoctorSection,
  DoctorStatus,
} from './types.ts'

const DOCTOR_STATUSES = new Set<DoctorStatus>(['ok', 'info', 'warning', 'fail', 'skipped'])
const OVERALL_STATUSES = new Set<DoctorOverallStatus>(['ok', 'warning', 'fail'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${key} must be a non-empty string`)
  }
  return value
}

function parseCheck(value: unknown): DoctorCheck {
  if (!isRecord(value)) throw new TypeError('doctor check must be an object')
  const status = requireString(value, 'status') as DoctorStatus
  if (!DOCTOR_STATUSES.has(status))
    throw new TypeError(`unsupported doctor check status: ${status}`)
  const details = value.details
  if (details !== undefined && !isRecord(details))
    throw new TypeError('doctor check details must be an object')
  return {
    id: requireString(value, 'id'),
    status,
    summary: requireString(value, 'summary'),
    ...(details === undefined ? {} : { details }),
  }
}

function parseSection(value: unknown): DoctorSection {
  if (!isRecord(value)) throw new TypeError('doctor section must be an object')
  const status = requireString(value, 'status') as DoctorStatus
  if (!DOCTOR_STATUSES.has(status))
    throw new TypeError(`unsupported doctor section status: ${status}`)
  if (!Array.isArray(value.checks)) throw new TypeError('doctor section checks must be an array')
  return {
    id: requireString(value, 'id'),
    status,
    checks: value.checks.map(parseCheck),
  }
}

/** Parse the complete doctor stdout. Non-zero process exit is deliberately handled elsewhere. */
export function parseDoctorReport(stdout: Buffer): DoctorReport {
  let value: unknown
  try {
    value = JSON.parse(stdout.toString('utf8'))
  } catch (cause) {
    throw new MarivoEnvironmentError(
      'doctor-json-invalid',
      'marivo doctor did not return valid JSON',
      { stdoutBytes: stdout.byteLength },
      { cause },
    )
  }

  try {
    if (!isRecord(value)) throw new TypeError('doctor report must be an object')
    const status = requireString(value, 'status') as DoctorOverallStatus
    if (!OVERALL_STATUSES.has(status)) throw new TypeError(`unsupported doctor status: ${status}`)
    const marivo = value.marivo
    if (!isRecord(marivo)) throw new TypeError('marivo must be an object')
    if (!Array.isArray(value.sections)) throw new TypeError('sections must be an array')
    return {
      status,
      project_root: requireString(value, 'project_root'),
      python_executable: requireString(value, 'python_executable'),
      marivo: {
        version: requireString(marivo, 'version'),
        package_path: requireString(marivo, 'package_path'),
      },
      sections: value.sections.map(parseSection),
    }
  } catch (cause) {
    throw new MarivoEnvironmentError(
      'doctor-json-invalid',
      `marivo doctor JSON has an invalid shape: ${(cause as Error).message}`,
      {},
      { cause },
    )
  }
}

function normalizeAbsolute(value: string): string {
  return path.normalize(path.resolve(value))
}

function findCheck(report: DoctorReport, id: string): DoctorCheck | undefined {
  for (const section of report.sections) {
    const match = section.checks.find((check) => check.id === id)
    if (match !== undefined) return match
  }
  return undefined
}

function admissionFailure(check: string, reason: string): never {
  throw new MarivoEnvironmentError(
    'doctor-admission-failed',
    `Marivo disclosure admission failed at ${check}: ${reason}`,
    { check, reason },
  )
}

/**
 * Validate disclosure-specific admission checks without treating the top-level doctor status as
 * an admission decision.
 */
export function admitDoctorReport(
  report: DoctorReport,
  expectedProjectRoot: string,
  expectedPythonExecutable: string,
): void {
  if (normalizeAbsolute(report.project_root) !== normalizeAbsolute(expectedProjectRoot)) {
    admissionFailure('project_root', `reported ${report.project_root}`)
  }
  if (normalizeAbsolute(report.python_executable) !== normalizeAbsolute(expectedPythonExecutable)) {
    admissionFailure('python_executable', `reported ${report.python_executable}`)
  }
  if (report.marivo.version.length === 0) admissionFailure('marivo.version', 'missing')
  if (!path.isAbsolute(report.marivo.package_path)) {
    admissionFailure('marivo.package_path', 'must be absolute')
  }

  for (const id of ['installation.python', 'installation.marivo']) {
    const check = findCheck(report, id)
    if (check === undefined) admissionFailure(id, 'check is missing')
    if (check.status !== 'ok') admissionFailure(id, `status is ${check.status}`)
  }
  const manifest = findCheck(report, 'project.marivo_toml')
  if (manifest === undefined) admissionFailure('project.marivo_toml', 'check is missing')
  if (manifest.status !== 'ok' && manifest.status !== 'info') {
    admissionFailure('project.marivo_toml', `status is ${manifest.status}`)
  }
}
