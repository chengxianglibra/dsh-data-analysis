import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
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
      move(): void
      save(): void
      savedBase(): void
      replaceResources(): void
      lateResources(): void
      lateResourceView(): void
    }
  }
}

test('drafts on both surfaces render new text during the argument stream and roll back failed candidates', async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-draft-streaming-')))
  const browser = await chromium.launch()
  try {
    const draftId = randomUUID()
    await writeFile(
      path.join(directory, 'image.png'),
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=',
        'base64',
      ),
    )
    const document = await createAnalysisDocument(
      {
        surface: 'tool',
        resourcePatch: { put: { image: { kind: 'image-file', path: 'image.png' } } },
        locale: 'en-US',
        title: 'Streaming draft',
        program:
          'root = Stack([intro, stable, picture, sections]);\nsections = Tabs([TabItem("one", "Overview", [TextContent("Overview content")]), TabItem("two", "Details", [TextContent("Preserved selection")])]);\nintro = TextContent("Confirmed");\nstable = TextContent("Retained section");\npicture=Image("Admitted image", "image");',
      },
      { projectRoot: directory },
      { workspaceId: 'workspace', reportId: 'report', buildId: randomUUID() },
      new AbortController().signal,
    )
    const bytes = Buffer.from(JSON.stringify(document))
    const digest = createHash('sha256').update(bytes).digest('hex')
    const receipt = {
      schemaVersion: 2,
      kind: 'marivo.presentation',
      workspaceId: document.workspaceId,
      reportId: document.reportId,
      buildId: document.buildId,
      title: document.title,
      summary: 'Saved base',
      files: {
        document: {
          asset: 'presentation.json',
          path: `/workspace/.dsh-data-analysis/presentations/${document.reportId}/builds/${document.buildId}/presentation.json`,
          sha256: digest,
          bytes: bytes.length,
        },
      },
    }
    const file = {
      workspaceId: document.workspaceId,
      reportId: document.reportId,
      buildId: document.buildId,
      asset: 'presentation.json',
      mimeType: 'application/json',
      sha256: digest,
      bytes: bytes.length,
      bodyBase64: bytes.toString('base64'),
    }
    await build({
      stdin: {
        resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
        contents: `
import {createElement as h,useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {PartialArguments} from '@deepseek-ai/dsh-util-values';
import {analysisCandidate} from './src/client/analysis-ui/candidate.ts';
import {ReportViews} from './src/client/analysis-ui/report-views.ts';
import {ReportView} from './src/client/analysis-ui/report-view.tsx';
const documentValue = ${JSON.stringify(document)};
const views=new ReportViews(), generation={}, draftId=${JSON.stringify(draftId)};
let surface='tool',args,callId='first',savedMode=false,hostKey=0;
const root=createRoot(document.getElementById('root'));
const receipt=${JSON.stringify(receipt)},file=${JSON.stringify(file)};
const rpc={call:async(_channel,endpoint)=>({ok:true,value:endpoint==='reports/history'?{workspaceId:documentValue.workspaceId,reportId:documentValue.reportId,currentBuildId:documentValue.buildId,versions:[{receipt,publishedAt:'2026-11-09T00:00:00.000Z',source:{kind:'agent',sessionId:'session',surface}}]}:endpoint==='files/read'?file:documentValue})};
function App(){useSyncExternalStore(views.subscribe,views.getSnapshot);const view=views.forTurn('session',1).at(-1);return view ? h('div',{key:hostKey,'data-surface':surface},h(ReportView,{view,views,rpc})):null;}
function observe(){views.observe(analysisCandidate({phase:'preparing',args,callId,name:'marivo_present',turn:1,step:1,time:1,subCalls:[]},'session','workspace',generation),'/workspace');}
window.draftTest={
move(){hostKey++;root.render(h(App));},
start(nextSurface){views.revoke('session');surface=nextSurface;savedMode=false;callId='first';args=new PartialArguments();args.append(JSON.stringify({surface,stage:'preview',program:'root = TextContent("First streamed text'}).slice(0,-2));observe();},
preview(){views.accept({kind:'marivo.presentation.draft',dshSessionId:'session',workspaceId:'workspace',turn:1,surface,draftId,draftRevision:documentValue.buildId},callId,generation,'/workspace');},
stream(text){callId='next';args=new PartialArguments();args.append(JSON.stringify({surface,stage:'preview',draftId,draftRevision:documentValue.buildId,resourcePatch:{},program:'intro = TextContent("'+text}).slice(0,-2));observe();},
fail(){const view=views.forTurn('session',1).at(-1);views.observe({...view.candidate,phase:'failed'},'/workspace');},
save(){views.accept({kind:'marivo.presentation.delivery',schemaVersion:2,dshSessionId:'session',turn:1,surface:'tool',draftId,receipt},'save',generation,'/workspace');},
savedBase(){views.revoke('session');savedMode=true;callId='base';args=new PartialArguments();args.append(JSON.stringify({surface,stage:'preview',basedOnRecordId:documentValue.recordId,resourcePatch:{},program:'intro = TextContent("Saved base prefix'}).slice(0,-2));observe();},
lateResourceView(){callId='unknown-resource-view';args=new PartialArguments();args.append(JSON.stringify({surface,stage:'preview',draftId,draftRevision:documentValue.buildId,program:'intro = TextContent("Scope while patch arrives"); picture = Image("Candidate replacement", "image");'}).slice(0,-1));observe();},
lateResources(){callId=savedMode?'base':'late-resources';args=new PartialArguments();args.append(JSON.stringify({surface,stage:'preview',...(savedMode?{basedOnRecordId:documentValue.recordId}:{draftId,draftRevision:documentValue.buildId}),program:'intro = TextContent("Pending resource scope");'}).slice(0,-1));observe();},
replaceResources(){callId=savedMode?'base':'resources';args=new PartialArguments();args.append(JSON.stringify({surface,stage:'preview',...(savedMode?{basedOnRecordId:documentValue.recordId}:{draftId,draftRevision:documentValue.buildId}),program:'intro = TextContent("New resource scope");'}).slice(0,-1)+',"resourcePatch":{"put":{"image":{"kind":"image-file","path":"new');observe();}
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
      assert.equal(await page.locator('[data-analysis-report]').count(), 1)
      const motion = page.locator('.au-report-motion')
      assert.equal(await motion.getAttribute('data-progress'), 'generating')
      assert.equal(await motion.innerText(), '')
      assert.notEqual(
        await motion
          .locator('path')
          .last()
          .evaluate((node) => getComputedStyle(node).animationName),
        'none',
      )
      await page.emulateMedia({ reducedMotion: 'reduce' })
      assert.equal(
        await motion
          .locator('path')
          .last()
          .evaluate((node) => getComputedStyle(node).animationName),
        'none',
      )
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await page.evaluate(() => window.draftTest.preview())
      await page.getByText('Confirmed', { exact: true }).waitFor()
      assert.equal(await motion.getAttribute('data-progress'), 'draft')
      assert.equal(await page.locator('.au-image').getAttribute('alt'), 'Admitted image')
      await page.getByRole('tab', { name: 'Details', exact: true }).click()
      await page.evaluate(() => window.draftTest.move())
      await page.getByText('Preserved selection', { exact: true }).waitFor()
      assert.equal(
        await page.getByRole('tab', { name: 'Details', exact: true }).getAttribute('aria-selected'),
        'true',
      )
      await page.evaluate(() => window.draftTest.stream('Live replacement'))
      await page.getByText('Live replacement', { exact: true }).waitFor()
      assert.equal(await page.getByText('Retained section', { exact: true }).isVisible(), true)
      assert.equal(await page.locator('[data-analysis-report]').count(), 1)
      assert.equal(await page.locator('.au-image').getAttribute('alt'), 'Admitted image')
      await page.evaluate(() => window.draftTest.lateResourceView())
      await page.getByText('Scope while patch arrives', { exact: true }).waitFor()
      assert.equal(await page.locator('.au-image').getAttribute('alt'), 'Admitted image')
      assert.equal(await page.getByText('Retained section', { exact: true }).isVisible(), true)
      assert.equal((await page.locator('[role="status"]').count()) > 1, true)
      await page.evaluate(() => window.draftTest.lateResources())
      await page.getByText('Pending resource scope', { exact: true }).waitFor()
      assert.equal(await page.locator('.au-image').getAttribute('alt'), 'Admitted image')
      await page.evaluate(() => window.draftTest.replaceResources())
      await page.getByText('New resource scope', { exact: true }).waitFor()
      assert.equal(await page.locator('.au-image').getAttribute('alt'), 'Admitted image')
      await page.evaluate(() => window.draftTest.fail())
      await page.getByText('Confirmed', { exact: true }).waitFor()
      assert.equal(await page.locator('.au-image').getAttribute('alt'), 'Admitted image')
      assert.equal(await page.getByText('Live replacement', { exact: true }).count(), 0)
      await page.evaluate(() => window.draftTest.save())
      await page.locator('[data-analysis-record]').waitFor()
      assert.equal(await motion.count(), 0)
      assert.equal(
        await page.getByRole('tab', { name: 'Details', exact: true }).getAttribute('aria-selected'),
        'true',
      )
      await page.evaluate(() => window.draftTest.move())
      await page.getByText('Preserved selection', { exact: true }).waitFor()
      assert.equal(await page.locator('[data-analysis-phase=saved]').count(), 1)
      await page.evaluate(() => window.draftTest.savedBase())
      await page.getByText('Saved base prefix', { exact: true }).waitFor()
      assert.equal(await page.getByText('Retained section', { exact: true }).isVisible(), true)
      assert.equal(await page.locator('.au-image').getAttribute('alt'), 'Admitted image')
      await page.evaluate(() => window.draftTest.lateResources())
      await page.getByText('Pending resource scope', { exact: true }).waitFor()
      assert.equal(await page.locator('.au-image').getAttribute('alt'), 'Admitted image')
      await page.evaluate(() => window.draftTest.replaceResources())
      await page.getByText('New resource scope', { exact: true }).waitFor()
      assert.equal(await page.locator('.au-image').getAttribute('alt'), 'Admitted image')
      await page.evaluate(() => window.draftTest.fail())
      await page.getByText('Confirmed', { exact: true }).waitFor()
      assert.equal(await page.locator('.au-image').getAttribute('alt'), 'Admitted image')
    }
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
    await rm(directory, { recursive: true, force: true })
  }
})
