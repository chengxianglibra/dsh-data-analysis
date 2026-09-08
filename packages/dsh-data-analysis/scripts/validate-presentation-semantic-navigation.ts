/** Production client installers and file service, synthetic Catalog; no live Harness or Agent. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { kindLabels } from '../src/client/semantic-browser/labels.ts'
import { publishPresentation } from '../src/presentation/reports.ts'
import { MarivoPresentationFileService } from '../src/presentation/rpc.ts'
import { interactionFixture } from '../tests/presentation-reader/interaction-fixture.ts'
import { object, snapshot } from '../tests/semantic-browser/fixtures.ts'

const output = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-semantic-navigation-')))
process.stdout.write(`Semantic navigation acceptance: ${output}\n`)
const { document } = await interactionFixture()
// The label map is presentation metadata, never a navigation allowlist.
const allKindObjects = [...Object.keys(kindLabels), 'future_kind'].map((kind) =>
  object(`navigation_${kind}`, kind),
)
document.sources = [
  {
    id: 'semantic-source',
    status: 'available',
    label: 'Saved source',
    ref: { sessionId: 'analysis', artifactRef: 'saved' },
    facts: [
      {
        label: '公开语义引用',
        value: JSON.stringify([
          { kind: 'metric', path: 'sales.zz_target' },
          { kind: 'dimension', path: 'sales.region' },
          { kind: 'metric', path: 'sales.deleted' },
          { path: 'sales.untyped' },
          ...allKindObjects.map((item) => item.ref),
        ]),
      },
    ],
  },
]
for (const dataset of document.datasets) dataset.sourceIds = ['semantic-source']
const workspace = path.join(output, 'workspace')
await mkdir(workspace)
const receipt = await publishPresentation(workspace, document, null, async () => {})
const delivery = {
  kind: 'marivo.presentation.delivery',
  schemaVersion: 2,
  dshSessionId: 'test',
  turn: 0,
  receipt,
}
const portable = path.join(output, 'report.html')
await writeFile(portable, await readFile(receipt.files.html.path))
const bundle = await build({
  loader: { '.wasm': 'binary' },
  stdin: {
    resolveDir: fileURLToPath(new URL('../', import.meta.url)),
    loader: 'tsx',
    contents: `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {installSemanticBrowser} from './src/client/semantic-browser/install.tsx';
import {installPresentation} from './src/client/presentation/install.tsx';
import {PRESENTATION_TURN_DATA_KEY} from './src/client/presentation/delivery.ts';
const registrations=[];
const ctx={effect(install){install();},on(){},conversationEvents:{register(){return()=>{};}},
slots:{inject(name,install){install();},register(options,component){registrations.push({options,component});return()=>{};}}};
const rpc={call:async(channel,endpoint,payload,signal)=>(await fetch('/rpc',{method:'POST',body:JSON.stringify({endpoint,payload}),signal})).json()};
const openSemanticObject=installSemanticBrowser(ctx,rpc);
installPresentation(ctx,rpc,openSemanticObject);
const delivery=${JSON.stringify(delivery)};
const workspaces=[{workspaceId:delivery.receipt.workspaceId,sessionIds:['test']},{workspaceId:'other',sessionIds:['other']}];
const node={kind:PRESENTATION_TURN_DATA_KEY,target:'chat',location:{kind:'turn',turn:{turn:0}},data:{deliveries:[{seq:1,delivery}]}};
function App(){const [session,setSession]=useState('test');window.setFixtureSession=setSession;
const props={node,sessionId:session,useWorkspaces:selector=>selector({items:workspaces,state:'idle',phase:'ready'}),useSessions:selector=>selector({current:session})};
return <>{registrations.map(({options,component:Component},index)=><Component key={index} {...props}/>)}</>;}
createRoot(document.getElementById('app')).render(<App/>);`,
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'silent',
})
const service = new MarivoPresentationFileService(async (session) =>
  session === 'test' ? { id: document.workspaceId, path: workspace } : undefined,
)
const catalog = snapshot(document.workspaceId, [
  ...Array.from({ length: 85 }, (_, index) => object(`a${index}`)),
  { ...object('zz_target'), definition: '当前指标定义' },
  { ...object('zz_target', 'measure'), definition: '同路径的度量，不是目标指标' },
  object('region', 'dimension'),
  ...allKindObjects,
])
let catalogMode: 'ready' | 'empty' | 'error' = 'ready'
const requests: { endpoint: string; payload: Record<string, unknown> }[] = []
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/app.js') {
      res.setHeader('content-type', 'text/javascript')
      res.end(bundle.outputFiles[0]!.text)
      return
    }
    if (req.url === '/rpc') {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const { endpoint, payload } = JSON.parse(Buffer.concat(chunks).toString())
      requests.push({ endpoint, payload })
      let value: unknown
      if (endpoint === 'semantic-browser/catalog') {
        assert.equal(payload.workspaceId, document.workspaceId)
        if (catalogMode === 'error') throw new Error('Catalog 暂不可用')
        value = catalogMode === 'empty' ? snapshot(document.workspaceId, []) : catalog
      } else
        value =
          endpoint === 'files/read'
            ? await service.read(payload)
            : await service.report(endpoint, payload)
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ ok: true, value }))
      return
    }
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end(
      '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>报告语义导航验收</title><div id="app"></div><script src="/app.js"></script></html>',
    )
  } catch (error) {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ ok: false, error: { message: String(error) } }))
  }
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
assert(address && typeof address !== 'string')
const browser = await chromium.launch({ headless: true })
const checks: string[] = [],
  errors: string[] = []
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(10_000)
  page.on('pageerror', (error: Error) => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${address.port}`)
  await page.getByRole('button', { name: '打开分析', exact: true }).click()
  const report = page.locator('.pd-dialog')
  const reader = report.locator('[data-mode="interactive"]')
  await reader.getByRole('heading', { name: document.title, exact: true }).waitFor()
  assert.equal(requests.filter((item) => item.endpoint === 'semantic-browser/catalog').length, 0)
  await report.getByRole('button', { name: '编辑报告', exact: true }).click()
  await reader.getByRole('textbox', { name: '报告标题', exact: true }).fill('保留未保存的报告标题')
  await reader.getByRole('button', { name: /^日期/ }).click()
  await reader.getByRole('menuitemradio', { name: '周一', exact: true }).click()
  const metric = reader.locator('[data-block-id="count"]')
  const valueBefore = await metric.locator('[data-metric-value]').innerText()
  await metric.getByRole('button', { name: 'cell 更多操作' }).click()
  await metric.getByRole('menuitem', { name: '数据源', exact: true }).click()
  const source = report.locator('.pr-source-dialog')
  const target = source.getByRole('button', { name: 'sales.zz_target', exact: true })
  await source.screenshot({ path: path.join(output, 'source-links.png') })
  await target.focus()
  await page.keyboard.press('Enter')
  const semantic = page.locator('.sb-dialog')
  await semantic.getByRole('heading', { name: 'zz_target', exact: true }).waitFor()
  await semantic.locator('.sb-detail').getByText('当前指标定义', { exact: true }).waitFor()
  assert.equal(
    await semantic.locator('.sb-objects [aria-pressed="true"] .sb-ref').innerText(),
    'metric:sales.zz_target',
  )
  assert.match(await semantic.innerText(), /当前语义定义.*报告数据与来源/s)
  assert.equal(await page.locator('dialog[open]').count(), 3)
  // Wait for the React scroll effect; allow fractional CSS-pixel rounding at the edge.
  await page.waitForFunction(() => {
    const element = window.document.querySelector('.sb-objects [aria-pressed="true"]')
    if (!element) return false
    const bounds = element.getBoundingClientRect()
    const list = element.closest('.sb-list')!.getBoundingClientRect()
    return bounds.top >= list.top - 1 && bounds.bottom <= list.bottom + 1
  })
  await semantic.screenshot({ path: path.join(output, 'semantic-desktop.png') })
  await semantic.getByRole('textbox', { name: '搜索语义对象' }).fill('不存在的搜索')
  await page.keyboard.press('Escape')
  await semantic.waitFor({ state: 'detached' })
  assert.equal(
    await target.evaluate((element) => element === element.ownerDocument.activeElement),
    true,
  )
  assert.equal(await page.locator('dialog[open]').count(), 2)
  await source.getByRole('button', { name: 'sales.region', exact: true }).click()
  await semantic.getByRole('heading', { name: 'region', exact: true }).waitFor()
  assert.equal(await semantic.getByRole('textbox', { name: '搜索语义对象' }).inputValue(), '')
  await semantic.getByRole('button', { name: '关闭语义层' }).click()
  await source.getByRole('button', { name: 'sales.deleted', exact: true }).click()
  await semantic.getByText('所选对象已不在当前 Catalog 中，请重新选择。', { exact: true }).waitFor()
  await semantic.getByRole('button', { name: '关闭语义层' }).click()
  checks.push(
    'keyboard exact kind/path selection on target page; dimension navigation; missing object; filters cleared; stacked dialogs and focus restoration',
  )
  for (const item of allKindObjects) {
    const trigger = source.getByRole('button', { name: item.ref.path, exact: true })
    await trigger.click()
    await semantic.getByRole('heading', { name: item.name, exact: true }).waitFor()
    assert.equal(
      await semantic.locator('.sb-objects [aria-pressed="true"] .sb-ref').innerText(),
      `${item.ref.kind}:${item.ref.path}`,
    )
    if (item.ref.kind === 'entity')
      await semantic.screenshot({ path: path.join(output, 'semantic-entity.png') })
    await semantic.getByRole('button', { name: '关闭语义层' }).click()
    assert.equal(
      await trigger.evaluate((element) => element === element.ownerDocument.activeElement),
      true,
    )
  }
  checks.push(
    `all ${Object.keys(kindLabels).length} current kinds, including entity, and one future kind navigate and return focus`,
  )
  catalogMode = 'empty'
  await target.click()
  await semantic.getByText('所选对象已不在当前 Catalog 中，请重新选择。', { exact: true }).waitFor()
  await semantic.getByRole('button', { name: '关闭语义层' }).click()
  catalogMode = 'error'
  await target.click()
  await semantic.getByRole('alert').filter({ hasText: 'Catalog 暂不可用' }).waitFor()
  assert.equal(await semantic.getByRole('heading', { name: 'zz_target', exact: true }).count(), 0)
  await semantic.getByRole('button', { name: '关闭语义层' }).click()
  catalogMode = 'ready'
  await page.setViewportSize({ width: 390, height: 844 })
  await target.click()
  await semantic.getByRole('heading', { name: 'zz_target', exact: true }).waitFor()
  await semantic.screenshot({ path: path.join(output, 'semantic-mobile.png') })
  await semantic.getByRole('button', { name: '关闭语义层' }).click()
  await source.getByRole('button', { name: '关闭数据源' }).click()
  assert.equal(
    await reader.getByRole('textbox', { name: '报告标题' }).inputValue(),
    '保留未保存的报告标题',
  )
  assert.equal(await metric.locator('[data-metric-value]').innerText(), valueBefore)
  assert.match(await reader.getByRole('button', { name: /^日期/ }).innerText(), /周一/)
  assert.equal(
    requests.some((item) => item.endpoint === 'reports/save'),
    false,
  )
  checks.push(
    'empty Catalog and read failure; mobile detail; unsaved editing and global filter state preserved',
  )
  await metric.getByRole('button', { name: 'cell 更多操作' }).click()
  await metric.getByRole('menuitem', { name: '数据源', exact: true }).click()
  await target.click()
  await semantic.getByRole('heading', { name: 'zz_target', exact: true }).waitFor()
  await page.evaluate(() =>
    (window as unknown as { setFixtureSession: (id: string) => void }).setFixtureSession('other'),
  )
  await semantic.waitFor({ state: 'detached' })
  await reader.waitFor({ state: 'detached' })
  await report
    .getByRole('alert')
    .filter({ hasText: 'Workspace 或 Session 已变化或不可用' })
    .waitFor()
  assert(
    requests
      .filter((item) => item.endpoint === 'semantic-browser/catalog')
      .every((item) => item.payload.workspaceId === document.workspaceId),
  )
  checks.push(
    'session switch closes semantic view and invalidates report content; all Catalog calls retain report Workspace',
  )
  const offline = await browser.newPage()
  await offline.goto(pathToFileURL(portable).href)
  const offlineReader = offline.locator('[data-mode="interactive"]')
  await offlineReader.getByRole('heading', { name: document.title, exact: true }).waitFor()
  await offline.context().setOffline(true)
  await offlineReader
    .locator('[data-block-id="count"]')
    .getByRole('button', { name: 'cell 更多操作' })
    .click()
  await offlineReader.getByRole('menuitem', { name: '数据源', exact: true }).click()
  await offlineReader
    .locator('.pr-source-dialog')
    .getByText('sales.zz_target', { exact: true })
    .waitFor()
  assert.equal(await offline.locator('.pr-semantic-link').count(), 0)
  const noScript = await browser.newPage({ javaScriptEnabled: false })
  await noScript.goto(pathToFileURL(portable).href)
  assert.equal(await noScript.locator('.pr-semantic-link').count(), 0)
  assert.match(
    (await noScript.locator('.pr-source-summary').textContent()) ?? '',
    /sales.zz_target/,
  )
  checks.push(
    'offline interactive HTML and no-script snapshots retain readable references without host links',
  )
  assert.deepEqual(errors, [])
  assert(
    requests.every((item) =>
      ['semantic-browser/catalog', 'files/read', 'reports/resolve'].includes(item.endpoint),
    ),
  )
  await writeFile(
    path.join(output, 'result.json'),
    JSON.stringify({ checks, requests, errors }, null, 2),
  )
  process.stdout.write(`${JSON.stringify({ output, checks, errors }, null, 2)}\n`)
} finally {
  await browser.close()
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
}
