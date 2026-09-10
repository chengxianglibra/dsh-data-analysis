/** Real DSH LocaleRuntime + production components in an isolated browser; no running profile changes. */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { buildPresentation } from '../src/presentation/build/index.ts'
import { interactionFixture } from '../tests/presentation-reader/interaction-fixture.ts'
import { snapshot } from '../tests/semantic-browser/fixtures.ts'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await mkdtemp(path.join(tmpdir(), 'dsh-locale-'))
const { document } = await interactionFixture()
const sourceFixture = JSON.parse(
  await readFile(
    new URL('../tests/presentation-s0/fixtures/computed.document.json', import.meta.url),
    'utf8',
  ),
)
document.sources = sourceFixture.sources
for (const source of document.sources) {
  if (source.status === 'unavailable') source.reason = 'marivo.presentation.source-unavailable'
  else
    source.facts.push({
      label: '选择的 Finding unavailable',
      value: 'marivo.presentation.finding-unavailable',
    })
}
for (const dataset of document.datasets)
  dataset.sourceIds = document.sources.map((source) => source.id)
document.diagnostics.push({
  code: 'finding_unavailable',
  path: '/sources/0/ref/findingId',
  message: 'Artifact is available; its requested Finding is unavailable.',
})

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
import { HostPresentationReader } from './src/client/presentation/host-entry.tsx';
import { exportCurrentView } from './src/client/presentation/export-view.ts';
import { defaultSelection } from './src/presentation/contracts/interaction.ts';
import { presentationEdits } from './src/presentation/contracts/editing.ts';
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
const credentials = { ...frozen({open:true, workspaceId:'a', sessionId:'s', generation:'g', datasources:[credential], requests:[], requestId:'', selected:credential.token, loading:false, error:'marivo.credentials.connection-test-failed', operations:[], outcomes:{}}), publishingCredentials: async () => ({ enabled: false }), select() {}, refreshDatasources(){ window.dataReads++; } };
let semanticState = {open:true, workspaceId:'a', views:{a:{...emptyView(), snapshot:${JSON.stringify(snapshot())}}}};
const semanticListeners = new Set();
const semantic = { getSnapshot: () => semanticState, subscribe(listener) { semanticListeners.add(listener); return () => semanticListeners.delete(listener); }, patch(patch) { semanticState = {...semanticState,views:{a:{...semanticState.views.a,...patch}}}; for (const listener of semanticListeners) listener(); }, select(){}, refresh(){ window.dataReads++; } };
let setReport, setEditing;
window.dataReads = 0;
function App() {
 const [report, updateReport] = React.useState(${JSON.stringify(document)});
 const [editing, updateEditing] = React.useState(false);
 const [edits, updateEdits] = React.useState(presentationEdits(report));
 setReport = locale => updateReport(value => ({...value,locale}));
 setEditing = updateEditing;
 window.currentReport = report;
 return <><div id="credentials"><CredentialPanel model={credentials} workspaces={workspaces}/></div><div id="semantic"><SemanticBrowserPanel model={semantic} workspaces={workspaces}/></div><div id="report"><HostPresentationReader document={report} editing={editing ? {edits,onChange:updateEdits} : undefined} exportActions={{downloadFullReport(){}}}/></div></>;
}
const AppRoot = localized(ctx, App);
createRoot(document.getElementById('root')).render(<AppRoot/>);
window.systemLanguage = value => ctx.locale.setLocale(value);
window.reportLanguage = value => setReport(value);
window.editReport = value => setEditing(value);
window.exportView = () => new TextDecoder().decode(exportCurrentView(document.querySelector('#report .pr-host-live .pr-reader'), window.currentReport, {selection: defaultSelection(window.currentReport.interaction), explorations:{},tableSorts:{}}).bytes);
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
const offline = new Map<string, Buffer>()
for (const locale of ['zh-CN', 'en-US'] as const)
  offline.set(`/${locale}`, (await buildPresentation({ ...document, locale })).htmlBytes)
const server = createServer((request, response) => {
  if (request.url === '/app.js') {
    response.setHeader('content-type', 'application/javascript')
    response.end(script)
  } else if (offline.has(request.url!)) {
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end(offline.get(request.url!)!)
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
  await page.locator('#report .pr-host-live .pr-reader').waitFor()
  const password = page.locator('#credentials input[type="password"]')
  await password.fill('LOCAL-UI-CANARY')
  const search = page.locator('#semantic .sb-search')
  for (const query of ['指标', 'Metric']) {
    await search.fill(query)
    assert.equal(await page.locator('#semantic .sb-objects > li').count(), 1)
  }
  const report = page.locator('#report .pr-host-live')
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
    for (const locale of ['zh-CN', 'en-US']) {
      await page.evaluate((value) => (window as any).reportLanguage(value), locale)
      await report.locator(`[lang="${locale}"]`).waitFor()
      const printed = page.locator('#report .pr-host-print .pr-reader')
      assert.equal(await printed.getAttribute('lang'), locale)
      assert.ok(
        (await printed.textContent())!.includes(locale === 'zh-CN' ? '生成于' : 'Generated'),
      )
      assert.ok((await report.innerText()).includes(locale === 'zh-CN' ? '生成于' : 'Generated'))
      await report
        .getByRole('button', { name: system === 'zh' ? '导出报告' : 'Export report', exact: true })
        .waitFor()
      assert.doesNotMatch(
        await page.locator('#root').innerText(),
        /marivo\.(credentials|semantic|presentation|navigation)\./,
      )
      const html = await page.evaluate(() => (window as any).exportView())
      assert.match(html, new RegExp(`<html lang="${locale}">`))
      assert.doesNotMatch(html, /marivo\.presentation\.(?:source-unavailable|finding-unavailable)/)
      assert.doesNotMatch(html, /Artifact is available; its requested Finding is unavailable/)
      assert.ok(html.includes(locale === 'zh-CN' ? '请求的 Finding' : 'The requested Finding'))
      await writeFile(path.join(output, `view-${system}-${locale}.html`), html)
      await page.screenshot({
        path: path.join(output, `${system}-ui-${locale}-report.png`),
        fullPage: true,
      })
    }
  }
  await page.evaluate(() => (window as any).editReport(true))
  const title = report.locator('.pr-title-row input')
  await title.fill('Preserved report draft')
  await page.evaluate(() => (window as any).systemLanguage('zh'))
  assert.equal(await title.inputValue(), 'Preserved report draft')
  assert.equal(await password.inputValue(), 'LOCAL-UI-CANARY')
  assert.equal(await page.evaluate(() => (window as any).dataReads), 0)
  await page.screenshot({ path: path.join(output, 'zh-ui-en-report.png'), fullPage: true })
  for (const locale of ['zh-CN', 'en-US']) {
    for (const javaScriptEnabled of [true, false]) {
      const context = await browser.newContext({
        locale: locale === 'zh-CN' ? 'en-US' : 'zh-CN',
        javaScriptEnabled,
      })
      const portable = await context.newPage()
      await portable.goto(`${origin}/${locale}`)
      if (javaScriptEnabled)
        await portable.locator('html[data-presentation-ready="true"]').waitFor()
      assert.equal(await portable.locator('html').getAttribute('lang'), locale)
      assert.ok(
        (await portable.locator('body').innerText()).includes(
          locale === 'zh-CN' ? '生成于' : 'Generated',
        ),
      )
      await portable.emulateMedia({ media: 'print' })
      assert.ok(
        (await portable.locator('body').innerText()).includes(
          locale === 'zh-CN' ? '生成于' : 'Generated',
        ),
      )
      await context.close()
    }
  }
  assert.deepEqual(failures, [])
  console.log(
    JSON.stringify({
      passed: true,
      output,
      evidence:
        'Installed DSH LocaleRuntime, production UI, 4 language combinations, retained credential, semantic search and report inputs, bilingual semantic search, no extra data reads, print, portable JS and static fallback',
    }),
  )
} finally {
  await browser.close()
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
}
