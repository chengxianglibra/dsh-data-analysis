import { createHash, randomUUID } from 'node:crypto'
import { type CredentialProvider, credentialRef } from '@deepseek-ai/dsh-credentials'
import type { SavedReportRef } from '../presentation/contracts/report-ref.ts'
import type { MarivoPresentationFileService } from '../presentation/rpc.ts'
import type { EnabledPublishingConfig } from './config.ts'
import {
  type PublishingCredentialView,
  type PublishingField,
  publishingFields,
} from './credential-contract.ts'

type Store = Pick<CredentialProvider, 'describe' | 'set' | 'unset' | 'resolve'>

function pathName(value: string, fallback: string): string {
  const name = Array.from(value.normalize('NFKC').replace(/[^\p{L}\p{N}_-]+/gu, '-'))
    .slice(0, 48)
    .join('')
    .replace(/^-+|-+$/g, '')
  return name || fallback
}

export class ReportPublishingService {
  readonly configId = randomUUID()
  readonly #config: EnabledPublishingConfig
  readonly #store: Store
  readonly #files: Pick<MarivoPresentationFileService, 'readSavedReport'>
  readonly #workspaceName: (id: string) => string

  constructor(
    config: EnabledPublishingConfig,
    store: Store,
    files: Pick<MarivoPresentationFileService, 'readSavedReport'>,
    workspaceName: (id: string) => string,
  ) {
    this.#config = config
    this.#store = store
    this.#files = files
    this.#workspaceName = workspaceName
  }

  assertConfig(configId: string): void {
    if (configId !== this.configId) throw new Error('report-publishing-config-changed')
  }

  async describe(): Promise<PublishingCredentialView> {
    const fields = await Promise.all(
      publishingFields.flatMap((field) => {
        const reference = this.#config.storage[`${field}Ref`]
        if (reference === undefined) return []
        return [
          this.#store.describe(credentialRef(reference)).then((info) => ({
            field,
            reference,
            required: true,
            configured: info.configured,
            writable: info.writable,
            ...(info.source ? { source: info.source } : {}),
          })),
        ]
      }),
    )
    return {
      enabled: true,
      configId: this.configId,
      name: this.#config.storage.name,
      bucket: this.#config.storage.bucket,
      fields,
    }
  }

  async change(field: PublishingField, value: string | undefined, signal: AbortSignal) {
    const reference = this.#config.storage[`${field}Ref`]
    if (reference === undefined) throw new Error('report-publishing-disabled-or-field-unavailable')
    signal.throwIfAborted()
    if (value === undefined) await this.#store.unset(credentialRef(reference))
    else await this.#store.set(credentialRef(reference), value)
  }

  async publish(
    scope: { sessionId: string } | { workspaceId: string },
    ref: SavedReportRef,
    caller: AbortSignal,
  ) {
    const signal = AbortSignal.any([caller, AbortSignal.timeout(110_000)])
    const { workspaceId, reportId, buildId } = ref
    const document = await this.#files.readSavedReport(scope, ref, signal)
    const { exportAnalysisHtml } = await import('../client/analysis-ui/offline-export.ts')
    const bytes = Buffer.from(exportAnalysisHtml(document), 'utf8')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const publicationId = createHash('sha256')
      .update(JSON.stringify([workspaceId, reportId, buildId, sha256]))
      .digest('hex')
      .slice(0, 32)
    const { pathPrefix, publicBaseUrl, storage } = this.#config
    const key = [
      pathPrefix,
      pathName(this.#workspaceName(workspaceId), 'workspace'),
      pathName(document.title, 'report'),
      publicationId,
      'index.html',
    ]
      .filter(Boolean)
      .join('/')
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3')
    const accessKeyId = await this.#resolveCredential(storage.accessKeyIdRef, signal)
    const secretAccessKey = await this.#resolveCredential(storage.secretAccessKeyRef, signal)
    const sessionToken =
      storage.sessionTokenRef === undefined
        ? undefined
        : await this.#resolveCredential(storage.sessionTokenRef, signal)
    signal.throwIfAborted()
    const client = new S3Client({
      endpoint: storage.endpoint,
      region: storage.region,
      forcePathStyle: storage.forcePathStyle,
      credentials: { accessKeyId, secretAccessKey, sessionToken },
      maxAttempts: 3,
      requestChecksumCalculation: 'WHEN_REQUIRED',
    })
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: storage.bucket,
          Key: key,
          Body: bytes,
          ContentType: 'text/html; charset=utf-8',
          ContentDisposition: 'inline',
          CacheControl: 'public, max-age=31536000, immutable',
        }),
        { abortSignal: signal },
      )
    } catch {
      throw new Error('report-publishing-upload-unconfirmed')
    } finally {
      client.destroy()
    }
    return {
      storage: storage.name,
      bucket: storage.bucket,
      key,
      url: `${publicBaseUrl.replace(/\/+$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`,
      workspaceId,
      reportId,
      buildId,
      sha256,
      bytes: bytes.length,
      publishedAt: new Date().toISOString(),
    }
  }

  async #resolveCredential(reference: string, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted()
    const result = await this.#store.resolve(credentialRef(reference))
    if (!result?.value) throw new Error('report-publishing-credentials-missing')
    return result.value
  }
}
