import { createHash, randomUUID } from 'node:crypto'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { type CredentialProvider, credentialRef } from '@deepseek-ai/dsh-credentials'
import { PRESENTATION_BUDGETS } from '../presentation/contracts/index.ts'
import type { MarivoPresentationFileService } from '../presentation/rpc.ts'
import type { EnabledPublishingConfig } from './config.ts'

export type PublishingField = 'accessKeyId' | 'secretAccessKey' | 'sessionToken'
export interface PublishingCredentialField {
  field: PublishingField
  reference: string
  required: boolean
  configured: boolean
  writable: boolean
  source?: string
}
export interface PublishingCredentialView {
  enabled: boolean
  configId?: string
  name?: string
  bucket?: string
  fields: PublishingCredentialField[]
}
type Store = Pick<CredentialProvider, 'describe' | 'set' | 'unset' | 'resolve'>
export interface UploadInput {
  config: EnabledPublishingConfig
  credentials: { accessKeyId: string; secretAccessKey: string; sessionToken?: string }
  key: string
  bytes: Buffer
  signal: AbortSignal
}
export async function uploadReport(input: UploadInput): Promise<void> {
  const { config, credentials, key, bytes, signal } = input
  const client = new S3Client({
    endpoint: config.storage.endpoint,
    region: config.storage.region,
    forcePathStyle: config.storage.forcePathStyle,
    credentials,
    maxAttempts: 3,
    requestChecksumCalculation: 'WHEN_REQUIRED',
  })
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: config.storage.bucket,
        Key: key,
        Body: bytes,
        ContentType: 'text/html; charset=utf-8',
        ContentDisposition: 'inline',
        CacheControl: 'public, max-age=31536000, immutable',
      }),
      { abortSignal: signal },
    )
  } finally {
    client.destroy()
  }
}
export class ReportPublishingService {
  readonly configId = randomUUID()
  readonly config: EnabledPublishingConfig | undefined
  readonly store: Store
  readonly files: Pick<MarivoPresentationFileService, 'catalog' | 'read'>
  readonly upload: (input: UploadInput) => Promise<void>
  constructor(
    config: EnabledPublishingConfig | undefined,
    store: Store,
    files: Pick<MarivoPresentationFileService, 'catalog' | 'read'>,
    upload: (input: UploadInput) => Promise<void> = uploadReport,
  ) {
    this.config = config
      ? Object.freeze({ ...config, storage: Object.freeze({ ...config.storage }) })
      : undefined
    this.store = store
    this.files = files
    this.upload = upload
  }
  assertConfig(configId: string): void {
    if (configId !== this.configId) throw new Error('report-publishing-config-changed')
  }
  references(): Array<{ field: PublishingField; reference: string; required: boolean }> {
    const storage = this.config?.storage
    if (!storage) return []
    return [
      { field: 'accessKeyId' as const, reference: storage.accessKeyIdRef, required: true },
      { field: 'secretAccessKey' as const, reference: storage.secretAccessKeyRef, required: true },
      ...(storage.sessionTokenRef
        ? [{ field: 'sessionToken' as const, reference: storage.sessionTokenRef, required: true }]
        : []),
    ]
  }
  async describe(): Promise<PublishingCredentialView> {
    if (!this.config) return { enabled: false, fields: [] }
    const fields = await Promise.all(
      this.references().map(async (field) => {
        const info = await this.store.describe(credentialRef(field.reference))
        return {
          ...field,
          configured: info.configured,
          writable: info.writable,
          ...(info.source ? { source: info.source } : {}),
        }
      }),
    )
    return {
      enabled: true,
      configId: this.configId,
      name: this.config.storage.name,
      bucket: this.config.storage.bucket,
      fields,
    }
  }
  async change(
    field: PublishingField,
    value: string | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    const item = this.references().find((item) => item.field === field)
    if (!item) throw new Error('report-publishing-disabled-or-field-unavailable')
    signal.throwIfAborted()
    if (value === undefined) await this.store.unset(credentialRef(item.reference))
    else await this.store.set(credentialRef(item.reference), value)
  }
  async publish(
    scope: { sessionId: string } | { workspaceId: string },
    reportId: string,
    buildId: string,
    signal: AbortSignal,
    viewHtml?: string,
  ) {
    const config = this.config
    if (!config) throw new Error('report-publishing-disabled')
    const history = await this.files.catalog('reports/history', { ...scope, reportId }, signal)
    if (!('versions' in history)) throw new Error('report-publishing-build-unavailable')
    const receipt = history.versions.find((entry) => entry.receipt.buildId === buildId)?.receipt
    if (!receipt) throw new Error('report-publishing-build-unavailable')
    const credentials: Record<string, string> = {}
    for (const field of this.references()) {
      signal.throwIfAborted()
      const hit = await this.store.resolve(credentialRef(field.reference))
      if (!hit?.value) throw new Error('report-publishing-credentials-missing')
      credentials[field.field] = hit.value
    }
    const asset = await this.files.read(
      { ...scope, receipt, asset: viewHtml === undefined ? 'index.html' : 'presentation.json' },
      signal,
    )
    let bytes: Buffer
    if (viewHtml === undefined) bytes = Buffer.from(asset.bodyBase64, 'base64')
    else {
      if (
        Buffer.byteLength(viewHtml) > PRESENTATION_BUDGETS.htmlBytes ||
        !viewHtml.startsWith('<!doctype html><html lang="zh-CN"><head>')
      )
        throw new Error('report-publishing-view-invalid')
      // Browser-authored snapshot: force a restrictive policy before any client-supplied markup.
      bytes = Buffer.from(
        viewHtml.replace(
          '<head>',
          `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">`,
        ),
      )
      if (bytes.length > PRESENTATION_BUDGETS.htmlBytes)
        throw new Error('report-publishing-view-invalid')
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const workspaceKey = createHash('sha256').update(receipt.workspaceId).digest('hex')
    const key = [
      config.pathPrefix,
      workspaceKey,
      reportId,
      buildId,
      ...(viewHtml === undefined ? [] : ['views']),
      sha256,
      'index.html',
    ]
      .filter(Boolean)
      .join('/')
    signal.throwIfAborted()
    try {
      await this.upload({
        config,
        credentials: credentials as UploadInput['credentials'],
        key,
        bytes,
        signal,
      })
    } catch {
      throw new Error('report-publishing-upload-unconfirmed')
    } finally {
      for (const key of Object.keys(credentials)) delete credentials[key]
    }
    return {
      storage: config.storage.name,
      bucket: config.storage.bucket,
      key,
      url: `${config.publicBaseUrl.replace(/\/+$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`,
      workspaceId: receipt.workspaceId,
      reportId,
      buildId,
      sha256,
      bytes: bytes.length,
      kind: viewHtml === undefined ? 'report' : 'view',
      publishedAt: new Date().toISOString(),
    }
  }
}
