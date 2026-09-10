/** Isolated Chromium + real Marivo removal + native credential RPC and panel. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { MarivoDatasourceBridge } from '../src/datasource/bridge.ts'
import { registerCredentialRpc } from '../src/datasource/rpc.ts'
import { marivoCredentialStorageRef } from '../src/datasource/shell-env.ts'
import { bindMarivoEnvironment } from '../src/environment/index.ts'
import { fixture } from '../tests/datasource-credentials/fixtures.ts'
import { createConnectionFixture } from '../tests/semantic-reference-input/fixtures.ts'

const python = process.env.DSH_DATA_ANALYSIS_PYTHON
if (!python) throw new Error('DSH_DATA_ANALYSIS_PYTHON required')
const { chromium } = await import(process.env.DSH_DATA_ANALYSIS_PLAYWRIGHT_MODULE ?? 'playwright')
const root = await mkdtemp(path.join(tmpdir(), 'dsh-removal-web-'))
const output = process.env.DSH_DATA_ANALYSIS_BROWSER_OUTPUT ?? '/tmp/dsh-datasource-removal-web'
await mkdir(output, { recursive: true })
const f = fixture()
const { connection, channels } = createConnectionFixture()
let unregister: (() => Promise<void>) | undefined
let server: ReturnType<typeof createServer> | undefined
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
try {
  const runner = await bindMarivoEnvironment({ projectRoot: root, pythonExecutable: python })
  const bridge = new MarivoDatasourceBridge(runner)
  for (const name of ['delete_first', 'delete_shared', 'delete_readonly']) {
    assert.deepEqual(
      await bridge.create({
        backend: 'duckdb',
        fields: {
          name,
          path: ':memory:',
          http_scope: 'http://127.0.0.1/',
          http_bearer_token_env: 'SHARED_TOKEN',
        },
      }),
      { name },
    )
  }
  f.store.put('SHARED_TOKEN')
  unregister = registerCredentialRpc(connection, f.service, async () => bridge)
  const handler = channels.get('/dsh-data-analysis-credentials')!
  const app = await build({
    stdin: {
      loader: 'tsx',
      resolveDir: process.cwd(),
      contents: `
import React,{useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {CredentialPanel} from ${JSON.stringify(fileURLToPath(new URL('../src/client/credentials/install.tsx', import.meta.url)))};
import {CredentialClientModel} from ${JSON.stringify(fileURLToPath(new URL('../src/client/credentials/model.ts', import.meta.url)))};
const rpc={call:async(channel,endpoint,payload,signal)=>(await fetch('/rpc',{method:'POST',body:JSON.stringify({endpoint,payload}),signal})).json()};
const model=new CredentialClientModel(rpc,sessionStorage);
model.show('workspace');
function App(){useSyncExternalStore(model.subscribe,model.getSnapshot);return <div style={{maxWidth:900,margin:'auto',padding:8}}><CredentialPanel model={model} workspaces={[{workspaceId:'workspace',title:'删除验收',sessionIds:[]}]}/></div>}
createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
  })
  server = createServer(async (req, res) => {
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
    const { endpoint, payload } = JSON.parse(Buffer.concat(chunks).toString())
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(await handler(endpoint, payload, controller.signal)))
  })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert(address && typeof address !== 'string')
  browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
  const errors: string[] = []
  page.on('pageerror', (error: Error) => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${address.port}`)
  const select = async (name: string) => {
    await page.getByRole('button', { name: `选择数据源 ${name}`, exact: true }).click()
    await page.getByRole('heading', { name, exact: true }).waitFor()
    await page.getByRole('button', { name: '删除数据源', exact: true }).click()
  }
  const confirmation = page.getByRole('group', { name: '确认删除数据源', exact: true })
  const confirm = () =>
    confirmation.getByRole('button', { name: '确认删除数据源', exact: true }).click()
  await select('delete_first')
  assert.equal(await confirmation.getByRole('checkbox').isChecked(), false)
  await confirmation.getByRole('button', { name: '取消', exact: true }).click()
  assert((await bridge.inventory()).some((item) => item.name === 'delete_first'))
  await page.getByRole('button', { name: '删除数据源', exact: true }).click()
  await page.screenshot({ path: path.join(output, 'delete-confirm-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  const overflow = await page.locator('.mc-panel').evaluate((panel: Element) =>
    [document.documentElement, panel, ...panel.querySelectorAll('*')]
      .filter((element) => element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1)
      .filter(
        (element) =>
          !(element.matches('.mc-datasources') && getComputedStyle(element).overflowX === 'auto'),
      )
      .map((element) => element.className),
  )
  assert.deepEqual(overflow, [])
  await page.screenshot({ path: path.join(output, 'delete-confirm-mobile.png'), fullPage: true })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.screenshot({ path: path.join(output, 'delete-confirm-dark.png'), fullPage: true })
  await confirm()
  await page.getByText('已删除数据源 delete_first。', { exact: true }).waitFor({ timeout: 30000 })
  await page
    .getByRole('button', { name: '选择数据源 delete_first', exact: true })
    .waitFor({ state: 'detached', timeout: 30000 })
  assert(f.store.values.has(marivoCredentialStorageRef('SHARED_TOKEN')))
  await select('delete_shared')
  await confirmation.getByRole('checkbox').check()
  await confirm()
  await page.getByText('已删除凭证：SHARED_TOKEN。', { exact: true }).waitFor({ timeout: 30000 })
  assert(!f.store.values.has(marivoCredentialStorageRef('SHARED_TOKEN')))
  f.store.put('SHARED_TOKEN')
  f.store.readonly = true
  const refreshed = page.waitForResponse(
    (response: { url(): string; request(): { postDataJSON(): { endpoint: string } } }) =>
      response.url().endsWith('/rpc') && response.request().postDataJSON().endpoint === 'overview',
  )
  await page.getByRole('button', { name: '刷新数据源', exact: true }).click()
  await refreshed
  await page.getByRole('button', { name: '选择数据源 delete_readonly', exact: true }).click()
  await page.getByText(/来源只读/).waitFor()
  await select('delete_readonly')
  await confirmation.getByRole('checkbox').check()
  await confirm()
  await page
    .getByText('未能删除的凭证：SHARED_TOKEN。', { exact: true })
    .waitFor({ timeout: 30000 })
  await page
    .getByText('已删除数据源 delete_readonly。', { exact: true })
    .waitFor({ timeout: 30000 })
  assert(f.store.values.has(marivoCredentialStorageRef('SHARED_TOKEN')))
  assert(!(await bridge.inventory()).some((item) => item.name.startsWith('delete_')))
  assert.doesNotMatch(await page.locator('body').innerText(), /canary-private/)
  await page.screenshot({ path: path.join(output, 'delete-result.png'), fullPage: true })
  assert.deepEqual(errors, [])
  const evidence = {
    passed: true,
    runtime: runner.binding.marivoVersion,
    surface:
      'isolated Chromium, real Marivo, native plugin RPC and panel; fixture Harness credential provider',
    checks: [
      'confirmation-and-cancel',
      'preserve-shared-credentials',
      'explicit-credential-deletion',
      'readonly-partial-failure',
      'result-after-card-disappears',
      'mobile-and-dark-layout',
      'no-secret-output',
    ],
    screenshots: output,
  }
  await writeFile(
    path.join(output, 'browser-evidence.json'),
    `${JSON.stringify(evidence, null, 2)}\n`,
  )
  console.log(JSON.stringify(evidence))
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0]
  if (page) {
    await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true })
    console.error(await page.locator('body').innerText())
  }
  throw error
} finally {
  await browser?.close()
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
  await unregister?.()
  await f.service.close()
  await rm(root, { recursive: true, force: true })
}
