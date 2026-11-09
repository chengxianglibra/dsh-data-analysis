import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { createAnalysisDocument } from '../../src/presentation/analysis.ts'

declare global {
  interface Window {
    draftTest: {
      start(surface: 'tool' | 'tab'): void
      preview(): void
      stream(text: string): void
      fail(): void
      save(): void
    }
  }
}

test('drafts on both surfaces render new text during the argument stream and roll back failed candidates', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-draft-streaming-'))
  const browser = await chromium.launch()
  try {
    const draftId = randomUUID()
    const document = await createAnalysisDocument(
      {
        surface: 'tool',
        resources: {},
        locale: 'en-US',
        title: 'Streaming draft',
        program:
          'root = Stack([intro, stable]);\nintro = TextContent("Confirmed");\nstable = TextContent("Retained section");',
      },
      { projectRoot: directory },
      { workspaceId: 'workspace', reportId: 'report', buildId: randomUUID() },
      new AbortController().signal,
    )
    await build({
      stdin: {
        resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
        contents: `
import {createElement as h,useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {PartialArguments} from '@deepseek-ai/dsh-util-values';
import {analysisCandidate} from './src/client/analysis-ui/candidate.ts';
import {AnalysisDraftViews} from './src/client/analysis-ui/drafts.ts';
import {DraftReportView} from './src/client/analysis-ui/draft-view.tsx';
import {SavedAnalysisSurface} from './src/client/analysis-ui/lazy-surface.tsx';
const documentValue = ${JSON.stringify(document)};
const views=new AnalysisDraftViews(), generation={}, draftId=${JSON.stringify(draftId)};
let surface='tool',args,callId='first',published=false;
const root=createRoot(document.getElementById('root'));
const rpc={call:async()=>({ok:true,value:documentValue})};
function App(){const view=useSyncExternalStore(views.subscribe,()=>views.get('session',1));return view ? h('div',{'data-surface':surface},published?h(SavedAnalysisSurface,{document:documentValue}):h(DraftReportView,{view,rpc})):null;}
function observe(){views.observe(analysisCandidate({phase:'preparing',args,callId,name:'marivo_present',turn:1,step:1,time:1,subCalls:[]},'session','workspace',generation),'/workspace');}
window.draftTest={
start(nextSurface){views.revoke('session');surface=nextSurface;published=false;callId='first';args=new PartialArguments();args.append(JSON.stringify({surface,stage:'preview',program:'root = TextContent("First streamed text'}).slice(0,-2));observe();},
preview(){views.preview({kind:'marivo.presentation.draft',dshSessionId:'session',workspaceId:'workspace',turn:1,surface,draftId,draftRevision:documentValue.buildId},generation,'/workspace');},
stream(text){callId='next';args=new PartialArguments();args.append(JSON.stringify({surface,stage:'preview',draftId,draftRevision:documentValue.buildId,program:'intro = TextContent("'+text}).slice(0,-2));observe();},
fail(){const view=views.get('session',1);views.observe({...view.candidate,phase:'failed'},'/workspace');},
save(){published=true;root.render(h(App));}
};
root.render(h(App));`,
      },
      outfile: path.join(directory, 'page.js'),
      bundle: true,
      platform: 'browser',
      format: 'iife',
      jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' },
      logLevel: 'silent',
      plugins: [
        {
          name: 'host-dialog-boundary',
          setup(build) {
            build.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({
              path: 'host-dialog',
              namespace: 'fixture',
            }))
            build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
              contents: 'export const Modal = () => null;',
            }))
          },
        },
      ],
    })
    await writeFile(
      path.join(directory, 'index.html'),
      '<html><meta charset="utf-8"><title>Draft streaming regression</title><div id="root"></div><script src="page.js"></script></html>',
    )
    const page = await browser.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(pathToFileURL(path.join(directory, 'index.html')).href)
    for (const surface of ['tool', 'tab'] as const) {
      await page.evaluate((surface) => window.draftTest.start(surface), surface)
      await page.getByText('First streamed text', { exact: true }).waitFor()
      assert.equal(await page.locator('[data-analysis-draft]').count(), 1)
      await page.evaluate(() => window.draftTest.preview())
      await page.getByText('Confirmed', { exact: true }).waitFor()
      await page.evaluate(() => window.draftTest.stream('Live replacement'))
      await page.getByText('Live replacement', { exact: true }).waitFor()
      assert.equal(await page.getByText('Retained section', { exact: true }).isVisible(), true)
      assert.equal(await page.locator('[data-analysis-draft]').count(), 1)
      await page.evaluate(() => window.draftTest.fail())
      await page.getByText('Confirmed', { exact: true }).waitFor()
      assert.equal(await page.getByText('Live replacement', { exact: true }).count(), 0)
      await page.evaluate(() => window.draftTest.save())
      await page.locator('[data-analysis-record]').waitFor()
      assert.equal(await page.locator('[data-analysis-draft]').count(), 0)
    }
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
    await rm(directory, { recursive: true, force: true })
  }
})
