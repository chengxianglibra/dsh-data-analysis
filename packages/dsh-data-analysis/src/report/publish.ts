import { createHash } from 'node:crypto'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { ReportDocumentV2, ReportIssueV2 } from './document.ts'
import { REPORT_RENDERER_VERSION, renderReportHtml } from './render.ts'
import type { CompiledReport } from './visual.ts'

export const REPORT_DIGEST_VERSION = 'dsh-data-analysis-report-digest/v4' as const
export const REPORT_MANIFEST_VERSION = 'dsh-data-analysis-report-manifest/v4' as const
export const MAX_REPORT_HTML_BYTES = 10 * 1024 * 1024

interface ReportManifestV4 {
  readonly version: typeof REPORT_MANIFEST_VERSION
  readonly renderer_version: typeof REPORT_RENDERER_VERSION
  readonly report_digest: string
  readonly document_digest: string
  readonly provenance_digest: string
  readonly environment_fingerprint: string
  readonly marivo_version: string
  readonly generated_at: string
  readonly artifacts: readonly { readonly ref: string; readonly content_hash: string }[]
  readonly files: {
    readonly index_html: { readonly sha256: string; readonly bytes: number }
    readonly report_document_json: { readonly sha256: string; readonly bytes: number }
  }
}

export interface PublishReportOptions {
  readonly environmentFingerprint: string
  readonly marivoVersion: string
  readonly reportsRoot?: string
  readonly now?: () => Date
  readonly signal?: AbortSignal
}

export type PublishReportResult =
  | {
      readonly ok: true
      readonly path: string
      readonly reportDigest: string
      readonly documentDigest: string
      readonly generatedAt: string
      readonly reused: boolean
    }
  | { readonly ok: false; readonly issues: readonly ReportIssueV2[] }

function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalValue(value: unknown, location: string): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${location} contains a non-finite number`)
    return JSON.stringify(Object.is(value, -0) ? 0 : value)
  }
  if (Array.isArray(value))
    return `[${value.map((item, index) => canonicalValue(item, `${location}[${index}]`)).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const source = value as Record<string, unknown>
    const entries = Object.keys(source)
      .sort()
      .map((key) => {
        const item = source[key]
        if (item === undefined) throw new TypeError(`${location}.${key} is undefined`)
        return `${JSON.stringify(key)}:${canonicalValue(item, `${location}.${key}`)}`
      })
    return `{${entries.join(',')}}`
  }
  throw new TypeError(`${location} is not lossless JSON`)
}

/** Stable recursive-key canonical JSON used by both document and report identities. */
export function canonicalJson(value: JsonValue | unknown): string {
  return canonicalValue(value, '$')
}

function digestInputs(
  report: CompiledReport,
  options: PublishReportOptions,
): {
  documentText: string
  documentDigest: string
  provenanceDigest: string
  reportDigest: string
} {
  const documentText = `${canonicalJson(report.document)}\n`
  const documentDigest = hash(documentText.trimEnd())
  const provenanceDigest = hash(canonicalJson(report.projection))
  const identity = {
    version: REPORT_DIGEST_VERSION,
    renderer_version: REPORT_RENDERER_VERSION,
    document: report.document,
    environment_fingerprint: options.environmentFingerprint,
    marivo_version: options.marivoVersion,
    provenance_digest: provenanceDigest,
  }
  return {
    documentText,
    documentDigest,
    provenanceDigest,
    reportDigest: hash(canonicalJson(identity)),
  }
}

export function reportDocumentDigest(document: ReportDocumentV2): string {
  return hash(canonicalJson(document))
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted()
}

async function secureDirectory(directory: string, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  throwIfAborted(signal)
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error(`Report path is not a trusted directory: ${directory}`)
  if (process.platform !== 'win32') await chmod(directory, 0o700)
  throwIfAborted(signal)
}

function parseManifest(raw: Buffer): ReportManifestV4 {
  let value: unknown
  try {
    value = JSON.parse(raw.toString('utf8'))
  } catch (cause) {
    throw new Error('Existing report manifest is invalid JSON', { cause })
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Existing report manifest is not an object')
  return value as ReportManifestV4
}

async function validateExisting(
  directory: string,
  expected: {
    readonly report: CompiledReport
    readonly reportDigest: string
    readonly documentDigest: string
    readonly provenanceDigest: string
    readonly documentText: string
    readonly environmentFingerprint: string
    readonly marivoVersion: string
    readonly artifacts: readonly { readonly ref: string; readonly content_hash: string }[]
  },
  signal?: AbortSignal,
): Promise<ReportManifestV4> {
  throwIfAborted(signal)
  const directoryInfo = await lstat(directory)
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink())
    throw new Error('Existing report digest path is not a trusted directory')
  if (process.platform !== 'win32' && (directoryInfo.mode & 0o077) !== 0)
    throw new Error('Existing report digest directory has unsafe permissions')
  const [html, document, manifestRaw] = await Promise.all([
    readFile(path.join(directory, 'index.html'), { signal }),
    readFile(path.join(directory, 'report-document.json'), { signal }),
    readFile(path.join(directory, 'manifest.json'), { signal }),
  ])
  throwIfAborted(signal)
  const manifest = parseManifest(manifestRaw)
  const expectedKeys = [
    'version',
    'renderer_version',
    'report_digest',
    'document_digest',
    'provenance_digest',
    'environment_fingerprint',
    'marivo_version',
    'generated_at',
    'artifacts',
    'files',
  ]
    .sort()
    .join(',')
  if (
    Object.keys(manifest as unknown as Record<string, unknown>)
      .sort()
      .join(',') !== expectedKeys
  )
    throw new Error('Existing report manifest has an unexpected shape')
  if (
    typeof manifest.files !== 'object' ||
    manifest.files === null ||
    Object.keys(manifest.files).sort().join(',') !== 'index_html,report_document_json' ||
    Object.keys(manifest.files.index_html ?? {})
      .sort()
      .join(',') !== 'bytes,sha256' ||
    Object.keys(manifest.files.report_document_json ?? {})
      .sort()
      .join(',') !== 'bytes,sha256'
  )
    throw new Error('Existing report manifest file inventory has an unexpected shape')
  if (
    manifest.version !== REPORT_MANIFEST_VERSION ||
    manifest.renderer_version !== REPORT_RENDERER_VERSION ||
    manifest.report_digest !== expected.reportDigest ||
    manifest.document_digest !== expected.documentDigest ||
    manifest.provenance_digest !== expected.provenanceDigest ||
    manifest.environment_fingerprint !== expected.environmentFingerprint ||
    manifest.marivo_version !== expected.marivoVersion ||
    typeof manifest.generated_at !== 'string' ||
    !Number.isFinite(Date.parse(manifest.generated_at)) ||
    canonicalJson(manifest.artifacts) !== canonicalJson(expected.artifacts) ||
    document.toString('utf8') !== expected.documentText ||
    html.toString('utf8') !== renderReportHtml(expected.report, manifest.generated_at) ||
    manifest.files?.index_html?.sha256 !== hash(html) ||
    manifest.files.index_html.bytes !== html.byteLength ||
    manifest.files?.report_document_json?.sha256 !== hash(document) ||
    manifest.files.report_document_json.bytes !== document.byteLength
  )
    throw new Error('Existing immutable report does not match its expected manifest')
  for (const filename of ['index.html', 'report-document.json', 'manifest.json']) {
    throwIfAborted(signal)
    const info = await stat(path.join(directory, filename))
    if (!info.isFile()) throw new Error(`Existing report member is not a file: ${filename}`)
    if (process.platform !== 'win32' && (info.mode & 0o077) !== 0)
      throw new Error(`Existing report member has unsafe permissions: ${filename}`)
  }
  throwIfAborted(signal)
  return manifest
}

function publishBlocked(message: string): PublishReportResult {
  return {
    ok: false,
    issues: [
      {
        code: 'html-too-large',
        location: 'index.html',
        message,
        repair: 'Reduce report text, rows, or blocks and submit the complete document again.',
      },
    ],
  }
}

/** Atomically publish or validate/reuse one immutable report directory. */
export async function publishReport(
  report: CompiledReport,
  options: PublishReportOptions,
): Promise<PublishReportResult> {
  throwIfAborted(options.signal)
  if (!/^[a-f0-9]{64}$/.test(options.environmentFingerprint))
    throw new TypeError('environment fingerprint must be a SHA-256 hex digest')
  if (options.marivoVersion.length === 0) throw new TypeError('Marivo version must be non-empty')
  const inputs = digestInputs(report, options)
  const reportsRoot = path.resolve(
    options.reportsRoot ?? path.join(resolveDshHome(), 'dsh-data-analysis', 'reports'),
  )
  const environmentDirectory = path.join(reportsRoot, options.environmentFingerprint)
  const reportDirectory = path.join(environmentDirectory, inputs.reportDigest)
  await secureDirectory(reportsRoot, options.signal)
  await secureDirectory(environmentDirectory, options.signal)
  try {
    const manifest = await validateExisting(
      reportDirectory,
      {
        report,
        ...inputs,
        environmentFingerprint: options.environmentFingerprint,
        marivoVersion: options.marivoVersion,
        artifacts: report.projection.artifacts.map((item) => ({
          ref: item.ref,
          content_hash: item.contentHash,
        })),
      },
      options.signal,
    )
    return {
      ok: true,
      path: path.join(reportDirectory, 'index.html'),
      reportDigest: inputs.reportDigest,
      documentDigest: inputs.documentDigest,
      generatedAt: manifest.generated_at,
      reused: true,
    }
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') throw cause
  }

  throwIfAborted(options.signal)
  const generatedAt = (options.now?.() ?? new Date()).toISOString()
  const html = renderReportHtml(report, generatedAt)
  const htmlBytes = Buffer.byteLength(html)
  if (htmlBytes > MAX_REPORT_HTML_BYTES)
    return publishBlocked(
      `Generated index.html is ${htmlBytes} bytes; the maximum is ${MAX_REPORT_HTML_BYTES}.`,
    )
  const artifacts = report.projection.artifacts.map((item) => ({
    ref: item.ref,
    content_hash: item.contentHash,
  }))
  const manifest: ReportManifestV4 = {
    version: REPORT_MANIFEST_VERSION,
    renderer_version: REPORT_RENDERER_VERSION,
    report_digest: inputs.reportDigest,
    document_digest: inputs.documentDigest,
    provenance_digest: inputs.provenanceDigest,
    environment_fingerprint: options.environmentFingerprint,
    marivo_version: options.marivoVersion,
    generated_at: generatedAt,
    artifacts,
    files: {
      index_html: { sha256: hash(html), bytes: htmlBytes },
      report_document_json: {
        sha256: hash(inputs.documentText),
        bytes: Buffer.byteLength(inputs.documentText),
      },
    },
  }
  const manifestText = `${canonicalJson(manifest)}\n`
  const staging = await mkdtemp(path.join(environmentDirectory, '.staging-'))
  let renamed = false
  try {
    if (process.platform !== 'win32') await chmod(staging, 0o700)
    throwIfAborted(options.signal)
    await Promise.all([
      writeFile(path.join(staging, 'index.html'), html, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
        signal: options.signal,
      }),
      writeFile(path.join(staging, 'report-document.json'), inputs.documentText, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
        signal: options.signal,
      }),
      writeFile(path.join(staging, 'manifest.json'), manifestText, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
        signal: options.signal,
      }),
    ])
    throwIfAborted(options.signal)
    await validateExisting(
      staging,
      {
        report,
        ...inputs,
        environmentFingerprint: options.environmentFingerprint,
        marivoVersion: options.marivoVersion,
        artifacts,
      },
      options.signal,
    )
    try {
      throwIfAborted(options.signal)
      await rename(staging, reportDirectory)
      renamed = true
      throwIfAborted(options.signal)
      return {
        ok: true,
        path: path.join(reportDirectory, 'index.html'),
        reportDigest: inputs.reportDigest,
        documentDigest: inputs.documentDigest,
        generatedAt,
        reused: false,
      }
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code
      if (code !== 'EEXIST' && code !== 'ENOTEMPTY') throw cause
      const existing = await validateExisting(
        reportDirectory,
        {
          report,
          ...inputs,
          environmentFingerprint: options.environmentFingerprint,
          marivoVersion: options.marivoVersion,
          artifacts,
        },
        options.signal,
      )
      return {
        ok: true,
        path: path.join(reportDirectory, 'index.html'),
        reportDigest: inputs.reportDigest,
        documentDigest: inputs.documentDigest,
        generatedAt: existing.generated_at,
        reused: true,
      }
    }
  } finally {
    if (!renamed) await rm(staging, { recursive: true, force: true })
  }
}
