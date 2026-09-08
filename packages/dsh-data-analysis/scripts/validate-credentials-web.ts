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
import type { ConnectionRpcHandler, HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import LlmRuntime, { CallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { build } from 'esbuild'
import { MarivoDatasourceBridge } from '../src/datasource/bridge.ts'
import { registerMarivoPythonTool } from '../src/datasource/python.ts'
import { registerCredentialRpc } from '../src/datasource/rpc.ts'
import { MarivoCredentialService } from '../src/datasource/service.ts'
import { bindMarivoEnvironment } from '../src/environment/index.ts'
import { failed, fixture } from '../tests/datasource-credentials/fixtures.ts'
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
  'import marivo.datasource as md\nmd.duckdb(name="warehouse",path=":memory:",http_scope="http://127.0.0.1/",http_bearer_token_env="DB_PASSWORD")\n',
)
await writeFile(
  path.join(directory, 'warehouse_two.py'),
  'import marivo.datasource as md\nmd.duckdb(name="warehouse_two",path=":memory:",http_scope="http://127.0.0.1/",http_bearer_token_env="DB_PASSWORD")\n',
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
await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 })
await ctx.plugin(SubprocessLocal)
await ctx.plugin(BashLocal, { timeoutMs: 120_000, maxOutputBytes: 65536 })
const agent = ctx.agentLoop.create(
  SessionId('session'),
  { provider: 'fixture', model: 'unused' },
  { cwd: root },
)
registerMarivoPythonTool(agent.ctx, bridge, service)
let starts = 0
const shell = agent.ctx.get('shell')!
const originalRun = shell.run.bind(shell)
shell.run = (spec) => {
  starts++
  return originalRun(spec)
}
let handler!: ConnectionRpcHandler
const connection = {
  rpc: {
    handle: (_channel: string, callback: ConnectionRpcHandler) => {
      handler = callback
      return async () => {}
    },
  },
} as unknown as HostConnectionHandle
const unregister = registerCredentialRpc(connection, service, async () => bridge)
const installer = fileURLToPath(new URL('../src/client/credentials/install.tsx', import.meta.url))
const semanticInstaller = fileURLToPath(
  new URL('../src/client/semantic-browser/install.tsx', import.meta.url),
)
const app = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: 'tsx',
    contents: `
import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
import {installCredentials} from ${JSON.stringify(installer)};
import {installSemanticBrowser} from ${JSON.stringify(semanticInstaller)};
const seats=[];
const ctx={effect(fn){fn()},on(){},slots:{inject(n,fn){fn()},register(options,component){seats.push({options,component});return()=>{}}}};
const rpc={call:async(channel,endpoint,payload,signal)=>(await fetch('/rpc',{method:'POST',body:JSON.stringify({endpoint,payload}),signal})).json()};
installSemanticBrowser(ctx,rpc);
installCredentials(ctx,rpc);
const workspaces=[{workspaceId:'workspace',name:'验收项目',sessionIds:['session']},{workspaceId:'other',name:'其他工作区不应显示',sessionIds:['other-session']}];
const props={sessionId:'session',useWorkspaces:fn=>fn({items:workspaces,state:'idle',phase:'ready'}),useSessions:fn=>fn({current:'session'})};
const renderSeat=({options,component:C})=><C key={options.name+options.id} {...props}/>;
function App(){const [headerVisible,setHeaderVisible]=useState(false);window.setFixtureHeaderVisible=setHeaderVisible;return <><h1>凭证集成验收夹具</h1>{headerVisible&&<header style={{display:'flex',alignItems:'center',gap:10}}><span>数据源分析会话</span><nav aria-label="会话标题操作" style={{display:'flex',gap:8}}>{seats.filter(({options})=>options.name==='conversation.session.header.actions').sort((a,b)=>a.options.order-b.options.order).map(renderSeat)}</nav></header>}{seats.filter(({options})=>options.name==='shell.overlay').map(renderSeat)}</>}
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
let failOverview = false
const server = createServer(async (req, res) => {
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
    if (endpoint === 'overview' && failOverview) {
      res.statusCode = 503
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: false, error: { message: 'fixture-overview-unavailable' } }))
      return
    }
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
  page.getByRole('button', { name: `选择数据源 ${name}`, exact: true }).click()
async function assertPendingWorkspace() {
  assert.equal(await page.getByLabel('Workspace', { exact: true }).count(), 0)
  assert.equal(await page.getByText('其他工作区不应显示', { exact: true }).count(), 0)
  const navigation = page.getByRole('complementary', { name: '数据源导航' })
  await navigation.getByRole('heading', { name: '请求的数据源', exact: true }).waitFor()
  assert.equal(
    await navigation.getByRole('button', { name: '选择数据源 warehouse', exact: true }).count(),
    1,
  )
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
  const bounds = await page.getByRole('dialog', { name: '数据源与凭证' }).boundingBox()
  assert(bounds)
  assert(bounds.x >= 0 && bounds.x + bounds.width <= page.viewportSize()!.width + 1)
  const overflows = await page
    .getByRole('dialog', { name: '数据源与凭证' })
    .evaluate((dialog: Element) =>
      [document.documentElement, dialog, ...dialog.querySelectorAll('*')]
        .filter(
          (element) => element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1,
        )
        // The narrow-screen datasource navigation is an intentional horizontal scroller.
        .filter(
          (element) =>
            !(element.matches('.mc-datasources') && getComputedStyle(element).overflowX === 'auto'),
        )
        .map((element) => `${element.tagName}.${element.className}`),
    )
  assert.deepEqual(overflows, [], 'dialog and page must not overflow horizontally')
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
  assert.deepEqual(compactEntries, [
    { width: 32, height: 32, label: 'none' },
    { width: 32, height: 32, label: 'none' },
  ])
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  await page.screenshot({ path: path.join(output, 'header-entries-mobile.png'), fullPage: true })
  await page.setViewportSize({ width: 1200, height: 900 })
  await page.getByRole('button', { name: '打开数据源与凭证' }).click()
  assert.equal(await page.getByLabel('Workspace', { exact: true }).count(), 0)
  assert.equal(await page.getByText('其他工作区不应显示', { exact: true }).count(), 0)
  await selectDatasource('warehouse')
  await page.getByRole('heading', { name: 'warehouse', exact: true }).waitFor({ timeout: 30000 })
  await page.getByLabel('新值').fill(secret)
  await page.getByRole('button', { name: '新增凭证', exact: true }).click()
  await page.getByRole('button', { name: '更换', exact: true }).waitFor({ timeout: 30000 })
  await page.getByRole('button', { name: '测试连接', exact: true }).click()
  await page.getByText('连接测试成功', { exact: true }).waitFor()
  assert(!(await page.locator('body').innerText()).includes(secret))
  assert(!(await page.evaluate(() => JSON.stringify(sessionStorage))).includes(secret))
  await assertNoCompletedOperations()
  await assertNoHorizontalOverflow()
  await page.screenshot({ path: path.join(output, 'management.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await assertNoHorizontalOverflow()
  await page.screenshot({ path: path.join(output, 'management-mobile.png'), fullPage: true })
  await page.setViewportSize({ width: 1200, height: 900 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await assertNoHorizontalOverflow()
  await page.screenshot({ path: path.join(output, 'management-dark.png'), fullPage: true })
  await page.emulateMedia({ colorScheme: 'light' })
  // Hold two actual bridge validations so navigation and reload happen while both are live.
  const originalTest = bridge.test.bind(bridge)
  const gates = new Map<string, () => void>()
  let enteredBoth!: () => void
  const bothEntered = new Promise<void>((resolve) => {
    enteredBoth = resolve
  })
  bridge.test = async (description, values, signal) => {
    await new Promise<void>((resolve, reject) => {
      const abort = () => reject(new Error('validation cancelled'))
      signal?.addEventListener('abort', abort, { once: true })
      gates.set(description.name, () => {
        signal?.removeEventListener('abort', abort)
        resolve()
      })
      if (gates.size === 2) enteredBoth()
      if (signal?.aborted) abort()
    })
    return originalTest(description, values, signal)
  }
  await page.getByRole('button', { name: '测试连接', exact: true }).click()
  await selectDatasource('warehouse_two')
  await page.getByRole('button', { name: '测试连接', exact: true }).click()
  await page.getByRole('button', { name: 'warehouse_two · 处理中', exact: true }).waitFor()
  assert.equal(
    await page.evaluate(
      () => JSON.parse(sessionStorage.getItem('marivo-credential-operation') ?? '[]').length,
    ),
    2,
  )
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Both bridge tests did not start')), 30000)
    void bothEntered.then(() => {
      clearTimeout(timer)
      resolve()
    })
  })
  await page.reload()
  await page.waitForFunction('typeof window.setFixtureHeaderVisible === "function"')
  await page.evaluate('window.setFixtureHeaderVisible(true)')
  await page.getByRole('button', { name: '打开数据源与凭证' }).click()
  await page.getByRole('button', { name: 'warehouse · 处理中', exact: true }).waitFor()
  await page.getByRole('button', { name: 'warehouse_two · 处理中', exact: true }).waitFor()
  assert(gates.has('warehouse') && gates.has('warehouse_two'))
  gates.get('warehouse')!()
  await page
    .getByRole('button', { name: 'warehouse · 处理中', exact: true })
    .waitFor({ state: 'hidden', timeout: 30000 })
  assert.equal(
    await page.getByRole('button', { name: 'warehouse · 已结束', exact: true }).count(),
    0,
  )
  assert.equal(
    await page.evaluate(
      () => JSON.parse(sessionStorage.getItem('marivo-credential-operation') ?? '[]').length,
    ),
    1,
  )
  await page.getByRole('button', { name: 'warehouse_two · 处理中', exact: true }).click()
  await page
    .getByRole('button', { name: '选择数据源 warehouse_two', exact: true })
    .waitFor({ timeout: 30000 })
  await assertNoHorizontalOverflow()
  await page.screenshot({ path: path.join(output, 'concurrent-operations.png'), fullPage: true })
  gates.get('warehouse_two')!()
  await assertNoCompletedOperations()
  bridge.test = originalTest
  await page.getByText('连接测试成功', { exact: true }).waitFor()
  await page.getByRole('button', { name: '收起', exact: true }).click()
  await page.getByRole('button', { name: '打开数据源与凭证' }).click()
  await selectDatasource('warehouse_two')
  await page.getByText('连接测试成功', { exact: true }).waitFor()
  await assertNoCompletedOperations()
  await page.screenshot({ path: path.join(output, 'completed-reopened.png'), fullPage: true })
  // New failed validation must supersede a previous success, even if the overview refresh fails.
  bridge.test = async (description) => ({ ...failed, name: description.name })
  await page.getByRole('button', { name: '更换', exact: true }).click()
  await page.getByLabel('新值').fill(secret)
  await page.getByRole('button', { name: '确认更换', exact: true }).click()
  await assertNoCompletedOperations()
  await page.getByText('配置已变化，请重新测试', { exact: true }).waitFor()
  failOverview = true
  const overviewFailure = page.waitForResponse(
    (response: { status(): number }) => response.status() === 503,
    { timeout: 30000 },
  )
  await page.getByRole('button', { name: '测试连接', exact: true }).click()
  assert.equal((await overviewFailure).request().postDataJSON().endpoint, 'overview')
  await page.getByText('connection rejected', { exact: true }).waitFor({ timeout: 30000 })
  assert.equal(await page.getByText('连接测试成功', { exact: true }).count(), 0)
  assert.equal(f.store.values.size, 1)
  await assertNoCompletedOperations()
  assert(!(await page.locator('body').innerText()).includes(secret))
  assert(!(await page.evaluate(() => JSON.stringify(sessionStorage))).includes(secret))
  await page.screenshot({ path: path.join(output, 'failed-overview.png'), fullPage: true })
  failOverview = false
  await page.getByRole('button', { name: '刷新状态', exact: true }).click()
  await page.getByText('connection rejected', { exact: true }).waitFor()
  await page.getByRole('button', { name: '收起', exact: true }).click()
  await page.getByRole('button', { name: '打开数据源与凭证' }).click()
  await selectDatasource('warehouse_two')
  await page.getByText('connection rejected', { exact: true }).waitFor()
  await assertNoCompletedOperations()
  await page.screenshot({ path: path.join(output, 'failed-reopened.png'), fullPage: true })
  bridge.test = originalTest
  await selectDatasource('warehouse')
  await page.getByRole('button', { name: '删除已保存值', exact: true }).click()
  await page.getByRole('button', { name: '确认删除已保存值', exact: true }).click()
  await page.getByLabel('新值').waitFor({ timeout: 30000 })
  await page.getByText('配置已变化，请重新测试', { exact: false }).waitFor()
  await page.getByRole('button', { name: '收起', exact: true }).click()
  // The global overlay must keep watching even when no header entry is mounted.
  await page.evaluate('window.setFixtureHeaderVisible(false)')
  await page.getByRole('navigation', { name: '会话标题操作' }).waitFor({ state: 'hidden' })
  const pending = agent.ctx.tools.execute({
    agent,
    name: 'marivo_python',
    arguments: {
      datasources: ['warehouse'],
      code: 'import os\nimport marivo.datasource as md\nassert "DB_PASSWORD" not in os.environ\nwith md.connect("warehouse") as backend:\n    assert backend.raw_sql("SELECT 42").fetchall() == [(42,)]\nprint("WEB_EXECUTION_OK")',
    },
    callId: CallId('web-execution'),
    signal: f.controller.signal,
  })
  await page
    .getByRole('button', { name: '提交凭证并继续', exact: true })
    .waitFor({ timeout: 30000 })
  await assertPendingWorkspace()
  await page.evaluate('window.setFixtureHeaderVisible(true)')
  await page.getByRole('button', { name: '收起', exact: true }).click()
  await page
    .getByRole('navigation', { name: '会话标题操作' })
    .getByRole('button', { name: '等待配置凭证', exact: true })
    .click()
  await assertPendingWorkspace()
  await page.getByLabel('新值').fill('unsubmitted')
  assert.equal(starts, 0)
  await page.reload()
  await page
    .getByRole('button', { name: '提交凭证并继续', exact: true })
    .waitFor({ timeout: 30000 })
  await assertPendingWorkspace()
  assert.equal(await page.getByLabel('新值').inputValue(), '')
  assert.equal(starts, 0)
  await page.getByLabel('新值').fill(secret)
  await page.screenshot({ path: path.join(output, 'pending.png'), fullPage: true })
  await page.getByRole('button', { name: '提交凭证并继续', exact: true }).click()
  const result = await pending
  assert(!result.isError, JSON.stringify(result))
  assert.equal((result.value as { exitCode: number }).exitCode, 0, JSON.stringify(result))
  assert.match((result.value as { stdout: string }).stdout, /WEB_EXECUTION_OK/)
  assert.equal(starts, 1)
  assert(!JSON.stringify(result).includes(secret))
  await page.getByText('验证完成，原调用继续', { exact: false }).first().waitFor({ timeout: 30000 })
  assert(!(await page.locator('body').innerText()).includes(secret))
  await page.setViewportSize({ width: 390, height: 844 })
  await assertNoHorizontalOverflow()
  await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true })
  await page.getByRole('button', { name: '返回数据源管理', exact: true }).click()
  await page.getByRole('button', { name: '测试连接', exact: true }).waitFor({ timeout: 30000 })
  assert.equal(await page.getByLabel('Workspace', { exact: true }).count(), 0)
  assert.equal(await page.getByText('其他工作区不应显示', { exact: true }).count(), 0)
  const navigation = page.getByRole('complementary', { name: '数据源导航' })
  assert.equal(await navigation.getByRole('button', { name: /^选择数据源 / }).count(), 2)
  await page.getByRole('heading', { name: 'warehouse', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '返回数据源管理', exact: true }).count(), 0)
  await assertNoHorizontalOverflow()
  await page.screenshot({
    path: path.join(output, 'returned-management-mobile.png'),
    fullPage: true,
  })
  await page.setViewportSize({ width: 1200, height: 900 })
  await page.getByRole('button', { name: '新增数据源', exact: true }).click()
  await page.getByLabel('引擎', { exact: true }).selectOption('clickhouse')
  const fieldLayout = await page.getByLabel('host', { exact: true }).evaluate((input: Element) => {
    const label = input.closest('label')!
    const name = label.querySelector('.mc-input-name')!.getBoundingClientRect()
    const description = label.querySelector('.mc-input-description')!.getBoundingClientRect()
    const control = input.getBoundingClientRect()
    return {
      above: name.bottom <= control.top && description.bottom <= control.top,
      sameRow: Math.abs(name.top - description.top) < 6,
    }
  })
  assert.deepEqual(fieldLayout, { above: true, sameRow: true })
  await page.screenshot({
    path: path.join(output, 'create-field-descriptions.png'),
    fullPage: true,
  })
  await page.getByLabel('name', { exact: true }).fill('clickhouse_in_card')
  await page.getByLabel('host', { exact: true }).fill('example.invalid')
  await page.getByLabel('port', { exact: true }).fill('80')
  await page.getByLabel('database', { exact: true }).fill('analytics')
  await page.getByLabel('secure', { exact: true }).selectOption('false')
  await page.getByLabel('settings', { exact: true }).fill('{"max_execution_time":30}')
  await page.getByLabel('user_env', { exact: true }).fill('CLICKHOUSE_TEST_USER')
  await page.getByLabel('password_env', { exact: true }).fill('9invalid-reference-canary')
  await page.getByRole('button', { name: '确认新增数据源', exact: true }).click()
  const creationError = page.getByRole('alert').filter({ hasText: '凭证引用名称无效' })
  await creationError.waitFor({ timeout: 30000 })
  assert.doesNotMatch(
    await creationError.innerText(),
    /9invalid-reference-canary|提交结果未确认|凭证操作失败/,
  )
  assert(!(await bridge.inventory()).some((item) => item.name === 'clickhouse_in_card'))
  await page.screenshot({
    path: path.join(output, 'invalid-credential-reference.png'),
    fullPage: true,
  })
  await page.getByLabel('password_env', { exact: true }).fill('CLICKHOUSE_TEST_PASSWORD')
  await page.getByRole('button', { name: '确认新增数据源', exact: true }).click()
  await page
    .getByRole('heading', { name: 'clickhouse_in_card', exact: true })
    .waitFor({ timeout: 30000 })
  const properties = page.getByRole('region', { name: '数据源属性' })
  assert(
    await properties.evaluate(
      (element: Element) =>
        element.getBoundingClientRect().top >=
        element.closest('.mc-main')!.getBoundingClientRect().top,
    ),
    'newly created datasource properties must start in view',
  )
  for (const value of [
    'clickhouse',
    'example.invalid',
    '80',
    'analytics',
    'false',
    'max_execution_time',
  ]) {
    assert((await properties.innerText()).includes(value), `Missing datasource property: ${value}`)
  }
  assert.doesNotMatch(await properties.innerText(), /CLICKHOUSE_TEST_PASSWORD|CLICKHOUSE_TEST_USER/)
  assert.equal((await bridge.describe('clickhouse_in_card')).properties?.host, 'example.invalid')
  await assertNoHorizontalOverflow()
  await page.screenshot({ path: path.join(output, 'clickhouse-properties.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await assertNoHorizontalOverflow()
  await page.screenshot({
    path: path.join(output, 'clickhouse-properties-mobile.png'),
    fullPage: true,
  })
  await page.setViewportSize({ width: 1200, height: 900 })
  await page.getByRole('button', { name: '新增数据源', exact: true }).click()
  await page.getByLabel('引擎', { exact: true }).selectOption('duckdb')
  await page.getByLabel('name', { exact: true }).fill('created_in_card')
  await page.getByLabel('http_scope', { exact: true }).fill('http://127.0.0.1/')
  await page.getByLabel('http_bearer_token_env', { exact: true }).fill('NEW_TOKEN')
  await assertNoHorizontalOverflow()
  await page.screenshot({ path: path.join(output, 'create-datasource.png'), fullPage: true })
  await page.getByRole('button', { name: '确认新增数据源', exact: true }).click()
  await page
    .getByRole('heading', { name: 'created_in_card', exact: true })
    .waitFor({ timeout: 30000 })
  await page.getByLabel('新值').fill(secret)
  await page.getByRole('button', { name: '新增凭证', exact: true }).click()
  await page.getByRole('button', { name: '更换', exact: true }).waitFor({ timeout: 30000 })
  assert.equal(await page.getByRole('button', { name: /保存并验证/ }).count(), 0)
  await page.getByRole('button', { name: '测试连接', exact: true }).click()
  await page.getByText('连接测试成功', { exact: true }).waitFor({ timeout: 30000 })
  assert((await bridge.inventory()).some((item) => item.name === 'created_in_card'))
  await page.screenshot({ path: path.join(output, 'created-datasource.png'), fullPage: true })
  await page.getByRole('button', { name: '新增数据源', exact: true }).click()
  await page.getByLabel('name', { exact: true }).fill('created_in_card')
  await page.getByRole('button', { name: '确认新增数据源', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '该数据源已存在' }).waitFor({ timeout: 30000 })
  assert.equal((await bridge.describe('created_in_card')).refs[0], 'NEW_TOKEN')
  assert.deepEqual(errors, [])
  const evidence = {
    browser: 'passed',
    managementSaveDelete: 'passed',
    createDatasourceAndCredential: 'passed',
    invalidCredentialReferenceRejectedBeforeWrite: 'passed',
    clickhouseCreationAndProperties: 'passed',
    descriptionsAboveInputsBesideNames: 'passed',
    createdDatasourceScrollsToProperties: 'passed',
    duplicateDatasourceRejected: 'passed',
    workspaceSelectorsRemoved: 'passed',
    lastTestFreshAndStale: 'passed',
    concurrentOperationsRecovery: 'passed',
    completedOperationsRemovedAndStayRemoved: 'passed',
    lastSuccessAndFailureSurviveReopen: 'passed',
    failedValidationSupersedesOldSuccessWithoutOverview: 'passed',
    savedChangesRemainVisibleAfterFailedValidation: 'passed',
    headerEntryStyleAndWorkspaceBinding: 'passed',
    pendingWatchStartsWithoutHeaderAndSurvivesUnmount: 'passed',
    desktopMobileDarkWithoutHorizontalOverflow: 'passed',
    refreshRestoresPendingWithoutSecret: 'passed',
    pendingWorkspaceAndReturnToManagement: 'passed',
    originalCallResumed: 'passed',
    originalPythonStartedOnce: 'passed',
    screenshots: output,
    surface: 'isolated DSH slots and HTTP transport; not full DSH Web deployment',
    runtime: bridge.binding,
    pythonStarts: starts,
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
  await service.close()
  await ctx.fiber.dispose()
  await unregister()
  await browser.close()
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await rm(root, { recursive: true, force: true })
}
