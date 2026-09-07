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
const { chromium } = await import(playwrightModule)
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
      (_, i) => `metric_${i} = ms.aggregate(name="metric_${i}", measure=amount, agg="sum")`,
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
  { workspaceId: 'sales', title: '销售分析', path: rootA, sessionIds: [] },
  { workspaceId: 'empty', title: '空项目', path: rootB, sessionIds: [] },
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
const installer = fileURLToPath(
  new URL('../src/client/semantic-browser/install.tsx', import.meta.url),
)
const app = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: 'tsx',
    contents: `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {installSemanticBrowser} from ${JSON.stringify(installer)};
const registrations=[], callbacks={};
const ctx={
 effect(install){ install(); },
 on(event,callback){callbacks[event]=callback;},
 slots:{inject(name,install){install();},register(options,component){registrations.push({options,component});return()=>{};}}
};
installSemanticBrowser(ctx,{call:async(channel,endpoint,payload,signal)=>{
 const response=await fetch('/catalog',{method:'POST',body:JSON.stringify(payload),signal}); return response.json();
}});
const workspaces=${JSON.stringify(workspaceList)};
const props={wide:true,useWorkspaces:selector=>selector({items:workspaces,state:'idle',phase:'ready'}),useSessions:selector=>selector({current:undefined})};
createRoot(document.getElementById('app')).render(<><h1>DSH Slot 验收夹具</h1><p>真实 Marivo Catalog · 无 Agent · 仅临时项目</p>{registrations.map(({options,component:Component})=><Component key={options.name} {...props}/>)}</>);
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
  await page.getByRole('button', { name: '打开语义层' }).click()
  await page.getByText('请选择一个 Workspace 查看语义层。').waitFor()
  assert.equal(requests, 0)
  await page.getByLabel('选择 Workspace').selectOption('sales')
  await page.getByRole('button', { name: '下一页' }).waitFor({ timeout: 30000 })
  checks.push('无 Agent 打开、选择 Workspace、真实 Catalog 读取、大目录分页')
  await page.getByLabel('搜索语义对象').fill('metric:sales.quarter_spend')
  await page.getByRole('region', { name: '对象列表' }).getByRole('button').first().click()
  const computation = page.getByRole('region', { name: '指标计算口径' })
  assert.equal(await computation.count(), 0)
  await page.getByRole('button', { name: '定义', exact: true }).click()
  await computation.waitFor()
  await computation.getByText('由计算公式及组成对象确定').waitFor()
  assert.match(
    await computation.locator('.sb-formula').first().innerText(),
    /从 sales.fiscal 的 week 周期起点累计/,
  )
  await computation.getByRole('button', { name: 'sales.orders.ordered_at', exact: true }).waitFor()
  assert.equal(await page.getByRole('region', { name: '对象详情' }).locator('details').count(), 0)
  const code = computation.getByRole('region', { name: 'Ibis 表达式' })
  await code.locator('code').filter({ hasText: 't1["amount"]' }).waitFor()
  const copyExpression = code.getByRole('button', { name: '复制 Ibis 表达式', exact: true })
  assert.equal(await copyExpression.innerText(), '')
  await copyExpression.focus()
  await page.keyboard.press('Enter')
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 't1["amount"]')
  await code.getByText('表达式已复制', { exact: true }).waitFor()
  await computation.getByRole('button', { name: 'sales.fiscal', exact: true }).click()
  await page
    .getByRole('region', { name: '对象详情' })
    .getByRole('heading', { name: 'fiscal', exact: true })
    .waitFor()
  await page.getByRole('button', { name: '返回上个对象', exact: true }).click()
  await page.getByLabel('搜索语义对象').fill('metric:sales.ratio')
  await page.getByRole('region', { name: '对象列表' }).getByRole('button').first().click()
  await computation.getByText('sales.revenue ÷ sales.revenue', { exact: true }).waitFor()
  await computation.getByText('由计算公式及组成对象确定').waitFor()
  assert.equal(
    await computation.getByRole('region', { name: 'metric:sales.revenue', exact: true }).count(),
    1,
  )
  await page.getByLabel('搜索语义对象').fill('metric:sales.linear')
  await page.getByRole('region', { name: '对象列表' }).getByRole('button').first().click()
  assert.equal(
    await computation
      .locator('.sb-formula')
      .first()
      .getByRole('button', { name: 'sales.revenue', exact: true })
      .count(),
    3,
  )
  assert.equal(
    await computation.getByRole('region', { name: 'metric:sales.revenue', exact: true }).count(),
    1,
  )
  assert.equal(await computation.getByRole('region', { name: '时间折叠规则' }).count(), 0)
  for (const name of ['stock_total', 'stock_last', 'stock_linear']) {
    await page.getByLabel('搜索语义对象').fill(`metric:sales.${name}`)
    await page.getByRole('region', { name: '对象列表' }).getByRole('button').first().click()
    const temporal = computation.locator(':scope > .sb-temporal')
    const text = await temporal.innerText()
    assert.match(
      text,
      name === 'stock_linear'
        ? /由计算公式及组成对象确定/
        : name === 'stock_last'
          ? /末值/
          : /分位数（0.95）/,
    )
    if (name !== 'stock_linear')
      await temporal.getByRole('button', { name: 'sales.orders.ordered_at', exact: true }).waitFor()
    assert.doesNotMatch(await computation.innerText(), /需观察上下文确定|不适用/)
  }
  await page.screenshot({ path: path.join(output, 'temporal-component-defined.png') })
  await page.getByLabel('搜索语义对象').fill('metric:sales.all_spend')
  await page.getByRole('region', { name: '对象列表' }).getByRole('button').first().click()
  await computation.getByText('使用默认时间轴，需观察上下文确定', { exact: true }).waitFor()
  await computation.getByText('由计算公式及组成对象确定').waitFor()
  checks.push(
    '0.5.4 时间规则：普通加减无独立折叠、组合定义、继承分位数、末值覆盖；默认累计轴单独保留上下文提示',
  )
  await page.getByLabel('搜索语义对象').fill('metric:sales.cancellation_rate')
  await page.getByRole('region', { name: '对象列表' }).getByRole('button').first().click()
  for (const expression of ["t1['is_cancelled'].cast('int64').sum()", "t1['id'].count()"]) {
    const region = computation.getByRole('region', { name: 'Ibis 表达式' }).filter({
      has: page.locator('pre code').filter({ hasText: expression }),
    })
    await region.getByRole('button', { name: '复制 Ibis 表达式' }).click()
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), expression)
  }
  await page.getByLabel('搜索语义对象').fill('')
  checks.push('真实结构化定义：累计与比率；Ibis 代码直接展示、别名与复制；日历跳转返回')

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
  fail = true
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '当前显示上次成功加载的内容' }).waitFor()
  await page.getByRole('heading', { name: 'revenue', exact: true }).waitFor()
  fail = false
  await page.getByLabel('选择 Workspace').selectOption('empty')
  await page.getByText('当前项目没有语义层对象。').waitFor({ timeout: 30000 })
  await page.getByLabel('选择 Workspace').selectOption('sales')
  await page.getByRole('button', { name: '刷新', exact: true }).waitFor({ timeout: 30000 })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('heading', { name: 'revenue', exact: true }).waitFor()
  await page.screenshot({ path: path.join(output, 'mobile-detail.png') })
  const bounds = await page.getByRole('dialog').boundingBox()
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391)
  await page.getByRole('button', { name: '返回列表', exact: true }).click()
  await page.getByLabel('搜索语义对象').fill('does-not-exist')
  await page.getByText('没有匹配对象，请调整搜索或筛选条件。').waitFor()
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('dialog').count(), 0)
  assert.equal(
    await page
      .getByRole('button', { name: '打开语义层' })
      .evaluate((el: Element) => el === document.activeElement),
    true,
  )
  checks.push('刷新失败保留旧内容、空项目、Workspace 隔离、窄屏、空搜索、Escape 与焦点恢复')
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
