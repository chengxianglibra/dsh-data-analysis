import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import test from 'node:test'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { translator } from './../../src/client/i18n/copy.ts'
import { registerPublishingCredentials } from '../../src/report-publishing/adapters.ts'
import { resolvePublishingConfig } from '../../src/report-publishing/config.ts'
import {
  publishingPathName,
  ReportPublishingService,
  type UploadInput,
  uploadReport,
} from '../../src/report-publishing/service.ts'
import { createConnectionFixture } from '../semantic-reference-input/fixtures.ts'

const configuration = {
  enabled: true,
  storage: {
    name: '报告存储',
    endpoint: 'https://s3.example.test',
    region: 'us-east-1',
    bucket: 'reports',
    accessKeyIdRef: 'REPORT_AK',
    secretAccessKeyRef: 'REPORT_SK',
    sessionTokenRef: 'REPORT_TOKEN',
  },
  publicBaseUrl: 'https://reports.example.test/base',
  pathPrefix: 'analysis',
}
function fixture(enabled = true) {
  const values = new Map<string, string>([
    ['REPORT_AK', 'test-access'],
    ['REPORT_SK', 'test-secret'],
    ['REPORT_TOKEN', 'test-token'],
  ])
  const uploaded: UploadInput[] = []
  const reads: string[] = []
  const receipt: any = {
    workspaceId: 'workspace',
    reportId: 'report',
    buildId: 'build',
    title: '销售 / 月报',
  }
  const service = new ReportPublishingService(
    resolvePublishingConfig(enabled ? configuration : { enabled: false }),
    {
      describe: async (ref: CredentialRef) => ({
        configured: values.has(ref),
        writable: true,
        source: 'file',
      }),
      resolve: async (ref: CredentialRef) =>
        values.has(ref) ? { value: values.get(ref)!, source: 'file' } : undefined,
      set: async (ref: CredentialRef, value: string) => {
        values.set(ref, value)
      },
      unset: async (ref: CredentialRef) => {
        values.delete(ref)
      },
    },
    {
      catalog: async () => ({
        workspaceId: 'workspace',
        reportId: 'report',
        currentBuildId: 'build',
        legacyHistoryUnavailable: false,
        versions: [{ receipt, publishedAt: null, source: null }],
      }),
      read: async (input: any) => {
        reads.push(input.asset)
        const bytes = Buffer.from('<!doctype html><p>report</p>')
        return {
          workspaceId: 'workspace',
          reportId: 'report',
          buildId: 'build',
          asset: input.asset,
          mimeType: 'text/html',
          sha256: createHash('sha256').update(bytes).digest('hex'),
          bytes: bytes.length,
          bodyBase64: bytes.toString('base64'),
        }
      },
    },
    async (input) => {
      uploaded.push({ ...input, credentials: { ...input.credentials } })
    },
    () => '分析空间',
  )
  return { service, values, uploaded, reads, receipt }
}
const signal = () => new AbortController().signal

test('publishing configuration is opt-in, validates references and never echoes configuration values', () => {
  assert.equal(resolvePublishingConfig(), undefined)
  assert.equal(resolvePublishingConfig({ enabled: false }), undefined)
  assert.throws(
    () =>
      resolvePublishingConfig({
        ...configuration,
        storage: {
          ...configuration.storage,
          endpoint: 'https://secret-user:secret-password@example.test',
        },
      }),
    /^Error: report-publishing-config-invalid$/,
  )
  assert.throws(() =>
    resolvePublishingConfig({
      ...configuration,
      storage: { ...configuration.storage, secretAccessKeyRef: 'REPORT_AK' },
    }),
  )
  assert.throws(() => resolvePublishingConfig({ ...configuration, pathPrefix: '../escape' }))
})

test('single-field credential management exposes presence only and disabled mode rejects writes/uploads', async () => {
  const { service, values } = fixture()
  const view = await service.describe()
  assert.equal(view.fields.length, 3)
  assert(!JSON.stringify(view).includes('test-secret'))
  await service.change('secretAccessKey', 'rotated-secret', signal())
  assert.equal(values.get('REPORT_SK'), 'rotated-secret')
  await service.change('sessionToken', undefined, signal())
  await assert.rejects(
    service.publish({ sessionId: 'session' }, 'report', 'build', signal()),
    /credentials-missing/,
  )
  const disabled = fixture(false).service
  assert.deepEqual(await disabled.describe(), { enabled: false, fields: [] })
  await assert.rejects(disabled.change('accessKeyId', 'value', signal()))
  await assert.rejects(
    disabled.publish({ sessionId: 'session' }, 'report', 'build', signal()),
    /disabled/,
  )
})

test('publication binds saved Build, reads credentials per operation, and isolates view content keys', async () => {
  const { service, values, uploaded, reads } = fixture()
  const first = await service.publish({ sessionId: 'session' }, 'report', 'build', signal())
  values.set('REPORT_SK', 'rotated-secret')
  const second = await service.publish({ sessionId: 'session' }, 'report', 'build', signal())
  assert.equal(first.url, second.url)
  assert.equal(uploaded[1]!.credentials.secretAccessKey, 'rotated-secret')
  assert(!JSON.stringify(second).includes('rotated-secret'))
  const view = await service.publish(
    { workspaceId: 'workspace' },
    'report',
    'build',
    signal(),
    '<!doctype html><html lang="zh-CN"><head></head><body>filtered</body></html>',
  )
  assert.match(
    translator('zh-CN')(first.key),
    /^analysis\/分析空间\/销售-月报\/[a-f0-9]{32}\/index\.html$/,
  )
  assert.equal(decodeURI(first.url), `https://reports.example.test/base/${first.key}`)
  assert.notEqual(view.url, first.url)
  assert.equal(reads.at(-1), 'presentation.json')
  assert(uploaded.at(-1)!.bytes.toString().includes("default-src 'none'"))
  await assert.rejects(
    service.publish({ sessionId: 'session' }, 'report', 'missing', signal()),
    /build-unavailable/,
  )
  await assert.rejects(
    service.publish({ sessionId: 'session' }, 'report', 'build', AbortSignal.abort()),
  )
})

test('AWS client sends signed PUT with explicit credentials, bucket path and HTML headers', async (t) => {
  let received: any
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    received = {
      headers: request.headers,
      path: request.url,
      method: request.method,
      body: Buffer.concat(chunks).toString(),
    }
    response.writeHead(200, { ETag: '"test"' }).end()
  })
  server.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const address = server.address() as { port: number }
  const config = resolvePublishingConfig({
    ...configuration,
    storage: {
      ...configuration.storage,
      endpoint: `http://127.0.0.1:${address.port}`,
      forcePathStyle: true,
    },
  })!
  await uploadReport({
    config,
    credentials: { accessKeyId: 'test-ak', secretAccessKey: 'test-sk', sessionToken: 'test-token' },
    key: 'analysis/report/index.html',
    bytes: Buffer.from('<html>saved report</html>'),
    signal: signal(),
  })
  assert.equal(received.method, 'PUT')
  assert(received.path.startsWith('/reports/analysis/report/index.html'))
  assert.equal(received.headers['content-type'], 'text/html; charset=utf-8')
  assert.equal(received.headers['x-amz-security-token'], 'test-token')
  assert.match(received.headers.authorization, /AWS4-HMAC-SHA256 Credential=test-ak/)
  assert.equal(received.body, '<html>saved report</html>')
})

test('credential RPC rejects arbitrary references and sanitizes provider errors', async () => {
  const { service } = fixture()
  service.store.set = async () => {
    throw new Error('secret-sentinel')
  }
  const connection = createConnectionFixture()
  const close = registerPublishingCredentials(
    connection.connection,
    service,
    (id) => id === 'workspace',
  )
  try {
    const handler = connection.channels.get('/dsh-report-publishing')!
    const result = await handler(
      'set',
      {
        workspaceId: 'workspace',
        configId: service.configId,
        field: 'accessKeyId',
        value: 'secret-sentinel',
      },
      signal(),
    )
    assert.equal(result.ok, false)
    assert(!JSON.stringify(result).includes('secret-sentinel'))
    assert.equal(
      (
        await handler(
          'set',
          { workspaceId: 'workspace', configId: service.configId, field: 'other', value: 'value' },
          signal(),
        )
      ).ok,
      false,
    )
    assert.equal((await handler('describe', { workspaceId: 'missing' }, signal())).ok, false)
  } finally {
    await close()
  }
})

test('publishing tool returns a value-free receipt and rejects execution after withdrawal', async () => {
  const { registerReportPublishTool } = await import('../../src/report-publishing/adapters.ts')
  const { service } = fixture()
  let tool: any
  let withdrawn = false
  const close = registerReportPublishTool(
    {
      tools: {
        register(value: unknown) {
          tool = value
          return () => {
            withdrawn = true
          }
        },
      },
    } as any,
    service,
    'session',
  )
  const result = await tool.execute(
    { report_id: 'report', build_id: 'build' },
    { agent: { session: { id: 'session' } }, signal: signal() },
  )
  assert.match(JSON.parse(result.publicationJson).url, /^https:\/\/reports.example.test/)
  assert(!result.publicationJson.includes('test-secret'))
  await close()
  assert(withdrawn)
  await assert.rejects(
    tool.execute({ report_id: 'report', build_id: 'build' }, { signal: signal() }),
    /disposed/,
  )
})

test('reconfigured RPC rejects every stale mutation before touching credentials or uploading', async () => {
  const f = fixture()
  const connection = createConnectionFixture()
  let close = registerPublishingCredentials(connection.connection, f.service, () => true)
  const call = (endpoint: string, input: unknown) =>
    connection.channels.get('/dsh-report-publishing')!(endpoint, input, signal())
  try {
    const old = await call('describe', { workspaceId: 'workspace' })
    assert(old.ok)
    const oldConfigId = (old.value as { configId: string }).configId
    await close()
    const config = resolvePublishingConfig({
      ...configuration,
      storage: {
        ...configuration.storage,
        name: 'new-target',
        bucket: 'new-bucket',
        secretAccessKeyRef: 'NEW_SK',
      },
    })!
    const next = new ReportPublishingService(
      config,
      f.service.store,
      f.service.files,
      f.service.upload,
    )
    f.values.set('NEW_SK', 'untouched')
    close = registerPublishingCredentials(connection.connection, next, () => true)
    for (const [endpoint, input] of [
      ['set', { field: 'secretAccessKey', value: 'old-form-value' }],
      ['unset', { field: 'secretAccessKey' }],
      ['publish', { reportId: 'report', buildId: 'build', title: '销售 / 月报' }],
      [
        'publish',
        {
          reportId: 'report',
          buildId: 'build',
          viewHtml: '<!doctype html><html lang="zh-CN"><head></head><body>view</body></html>',
        },
      ],
    ] as const) {
      const rejected = await call(endpoint, {
        workspaceId: 'workspace',
        configId: oldConfigId,
        ...input,
      })
      assert(!rejected.ok)
      assert.equal(rejected.error.message, 'report-publishing-config-changed')
      assert.equal(f.values.get('NEW_SK'), 'untouched')
      assert.equal(f.uploaded.length, 0)
      assert.equal(f.reads.length, 0)
    }
    const fresh = await call('describe', { workspaceId: 'workspace' })
    assert(fresh.ok)
    const configId = (fresh.value as { configId: string }).configId
    assert.notEqual(configId, oldConfigId)
    assert(
      (
        await call('set', {
          workspaceId: 'workspace',
          configId,
          field: 'secretAccessKey',
          value: 'new-form-value',
        })
      ).ok,
    )
    assert.equal(f.values.get('NEW_SK'), 'new-form-value')
    assert(
      (
        await call('publish', {
          workspaceId: 'workspace',
          configId,
          reportId: 'report',
          buildId: 'build',
        })
      ).ok,
    )
    assert.equal(f.uploaded[0]!.config.storage.bucket, 'new-bucket')
    assert(
      (await call('unset', { workspaceId: 'workspace', configId, field: 'secretAccessKey' })).ok,
    )
    assert(!f.values.has('NEW_SK'))
  } finally {
    await close()
  }
})

test('publishing path names normalize unsafe characters and bound readable segments', () => {
  assert.equal(publishingPathName(' ../季度\\报告 :?#% / ', 'report'), '季度-报告')
  assert.equal(publishingPathName('...///', 'report'), 'report')
  assert.equal(publishingPathName('ＡＢＣ  １２３', 'report'), 'ABC-123')
  assert.equal(Array.from(publishingPathName('报'.repeat(100), 'report')).length, 48)
})

test('same readable names and bytes remain isolated across Workspace and Build identities', async () => {
  const { service, receipt } = fixture()
  const first = await service.publish({ workspaceId: 'workspace' }, 'report', 'build', signal())
  receipt.workspaceId = 'another-workspace'
  const otherWorkspace = await service.publish(
    { workspaceId: 'another-workspace' },
    'report',
    'build',
    signal(),
  )
  assert.notEqual(first.key, otherWorkspace.key)
  receipt.workspaceId = 'workspace'
  receipt.buildId = 'another-build'
  const otherBuild = await service.publish(
    { workspaceId: 'workspace' },
    'report',
    'another-build',
    signal(),
  )
  assert.notEqual(first.key, otherBuild.key)
  assert.equal(first.sha256, otherBuild.sha256)
})
