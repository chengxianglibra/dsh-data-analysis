/** Real browser + production publishing RPC/SDK against a local HTTP fixture; no live cloud credentials. */
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { publishPresentation } from '../src/presentation/reports.ts'
import {
  MarivoPresentationFileService,
  registerMarivoPresentationRpc,
} from '../src/presentation/rpc.ts'
import { registerPublishingCredentials } from '../src/report-publishing/adapters.ts'
import { resolvePublishingConfig } from '../src/report-publishing/config.ts'
import { ReportPublishingService } from '../src/report-publishing/service.ts'
import { interactionFixture } from '../tests/presentation-reader/interaction-fixture.ts'
import { createConnectionFixture } from '../tests/semantic-reference-input/fixtures.ts'

const root = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-publishing-browser-')))
const { document } = await interactionFixture()
await publishPresentation(root, document, null, async () => {})
const fixture = createConnectionFixture()
const files = new MarivoPresentationFileService(
  () => undefined,
  (id) => (id === document.workspaceId ? { id, path: root } : undefined),
)
const stopFiles = registerMarivoPresentationRpc(fixture.connection, files)
const values = new Map<string, string>()
const objects = new Map<string, Buffer>()
let bundle = ''
let rejectUpload = false
const server = createServer(async (request, response) => {
  try {
    if (request.method === 'PUT') {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      if (rejectUpload) {
        response.writeHead(403).end()
        return
      }
      assert.match(request.headers.authorization ?? '', /Credential=browser-ak/)
      assert.equal(request.headers['content-type'], 'text/html; charset=utf-8')
      objects.set(request.url!.split('?')[0]!, Buffer.concat(chunks))
      response.writeHead(200, { ETag: '"test"' }).end()
    } else if (request.url?.startsWith('/api/')) {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      const route = fixture.routes.get(request.url!)!
      const result = await route.fetch(
        new Request(`http://localhost${request.url}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: Buffer.concat(chunks),
        }),
      )
      response
        .writeHead(result.status, { 'content-type': 'application/json' })
        .end(await result.text())
    } else if (request.url === '/app.js')
      response.writeHead(200, { 'content-type': 'text/javascript' }).end(bundle)
    else if (objects.has(request.url!))
      response
        .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        .end(objects.get(request.url!))
    else
      response
        .writeHead(200, { 'content-type': 'text/html' })
        .end('<div id="root"></div><script src="/app.js"></script>')
  } catch {
    response.writeHead(500).end('fixture failure')
  }
})
server.listen(0, '127.0.0.1')
await new Promise<void>((resolve) => server.once('listening', resolve))
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
const config = resolvePublishingConfig({
  enabled: true,
  storage: {
    name: '验收存储',
    endpoint: base,
    region: 'us-east-1',
    bucket: 'reports',
    forcePathStyle: true,
    accessKeyIdRef: 'REPORT_AK',
    secretAccessKeyRef: 'REPORT_SK',
  },
  publicBaseUrl: `${base}/reports`,
  pathPrefix: 'html',
})!
const store = {
  describe: async (ref: string) => ({
    configured: values.has(ref),
    writable: true,
    source: 'file',
  }),
  resolve: async (ref: string) =>
    values.has(ref) ? { value: values.get(ref)!, source: 'file' } : undefined,
  set: async (ref: string, value: string) => {
    values.set(ref, value)
  },
  unset: async (ref: string) => {
    values.delete(ref)
  },
}
let stopPublishing = registerPublishingCredentials(
  fixture.connection,
  new ReportPublishingService(config, store, files),
  (id) => id === document.workspaceId,
)
const entry = `
import React, { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { HostPresentationReader } from './packages/dsh-data-analysis/src/client/presentation/host-entry.tsx';
import { PresentationDeliveryModel } from './packages/dsh-data-analysis/src/client/presentation/delivery-model.ts';
import { CredentialClientModel } from './packages/dsh-data-analysis/src/client/credentials/model.ts';
import { ReportPublishingCredentials } from './packages/dsh-data-analysis/src/client/credentials/report-publishing.tsx';
import { credentialStyles } from './packages/dsh-data-analysis/src/client/credentials/styles.ts';
const rpc = { call: async (channel, endpoint, payload, signal) => {
 const method = channel.slice(1) + '/' + endpoint;
 const response = await fetch('/api/' + method, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({type:'client-request',rpcId:'browser',method,payload}), signal });
 return (await response.json()).result;
}};
const model = new PresentationDeliveryModel(rpc);
const credentials = new CredentialClientModel(rpc);
window.model = model;
function App() {
 const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
 return <><section className="mc-panel"><style>{credentialStyles}</style><ReportPublishingCredentials model={credentials} workspaceId=${JSON.stringify(document.workspaceId)} /></section>
 {state.document && <HostPresentationReader document={state.document} exportActions={{ downloadFullReport:()=>model.downloadDisplayed(), publishing:state.publishingName ? {name:state.publishingName,publish:()=>model.publishDisplayed(),publishView:bytes=>model.publishDisplayed(bytes)}:undefined,publishingUnavailable:state.publishingUnavailable,downloading:state.downloading,report:{version:state.document.buildId,refresh:()=>model.showReport(${JSON.stringify(document.workspaceId)},'report'),edit:()=>{},history:()=>{}} }} />}
 {state.downloadError && <p role="alert">{state.downloadError}</p>}{state.publicationUrl && <a href={state.publicationUrl}>打开已发布报告</a>}
 </>;
}
createRoot(document.getElementById('root')).render(<App/>);
model.showReport(${JSON.stringify(document.workspaceId)}, 'report');
`
bundle = (
  await build({
    stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    loader: { '.wasm': 'binary' },
    jsx: 'automatic',
  })
).outputFiles[0]!.text
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({
  viewport: { width: 1300, height: 1000 },
  acceptDownloads: true,
})
let downloads = 0
const errors: string[] = []
page.on('download', () => downloads++)
page.on('pageerror', (error) => errors.push(error.message))
const menu = async (name: string) => {
  await page.getByRole('button', { name: '报告更多操作', exact: true }).click()
  await page.getByRole('menuitem', { name, exact: true }).click()
}
try {
  await page.goto(base)
  await page.getByRole('heading', { name: '报告发布凭证 · 验收存储' }).waitFor()
  await menu('发布 HTML 报告到验收存储')
  await page.getByRole('alert').filter({ hasText: '发布凭证尚未配齐' }).waitFor()
  for (const [field, reference, value] of [
    ['accessKeyId', 'REPORT_AK', 'browser-ak'],
    ['secretAccessKey', 'REPORT_SK', 'browser-sk'],
  ]) {
    await page.locator(`#report-publishing-${field}`).fill(value!)
    await page
      .getByRole('group', { name: reference, exact: true })
      .getByRole('button', { name: '新增凭证', exact: true })
      .click()
    await page.waitForFunction(
      (field) =>
        globalThis.document.querySelector<HTMLInputElement>('#report-publishing-' + field) === null,
      field,
    )
  }
  assert(
    !(await page
      .locator('body')
      .innerText()
      .then((text) => text.includes('browser-sk'))),
  )
  await menu('发布 HTML 报告到验收存储')
  await page.getByRole('link', { name: '打开已发布报告' }).waitFor()
  assert.equal(objects.size, 1)
  await page.getByRole('button', { name: /^日期/ }).click()
  await page.getByRole('menuitemradio', { name: '周一', exact: true }).click()
  const reportUrl = await page.getByRole('link', { name: '打开已发布报告' }).getAttribute('href')
  await menu('发布当前视图 HTML 到验收存储')
  await page.waitForFunction((previous) => {
    const link = globalThis.document.querySelector<HTMLAnchorElement>('a')
    return !!link && link.href !== previous
  }, reportUrl)
  assert.equal(objects.size, 2)
  const view = [...objects.entries()].at(-1)!
  assert(view[1].toString().includes('周一'))
  assert(!view[1].toString().includes('<script'))
  assert.equal(downloads, 0)
  await page.screenshot({ path: '/tmp/dsh-report-publishing-browser.png', fullPage: true })
  const published = await browser.newPage()
  await published.goto(base + view[0])
  await published.getByText('当前视图 · 已固定筛选与展示配置', { exact: true }).waitFor()
  await published.close()
  rejectUpload = true
  await menu('发布 HTML 报告到验收存储')
  await page.getByRole('alert').filter({ hasText: '发布结果未确认' }).waitFor()
  await stopPublishing()
  const nextConfig = {
    ...config,
    storage: { ...config.storage, name: '更新存储', secretAccessKeyRef: 'NEW_REPORT_SK' },
  }
  stopPublishing = registerPublishingCredentials(
    fixture.connection,
    new ReportPublishingService(nextConfig, store, files),
    () => true,
  )
  await menu('发布 HTML 报告到验收存储')
  await page.getByRole('alert').filter({ hasText: '发布配置已变化' }).waitFor()
  await page
    .getByRole('group', { name: 'REPORT_SK', exact: true })
    .getByRole('button', { name: '更换', exact: true })
    .click()
  await page.locator('#report-publishing-secretAccessKey').fill('stale-form-value')
  await page.getByRole('button', { name: '确认更换', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '发布配置已变化，请刷新凭证状态' }).waitFor()
  assert.equal(values.get('REPORT_SK'), 'browser-sk')
  assert.equal(values.has('NEW_REPORT_SK'), false)
  assert.equal(objects.size, 2)
  await page.getByRole('button', { name: '刷新凭证状态', exact: true }).click()
  await page.getByRole('heading', { name: '报告发布凭证 · 更新存储', exact: true }).waitFor()
  assert.equal(await page.locator('#report-publishing-secretAccessKey').inputValue(), '')
  await page.locator('#report-publishing-secretAccessKey').fill('fresh-form-value')
  await page.getByRole('button', { name: '新增凭证', exact: true }).click()
  await page.waitForFunction(
    () =>
      globalThis.document.querySelector<HTMLInputElement>('#report-publishing-secretAccessKey') ===
      null,
  )
  assert.equal(values.get('NEW_REPORT_SK'), 'fresh-form-value')
  await stopPublishing()
  stopPublishing = registerPublishingCredentials(
    fixture.connection,
    new ReportPublishingService(undefined, store, files),
    () => true,
  )
  await page.reload()
  await page.getByRole('button', { name: '报告更多操作', exact: true }).click()
  assert.equal(await page.getByRole('menuitem', { name: '下载完整报告', exact: true }).count(), 1)
  assert.equal(await page.getByRole('menuitem', { name: '导出当前视图', exact: true }).count(), 1)
  assert.equal(await page.getByRole('button', { name: /报告发布凭证/ }).count(), 0)
  assert.deepEqual(errors, [])
  console.log(
    'PASS: production browser credentials, missing credentials, both publication actions, filtered HTML, no downloads, upload failure, stale configuration rejection, refreshed credential edits, and disabled menus; local HTTP S3 fixture only.',
  )
} finally {
  await browser.close()
  await stopPublishing()
  await stopFiles()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await rm(root, { recursive: true, force: true })
}
