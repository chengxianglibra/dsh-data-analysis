/** Real Chromium + Credential RPC/service + Marivo; isolated DSH slot transport fixture. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import BashLocal from '@deepseek-ai/dsh-bash-local'
import LlmRuntime, { ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { build } from 'esbuild'
import { MarivoDatasourceBridge } from '../src/datasource/bridge.ts'
import { CredentialChangesService } from '../src/datasource/changes.ts'
import { registerMarivoPythonTool } from '../src/datasource/python.ts'
import { registerCredentialRpc } from '../src/datasource/rpc.ts'
import { MarivoCredentialService } from '../src/datasource/service.ts'
import { bindMarivoEnvironment } from '../src/environment/index.ts'
import { fixture } from '../tests/datasource-credentials/fixtures.ts'
import { createConnectionFixture } from '../tests/semantic-reference-input/fixtures.ts'
import { TestShellEnv } from '../tests/test-shell-env.ts'

const { chromium } = await import(process.env.DSH_DATA_ANALYSIS_PLAYWRIGHT_MODULE ?? 'playwright')
const python = process.env.DSH_DATA_ANALYSIS_PYTHON
if (!python) throw new Error('DSH_DATA_ANALYSIS_PYTHON required')
const root = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-credential-web-')))
const output = process.env.DSH_DATA_ANALYSIS_BROWSER_OUTPUT ?? '/tmp/dsh-credential-web-validation'
await mkdir(output, { recursive: true })
const f = fixture('web'),
  service = new MarivoCredentialService(f.store, 'web')
const directory = path.join(root, 'models', 'datasources')
await mkdir(directory, { recursive: true })
await writeFile(
  path.join(directory, 'warehouse.py'),
  'import marivo.datasource as md\nmd.duckdb(name="warehouse",path=":memory:",secrets=[md.http_bearer_secret(scope="http://127.0.0.1/",token=md.env("DB_PASSWORD"))])\n',
)
await writeFile(
  path.join(directory, 'warehouse_two.py'),
  'import marivo.datasource as md\nmd.duckdb(name="warehouse_two",path=":memory:",secrets=[md.http_bearer_secret(scope="http://127.0.0.1/",token=md.env("DB_PASSWORD"))])\n',
)
const runner = await bindMarivoEnvironment({ projectRoot: root, pythonExecutable: python })
const bridge = new MarivoDatasourceBridge(runner)
const ctx = new Context()
await ctx.plugin(LlmRuntime)
await ctx.plugin(SessionStore)
await ctx.plugin(SystemPrompt)
await ctx.plugin(TestShellEnv)
await ctx.plugin(ToolRuntime)
await ctx.plugin(AgentRegistry)
await ctx.plugin(SessionProjectionRegistry)
await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 })
await ctx.plugin(SubprocessLocal)
await ctx.plugin(BashLocal, { timeoutMs: 120_000, maxOutputBytes: 65536 })
const agent = await ctx.agentLoop.create(
  SessionId('session'),
  { provider: 'fixture', model: 'unused' },
  { cwd: root },
)
registerMarivoPythonTool(agent.ctx, bridge, service)
let starts = 0
const shell = agent.ctx.get('shell')!
const originalExecute = shell.execute.bind(shell)
shell.execute = (spec) => {
  starts++
  return originalExecute(spec)
}
const { connection, channels } = createConnectionFixture()
const unregister = registerCredentialRpc(connection, service, async () => bridge)
const handler = channels.get('/dsh-data-analysis-credentials')!
const notifications = new CredentialChangesService(new Context(), service)
const installer = fileURLToPath(new URL('../src/client/credentials/install.tsx', import.meta.url))
const app = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: 'tsx',
    contents: `
import React, {useState,useSyncExternalStore} from 'react'; import {createRoot} from 'react-dom/client';
import {CredentialPanel,installCredentials} from ${JSON.stringify(installer)};
import {WorkspaceHeaderAction} from ${JSON.stringify(fileURLToPath(new URL('../src/client/workspace-header-action.tsx', import.meta.url)))};
import {HostCopyProvider} from ${JSON.stringify(fileURLToPath(new URL('../src/client/i18n/context.tsx', import.meta.url)))};
import {translator,zh} from ${JSON.stringify(fileURLToPath(new URL('../src/client/i18n/copy.ts', import.meta.url)))};
const seats=[];
const localeSnapshot={active:'zh'};
const ctx={effect(fn){fn()},on(){},locale:{subscribe(){return()=>{}},getSnapshot(){return localeSnapshot},bind(){return key=>zh[key]}},slots:{inject(n,fn){fn()},register(options,component){seats.push({options,component});return()=>{}}}};
const rpc={call:async(channel,endpoint,payload,signal)=>(await fetch('/rpc',{method:'POST',body:JSON.stringify({endpoint,payload}),signal})).json()};
ctx.slots.register({name:'conversation.session.header.actions',id:'fixture-semantic',order:110},()=> <WorkspaceHeaderAction label="语义层" icon="semantic" onClick={()=>{}}/>);
// Fixture-only stream carrier; the production client uses Harness RemoteStream.
const changes=sessionId=>{
 const controller=new AbortController();
 return {async *[Symbol.asyncIterator](){
  const response=await fetch('/changes?sessionId='+encodeURIComponent(sessionId),{signal:controller.signal});
  const reader=response.body.pipeThrough(new TextDecoderStream()).getReader();let buffer='';
  try {while(true){const {done,value}=await reader.read();if(done)break;buffer+=value;let end;while((end=buffer.indexOf('\\n'))>=0){const value=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);yield {generation:1,value,signal:controller.signal,accept(){}}}}}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
 },async dispose(){controller.abort()}}
};
const model=installCredentials(ctx,rpc,changes);
ctx.slots.register({name:'conversation.session.header.actions',id:'fixture-credentials',order:100},()=> <WorkspaceHeaderAction label="数据源与凭证" icon="credentials" onClick={()=>model.show('workspace')}/>);
const workspaces=[{workspaceId:'workspace',name:'验收项目',sessionIds:['session']},{workspaceId:'other',name:'其他工作区不应显示',sessionIds:['other-session']}];
const props={sessionId:'session',useWorkspaces:fn=>fn({items:workspaces,state:'idle',phase:'ready'}),useSessions:fn=>fn({ids:['session'],byId:{session:{retainedBy:{mainView:true}}}})};
const renderSeat=({options,component:C})=><C key={options.name+options.id} {...props}/>;
function Panel(){const state=useSyncExternalStore(model.subscribe,model.getSnapshot);return state.open&&<div style={{containerType:'inline-size',padding:16,maxWidth:900}}><button onClick={()=>model.close()}>收起</button><button onClick={()=>model.selectWorkspace('workspace')}>刷新状态</button><CredentialPanel model={model} workspaces={workspaces}/></div>}
function App(){const [headerVisible,setHeaderVisible]=useState(false);window.setFixtureHeaderVisible=setHeaderVisible;return <HostCopyProvider t={translator('zh-CN')}><h1>凭证集成验收夹具</h1>{headerVisible&&<header style={{display:'flex',alignItems:'center',gap:10}}><span>数据源分析会话</span><nav aria-label="会话标题操作" style={{display:'flex',gap:8}}>{seats.filter(({options})=>options.name==='conversation.session.header.actions').sort((a,b)=>a.options.order-b.options.order).map(renderSeat)}</nav></header>}{seats.filter(({options})=>options.name==='shell.overlay').map(renderSeat)}<Panel/></HostCopyProvider>}
createRoot(document.getElementById('app')).render(<App/>);
`,
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
})
const server = createServer(async (req, res) => {
  if (req.url?.startsWith('/changes?')) {
    const controller = new AbortController()
    res.on('close', () => controller.abort())
    res.setHeader('Content-Type', 'application/x-ndjson')
    try {
      const sessionId = new URL(req.url, 'http://fixture').searchParams.get('sessionId')!
      for await (const value of notifications.changes(sessionId, controller.signal))
        res.write(JSON.stringify(value) + '\n')
    } catch {
      /* Client cancellation only terminates the fixture subscription. */
    }
    res.end()
    return
  }
  if (req.url === '/app.js') {
    res.setHeader('Content-Type', 'text/javascript')
    res.end(app.outputFiles[0]!.text)
    return
  }
  if (req.url !== '/rpc') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(
      '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div><script src="/app.js"></script></html>',
    )
    return
  }
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  const controller = new AbortController()
  res.on('close', () => controller.abort())
  try {
    const { endpoint, payload } = JSON.parse(Buffer.concat(chunks).toString())
    const result = await handler(endpoint, payload, controller.signal)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(result))
  } catch {
    if (!res.destroyed) res.end(JSON.stringify({ ok: false, error: { message: 'request-ended' } }))
  }
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
assert(address && typeof address !== 'string')
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
const errors: string[] = []
page.on('pageerror', (error: Error) => errors.push(error.message))
const secret = 'browser-private-canary-32457'
const activeOperations = page.getByRole('region', { name: '进行中的凭证操作' })
const selectDatasource = (name: string) =>
  page.getByRole('tab', { name: `选择数据源 ${name}`, exact: true }).click()
async function assertPendingWorkspace() {
  assert.equal(await page.getByLabel('Workspace', { exact: true }).count(), 0)
  assert.equal(await page.getByText('其他工作区不应显示', { exact: true }).count(), 0)
  await page.getByRole('button', { name: '数据源管理', exact: true }).waitFor()
  assert.equal(
    await page.getByRole('button', { name: 'warehouse · 等待填写', exact: true }).count(),
    1,
  )
  assert.equal(await page.getByLabel('新值', { exact: true }).count(), 1)
}
async function assertNoCompletedOperations() {
  await activeOperations.waitFor({ state: 'hidden', timeout: 30000 })
  assert.equal(await page.getByRole('button', { name: /· 已结束$/ }).count(), 0)
  assert.equal(await page.getByText('本次操作已结束', { exact: true }).count(), 0)
  assert.equal(
    await page.evaluate(
      () => JSON.parse(sessionStorage.getItem('marivo-credential-operation') ?? '[]').length,
    ),
    0,
  )
}
async function assertNoHorizontalOverflow() {
  const bounds = await page.getByRole('region', { name: '数据源与凭证', exact: true }).boundingBox()
  assert(bounds)
  assert(bounds.x >= 0 && bounds.x + bounds.width <= page.viewportSize()!.width + 1)
  const overflows = await page
    .getByRole('region', { name: '数据源与凭证', exact: true })
    .evaluate((dialog: Element) =>
      [document.documentElement, dialog, ...dialog.querySelectorAll('*')]
        .filter(
          (element) => element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1,
        )
        // The narrow-screen datasource navigation is an intentional horizontal scroller.
        .filter(
          (element) =>
            !element.matches('.mc-visually-hidden') &&
            !(element.matches('.mc-datasources') && getComputedStyle(element).overflowX === 'auto'),
        )
        .map((element) => `${element.tagName}.${element.className}`),
    )
  assert.deepEqual(overflows, [], 'panel and page must not overflow horizontally')
}
async function assertCredentialStatusBesideName() {
  const bounds = await page.locator('.mc-identity-title').evaluate((row: Element) => {
    const title = row.querySelector('[data-slot="card-title"]')!.getBoundingClientRect()
    const status = row.querySelector('[data-slot="badge"]')!.getBoundingClientRect()
    return {
      titleRight: title.right,
      titleTop: title.top,
      titleBottom: title.bottom,
      statusLeft: status.left,
      statusTop: status.top,
      statusBottom: status.bottom,
    }
  })
  assert(bounds.statusLeft >= bounds.titleRight)
  assert(bounds.statusTop < bounds.titleBottom && bounds.statusBottom > bounds.titleTop)
}
async function assertDatasourceDot(name: string, ready: boolean, description: string) {
  const button = page.getByRole('tab', { name: `选择数据源 ${name}`, exact: true })
  const state = await button.evaluate((element: Element) => {
    const title = element.querySelector('.mc-datasource-name')!.getBoundingClientRect()
    const dot = element.querySelector('.mc-dot')!
    const dotBounds = dot.getBoundingClientRect()
    const descriptionId = element.getAttribute('aria-describedby')!
    return {
      text: element.querySelector('.mc-datasource-copy')!.textContent,
      ready: dot.getAttribute('data-ready'),
      description: document.getElementById(descriptionId)?.textContent,
      dotRightOfName: dotBounds.left >= title.right,
    }
  })
  assert.deepEqual(state, {
    text: name,
    ready: String(ready),
    description,
    dotRightOfName: true,
  })
}
try {
  const initialWatch = page.waitForRequest(
    (request: { method(): string; postDataJSON(): { endpoint: string } }) =>
      request.method() === 'POST' && request.postDataJSON().endpoint === 'watch',
  )
  await page.goto(`http://127.0.0.1:${address.port}`)
  assert.equal((await initialWatch).postDataJSON().payload.sessionId, 'session')
  assert.equal(await page.getByRole('navigation', { name: '会话标题操作' }).count(), 0)
  await page.evaluate('window.setFixtureHeaderVisible(true)')
  await page.getByRole('button', { name: '打开数据源与凭证' }).waitFor()
  assert.deepEqual(
    await page
      .getByRole('navigation', { name: '会话标题操作' })
      .getByRole('button')
      .allTextContents(),
    ['数据源与凭证', '语义层'],
  )
  const entryStyles = await page
    .getByRole('navigation', { name: '会话标题操作' })
    .getByRole('button')
    .evaluateAll((buttons: Element[]) =>
      buttons.map((button) => {
        const styles = getComputedStyle(button)
        return Object.fromEntries(
          [
            'display',
            'align-items',
            'justify-content',
            'padding',
            'border-width',
            'border-radius',
            'background-color',
            'color',
            'font-family',
            'font-size',
            'line-height',
          ].map((property) => [property, styles.getPropertyValue(property)]),
        )
      }),
    )
  assert.equal(entryStyles.length, 2)
  assert.deepEqual(entryStyles[0], entryStyles[1], 'semantic and credential entries share a style')
  await page.screenshot({ path: path.join(output, 'header-entries.png'), fullPage: true })
  await page.setViewportSize({ width: 320, height: 740 })
  const compactEntries = await page
    .getByRole('navigation', { name: '会话标题操作' })
    .getByRole('button')
    .evaluateAll((buttons: Element[]) =>
      buttons.map((button) => {
        const bounds = button.getBoundingClientRect()
        return {
          width: bounds.width,
          height: bounds.height,
          label: getComputedStyle(button.querySelector('span')!).display,
        }
      }),
    )
  assert.equal(compactEntries.length, 2)
  assert.deepEqual(compactEntries[0], compactEntries[1])
  assert.equal(compactEntries[0]!.label, 'none')
  assert(compactEntries[0]!.width <= 40 && compactEntries[0]!.height <= 40)
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  await page.screenshot({ path: path.join(output, 'header-entries-mobile.png'), fullPage: true })
  await page.setViewportSize({ width: 1200, height: 900 })
  await page.getByRole('button', { name: '打开数据源与凭证' }).click()
  assert.equal(await page.getByLabel('Workspace', { exact: true }).count(), 0)
  assert.equal(await page.getByText('其他工作区不应显示', { exact: true }).count(), 0)
  const datasourceTabs = page.getByRole('tab', { name: /^选择数据源 / })
  await datasourceTabs.first().waitFor({ timeout: 30000 })
  assert((await datasourceTabs.count()) >= 2)
  await datasourceTabs.first().click()
  await datasourceTabs.first().focus()
  await page.keyboard.press('ArrowRight')
  await page.waitForFunction(
    () => document.activeElement === document.querySelectorAll('[role=tab]')[1],
  )
  assert.equal(
    await datasourceTabs.nth(1).evaluate((tab: Element) => tab === document.activeElement),
    true,
  )
  assert.equal(await datasourceTabs.first().getAttribute('aria-selected'), 'true')
  assert.equal(await datasourceTabs.nth(1).getAttribute('aria-selected'), 'false')
  await page.keyboard.press('Enter')
  assert.equal(await datasourceTabs.nth(1).getAttribute('aria-selected'), 'true')
  const selectedTabId = await datasourceTabs.nth(1).getAttribute('id')
  const selectedPanelId = await datasourceTabs.nth(1).getAttribute('aria-controls')
  const selectedPanel = page.getByRole('tabpanel')
  await selectedPanel.waitFor()
  assert.equal(await selectedPanel.getAttribute('id'), selectedPanelId)
  assert.equal(await selectedPanel.getAttribute('aria-labelledby'), selectedTabId)
  await selectDatasource('warehouse')
  await page.getByRole('heading', { name: 'warehouse', exact: true }).waitFor({ timeout: 30000 })
  await assertDatasourceDot('default', true, '无需凭证')
  await assertDatasourceDot('warehouse', false, '0 / 1 项已配置')
  const selectedDatasource = page.getByRole('tab', { name: '选择数据源 warehouse', exact: true })
  await selectedDatasource.focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  assert.equal(
    await selectedDatasource.evaluate((button: Element) => {
      const style = getComputedStyle(button)
      return (
        button.matches(':focus-visible') &&
        style.outlineStyle !== 'none' &&
        style.outlineWidth !== '0px'
      )
    }),
    true,
  )
  await page.getByLabel('新值').fill(secret)
  await page.getByRole('button', { name: '新增凭证', exact: true }).click()
  await page.getByRole('button', { name: '更换', exact: true }).waitFor({ timeout: 30000 })
  await assertDatasourceDot('warehouse', true, '凭证已配齐')
  await assertCredentialStatusBesideName()
  assert(!(await page.locator('body').innerText()).includes(secret))
  assert(!(await page.evaluate(() => JSON.stringify(sessionStorage))).includes(secret))
  await assertNoCompletedOperations()
  await assertNoHorizontalOverflow()
  await page.screenshot({ path: path.join(output, 'management.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await assertCredentialStatusBesideName()
  await assertNoHorizontalOverflow()
  await page.screenshot({ path: path.join(output, 'management-mobile.png'), fullPage: true })
  await page.setViewportSize({ width: 1200, height: 900 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await assertNoHorizontalOverflow()
  await page.screenshot({ path: path.join(output, 'management-dark.png'), fullPage: true })
  await page.emulateMedia({ colorScheme: 'light' })
  await selectDatasource('warehouse')
  await page.getByRole('button', { name: '删除已保存值', exact: true }).click()
  await page.getByRole('button', { name: '确认删除已保存值', exact: true }).click()
  await page.getByLabel('新值').waitFor({ timeout: 30000 })
  await page.getByRole('button', { name: '收起', exact: true }).click()
  // The global overlay must keep watching even when no header entry is mounted.
  await page.evaluate('window.setFixtureHeaderVisible(false)')
  await page.getByRole('navigation', { name: '会话标题操作' }).waitFor({ state: 'hidden' })
  const pending = agent.ctx.tools.execute({
    agent,
    name: 'marivo_python',
    arguments: {
      project: 'required',
      datasources: ['warehouse'],
      code: 'import os\nimport marivo.datasource as md\nassert "DB_PASSWORD" not in os.environ\nimport marivo.semantic as ms\nassert md.raw_sql(ms.ref.datasource("warehouse"), "SELECT 42", reason="Validate fixture execution").to_pandas().iloc[0,0] == 42\nprint("WEB_EXECUTION_OK")',
    },
    callId: ToolCallId('web-execution'),
    signal: f.controller.signal,
  })
  await page
    .getByRole('button', { name: '提交凭证并继续', exact: true })
    .waitFor({ timeout: 30000 })
  await assertPendingWorkspace()
  const startsBeforeCredentials = starts
  await page.evaluate('window.setFixtureHeaderVisible(true)')
  await page.getByRole('button', { name: '收起', exact: true }).click()
  await page
    .getByRole('navigation', { name: '会话标题操作' })
    .getByRole('button', { name: '等待配置凭证', exact: true })
    .click()
  await assertPendingWorkspace()
  await page.getByLabel('新值').fill('unsubmitted')
  assert.equal(starts, startsBeforeCredentials)
  await page.reload()
  await page
    .getByRole('button', { name: '提交凭证并继续', exact: true })
    .waitFor({ timeout: 30000 })
  await assertPendingWorkspace()
  assert.equal(await page.getByLabel('新值').inputValue(), '')
  assert.equal(starts, startsBeforeCredentials)
  await page.getByLabel('新值').fill(secret)
  await page.screenshot({ path: path.join(output, 'pending.png'), fullPage: true })
  await page.getByRole('button', { name: '提交凭证并继续', exact: true }).click()
  const result = await pending
  assert(!result.isError, JSON.stringify(result))
  assert.equal((result.value as { exitCode: number }).exitCode, 0, JSON.stringify(result))
  assert.match((result.value as { stdout: string }).stdout, /WEB_EXECUTION_OK/)
  assert.equal(starts, startsBeforeCredentials + 1)
  assert(!JSON.stringify(result).includes(secret))
  await page
    .getByText('凭证已配置，原调用继续', { exact: false })
    .first()
    .waitFor({ timeout: 30000 })
  assert(!(await page.locator('body').innerText()).includes(secret))
  await page.setViewportSize({ width: 390, height: 844 })
  await assertNoHorizontalOverflow()
  await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true })
  await page.getByRole('button', { name: '返回数据源管理', exact: true }).click()
  await selectDatasource('warehouse')
  await page.getByRole('heading', { name: 'warehouse', exact: true }).waitFor({ timeout: 30000 })
  assert(!(await page.locator('body').innerText()).includes(secret))
  assert.deepEqual(errors, [])
  const evidence = {
    browser: 'passed',
    managementSaveDelete: 'passed',
    responsiveAndDark: 'passed',
    originalCallResumed: 'passed',
    originalPythonStartedOnce: 'passed',
    surface: 'isolated DSH slots and HTTP transport; not full DSH Web deployment',
    runtime: bridge.binding,
    pythonStarts: starts,
    screenshots: output,
  }
  await writeFile(
    path.join(output, 'browser-evidence.json'),
    `${JSON.stringify(evidence, null, 2)}\n`,
  )
  console.log(JSON.stringify(evidence))
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true })
  console.error(await page.locator('body').innerText())
  throw error
} finally {
  f.controller.abort()
  await notifications.close()
  await service.close()
  await ctx.fiber.dispose()
  await unregister()
  await browser.close()
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await rm(root, { recursive: true, force: true })
}
