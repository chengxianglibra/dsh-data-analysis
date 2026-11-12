import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

test('deletion requires confirmation, preserves cancellation, and reports conflicts', async (t) => {
  const bundle = await build({
    stdin: {
      resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
      loader: 'tsx',
      contents: `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {CopyProvider} from './src/client/i18n/context.tsx';
import {translator} from './src/client/i18n/copy.ts';
import {ReportActions} from './src/client/right-tabs/report-actions.tsx';
let result='stale', calls=0;
const rpc={call:async()=>({ok:true,value:{enabled:false,fields:[]}})};
createRoot(document.getElementById('root')).render(<CopyProvider t={translator('en-US')}><ReportActions document={{reportId:'r',buildId:'b',title:'Revenue'}} rpc={rpc} signal={new AbortController().signal} isCurrent={()=>true} onHistory={()=>{}} refreshLocked={false} onRefreshData={async()=> 'accepted'} onDelete={async()=>{calls++;return result}} /></CopyProvider>);
window.fixture={calls:()=>calls,set:value=>{result=value}};
`,
    },
    bundle: true,
    platform: 'browser',
    format: 'iife',
    write: false,
    logLevel: 'silent',
  })
  const browser = await chromium.launch()
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.setContent('<div id="root"></div>')
  await page.addScriptTag({ content: bundle.outputFiles[0]?.text })
  const open = async () => {
    await page.getByRole('button', { name: 'Analysis view actions' }).click()
    await page.getByRole('menuitem', { name: 'Delete analysis view' }).click()
  }
  await open()
  const dialog = page.getByRole('dialog')
  assert.equal(await dialog.getByText('Revenue', { exact: false }).count(), 1)
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  assert.equal(await page.evaluate('window.fixture.calls()'), 0)
  await open()
  await dialog.getByRole('button', { name: 'Delete analysis view' }).click()
  await page.getByRole('alert').waitFor()
  assert.equal(await page.evaluate('window.fixture.calls()'), 1)
  await page.getByRole('button', { name: 'Dismiss deletion notification' }).click()
  await page.evaluate('window.fixture.set("deleted")')
  await open()
  await dialog.getByRole('button', { name: 'Delete analysis view' }).click()
  assert.equal(await page.evaluate('window.fixture.calls()'), 2)
})

test('report data update sends once while pending and reports stale and accepted requests', async (t) => {
  const bundle = await build({
    stdin: {
      resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
      loader: 'tsx',
      contents: `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {CopyProvider} from './src/client/i18n/context.tsx';
import {translator} from './src/client/i18n/copy.ts';
import {ReportActions} from './src/client/right-tabs/report-actions.tsx';
const root=createRoot(document.getElementById('root'));
let resolve, locked=false, calls=0;
const rpc={call:async()=>({ok:true,value:{enabled:false,fields:[]}})};
const signal=new AbortController().signal;
function render(){root.render(<CopyProvider t={translator('en-US')}><ReportActions document={{reportId:'r',buildId:'b'}} rpc={rpc} signal={signal} isCurrent={()=>true} onHistory={()=>{}} refreshLocked={locked} onRefreshData={()=>{calls++;locked=true;render();return new Promise(r=>resolve=r)}} /></CopyProvider>)}
window.fixture={resolve:value=>{locked=false;resolve(value);render()},calls:()=>calls};render();
`,
    },
    bundle: true,
    platform: 'browser',
    format: 'iife',
    write: false,
    logLevel: 'silent',
  })
  const browser = await chromium.launch()
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.setContent('<div id="root"></div>')
  await page.addScriptTag({ content: bundle.outputFiles[0]?.text })
  const menu = page.getByRole('button', { name: 'Analysis view actions' })
  const update = page.getByRole('menuitem', { name: 'Update data' })
  await menu.click()
  await update.click()
  await menu.click()
  assert.equal(await update.getAttribute('data-disabled'), '')
  assert.equal(await page.evaluate('window.fixture.calls()'), 1)
  await page.keyboard.press('Escape')
  await page.evaluate('window.fixture.resolve("stale")')
  await page.getByRole('alert').waitFor()
  await page.getByRole('button', { name: 'Dismiss update notification' }).click()
  await menu.click()
  await update.click()
  await page.evaluate('window.fixture.resolve("accepted")')
  await page.getByRole('status').waitFor()
  assert.equal(await page.evaluate('window.fixture.calls()'), 2)
})

test('refresh admission preserves the draft and rejects busy, changed owners and duplicate clicks', async (t) => {
  const bundle = await build({
    stdin: {
      resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
      loader: 'tsx',
      contents: `
import {createReportRefresh} from './src/client/right-tabs/report-refresh.ts';
import {savedReportRef} from './src/presentation/contracts/report-ref.ts';
const observable=value=>{const listeners=new Set();return {getSnapshot:()=>value,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},set:next=>{value=next;for(const fn of listeners)fn()}}};
const generation=observable({}), session=observable({running:false,removed:false,pendingSubmissions:[]});
const events=observable({entries:[]}), input=observable({phase:'plain',draft:'keep my draft',attachmentIds:['attachment'],queue:[]});
const list=observable({byId:{s:{retainedBy:{mainView:true}}}}), workspaces=observable({phase:'ready',items:[{workspaceId:'w',path:'/workspace',sessionIds:['s']}]});
let sent=[], resolvePrepare, dispose, delayed=false, sendMode='normal';
const scope={}, binding={session:{...session,prompt:async blocks=>{sent.push(blocks[0].text);if(sendMode==='instant')events.set({entries:[{type:'event',event:{type:'turn/start',data:{turn:1}}},{type:'event',event:{type:'turn/end',data:{turn:1}}}]});if(sendMode==='reject')throw Error('network');if(sendMode==='denied')return {ok:false,error:{code:'denied'}};return {ok:true,value:{accepted:true}}}},eventSource:events};
const ctx={connection:{generation}, sessions:{list,scope:()=>scope,binding:()=>binding},workspaces:{list:workspaces},conversation:{input:{for:()=>({state:input})}},effect:fn=>{dispose=fn()}};
const ref=savedReportRef({workspaceId:'w',reportId:'r',buildId:'b'});
const rpc={call:()=>delayed?new Promise(r=>resolvePrepare=r):Promise.resolve({ok:true,value:{ref}})};
const action=createReportRefresh(ctx,rpc), report={recordId:'marivo-ui:r:b',reportId:'r',buildId:'b',locale:'en-US'};
const page={sessionId:'s',target:{workspaceId:'w'}}, tab={signal:new AbortController().signal};
const send=()=>action.refreshReport(page,tab,report,()=>true);
window.run=async()=>{
 const first=await send();const draft=input.getSnapshot().draft;const attachments=input.getSnapshot().attachmentIds;
 const locked=await send();
 session.set({...session.getSnapshot(),running:true});session.set({...session.getSnapshot(),running:false});
 input.set({...input.getSnapshot(),phase:'submitting'});const submitting=await send();
 input.set({...input.getSnapshot(),phase:'plain'});session.set({...session.getSnapshot(),running:true});const busy=await send();session.set({...session.getSnapshot(),running:false});
 delayed=true;const pending=send(), duplicate=await send();
 workspaces.set({phase:'ready',items:[{workspaceId:'w',path:'/different',sessionIds:['s']}]});resolvePrepare({ok:true,value:{ref}});const changed=await pending;
 const lockedAfter=action.refreshLocks.has('s');
 workspaces.set({phase:'ready',items:[{workspaceId:'w',path:'/workspace',sessionIds:['s']}]});delayed=false;sendMode='instant';const instant=await send();const instantLocked=action.refreshLocks.has('s');sendMode='reject';const uncertain=await send();sendMode='denied';const denied=await send();
 delayed=true;const retiring=send();dispose();resolvePrepare({ok:true,value:{ref}});const disposed=await retiring;const afterDispose=await send();
 return {first,draft,attachments,locked,submitting,busy,duplicate,changed,sent:sent.length,refInPrompt:sent[0].includes(ref),lockedAfter,instant,instantLocked,uncertain,denied,disposed,afterDispose};
};
`,
    },
    loader: { '.module.css': 'empty', '.css': 'empty' },
    bundle: true,
    platform: 'browser',
    format: 'iife',
    write: false,
    logLevel: 'silent',
  })
  const browser = await chromium.launch()
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.setContent('<div></div>')
  await page.addScriptTag({ content: bundle.outputFiles[0]?.text })
  assert.deepEqual(await page.evaluate('window.run()'), {
    first: 'accepted',
    draft: 'keep my draft',
    attachments: ['attachment'],
    locked: 'unavailable',
    submitting: 'unavailable',
    busy: 'unavailable',
    duplicate: 'unavailable',
    changed: 'unavailable',
    sent: 4,
    refInPrompt: true,
    lockedAfter: false,
    instant: 'accepted',
    instantLocked: false,
    uncertain: 'uncertain',
    denied: 'uncertain',
    disposed: 'unavailable',
    afterDispose: 'unavailable',
  })
})
