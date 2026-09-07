/** Real Chromium + Credential RPC/service + Marivo; isolated DSH slot transport fixture. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import type { ConnectionRpcHandler, HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { build } from 'esbuild'
import { MarivoDatasourceBridge } from '../src/datasource/bridge.ts'
import { registerCredentialRpc } from '../src/datasource/rpc.ts'
import { MarivoCredentialService } from '../src/datasource/service.ts'
import { bindMarivoEnvironment } from '../src/environment/index.ts'
import { fixture } from '../tests/datasource-credentials/fixtures.ts'

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
const app = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: 'tsx',
    contents: `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {installCredentials} from ${JSON.stringify(installer)};
const seats=[];
installCredentials({effect(fn){fn()},on(){},slots:{inject(n,fn){fn()},register(options,component){seats.push({options,component});return()=>{}}}},
{call:async(channel,endpoint,payload,signal)=>(await fetch('/rpc',{method:'POST',body:JSON.stringify({endpoint,payload}),signal})).json()});
const workspaces=[{workspaceId:'workspace',name:'验收项目',sessionIds:['session']}];
const props={sessionId:'session',wide:true,useWorkspaces:fn=>fn({items:workspaces}),useSessions:fn=>fn({current:'session'})};
createRoot(document.getElementById('app')).render(<><h1>凭证集成验收夹具</h1>{seats.map(({options,component:C})=><C key={options.id} {...props}/>)}</>);
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
try {
  await page.goto(`http://127.0.0.1:${address.port}`)
  await page.getByRole('button', { name: '打开数据源与凭证' }).click()
  await page
    .getByLabel('数据源', { exact: true })
    .selectOption({ label: 'warehouse' }, { timeout: 30000 })
  await page.getByRole('heading', { name: 'warehouse', exact: true }).waitFor({ timeout: 30000 })
  await page.getByLabel('新值').fill(secret)
  await page.getByRole('button', { name: '保存并验证', exact: true }).click()
  await page.getByRole('button', { name: '更换', exact: true }).waitFor({ timeout: 30000 })
  assert(!(await page.locator('body').innerText()).includes(secret))
  assert(!(await page.evaluate(() => JSON.stringify(sessionStorage))).includes(secret))
  await page.screenshot({ path: path.join(output, 'management.png'), fullPage: true })
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
  await page.getByLabel('数据源', { exact: true }).selectOption({ label: 'warehouse_two' })
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
  await page.getByRole('button', { name: '打开数据源与凭证' }).click()
  await page.getByRole('button', { name: 'warehouse · 处理中', exact: true }).waitFor()
  await page.getByRole('button', { name: 'warehouse_two · 处理中', exact: true }).waitFor()
  assert(gates.has('warehouse') && gates.has('warehouse_two'))
  gates.get('warehouse')!()
  await page
    .getByRole('button', { name: 'warehouse · 已结束', exact: true })
    .waitFor({ timeout: 30000 })
  assert.equal(
    await page.evaluate(
      () => JSON.parse(sessionStorage.getItem('marivo-credential-operation') ?? '[]').length,
    ),
    1,
  )
  await page.getByRole('button', { name: 'warehouse_two · 处理中', exact: true }).click()
  await page.screenshot({ path: path.join(output, 'concurrent-operations.png'), fullPage: true })
  gates.get('warehouse_two')!()
  await page
    .getByRole('button', { name: 'warehouse_two · 已结束', exact: true })
    .waitFor({ timeout: 30000 })
  bridge.test = originalTest
  await page.getByLabel('数据源', { exact: true }).selectOption({ label: 'warehouse' })
  await page.getByRole('button', { name: '删除已保存值', exact: true }).click()
  await page.getByRole('button', { name: '确认删除已保存值', exact: true }).click()
  await page.getByLabel('新值').waitFor({ timeout: 30000 })
  await page.getByRole('button', { name: '收起', exact: true }).click()
  const pending = service.prepare('access', f.exec, async () => bridge, 'warehouse')
  await page
    .getByRole('button', { name: '保存并验证后继续', exact: true })
    .waitFor({ timeout: 30000 })
  await page.getByLabel('新值').fill('unsubmitted')
  await page.reload()
  await page
    .getByRole('button', { name: '保存并验证后继续', exact: true })
    .waitFor({ timeout: 30000 })
  assert.equal(await page.getByLabel('新值').inputValue(), '')
  await page.getByLabel('新值').fill(secret)
  await page.screenshot({ path: path.join(output, 'pending.png'), fullPage: true })
  await page.getByRole('button', { name: '保存并验证后继续', exact: true }).click()
  const result = await pending
  assert.equal('status' in result && result.status, 'ok')
  await page.getByText('验证完成，原调用继续', { exact: false }).first().waitFor({ timeout: 30000 })
  assert(!(await page.locator('body').innerText()).includes(secret))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true })
  assert.deepEqual(errors, [])
  console.log(
    JSON.stringify({
      browser: 'passed',
      managementSaveDelete: 'passed',
      concurrentOperationsRecovery: 'passed',
      refreshRestoresPendingWithoutSecret: 'passed',
      originalCallResumed: 'passed',
      screenshots: output,
      surface: 'isolated DSH slots and HTTP transport; not full DSH Web deployment',
    }),
  )
} finally {
  f.controller.abort()
  await service.close()
  await unregister()
  await browser.close()
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await rm(root, { recursive: true, force: true })
}
