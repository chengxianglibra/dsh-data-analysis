import { createRequire } from 'node:module'

export const COMPATIBILITY_SCHEMA = 'dsh-data-analysis-compatibility/v1' as const

export interface DshDataAnalysisCompatibility {
  readonly schema: typeof COMPATIBILITY_SCHEMA
  readonly dsh: {
    readonly distribution: '@deepseek-ai/dsh'
    readonly peerRange: string
  }
  readonly marivo: {
    readonly version: string
    readonly packageSpec: string
  }
  readonly contracts: {
    readonly reportDocument: 'dsh-data-analysis-report/v1'
    readonly computedData: 'dsh-computed-data/v1'
    readonly reportRenderer: 'dsh-data-analysis-html/v1'
    readonly reportDigest: 'dsh-data-analysis-report-digest/v1'
    readonly reportManifest: 'dsh-data-analysis-report-manifest/v1'
    readonly runtimeInstallation: 'dsh-data-analysis-runtime/v1'
    readonly subprocessPolicy: 'direct-argv-inherited-env-snapshot-overlay-v1'
  }
}

interface PackageManifest {
  readonly version: string
  readonly peerDependencies: Readonly<Record<string, string>>
  readonly dshDataAnalysisCompatibility: DshDataAnalysisCompatibility
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(value: unknown, location: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${location} must be a non-empty string`)
  }
  return value
}

function requiredLiteral<T extends string>(value: unknown, expected: T, location: string): T {
  if (value !== expected) throw new TypeError(`${location} must be ${expected}`)
  return expected
}

function stringRecord(value: unknown, location: string): Readonly<Record<string, string>> {
  if (!isRecord(value)) throw new TypeError(`${location} must be an object`)
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, requiredString(item, `${location}.${key}`)]),
    ),
  )
}

function parsePackageManifest(value: unknown): PackageManifest {
  if (!isRecord(value)) throw new TypeError('package.json must contain an object')
  const compatibility = value.dshDataAnalysisCompatibility
  if (!isRecord(compatibility)) {
    throw new TypeError('package.json.dshDataAnalysisCompatibility must be an object')
  }
  const dsh = compatibility.dsh
  const marivo = compatibility.marivo
  const contracts = compatibility.contracts
  if (!isRecord(dsh) || !isRecord(marivo) || !isRecord(contracts)) {
    throw new TypeError('package compatibility dsh, marivo, and contracts must be objects')
  }
  return Object.freeze({
    version: requiredString(value.version, 'package.json.version'),
    peerDependencies: stringRecord(value.peerDependencies, 'package.json.peerDependencies'),
    dshDataAnalysisCompatibility: Object.freeze({
      schema: requiredLiteral(
        compatibility.schema,
        COMPATIBILITY_SCHEMA,
        'package compatibility schema',
      ),
      dsh: Object.freeze({
        distribution: requiredLiteral(
          dsh.distribution,
          '@deepseek-ai/dsh',
          'package compatibility dsh.distribution',
        ),
        peerRange: requiredString(dsh.peerRange, 'package compatibility dsh.peerRange'),
      }),
      marivo: Object.freeze({
        version: requiredString(marivo.version, 'package compatibility marivo.version'),
        packageSpec: requiredString(marivo.packageSpec, 'package compatibility marivo.packageSpec'),
      }),
      contracts: Object.freeze({
        reportDocument: requiredLiteral(
          contracts.reportDocument,
          'dsh-data-analysis-report/v1',
          'package compatibility contracts.reportDocument',
        ),
        computedData: requiredLiteral(
          contracts.computedData,
          'dsh-computed-data/v1',
          'package compatibility contracts.computedData',
        ),
        reportRenderer: requiredLiteral(
          contracts.reportRenderer,
          'dsh-data-analysis-html/v1',
          'package compatibility contracts.reportRenderer',
        ),
        reportDigest: requiredLiteral(
          contracts.reportDigest,
          'dsh-data-analysis-report-digest/v1',
          'package compatibility contracts.reportDigest',
        ),
        reportManifest: requiredLiteral(
          contracts.reportManifest,
          'dsh-data-analysis-report-manifest/v1',
          'package compatibility contracts.reportManifest',
        ),
        runtimeInstallation: requiredLiteral(
          contracts.runtimeInstallation,
          'dsh-data-analysis-runtime/v1',
          'package compatibility contracts.runtimeInstallation',
        ),
        subprocessPolicy: requiredLiteral(
          contracts.subprocessPolicy,
          'direct-argv-inherited-env-snapshot-overlay-v1',
          'package compatibility contracts.subprocessPolicy',
        ),
      }),
    }),
  })
}

const packageManifest = parsePackageManifest(createRequire(import.meta.url)('../package.json'))

/** The package semver and the compatibility contract shipped in this exact installation. */
export const PLUGIN_VERSION = packageManifest.version
export const DSH_DATA_ANALYSIS_COMPATIBILITY = packageManifest.dshDataAnalysisCompatibility

/** Every DSH peer is required and must use this one verified release. */
export const DSH_PEER_RANGE = DSH_DATA_ANALYSIS_COMPATIBILITY.dsh.peerRange
export const DSH_DISTRIBUTION = DSH_DATA_ANALYSIS_COMPATIBILITY.dsh.distribution
export const DSH_PEER_DEPENDENCIES = Object.freeze(
  Object.fromEntries(
    Object.entries(packageManifest.peerDependencies).filter(([name]) =>
      name.startsWith('@deepseek-ai/dsh-'),
    ),
  ),
)

export const MARIVO_VERSION = DSH_DATA_ANALYSIS_COMPATIBILITY.marivo.version
export const MARIVO_PACKAGE_SPEC = DSH_DATA_ANALYSIS_COMPATIBILITY.marivo.packageSpec

export const REPORT_DOCUMENT_VERSION = DSH_DATA_ANALYSIS_COMPATIBILITY.contracts.reportDocument
export const COMPUTED_DATA_VERSION = DSH_DATA_ANALYSIS_COMPATIBILITY.contracts.computedData
export const REPORT_RENDERER_VERSION = DSH_DATA_ANALYSIS_COMPATIBILITY.contracts.reportRenderer
export const REPORT_DIGEST_VERSION = DSH_DATA_ANALYSIS_COMPATIBILITY.contracts.reportDigest
export const REPORT_MANIFEST_VERSION = DSH_DATA_ANALYSIS_COMPATIBILITY.contracts.reportManifest
export const RUNTIME_INSTALLATION_VERSION =
  DSH_DATA_ANALYSIS_COMPATIBILITY.contracts.runtimeInstallation
export const SUBPROCESS_POLICY_VERSION = DSH_DATA_ANALYSIS_COMPATIBILITY.contracts.subprocessPolicy
