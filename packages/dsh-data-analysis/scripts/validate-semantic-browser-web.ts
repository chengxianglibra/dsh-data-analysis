/** Real Chromium + real Marivo, with an isolated DSH slot/Workspace transport fixture. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { bindMarivoEnvironment } from '../src/environment/index.ts'
import { browserFailure, SemanticBrowserService } from '../src/semantic-browser/service.ts'
import { createBrowserWorkspace } from '../tests/semantic-browser/fixtures.ts'

const playwrightModule = process.env.DSH_DATA_ANALYSIS_PLAYWRIGHT_MODULE ?? 'playwright'
const serveOnly = process.env.DSH_DATA_ANALYSIS_BROWSER_SERVE_ONLY === '1'
const python =
  process.env.DSH_DATA_ANALYSIS_TEST_PYTHON ??
  path.join(homedir(), '.dsh/dsh-data-analysis/runtimes/marivo/.venv/bin/python')
const output = path.resolve(
  process.env.DSH_DATA_ANALYSIS_BROWSER_OUTPUT ??
    path.join(tmpdir(), 'dsh-semantic-browser-validation'),
)
await mkdir(output, { recursive: true })
const temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-semantic-browser-web-')))
const rootA = path.join(temporary, 'sales'),
  rootB = path.join(temporary, 'empty')
await mkdir(rootA)
await mkdir(rootB)
await createBrowserWorkspace(rootA)
await mkdir(path.join(rootA, 'models/semantic/ops'))
await writeFile(
  path.join(rootA, 'models/semantic/ops/_domain.py'),
  'import marivo.semantic as ms\nms.domain(name="ops", owner="Operations")\n',
)
await writeFile(
  path.join(rootA, 'models/semantic/ops/objects.py'),
  'import marivo.semantic as ms\nimport marivo.datasource as md\njobs = ms.entity(name="jobs", datasource=ms.ref.datasource("warehouse"), source=md.table("jobs"))\n',
)
const fixtureFile = path.join(rootA, 'models/semantic/sales/objects.py')
const originalModel = await readFile(fixtureFile, 'utf8')
await writeFile(
  fixtureFile,
  originalModel +
    '\n' +
    Array.from(
      { length: 85 },
      (_, i) => `@ms.metric()\ndef metric_${i}():\n    return amount.sum()`,
    ).join('\n'),
)
const runners = new Map(
  await Promise.all(
    [rootA, rootB].map(
      async (root) =>
        [
          root,
          await bindMarivoEnvironment({ projectRoot: root, pythonExecutable: python }),
        ] as const,
    ),
  ),
)
const workspaceList = [
  { workspaceId: 'sales', title: '销售分析', path: rootA, sessionIds: ['sales-session'] },
  { workspaceId: 'empty', title: '空项目', path: rootB, sessionIds: ['empty-session'] },
]
const service = new SemanticBrowserService({
  getWorkspace: (id) => {
    const item = workspaceList.find((item) => item.workspaceId === id)
    return item ? { id, path: item.path } : undefined
  },
  projectRoot: (item) => item.path,
  resolve: async (root) => {
    const runner = runners.get(root)
    if (!runner) throw new Error('unknown-workspace')
    return runner
  },
})
const panelPath = fileURLToPath(
  new URL('../src/client/semantic-browser/panel.tsx', import.meta.url),
)
const modelPath = fileURLToPath(new URL('../src/client/semantic-browser/model.ts', import.meta.url))
const app = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: 'tsx',
    contents: `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CopyProvider} from './packages/dsh-data-analysis/src/client/i18n/context.tsx';
import {translator} from './packages/dsh-data-analysis/src/client/i18n/copy.ts';
import {SemanticBrowserPanel} from ${JSON.stringify(panelPath)};
import {SemanticBrowserModel} from ${JSON.stringify(modelPath)};
const model=new SemanticBrowserModel({call:async(channel,endpoint,payload,signal)=>{
 const response=await fetch('/catalog',{method:'POST',body:JSON.stringify(payload),signal}); return response.json();
}});
const workspaces=${JSON.stringify(workspaceList)};
function App(){ const [sessionId,setSessionId]=useState('sales-session'); window.setFixtureSession=(id)=>{model.close();setSessionId(id)};
return <><h1>语义层 Tab 正文验收夹具</h1><p>真实 Marivo Catalog · 无 live Agent · 仅临时项目</p><button onClick={()=>model.show(workspaces.find(w=>w.sessionIds.includes(sessionId)).workspaceId)}>打开语义层</button><div style={{height:'calc(100dvh - 150px)',minWidth:0}}><SemanticBrowserPanel model={model} workspaces={workspaces}/></div></>; }
createRoot(document.getElementById('app')).render(<CopyProvider t={translator('zh-CN')}><App/></CopyProvider>);
`,
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
})
let requests = 0,
  fail = false
const server = createServer(async (req, res) => {
  if (req.url === '/app.js') {
    res.setHeader('Content-Type', 'text/javascript')
    res.end(app.outputFiles[0]!.text)
    return
  }
  if (req.url !== '/catalog') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(
      '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>语义层浏览器验收</title><div id="app"></div><script src="/app.js"></script></html>',
    )
    return
  }
  requests++
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  const controller = new AbortController()
  res.on('close', () => controller.abort())
  try {
    if (fail) throw new Error('fixture-failure')
    const value = await service.read(
      JSON.parse(Buffer.concat(chunks).toString()),
      controller.signal,
    )
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: true, value }))
  } catch (error) {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: false, error: { message: browserFailure(error) } }))
  }
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
if (!address || typeof address === 'string') throw new Error('listener-unavailable')
const url = `http://127.0.0.1:${address.port}`
if (serveOnly) {
  console.log(JSON.stringify({ url, temporary, output }))
  await new Promise<void>((resolve) => {
    process.once('SIGTERM', resolve)
    process.once('SIGINT', resolve)
  })
  await service.close()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await rm(temporary, { recursive: true, force: true })
  process.exit(0)
}
const { chromium } = await import(playwrightModule)
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  permissions: ['clipboard-read', 'clipboard-write'],
})
const page = await context.newPage()
const errors: string[] = []
page.on('pageerror', (error: Error) => errors.push(error.message))
const checks: string[] = []
try {
  await page.goto(url)
  await page.getByRole('button', { name: '打开语义层' }).waitFor()
  assert.equal(requests, 0)
  await page.getByRole('button', { name: '打开语义层' }).click()
  await page.getByRole('button', { name: '下一页' }).waitFor({ timeout: 30000 })
  assert.equal(await page.getByLabel('选择 Workspace').count(), 0)
  assert.equal(requests, 1)
  checks.push('Tab 正文使用指定 Workspace、无 live Agent 真实 Catalog 读取、大目录分页')
  await page.getByLabel('搜索语义对象').fill('metric:sales.linear')
  await page.getByRole('region', { name: '对象列表' }).getByRole('button').first().click()
  await page.getByRole('button', { name: '定义', exact: true }).click()
  const computation = page.getByRole('region', { name: '指标计算口径' })
  await computation.waitFor()
  assert.match(await computation.innerText(), /revenue/)
  const dependency = computation.getByRole('region', { name: 'metric:sales.revenue', exact: true })
  await dependency.waitFor()
  await dependency.getByText('时间绑定', { exact: true }).waitFor()
  await dependency.getByRole('button', { name: 'sales.revenue', exact: true }).click()
  await page.getByRole('heading', { name: 'revenue', exact: true }).waitFor()
  await page.getByRole('button', { name: '返回上个对象', exact: true }).click()
  assert.equal(requests, 1)
  checks.push('新版公式、时间绑定、空值规则与依赖展示；引用跳转返回不重读')
  await page.getByLabel('搜索语义对象').fill('')
  const reads = requests
  const classification = page.getByRole('navigation', { name: '对象分类' })
  await classification.getByRole('button', { name: /^实体\s*3$/ }).waitFor()
  await classification.getByRole('button', { name: /^实体\s*3$/ }).click()
  await page.getByLabel('筛选业务域').selectOption('ops')
  await classification.getByRole('button', { name: /^实体\s*1$/ }).waitFor()
  await classification.getByRole('button', { name: /^指标\s*0$/ }).waitFor()
  await page
    .getByRole('region', { name: '对象列表' })
    .getByText('1 个对象', { exact: true })
    .waitFor()
  await page.getByLabel('筛选业务域').selectOption('sales')
  await classification.getByRole('button', { name: /^实体\s*2$/ }).waitFor()
  await page.getByLabel('搜索语义对象').fill('orders')
  await classification.getByRole('button', { name: /^实体\s*2$/ }).waitFor()
  await page.getByLabel('搜索语义对象').fill('')
  await page.getByLabel('筛选业务域').selectOption('')
  await classification.getByRole('button', { name: /^实体\s*3$/ }).waitFor()
  await classification.getByRole('button', { name: /^全部对象/ }).click()
  const allObjects = await page
    .getByRole('region', { name: '对象列表' })
    .locator('.sb-count')
    .innerText()
  assert.equal(
    (await classification.getByRole('button', { name: /^全部对象/ }).innerText()).replace(
      /\D/g,
      '',
    ),
    allObjects.replace(/\D/g, ''),
  )
  assert.equal(requests, reads)
  checks.push('业务域切换同步更新全部对象与各类型数量；类型选择和搜索不缩减分类计数')
  await page.getByRole('button', { name: '下一页' }).click()
  await page.getByLabel('筛选业务域').selectOption('sales')
  await page
    .getByRole('navigation', { name: '对象分类' })
    .getByRole('button', { name: /^指标/ })
    .click()
  await page.getByLabel('搜索语义对象').fill('收入')
  await page
    .getByRole('region', { name: '对象列表' })
    .getByRole('button', { name: /^revenue/ })
    .click()
  await page.getByRole('heading', { name: 'revenue', exact: true }).waitFor()
  await page.getByRole('button', { name: '概览', exact: true }).click()
  await page
    .getByText(/收入 Revenue <script>/)
    .last()
    .waitFor()
  assert.equal(await page.evaluate('window.secret'), undefined)
  assert.equal(requests, reads)
  await page.getByRole('button', { name: '复制引用', exact: true }).click()
  assert.equal(await page.evaluate('navigator.clipboard.readText()'), 'metric:sales.revenue')
  await page.screenshot({ path: path.join(output, 'desktop-overview.png') })
  await page.getByRole('button', { name: '定义', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: '复制定义位置' }).count(), 0)
  await page.getByText(/objects.py:\d+$/).waitFor()
  assert.equal(await page.getByText(/Marivo 提供的规范化 Ibis 表达式/).count(), 0)
  assert.equal(await page.getByText(/根据当前 Catalog 定义展示/).count(), 0)
  await page.getByRole('button', { name: '关系', exact: true }).click()
  await page.getByRole('button', { name: '查看关系图' }).click()
  await page.getByRole('button', { name: '再展开一层' }).click()
  await page.getByRole('button', { name: '放大关系图' }).click()
  const svg = page.getByRole('img', { name: '当前对象的局部关系图' })
  const box = await svg.boundingBox()
  await page.mouse.move(box.x + 20, box.y + 20)
  await page.mouse.down()
  await page.mouse.move(box.x + 60, box.y + 40)
  await page.mouse.up()
  await page.getByRole('button', { name: '回到中心' }).click()
  await page.screenshot({ path: path.join(output, 'desktop-relations.png') })
  await page.getByRole('button', { name: '查看 amount', exact: true }).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('heading', { name: 'amount', exact: true }).waitFor()
  await page.getByRole('button', { name: '返回上个对象' }).click()
  await page.getByRole('heading', { name: 'revenue', exact: true }).waitFor()
  checks.push(
    '搜索筛选不重读、文本注入隔离、引用复制与定义位置展示、关系图展开/缩放/平移/键盘跳转/返回',
  )
  assert.equal(await page.getByRole('button', { name: /刷新/ }).count(), 1)
  const refresh = page.getByRole('button', { name: '刷新语义层' })
  assert.equal(await refresh.locator('svg').count(), 1)
  assert.equal(await page.locator('.sb-meta').count(), 0)
  assert.equal(await page.getByText(/项目：|Catalog sha256:/).count(), 0)
  const updated = page.locator('.sb-header time')
  assert.match(await updated.innerText(), /^更新于 /)
  assert.ok(await updated.getAttribute('datetime'))
  const titleBox = await page.locator('.sb-header h1').boundingBox()
  const updatedBox = await updated.boundingBox()
  assert.ok(updatedBox.x > titleBox.x + titleBox.width)
  const header = await page.locator('.sb-header').boundingBox()
  const refreshBox = await refresh.boundingBox()
  assert.ok(refreshBox.x > header.x + header.width / 2)
  assert.ok(Math.abs(refreshBox.y + refreshBox.height / 2 - header.y - header.height / 2) < 3)
  const beforeNavigation = requests
  await page.getByRole('button', { name: '返回上个对象' }).click()
  assert.equal(requests, beforeNavigation, 'Object history must use the loaded Catalog')
  await page.getByLabel('搜索语义对象').fill('revenue')
  await page.locator('.sb-objects button').filter({ hasText: 'metric:sales.revenue' }).click()
  assert.equal(requests, beforeNavigation, 'Object selection must not refresh')
  fail = true
  await page.getByRole('button', { name: '刷新语义层', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '当前显示上次成功加载的内容' }).waitFor()
  await page.getByRole('heading', { name: 'revenue', exact: true }).waitFor()
  fail = false
  await page.evaluate("window.setFixtureSession('empty-session')")
  await page.locator('.sb-panel').waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '打开语义层' }).click()
  await page.getByText('当前项目没有语义层对象。').waitFor({ timeout: 30000 })
  await page.evaluate("window.setFixtureSession('sales-session')")
  await page.locator('.sb-panel').waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '打开语义层' }).click()
  await page.getByRole('button', { name: '刷新语义层', exact: true }).waitFor({ timeout: 30000 })
  await page.waitForFunction(() => !document.querySelector('.sb-refresh')?.hasAttribute('disabled'))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('heading', { name: 'revenue', exact: true }).waitFor()
  await page.screenshot({ path: path.join(output, 'mobile-detail.png') })
  const bounds = await page.locator('.sb-panel').boundingBox()
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391)
  await page.getByRole('button', { name: '返回列表', exact: true }).click()
  await page.getByLabel('搜索语义对象').fill('does-not-exist')
  await page.getByText('没有匹配对象，请调整搜索或筛选条件。').waitFor()
  assert.equal(await page.getByRole('dialog').count(), 0)
  checks.push('刷新失败保留旧内容、空项目、Workspace 隔离、窄屏、空搜索、无语义弹窗')
  assert.deepEqual(errors, [])
  await writeFile(
    path.join(output, 'result.json'),
    JSON.stringify(
      {
        status: 'passed',
        harness: 'real Chromium + real Marivo; isolated DSH slot/Workspace fixture',
        checks,
        requests,
        errors,
      },
      null,
      2,
    ),
  )
  console.log(JSON.stringify({ status: 'passed', output, checks }, null, 2))
} finally {
  await browser.close()
  service.dispose()
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
  await rm(temporary, { recursive: true, force: true })
}
