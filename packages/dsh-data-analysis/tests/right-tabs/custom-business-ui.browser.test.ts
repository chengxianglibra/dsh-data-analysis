import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

test('business UI follows Host theme while preserving form state and exact source', async (t) => {
  const output = process.env.DSH_DATA_ANALYSIS_BUSINESS_UI_OUTPUT
  const directory = output ?? (await mkdtemp(path.join(tmpdir(), 'marivo-business-ui-')))
  await mkdir(directory, { recursive: true })
  if (!output) t.after(() => rm(directory, { recursive: true, force: true }))
  const expression = '\namount.sum(\n\ttime=ordered_at,\n)\n' + '# long source '.repeat(50)
  await build({
    stdin: {
      resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
      loader: 'tsx',
      contents: `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {CopyProvider} from './src/client/i18n/context.tsx';
import {translator} from './src/client/i18n/copy.ts';
import {CredentialPanel} from './src/client/credentials/install.tsx';
import {CredentialClientModel} from './src/client/credentials/model.ts';
import {SemanticBrowserPanel} from './src/client/semantic-browser/panel.tsx';
import {SemanticBrowserModel} from './src/client/semantic-browser/model.ts';
import {PythonSettingsCard} from './src/client/settings/card.tsx';
import {WorkspaceHeaderAction} from './src/client/workspace-header-action.tsx';
import {ReportCatalogView,ReportHistoryPanel,catalogStyles} from './src/client/presentation/catalog.tsx';
import {ReportCatalogModel} from './src/client/presentation/catalog-model.ts';
import {rightTabStyles} from './src/client/right-tabs/styles.ts';
const workspaces=[{workspaceId:'w',name:'Sample',sessionIds:['s']}];
const credentialModel=new CredentialClientModel({call:async()=>({ok:true,value:{generation:'fixture',datasources:[{
 token:'warehouse',workspaceId:'w',name:'warehouse',backend:'clickhouse',properties:{host:'example.invalid',port:443},refs:['DB_PASSWORD'],fields:{password:'DB_PASSWORD'},version:'v1',credentials:{DB_PASSWORD:{configured:true,writable:true,source:'user'}}
}]}})});
await credentialModel.show('w');
const object={ref:{schema:'marivo.semantic_ref/v1',kind:'metric',path:'sales.revenue'},name:'Revenue 收入',domain:'sales',definition:'Captured definition',guardrails:[],source:{file:'models/sales.py',line:1,symbol:'revenue'},fields:[],relations:[],computation:{schema:'dsh-data-analysis-computation/v1',ref:{schema:'marivo.semantic_ref/v1',kind:'metric',path:'sales.revenue'},catalog_definition_fingerprint:'c1',expression:${JSON.stringify(expression)},explanation:'',facts:[]}};
const semanticModel=new SemanticBrowserModel({call:async()=>({ok:true,value:{formatVersion:2,workspaceId:'w',projectRoot:'/fixture',environmentFingerprint:'env',fingerprint:'c1',loadedAt:'2026-11-03T00:00:00Z',kinds:['metric'],objects:[object]}})});
semanticModel.show('w');
let settings={status:'ready',value:{pythonTimeoutMs:120000},user:{},revision:1,writable:true};
const listeners=new Set();
let refuse=false;
const form={getSnapshot:()=>settings,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},async mutate(ops,revision){if(refuse||revision!==settings.revision){refuse=false;return false}const value=ops[0].value;settings={...settings,value:{pythonTimeoutMs:value},user:{pythonTimeoutMs:value},revision:settings.revision+1};for(const fn of listeners)fn();return true}};
window.fixture={refuse(){refuse=true},snapshot:()=>settings,expression:${JSON.stringify(expression)}};
const version={receipt:{reportId:'r',buildId:'b1',title:'Revenue report'},publishedAt:'2026-11-03T00:00:00Z',source:{sessionId:'s',surface:'tab'}};
const catalog=new ReportCatalogModel({call:async()=>{throw Error('No fixture reads')}});
catalog.patch({open:true,workspaceId:'w',catalog:{workspaceId:'w',reports:[version],unavailable:0}});
const root=createRoot(document.getElementById('root'));
window.renderBusiness=(locale='en-US')=>root.render(<CopyProvider t={translator(locale)}><style>{rightTabStyles+catalogStyles}</style><main className="fixture-grid"><section className="mv-ui rt-page" data-fixture="credentials"><CredentialPanel model={credentialModel} workspaces={workspaces}/></section><section data-fixture="semantic"><SemanticBrowserPanel model={semanticModel} workspaces={workspaces}/></section><section className="mv-ui rt-page" data-fixture="catalog"><ReportCatalogView model={catalog} reader={{showReport(){}}}/><ReportHistoryPanel state={{history:{currentBuildId:'b1',versions:[version]},resolvedReceipt:{buildId:'b1'}}} model={{selectVersion(){}}}/></section><section data-fixture="settings"><ul style={{padding:0,margin:0}}><PythonSettingsCard scope={form}/></ul></section><section className="mv-ui" data-fixture="header"><WorkspaceHeaderAction icon="semantic" label="marivo.navigation.semantic-layer" disabled={false} onClick={()=>{}}/></section></main></CopyProvider>);
window.renderBusiness();
`,
    },
    bundle: true,
    platform: 'browser',
    format: 'esm',
    outfile: path.join(directory, 'main.js'),
    loader: {
      '.module.css': 'local-css',
      '.woff2': 'dataurl',
      '.woff': 'dataurl',
      '.ttf': 'dataurl',
    },
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  })
  const html = `<!doctype html><html data-ds-theme-source="user"><head><title>Marivo business UI fixture</title><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/main.css"><style>body{margin:16px;background:#eee;--dsw-alias-label-primary:#1d3036;--dsw-alias-bg-base:#fff;--dsw-alias-bg-module-platform:#f5f6f7}.fixture-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:24px;max-width:1000px;margin:auto}.fixture-grid>section{min-width:0;height:auto}body[data-ds-dark-theme]{background:#141416;--dsw-alias-label-primary:#ededed;--dsw-alias-bg-base:#1c1c1f;--dsw-alias-bg-module-platform:#26262a}</style></head><body><div id="root"></div><script type="module" src="/main.js"></script></body></html>`
  await writeFile(path.join(directory, 'index.html'), html)
  await writeFile(path.join(directory, 'main.css'), '')
  const server = createServer(async (request, response) => {
    const asset =
      request.url === '/main.js'
        ? 'main.js'
        : request.url === '/main.css'
          ? 'main.css'
          : 'index.html'
    response.setHeader(
      'Content-Type',
      asset.endsWith('.js') ? 'text/javascript' : asset.endsWith('.css') ? 'text/css' : 'text/html',
    )
    response.end(await readFile(path.join(directory, asset)))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  )
  const address = server.address()
  assert(address && typeof address === 'object')
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const context = await browser.newContext({
    viewport: { width: 1100, height: 1000 },
    colorScheme: 'dark',
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  const page = await context.newPage()
  page.setDefaultTimeout(5000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${address.port}`)
  await page.locator('.mc-panel').waitFor()
  await page.locator('.sb-objects button').waitFor({ state: 'visible' })
  assert.equal(await page.title(), 'Marivo business UI fixture')
  assert.equal(await page.locator('.sb-objects button').isVisible(), true)
  assert.equal(await page.locator('.sb-objects button').getAttribute('data-slot'), 'button')
  assert.equal(
    await page
      .locator('.marivo-settings-card [data-slot="card-header"]')
      .evaluate((node) => getComputedStyle(node).borderWidth),
    '0px',
  )
  const colors = () =>
    page.locator('.mc-panel,.sb-panel,.pd-catalog,.marivo-settings-card').evaluateAll((nodes) =>
      nodes.map((node) => ({
        color: getComputedStyle(node).color,
        scheme: getComputedStyle(node).colorScheme,
      })),
    )
  assert(
    (await colors()).every(
      ({ color, scheme }) => color === 'rgb(29, 48, 54)' && scheme === 'light',
    ),
  )
  await page.getByRole('button', { name: 'Expand settings: Data analysis' }).click()
  const input = page.locator('[data-fixture="settings"]').getByRole('spinbutton')
  await input.fill('180.125')
  assert.equal((await input.boundingBox())?.height, 32)
  await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', ''))
  await page.emulateMedia({ colorScheme: 'light' })
  assert(
    (await colors()).every(
      ({ color, scheme }) => color === 'rgb(237, 237, 237)' && scheme === 'dark',
    ),
  )
  assert.equal(await input.inputValue(), '180.125')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('button', { name: 'Expand settings: Data analysis' }).waitFor()
  await page.getByRole('button', { name: 'Expand settings: Data analysis' }).click()
  assert.equal(await input.inputValue(), '180.125')
  await input.fill('0')
  const errorId = await input.getAttribute('aria-describedby')
  assert(errorId?.includes('marivo-python-timeout-error'))
  assert(await page.getByRole('button', { name: 'Save', exact: true }).isDisabled())
  await input.fill('181')
  await page.evaluate(() => (window as unknown as { fixture: { refuse(): void } }).fixture.refuse())
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.locator('[data-fixture="settings"] [role=alert]').waitFor()
  assert.equal(await input.inputValue(), '181')
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click()
  assert.equal(await input.inputValue(), '180.125')
  await page.locator('.sb-objects button').click()
  await page.getByRole('tab', { name: 'Definition', exact: true }).click()
  assert.equal(await page.locator('.sb-back-list').isVisible(), false)
  assert.equal(await page.locator('.sb-expression-code pre code').textContent(), expression)
  assert.equal(
    await page
      .locator('.sb-expression-code pre')
      .evaluate((node) => getComputedStyle(node).whiteSpace),
    'pre-wrap',
  )
  await page.locator('.sb-expression-copy').click()
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), expression)
  const refresh = await page.locator('.sb-refresh').boundingBox()
  assert.equal(refresh?.width, 32)
  assert.equal(refresh?.height, 32)
  await page.screenshot({ path: path.join(directory, 'business-dark-desktop.png'), fullPage: true })
  await page.evaluate(() => document.body.removeAttribute('data-ds-dark-theme'))
  await page.setViewportSize({ width: 390, height: 844 })
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  const headerIcon = await page.locator('.marivo-workspace-header-action svg').boundingBox()
  assert.equal(headerIcon?.width, 16)
  assert.equal(await input.inputValue(), '180.125')
  assert.equal(
    await page
      .locator('.marivo-settings-card [data-slot="card"]')
      .evaluate((node) => getComputedStyle(node).backgroundColor),
    'rgb(255, 255, 255)',
  )
  assert.equal(await page.locator('.sb-back-list').isVisible(), true)
  const refreshBounds = await page
    .locator('[data-fixture="credentials"]')
    .getByRole('button', { name: 'Refresh datasources' })
    .boundingBox()
  assert(refreshBounds && refreshBounds.x >= 0 && refreshBounds.x + refreshBounds.width <= 390)
  assert.equal(refreshBounds.width, 32)
  assert.equal(refreshBounds.height, 32)
  await page.screenshot({ path: path.join(directory, 'business-light-mobile.png'), fullPage: true })
  assert.deepEqual(errors, [])
  await writeFile(
    path.join(directory, 'result.json'),
    JSON.stringify(
      {
        ok: true,
        checks: [
          'Host light/OS dark',
          'Host dark/OS light',
          'draft survives theme',
          'ConfigForm save/refusal/discard',
          'invalid field association',
          'exact captured expression copy',
          'official 32px controls',
          'mobile overflow',
          'console',
        ],
        errors,
      },
      null,
      2,
    ),
  )
})
