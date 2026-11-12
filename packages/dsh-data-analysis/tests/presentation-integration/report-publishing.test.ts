import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { type ToolRunContext, ToolRuntime } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import {
  analysisCatalogBuild,
  analysisCatalogId,
} from '../../src/presentation/contracts/analysis-catalog.ts'
import {
  ANALYSIS_UI_FORMAT,
  type AnalysisDocument,
  analysisRecordId,
} from '../../src/presentation/contracts/analysis-document.ts'
import { draftReportRef, savedReportRef } from '../../src/presentation/contracts/report-ref.ts'
import { publishPresentation, readReportHistory } from '../../src/presentation/reports.ts'
import { MarivoPresentationFileService } from '../../src/presentation/rpc.ts'
import {
  registerPublishingRpc,
  registerReportPublishTool,
} from '../../src/report-publishing/adapters.ts'
import { resolvePublishingConfig } from '../../src/report-publishing/config.ts'
import { ReportPublishingService } from '../../src/report-publishing/service.ts'
import { Store } from '../datasource-credentials/fixtures.ts'
import { createConnectionFixture } from '../semantic-reference-input/fixtures.ts'

const channel = '/dsh-report-publishing'
const storage = {
  name: 'Team reports',
  endpoint: 'https://s3.example.test',
  region: 'us-east-1',
  bucket: 'report-bucket',
  forcePathStyle: true,
  accessKeyIdRef: 'REPORT_ACCESS_KEY',
  secretAccessKeyRef: 'REPORT_SECRET_KEY',
  sessionTokenRef: 'REPORT_TOKEN',
}
const signal = new AbortController().signal
const toolOutput = z.object({ key: z.string(), url: z.string() })
const version = { workspaceId: 'private_workspace_id', reportId: 'report', buildId: 'first' }
const ref = savedReportRef(version)
const sessionId = 'source-session'
const workspaceExists = (id: string) => id === version.workspaceId

function config(endpoint = storage.endpoint) {
  return {
    enabled: true,
    storage: { ...storage, endpoint },
    publicBaseUrl: 'https://reports.example.test/cdn/',
  }
}

async function fixture(t: TestContext, endpoint?: string) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'report-publishing-')))
  const binding = { id: version.workspaceId, path: root }
  const files = new MarivoPresentationFileService(
    (id) => (id === sessionId ? binding : undefined),
    (id) => (workspaceExists(id) ? binding : undefined),
  )
  const store = new Store()
  const service = new ReportPublishingService(
    resolvePublishingConfig(config(endpoint))!,
    store,
    files,
    () => 'ＡＣＭＥ / 团队',
  )
  const { connection, channels } = createConnectionFixture()
  const close = registerPublishingRpc(connection, service, workspaceExists)
  t.after(async () => {
    await close()
    await files.close()
    await rm(root, { recursive: true, force: true })
  })
  const save = (buildId: string, title: string, expected: string | null) => {
    const document: AnalysisDocument = {
      schemaVersion: ANALYSIS_UI_FORMAT,
      ...version,
      buildId,
      recordId: analysisRecordId(version.reportId, buildId),
      title,
      locale: 'en-US',
      generatedAt: '2026-11-12T00:00:00Z',
      catalog: { id: analysisCatalogId, build: analysisCatalogBuild },
      program: `root = TextContent(${JSON.stringify(title)});`,
      resources: {},
    }
    return publishPresentation(root, document, expected, async () => {}, signal, {
      kind: 'agent',
      sessionId,
      surface: 'tab',
    })
  }
  return { root, store, service, save, call: channels.get(channel)! }
}

test('publishing defaults off and invalid enabled configuration returns a fixed diagnostic', async (t) => {
  assert.equal(resolvePublishingConfig(undefined), undefined)
  assert.equal(resolvePublishingConfig({ enabled: false }), undefined)
  assert.throws(
    () =>
      resolvePublishingConfig({ ...config(), publicBaseUrl: 'https://user:secret@example.test' }),
    { message: 'report-publishing-config-invalid' },
  )
  assert.throws(
    () =>
      resolvePublishingConfig({
        ...config(),
        storage: { ...storage, secretAccessKeyRef: storage.accessKeyIdRef },
      }),
    { message: 'report-publishing-config-invalid' },
  )
  const { connection, channels } = createConnectionFixture()
  t.after(registerPublishingRpc(connection, undefined, workspaceExists))
  const call = channels.get(channel)!
  assert.deepEqual(await call('describe', { workspaceId: version.workspaceId }, signal), {
    ok: true,
    value: { enabled: false, fields: [] },
  })
  const rejected = await call(
    'publish',
    { workspaceId: version.workspaceId, configId: randomUUID(), ref },
    signal,
  )
  assert.ok(!rejected.ok)
  assert.equal(rejected.error.message, 'report-publishing-disabled')
})

test('credential RPC scopes updates to the current config and returns status without values', async (t) => {
  const { call, service, store } = await fixture(t)
  const request = {
    workspaceId: version.workspaceId,
    configId: service.configId,
    field: 'secretAccessKey',
  }
  const value = 'credential-fixture-value'
  const stale = await call('set', { ...request, value, configId: randomUUID() }, signal)
  assert.ok(!stale.ok)
  assert.equal(stale.error.message, 'report-publishing-config-changed')
  assert.equal(store.values.size, 0)

  const set = await call('set', { ...request, value }, signal)
  assert.ok(set.ok)
  assert.equal(store.values.get(storage.secretAccessKeyRef), value)
  assert.doesNotMatch(JSON.stringify(set), new RegExp(value))
  const status = await call('describe', { workspaceId: version.workspaceId }, signal)
  assert.deepEqual(status, set)
  assert.equal(store.calls.resolve, 0)

  store.readonly = true
  const denied = await call('unset', request, signal)
  assert.ok(!denied.ok)
  assert.equal(denied.error.message, 'report-publishing-operation-failed')
  assert.equal(store.values.get(storage.secretAccessKeyRef), value)
  store.readonly = false
  const unset = await call('unset', request, signal)
  assert.ok(unset.ok)
  assert.equal(store.values.has(storage.secretAccessKeyRef), false)
})

test('only verified saved Builds are eligible for publishing credentials', async (t) => {
  const { call, service, save, store } = await fixture(t)
  const receipt = await save(version.buildId, 'Original report', null)
  const request = { workspaceId: version.workspaceId, configId: service.configId, ref }
  const unpublishedRef = savedReportRef({ ...version, buildId: 'unpublished' })
  const unavailable = await call('publish', { ...request, ref: unpublishedRef }, signal)
  assert.ok(!unavailable.ok)
  assert.equal(unavailable.error.message, 'report-publishing-build-unavailable')
  const otherWorkspaceRef = savedReportRef({
    ...version,
    workspaceId: 'another',
    buildId: 'unpublished',
  })
  const mismatch = await call('publish', { ...request, ref: otherWorkspaceRef }, signal)
  assert.ok(!mismatch.ok)
  assert.equal(mismatch.error.message, 'report-workspace-mismatch')
  const untrusted = await call('publish', { ...request, viewHtml: '<html></html>' }, signal)
  assert.ok(!untrusted.ok)
  assert.equal(untrusted.error.message, 'invalid-request')
  await writeFile(receipt.files.document.path, '{}')
  const tampered = await call('publish', request, signal)
  assert.ok(!tampered.ok)
  assert.equal(store.calls.resolve, 0)
})

test('RPC and Agent publish the exact historical Build as signed, self-contained HTML', async (t) => {
  let uploadAccepted = true
  const uploads: {
    url: string
    authorization?: string
    token?: string
    type?: string
    body: Buffer
  }[] = []
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk)
    uploads.push({
      url: req.url ?? '',
      authorization: req.headers.authorization,
      token: req.headers['x-amz-security-token']?.toString(),
      type: req.headers['content-type'],
      body: Buffer.concat(chunks),
    })
    if (uploadAccepted) res.writeHead(req.method === 'PUT' ? 200 : 405).end()
    else
      res
        .writeHead(403)
        .end('<Error><Code>AccessDenied</Code><Message>storage-private-detail</Message></Error>')
  })
  t.after(() => {
    server.closeAllConnections()
    return new Promise<void>((resolve) => server.close(() => resolve()))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const { call, root, service, save, store } = await fixture(t, `http://127.0.0.1:${address.port}`)
  await save(version.buildId, '原始 <报告>', null)
  await save('current', 'Updated report', version.buildId)
  const request = { workspaceId: version.workspaceId, configId: service.configId, ref }
  store.values.set(storage.accessKeyIdRef, 'TESTACCESSFIRST')
  store.values.set(storage.secretAccessKeyRef, 'test-secret')
  const missing = await call('publish', request, signal)
  assert.ok(!missing.ok)
  assert.equal(missing.error.message, 'report-publishing-credentials-missing')
  assert.equal(uploads.length, 0)

  store.values.set(storage.sessionTokenRef, 'test-token')
  const first = await call('publish', request, signal)
  assert.ok(first.ok)
  const publication = first.value
  assert.ok(publication && typeof publication === 'object' && 'key' in publication)
  const upload = uploads[0]!
  const sha256 = createHash('sha256').update(upload.body).digest('hex')
  const identity = createHash('sha256')
    .update(JSON.stringify([version.workspaceId, 'report', 'first', sha256]))
    .digest('hex')
    .slice(0, 32)
  const key = `reports/ACME-团队/原始-报告/${identity}/index.html`
  const encodedKey = key.split('/').map(encodeURIComponent).join('/')
  assert.equal(publication.key, key)
  assert.deepEqual(
    { ...publication, publishedAt: undefined },
    {
      ...version,
      key,
      storage: storage.name,
      bucket: storage.bucket,
      url: `https://reports.example.test/cdn/${encodedKey}`,
      sha256,
      bytes: upload.body.length,
      publishedAt: undefined,
    },
  )
  assert.equal(new URL(upload.url, storage.endpoint).pathname, `/report-bucket/${encodedKey}`)
  assert.match(upload.authorization ?? '', /^AWS4-HMAC-SHA256 Credential=TESTACCESSFIRST\//)
  assert.equal(upload.token, 'test-token')
  assert.equal(upload.type, 'text/html; charset=utf-8')
  const html = upload.body.toString()
  assert.match(html, /<title>原始 &lt;报告&gt;<\/title>/)
  assert.match(html, /<script type="application\/json" id="report-data">/)
  assert.doesNotMatch(html, /Updated report|private_workspace_id|test-secret|test-token/)

  const ctx = new Context()
  const prompt = await ctx.plugin(SystemPrompt)
  const tools = await ctx.plugin(ToolRuntime)
  const session = { id: sessionId } as Session
  const stopTool = registerReportPublishTool(ctx, service, session)
  t.after(async () => {
    await stopTool()
    await tools.dispose()
    await prompt.dispose()
  })
  const tool = ctx.tools.get('marivo_publish_report')!
  const exec = { agent: { session }, signal } as ToolRunContext
  await assert.rejects(
    tool.execute({ ref: savedReportRef({ ...version, workspaceId: 'another' }) }, exec),
    { message: 'report-workspace-mismatch' },
  )
  const draft = draftReportRef({
    workspaceId: version.workspaceId,
    sessionId,
    turn: 1,
    draftId: randomUUID(),
    revision: randomUUID(),
  })
  await assert.rejects(tool.execute({ ref: draft }, exec), { message: 'report-saved-ref-required' })
  await assert.rejects(tool.execute({ ref }, { ...exec, agent: undefined }), {
    message: 'presentation-session-mismatch',
  })
  store.values.set(storage.accessKeyIdRef, 'TESTACCESSROTATED')
  const result = await tool.execute({ ref }, exec)
  assert.deepEqual(toolOutput.parse(result), {
    key,
    url: `https://reports.example.test/cdn/${encodedKey}`,
  })
  assert.doesNotMatch(JSON.stringify(result), /test-secret|test-token|TESTACCESSROTATED/)
  const retry = uploads[1]!
  assert.equal(retry.url, upload.url)
  assert.deepEqual(retry.body, upload.body)
  assert.match(retry.authorization ?? '', /^AWS4-HMAC-SHA256 Credential=TESTACCESSROTATED\//)
  uploadAccepted = false
  const rejected = await call('publish', request, signal)
  assert.ok(!rejected.ok)
  assert.equal(rejected.error.message, 'report-publishing-upload-unconfirmed')
  assert.equal(
    (await readReportHistory(root, version.workspaceId, version.reportId)).currentBuildId,
    'current',
  )
})
