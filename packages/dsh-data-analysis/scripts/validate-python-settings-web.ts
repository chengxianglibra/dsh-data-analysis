/** Isolated card acceptance backed by the real Harness file settings provider. */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import type { SettingsPathOp } from '@deepseek-ai/dsh-settings'
import { FileSettingsProvider } from '@deepseek-ai/dsh-settings-file'
import { build } from 'esbuild'
import { type Browser, chromium } from 'playwright'
import { installPythonSettings, PYTHON_SETTINGS_NAMESPACE } from '../src/settings.ts'

const directory = await mkdtemp(path.join(tmpdir(), 'dsh-python-settings-web-'))
const ctx = new Context()
const provider = await ctx.plugin(FileSettingsProvider, {
  path: path.join(directory, 'settings.json'),
  watch: false,
})
let settings!: ReturnType<typeof installPythonSettings>
const owner = await ctx.plugin({
  name: 'python-settings-web-fixture',
  apply(owner: Context) {
    settings = installPythonSettings(owner, { pythonTimeoutMs: 180_000 })
  },
})
const descriptor = () =>
  ctx.settings
    .describe({ redactSecrets: true })
    .find((entry) => entry.ns === PYTHON_SETTINGS_NAMESPACE)!
const nativeClient = await readFile(
  new URL(
    './lib/client.js',
    pathToFileURL(
      createRequire(import.meta.url).resolve('@deepseek-ai/dsh-client-ui-settings/package.json'),
    ),
  ),
  'utf8',
)
await build({
  stdin: {
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
    loader: 'tsx',
    contents: `
import React from 'react';
import * as cordis from '@deepseek-ai/cordis';
import * as store from '@deepseek-ai/dsh-client-store';
import {createRoot} from 'react-dom/client';
import {PythonSettingsCard} from './src/client/settings/card.tsx';
import {CopyProvider} from './src/client/i18n/context.tsx';
import {translator} from './src/client/i18n/copy.ts';
const modules = { '@deepseek-ai/cordis': cordis, '@deepseek-ai/dsh-client-store': store };
window.__ModuleLoader__ = {load(entry) { modules[entry.id] = entry.factory((name) => modules[name]); }};
await import('/native-settings.js');
const client = new cordis.Context();
let writable = true;
client.provide('remote', {
  $host: {isLoopback:true},
  $on: () => () => {},
  settings: {
    async describe() {
      const result = await (await fetch('/settings')).json();
      result.value.writable = writable;
      return result;
    },
    async mutate(namespace, ops, expectedRevision) {
      return (await fetch('/settings', {method:'POST', body:JSON.stringify({ops, expectedRevision})})).json();
    },
  },
});
modules['@deepseek-ai/dsh-client-ui-settings'].apply(client);
const scope = client.settingsScope.bind({namespace:'dsh-data-analysis'});
const root = createRoot(document.getElementById('root'));
window.renderSettings = (locale = 'zh-CN') => root.render(<CopyProvider t={translator(locale)}><ul style={{padding:0}}><PythonSettingsCard scope={scope}/></ul></CopyProvider>);
window.refreshSettings = () => client.settingsScope.describe().load();
window.readOnly = () => { writable = false; return window.refreshSettings(); };
window.renderSettings();

`,
  },
  bundle: true,
  external: ['/native-settings.js'],
  platform: 'browser',
  format: 'esm',
  outfile: path.join(directory, 'main.js'),
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'silent',
})
let rejectNextWrite = false
const server = createServer(async (request, response) => {
  if (request.url === '/native-settings.js') {
    response.setHeader('Content-Type', 'text/javascript')
    response.end(nativeClient)
    return
  }
  if (request.url === '/settings') {
    response.setHeader('Content-Type', 'application/json')
    try {
      if (request.method === 'POST') {
        if (rejectNextWrite) {
          rejectNextWrite = false
          throw new Error('fixture-write-refused')
        }
        const chunks = []
        for await (const chunk of request) chunks.push(chunk)
        const input = JSON.parse(Buffer.concat(chunks).toString()) as {
          ops: SettingsPathOp[]
          expectedRevision: number
        }
        await ctx.settings.mutate(PYTHON_SETTINGS_NAMESPACE, input.ops, input.expectedRevision)
      }
      response.end(
        JSON.stringify({
          ok: true,
          value:
            request.method === 'POST'
              ? descriptor()
              : { writable: true, namespaces: [descriptor()] },
        }),
      )
    } catch {
      response.statusCode = 409
      response.end(JSON.stringify({ ok: false, error: { message: 'settings-write-failed' } }))
    }
    return
  }
  response.setHeader('Content-Type', request.url === '/main.js' ? 'text/javascript' : 'text/html')
  response.end(
    request.url === '/main.js'
      ? await readFile(path.join(directory, 'main.js'))
      : '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:24px;font-family:system-ui;color:#202124"><main id="root" style="max-width:760px;margin:auto"></main><script type="module" src="/main.js"></script></body></html>',
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
  await page.getByText('数据分析', { exact: true }).click()
  const input = page.getByLabel('Python 默认执行超时（秒）')
  assert.equal(await input.inputValue(), '180')
  await input.fill('900')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByText('未保存', { exact: true }).waitFor({ state: 'hidden' })
  assert.equal(settings.get().pythonTimeoutMs, 900_000)
  await page.reload()
  await page.getByText('数据分析', { exact: true }).click()
  assert.equal(await input.inputValue(), '900')
  await input.fill('0')
  assert(await page.getByRole('button', { name: '保存', exact: true }).isDisabled())
  await page.getByRole('alert').waitFor()
  await input.fill('1200')
  await ctx.settings.update(PYTHON_SETTINGS_NAMESPACE, { pythonTimeoutMs: 600_000 })
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByText(/保存失败或设置已被其他页面修改/).waitFor()
  assert.equal(await input.inputValue(), '1200', 'Conflict preserves the unsaved draft')
  assert.equal(settings.get().pythonTimeoutMs, 600_000)
  await page.getByRole('button', { name: '放弃修改' }).click()
  assert.equal(await input.inputValue(), '600')
  await page.getByRole('button', { name: '恢复继承值' }).click()
  assert.equal(await input.inputValue(), '180')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByText('未保存', { exact: true }).waitFor({ state: 'hidden' })
  assert.equal(settings.get().pythonTimeoutMs, 180_000)
  assert.equal(Object.hasOwn(descriptor().user as object, 'pythonTimeoutMs'), false)

  // Matching the effective value is insufficient: a refused set must not look saved.
  await input.fill('181')
  await input.fill('180')
  rejectNextWrite = true
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByText(/保存失败或设置已被其他页面修改/).waitFor()
  await page.getByText('未保存', { exact: true }).waitFor()
  assert.equal(Object.hasOwn(descriptor().user as object, 'pythonTimeoutMs'), false)
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByText('未保存', { exact: true }).waitFor({ state: 'hidden' })
  assert.equal((descriptor().user as { pythonTimeoutMs: number }).pythonTimeoutMs, 180_000)

  // A refused reset must preserve its unset intent even when value equals base.
  await page.getByRole('button', { name: '恢复继承值' }).click()
  rejectNextWrite = true
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByText(/保存失败或设置已被其他页面修改/).waitFor()
  await page.getByText('未保存', { exact: true }).waitFor()
  assert.equal((descriptor().user as { pythonTimeoutMs: number }).pythonTimeoutMs, 180_000)
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByText('未保存', { exact: true }).waitFor({ state: 'hidden' })
  assert.equal(Object.hasOwn(descriptor().user as object, 'pythonTimeoutMs'), false)
  const screenshot = path.join(directory, 'settings-zh.png')
  await page.screenshot({ path: screenshot })
  await page.setViewportSize({ width: 390, height: 700 })
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.evaluate(() => (window as unknown as { readOnly(): void }).readOnly())
  assert(await input.isDisabled())
  await page.getByText('当前连接的设置只读。').waitFor()
  await page.evaluate(() =>
    (window as unknown as { renderSettings(locale: string): void }).renderSettings('en-US'),
  )
  await page.getByLabel('Default Python execution timeout (seconds)').waitFor()
  assert.deepEqual(errors, [])
  const result = {
    ok: true,
    screenshot,
    checks: [
      'save',
      'reload',
      'invalid-value',
      'conflict-preserves-draft',
      'discard',
      'reset-inherits-base',
      'refused-set-at-inherited-value',
      'refused-reset-at-inherited-value',
      'retry-preserves-write-intent',
      'read-only',
      'locale',
      'mobile-layout',
    ],
    provider: 'Harness FileSettingsProvider',
    client: 'Harness native settingsScope',
    transport: 'isolated HTTP fixture',
  }
  await writeFile(path.join(directory, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} finally {
  await browser?.close()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await owner.dispose()
  await provider.dispose()
}
