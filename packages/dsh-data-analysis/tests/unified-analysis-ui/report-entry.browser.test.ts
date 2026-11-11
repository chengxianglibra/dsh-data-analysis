import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

test('report entry opens the right reader, retries failure and explains expired drafts', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-report-entry-'))
  const browser = await chromium.launch()
  try {
    await build({
      stdin: {
        resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
        contents: `import {createElement as h} from 'react';
import {createRoot} from 'react-dom/client';
import {installAnalysisTool} from './src/client/analysis-ui/install.tsx';
import {ReportViews} from './src/client/analysis-ui/report-views.ts';
import {en} from './src/client/i18n/copy.ts';
const observable=value=>({getSnapshot:()=>value,subscribe:()=>()=>{}});
const generation={}, connection=observable(generation), views=new ReportViews(), slots={}, locale={active:'en'};
const ctx={
 locale:{getSnapshot:()=>locale,subscribe:()=>()=>{},bind:()=>key=>en[key]},
 workspaces:{list:observable({phase:'ready',items:[{workspaceId:'w',path:'/workspace',sessionIds:['s']}]})},
 slots:{inject:(_name,fn)=>fn(),register:(meta,fn)=>{slots[meta.key]=fn;return()=>{}}}
};
let fail=true;
const noop=async()=>undefined;
const {ReportBody}=installAnalysisTool(ctx,{call:noop},()=>{},connection,views,
 view=>{if(fail)throw Error('open failed');views.openingFailed(view.id,false);right.render(h(ReportBody,{viewId:view.id,sessionId:'s'}))},
 ()=>{},noop,noop,noop);
const candidate={sessionId:'s',workspaceId:'w',generation,callId:'call',turn:1,phase:'preparing',
 preview:true,program:'',complete:false,resourcePatchInput:'omitted',title:'Revenue'};
const view=views.observe(candidate,'/workspace');views.openingFailed(view.id,true);
const chat=createRoot(document.getElementById('chat')),right=createRoot(document.getElementById('right'));
const draft={kind:'marivo.presentation.draft',dshSessionId:'s',workspaceId:'w',turn:1,surface:'tool',
 draftId:'8d26b759-2ba9-412e-8287-221ec059f581',draftRevision:'f740453c-4df5-4fc8-a313-6fae9e36b1c0'};
const receipt={schemaVersion:2,kind:'marivo.presentation',workspaceId:'w',reportId:'r',buildId:'b',title:'Saved revenue',summary:'Saved',files:{document:{asset:'presentation.json',path:'/workspace/.dsh-data-analysis/presentations/r/builds/b/presentation.json',bytes:1,sha256:'a'.repeat(64)}}};
const saved={kind:'marivo.presentation.delivery',schemaVersion:2,dshSessionId:'s',turn:1,surface:'tool',receipt};
let deliveries=[];
function render(expired=false){const node={kind:'marivo-analysis-surface',target:'chat',id:'1',location:{kind:'turn',turn:{turn:1}},data:{turn:1,boundary:expired?12:null,deliveries,drafts:expired?[{seq:8,delivery:draft,callId:'call'}]:[]}};
 chat.render(slots['marivo-analysis-surface']({node,sessionId:'s'}));}
const revision={...candidate,callId:'revision',basedOnRecordId:'marivo-ui:r:b',title:'Revised revenue'};
window.fixture={allow:()=>{fail=false},expire:()=>render(true),
 retry:(callId)=>views.observeReady({...candidate,callId,title:callId},'/workspace'),
 reject:()=>{const current=views.get(view.id).candidate;views.observeReady({...current,phase:'failed'},'/workspace');},
 base:()=>{const callId=views.get(view.id).candidate.callId;views.accept(saved,callId,generation,'/workspace');deliveries=[{seq:4,delivery:saved,callId}];render()},
 revision:()=>views.observe(revision,'/workspace'),
 failRevision:()=>views.observe({...revision,phase:'failed',...(views.get(view.id).draft?{draftId:draft.draftId}:{})},'/workspace'),
 previewRevision:()=>views.accept(draft,'revision',generation,'/workspace'),
 saveRevision:()=>{const result={...saved,draftId:draft.draftId,receipt:{...receipt,buildId:'c',title:'Revised saved',files:{document:{...receipt.files.document,path:'/workspace/.dsh-data-analysis/presentations/r/builds/c/presentation.json'}}}};views.accept(result,'revision',generation,'/workspace');deliveries.push({seq:10,delivery:result,callId:'revision'});render()},
 resetForExpiry:()=>{deliveries=[];views.revoke('s')}
};
render();`,
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
          // The entry does not open a Host modal; leave this Host boundary unmounted.
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
      '<!doctype html><div id="chat"></div><div id="right"></div><script src="page.js"></script>',
    )
    const page = await browser.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(pathToFileURL(path.join(directory, 'index.html')).href)
    await page.getByText('Revenue', { exact: true }).waitFor()
    assert.equal(await page.locator('#chat [data-analysis-placement]').count(), 0)
    assert.equal(await page.getByRole('alert').count(), 1)
    await page.getByRole('button', { name: 'Open analysis view in sidebar' }).click()
    await page.getByRole('alert').waitFor()
    await page.evaluate('window.fixture.allow()')
    await page.getByRole('button', { name: 'Open analysis view in sidebar' }).click()
    await page.locator('#right [data-analysis-placement="sidebar"]').waitFor()
    assert.equal(await page.getByRole('alert').count(), 0)
    const entry = page.locator('#chat [data-analysis-entry]')
    const viewId = await entry.getAttribute('data-analysis-entry')
    for (const attempt of ['Retry axis', 'Retry columns', 'Retry row limit']) {
      await page.evaluate((title) => {
        Reflect.get(window, 'fixture').reject()
        Reflect.get(window, 'fixture').retry(title)
      }, attempt)
      await page.getByText(attempt, { exact: true }).waitFor()
      assert.equal(await entry.count(), 1)
      assert.equal(await entry.getAttribute('data-analysis-entry'), viewId)
    }
    await page.evaluate('window.fixture.base()')
    await page.getByText('Saved revenue', { exact: true }).waitFor()
    await page.evaluate('window.fixture.revision()')
    await page.getByText('Revised revenue', { exact: true }).waitFor()
    await page.locator('#chat [role="status"]').waitFor()
    await page.evaluate('window.fixture.failRevision()')
    await page.getByText('Saved revenue', { exact: true }).waitFor()
    assert.equal(await page.locator('#chat [role="status"]').count(), 0)
    await page.evaluate('window.fixture.previewRevision()')
    await page.locator('#chat [role="status"]').waitFor()
    await page.evaluate('window.fixture.failRevision()')
    await page.locator('#chat [role="status"]').waitFor()
    await page.evaluate('window.fixture.saveRevision()')
    await page.getByText('Revised saved', { exact: true }).waitFor()
    assert.equal(await page.locator('#chat [role="status"]').count(), 0)
    await page.evaluate('window.fixture.resetForExpiry()')
    await page.evaluate('window.fixture.expire()')
    await page.locator('#chat [role="status"]').waitFor()
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
    await rm(directory, { recursive: true, force: true })
  }
})
