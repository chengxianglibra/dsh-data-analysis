/** Real DSH LocaleRuntime + production settings components in an isolated browser; no running profile changes. */
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { snapshot } from '../tests/semantic-browser/fixtures.ts'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await mkdtemp(path.join(tmpdir(), 'dsh-locale-'))

const nativeLocale = await readFile(
  new URL(
    './lib/client.js',
    `file://${require.resolve('@deepseek-ai/dsh-client-locale/package.json')}`,
  ),
  'utf8',
)
const bundle = await build({
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
const primitives = new Proxy({}, { get(_target, key) { throw new Error('Native settings row is outside this fixture: '+String(key)); } });
import * as store from '@deepseek-ai/dsh-client-store';
import { Context } from '@deepseek-ai/cordis';
import { createRoot } from 'react-dom/client';
import { localized, installCopy } from './src/client/i18n/host.tsx';
import { CredentialPanel } from './src/client/credentials/install.tsx';
import { SemanticBrowserPanel } from './src/client/semantic-browser/panel.tsx';
import { emptyView } from './src/client/semantic-browser/model.ts';
let native;
const modules = { react: React, 'react/jsx-runtime': jsx, '@deepseek-ai/dsh-client-ui-primitives': primitives, '@deepseek-ai/dsh-client-store': store };
window.__ModuleLoader__ = { load(entry) { native = entry.factory(name => { if (!(name in modules)) throw new Error('Missing module '+name); return modules[name]; }); } };
${nativeLocale}
const ctx = new Context();
ctx.locale = new native.LocaleRuntime(ctx);
ctx.locale.setLocale('zh');
installCopy(ctx);
const frozen = value => ({ getSnapshot: () => value, subscribe: () => () => {} });
const workspaces = [{workspaceId: 'a', title: 'Workspace A'}];
const credential = { name: 'warehouse', token: 'warehouse-context', version: '1', refs: ['PASSWORD'], fields: { password: 'PASSWORD' }, backend: 'duckdb', properties: {}, credentials: { PASSWORD: { configured: false, writable: true, source: null } } };
const credentials = { ...frozen({open:true, workspaceId:'a', sessionId:'s', generation:'g', datasources:[credential], requests:[], requestId:'', selected:credential.token, loading:false, error:'marivo.credentials.connection-test-failed', operations:[], outcomes:{}}), select() {}, refreshDatasources(){ window.dataReads++; } };
let semanticState = {open:true, workspaceId:'a', views:{a:{...emptyView(), snapshot:${JSON.stringify(snapshot())}}}};
const semanticListeners = new Set();
const semantic = { getSnapshot: () => semanticState, subscribe(listener) { semanticListeners.add(listener); return () => semanticListeners.delete(listener); }, patch(patch) { semanticState = {...semanticState,views:{a:{...semanticState.views.a,...patch}}}; for (const listener of semanticListeners) listener(); }, select(){}, refresh(){ window.dataReads++; } };
window.dataReads = 0;
function App() {
 return <><div id="credentials"><CredentialPanel model={credentials} workspaces={workspaces}/></div><div id="semantic"><SemanticBrowserPanel model={semantic} workspaces={workspaces}/></div></>;
}
const AppRoot = localized(ctx, App);
createRoot(document.getElementById('root')).render(<AppRoot/>);
window.systemLanguage = value => ctx.locale.setLocale(value);
`,
  },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  loader: { '.wasm': 'binary' },
  write: false,
  define: { 'process.env.NODE_ENV': '"production"' },
})
const script = bundle.outputFiles[0]!.text
const server = createServer((request, response) => {
  if (request.url === '/app.js') {
    response.setHeader('content-type', 'application/javascript')
    response.end(script)
  } else {
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end(
      '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="/app.js"></script></body></html>',
    )
  }
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
assert(address && typeof address !== 'string')
const origin = `http://127.0.0.1:${address.port}`
const browser = await chromium.launch({ headless: true })
const failures: string[] = []
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
  page.on('pageerror', (error) => {
    failures.push(error.message)
    console.error(error.message)
  })
  await page.goto(origin)
  await page.locator('#credentials input[type="password"]').waitFor()
  const password = page.locator('#credentials input[type="password"]')
  await password.fill('LOCAL-UI-CANARY')
  const search = page.locator('#semantic .sb-search')
  for (const query of ['指标', 'Metric']) {
    await search.fill(query)
    assert.equal(await page.locator('#semantic .sb-objects > li').count(), 1)
  }
  for (const system of ['zh', 'en']) {
    await page.evaluate((value) => (window as any).systemLanguage(value), system)
    await page
      .getByRole('button', {
        name: system === 'zh' ? '刷新数据源' : 'Refresh datasources',
        exact: true,
      })
      .waitFor()
    assert.equal(await password.inputValue(), 'LOCAL-UI-CANARY')
    assert.equal(await search.inputValue(), 'Metric')
    assert.ok(
      (await page.locator('#credentials').innerText()).includes(
        system === 'zh' ? '连接测试失败' : 'Connection test failed',
      ),
    )
    assert.doesNotMatch(
      await page.locator('#root').innerText(),
      /marivo\.(credentials|semantic|navigation)\./,
    )
    await page.screenshot({ path: path.join(output, `${system}-ui.png`), fullPage: true })
  }
  await page.evaluate(() => (window as any).systemLanguage('zh'))
  assert.equal(await password.inputValue(), 'LOCAL-UI-CANARY')
  assert.equal(await page.evaluate(() => (window as any).dataReads), 0)
  assert.deepEqual(failures, [])
  console.log(
    JSON.stringify({
      passed: true,
      output,
      evidence:
        'Installed DSH LocaleRuntime, production credential and semantic UI, both system languages, retained credential and semantic search inputs, bilingual semantic search, no extra data reads',
    }),
  )
} finally {
  await browser.close()
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
}
