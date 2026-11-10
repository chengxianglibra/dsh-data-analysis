import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

test('report history identifies and switches versions and can be closed in a narrow pane', {
  skip: process.env.DSH_DATA_ANALYSIS_BROWSER_TESTS !== '1',
}, async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'marivo-history-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await build({
    stdin: {
      resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
      loader: 'tsx',
      contents: `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {CopyProvider} from './src/client/i18n/context.tsx';
import {translator} from './src/client/i18n/copy.ts';
import {ReportHistoryPanel,catalogStyles} from './src/client/presentation/catalog.tsx';
import {rightTabStyles} from './src/client/right-tabs/styles.ts';
import {AnalysisSurface} from './src/client/analysis-ui/surface.tsx';
const makeVersion=(buildId,title,publishedAt)=>({receipt:{buildId,title},publishedAt,source:{sessionId:'s'}});
const versions=[makeVersion('b1','Revenue report','2026-11-03T00:00:00Z'),makeVersion('b0','Earlier report','2026-11-02T00:00:00Z')];
const documents={b1:{title:'Revenue report',locale:'en-US',recordId:'marivo-ui:r:b1',program:'root = TextContent("Current narrative");',resources:{},contentReview:'not-needed'},b0:{title:'Earlier report',locale:'en-US',recordId:'marivo-ui:r:b0',program:'root = TextContent("Historical narrative");',resources:{},contentReview:'required'}};
function App(){const [open,setOpen]=React.useState(true);const [selected,setSelected]=React.useState('b1');return <CopyProvider t={translator('en-US')}><style>{catalogStyles+rightTabStyles}</style><section className="mv-ui rt-page">{open&&<ReportHistoryPanel state={{history:{currentBuildId:'b1',versions},resolvedReceipt:{buildId:selected}}} model={{selectVersion:setSelected}} sessions={{s:{displayTitle:'Analysis conversation'}}} onOpenSession={()=>{}} onClose={()=>setOpen(false)}/>}<AnalysisSurface document={documents[selected]}/></section></CopyProvider>};
createRoot(document.getElementById('root')).render(<App/>);
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
  const server = createServer(async (request, response) => {
    if (request.url === '/main.js') {
      response.setHeader('Content-Type', 'text/javascript')
      response.end(await readFile(path.join(directory, 'main.js')))
    } else {
      response.setHeader('Content-Type', 'text/html')
      response.end(
        '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/main.js"></script>',
      )
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  )
  const address = server.address()
  assert(address && typeof address === 'object')
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.goto(`http://127.0.0.1:${address.port}`)
  const history = page.getByRole('complementary', { name: 'History' })
  const current = history.getByRole('button', { name: /Revenue report/ })
  const older = history.getByRole('button', { name: /Earlier report/ })
  assert.equal(await current.getAttribute('aria-pressed'), 'true')
  assert.equal(await history.getByText('Current version').count(), 1)
  assert.equal(await page.locator('[data-content-review]').count(), 0)
  assert.equal(await history.getByText('Analysis conversation').count(), 2)
  assert(await history.evaluate((node) => node.scrollWidth <= node.clientWidth))
  await older.click()
  assert.equal(await older.getAttribute('aria-pressed'), 'true')
  assert.equal(await current.getAttribute('aria-pressed'), 'false')
  assert.equal(await history.getByText('Viewing').count(), 1)
  await page
    .locator('[data-content-review=required]')
    .getByText('Data changed. Static narrative needs review.')
    .waitFor()
  assert.equal(await page.locator('.au-surface-body [data-content-review]').count(), 0)
  await current.click()
  await page.locator('[data-content-review]').waitFor({ state: 'detached' })
  await older.click()
  await page.locator('[data-content-review=required]').waitFor()
  await history.getByRole('button', { name: 'Close version history' }).click()
  assert.equal(await history.count(), 0)
})
