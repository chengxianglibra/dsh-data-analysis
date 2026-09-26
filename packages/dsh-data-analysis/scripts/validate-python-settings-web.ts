/** Isolated browser exercise of the card against the rc.1 ConfigForm contract. */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { type Browser, chromium } from 'playwright'

const directory = await mkdtemp(path.join(tmpdir(), 'dsh-python-settings-web-'))
await build({
  stdin: {
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
    loader: 'tsx',
    contents: `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {PythonSettingsCard} from './src/client/settings/card.tsx';
import {CopyProvider} from './src/client/i18n/context.tsx';
import {translator} from './src/client/i18n/copy.ts';
const listeners = new Set();
let state = {status:'ready', value:{pythonTimeoutMs:180000}, base:{pythonTimeoutMs:180000}, user:{}, revision:1, writable:true, mode:'host'};
let refuse = false;
const publish = next => { state = next; for (const listener of listeners) listener(); };
const form = {
  getSnapshot: () => state,
  subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  async mutate(ops, expectedRevision) {
    if (refuse) { refuse = false; return false; }
    if (!state.writable || expectedRevision !== state.revision) return false;
    const value = ops[0].value;
    if (!Number.isInteger(value) || value < 1 || value > 2147483647) return false;
    publish({...state, value:{pythonTimeoutMs:value}, user:{pythonTimeoutMs:value}, revision:state.revision+1});
    return true;
  },
};
const root = createRoot(document.getElementById('root'));
window.renderSettings = (locale = 'zh-CN') => root.render(<CopyProvider t={translator(locale)}><ul style={{padding:0}}><PythonSettingsCard scope={form}/></ul></CopyProvider>);
window.fixture = {
  external(value) { publish({...state, value:{pythonTimeoutMs:value}, user:{pythonTimeoutMs:value}, revision:state.revision+1}); },
  refuse() { refuse = true; },
  readOnly() { publish({...state, writable:false}); },
  snapshot: () => state,
};
window.renderSettings();
`,
  },
  bundle: true,
  platform: 'browser',
  format: 'esm',
  outfile: path.join(directory, 'main.js'),
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'silent',
})
const server = createServer(async (request, response) => {
  response.setHeader('Content-Type', request.url === '/main.js' ? 'text/javascript' : 'text/html')
  response.end(
    request.url === '/main.js'
      ? await readFile(path.join(directory, 'main.js'))
      : '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:24px;font-family:system-ui"><main id="root" style="max-width:760px;margin:auto"></main><script type="module" src="/main.js"></script></body></html>',
  )
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
assert(address && typeof address === 'object')
let browser: Browser | undefined
try {
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1050, height: 600 } })
  page.setDefaultTimeout(5000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${address.port}`)
  await page.getByRole('button', { name: '展开设置: 数据分析' }).click()
  const input = page.locator('#marivo-python-timeout')
  assert.equal(await input.evaluate((el: HTMLInputElement) => el.value), '180')
  await input.fill('900')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByText('未保存', { exact: true }).waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '展开设置: 数据分析' }).click()
  assert.equal(await input.inputValue(), '900')
  await input.fill('0')
  assert(await page.getByRole('button', { name: '保存', exact: true }).isDisabled())
  await input.fill('1200')
  await page.evaluate(() =>
    (window as unknown as { fixture: { external(n: number): void } }).fixture.external(600_000),
  )
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByText(/保存失败或设置已被其他页面修改/).waitFor()
  assert.equal(await input.inputValue(), '1200')
  await page.getByRole('button', { name: '放弃修改' }).click()
  assert.equal(await input.inputValue(), '600')
  await input.fill('601')
  await page.evaluate(() => (window as unknown as { fixture: { refuse(): void } }).fixture.refuse())
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByText(/保存失败或设置已被其他页面修改/).waitFor()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByText('未保存', { exact: true }).waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '展开设置: 数据分析' }).click()
  const screenshot = path.join(directory, 'settings-zh.png')
  await page.screenshot({ path: screenshot })
  await page.setViewportSize({ width: 390, height: 700 })
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.evaluate(() =>
    (window as unknown as { fixture: { readOnly(): void } }).fixture.readOnly(),
  )
  await page.getByText('当前连接的设置只读。').waitFor()
  await page.evaluate(() =>
    (window as unknown as { renderSettings(locale: string): void }).renderSettings('en-US'),
  )
  await page.getByText('Default Python execution timeout (seconds)').waitFor()
  assert.deepEqual(errors, [])
  const result = {
    ok: true,
    screenshot,
    checks: [
      'save',
      'validation',
      'conflict',
      'refused-write',
      'read-only',
      'locale',
      'mobile-layout',
    ],
    client: 'ConfigForm contract fixture',
  }
  await writeFile(path.join(directory, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} finally {
  await browser?.close()
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
}
