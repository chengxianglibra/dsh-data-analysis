import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { createAnalysisDocument } from '../../src/presentation/analysis.ts'

test('native report save keeps the visible document, selected tab and scroll without replacing the tab', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-report-save-'))
  const browser = await chromium.launch()
  try {
    const document = await createAnalysisDocument(
      {
        surface: 'tool',
        locale: 'en-US',
        title: 'Save lifecycle',
        program:
          'root=Stack([intro, sections, tail]); intro=TextContent("# Revenue analysis"); sections=Tabs([TabItem("overview", "Overview", [TextContent("Overview content")]), TabItem("details", "Details", [TextContent("Selected detail")])]); tail=TextContent("' +
          Array.from({ length: 80 }, (_, i) => `Section ${i}`).join('\\n\\n') +
          '");',
      },
      { projectRoot: directory },
      { workspaceId: 'w', reportId: 'r', buildId: 'b' },
      new AbortController().signal,
    )
    const bytes = Buffer.from(JSON.stringify(document))
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const receipt = {
      schemaVersion: 2,
      kind: 'marivo.presentation',
      workspaceId: 'w',
      reportId: 'r',
      buildId: 'b',
      title: document.title,
      summary: 'Saved',
      files: {
        document: {
          asset: 'presentation.json',
          path: '/w/.dsh-data-analysis/presentations/r/builds/b/presentation.json',
          bytes: bytes.length,
          sha256,
        },
      },
    }
    await build({
      stdin: {
        resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
        contents: `
import {createElement as h,useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {PartialArguments} from '@deepseek-ai/dsh-util-values';
import {installRightTabs} from './src/client/right-tabs/install.tsx';
import {en} from './src/client/i18n/copy.ts';
const observable=value=>{const listeners=new Set();return {getSnapshot:()=>value,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},set:next=>{value=next;for(const fn of listeners)fn()}}};
const doc=${JSON.stringify(document)}, receipt=${JSON.stringify(receipt)};
const file={workspaceId:'w',reportId:'r',buildId:'b',asset:'presentation.json',mimeType:'application/json',bytes:${bytes.length},sha256:${JSON.stringify(sha256)},bodyBase64:${JSON.stringify(bytes.toString('base64'))}};
const slots=new Map(),definitions=[],tabState=observable(undefined),chat=observable({nodes:new Map()}),events=observable({revision:0,entries:[],change:{kind:'replace',entries:[]}});
const session=observable({openState:'open',running:true,removed:false,pendingSubmissions:[]}),generation=observable({}),workspaces=observable({phase:'ready',state:'idle',items:[{workspaceId:'w',path:'/w',sessionIds:['s']}]}),sessions=observable({ids:['s'],byId:{s:{retainedBy:{mainView:true}}}}),locale=observable({active:'en'}),openTabs=observable([]);
let gate,release,reading=false,serial=0,controller;
// Harness replaceTab opens a new occurrence and aborts the previous one.
function openResource(address){const definition=definitions.find(d=>d.canOpen?.(address));if(!definition)throw Error('unclaimed address');controller?.abort();controller=new AbortController();const id='tab'+(++serial);const tab={id,tabId:id,kind:definition.kind,visible:true,signal:controller.signal,navigation:{address,revision:1},actions:{openResource}};openTabs.set([{tabId:id,sessionId:'s',contentId:address}]);tabState.set(tab);}
// Simulate only Harness slot/store and transport boundaries; the entire plugin tab lifecycle is real.
const ctx={effect:fn=>fn(),on:()=>()=>{},
 locale:{...locale,register:()=>()=>{},bind:()=>key=>en[key]},
 remote:{$mount:async()=>()=>{}},
 connection:{generation,rpc:{call:async(_channel,endpoint)=>{if(endpoint.endsWith('files/read')){reading=true;await gate;return {ok:true,value:file}}if(endpoint.endsWith('reports/resolve'))return {ok:true,value:receipt};if(endpoint.endsWith('reports/history'))return {ok:true,value:{workspaceId:'w',reportId:'r',currentBuildId:'b',versions:[{receipt,publishedAt:'2026-11-13T00:00:00.000Z',source:{kind:'agent',sessionId:'s',surface:'tool'}}]}};throw Error('Unexpected RPC '+endpoint)}}},
 workspaces:{list:workspaces},sessions:{list:sessions,binding:()=>({session,eventSource:events})},
 uiConversation:{binding:()=>({target:()=>chat}),userText:{register:()=>()=>{}},events:{register:()=>()=>{}}},
 inputTriggers:{registerSource:()=>()=>{}},
 sidebarRight:{openTabs,openResource,active:()=>tabState.getSnapshot(),isExpanded:()=>true,focus:()=>{}},
 sidebarRightTabs:{register:definition=>{definitions.push(definition);return()=>{}}},
 slots:{inject:(_name,fn)=>{const value=fn();if(value?.next)for(const _ of value){}},register:(meta,component)=>{slots.set(meta.name+':'+meta.key,component);return()=>{}}}
};
installRightTabs(ctx);
const restored=sessionStorage.getItem('report-save-fixture-address');if(restored)openResource(restored);
const props={sessionId:'s',useTabInfo:()=>({tab:useSyncExternalStore(tabState.subscribe,tabState.getSnapshot),panel:{id:'panel'}}),useWorkspaces:selector=>selector(useSyncExternalStore(workspaces.subscribe,workspaces.getSnapshot)),useSessions:selector=>selector(useSyncExternalStore(sessions.subscribe,sessions.getSnapshot))};
function App(){const tab=useSyncExternalStore(tabState.subscribe,tabState.getSnapshot);if(!tab)return null;const def=definitions.find(d=>d.kind===tab.kind);return h(slots.get('sidebar.right.pane.tab:'+def.id),{...props,key:tab.id});}
createRoot(document.getElementById('root')).render(h(App));
window.fixture={start(){const block={phase:'preparing',args:PartialArguments.fromObject({stage:'preview',surface:'tool',title:doc.title,locale:'en-US',program:doc.program}),callId:'call',name:'marivo_report_write',turn:1,step:1,time:1,subCalls:[]};chat.set({nodes:new Map([['call',{kind:'tool-call',location:{kind:'turn',turn:{turn:1}},data:{root:block}}]])});},save(){gate=new Promise(resolve=>release=resolve);const entries=[{type:'tool/call',seq:1,data:{turn:1,callId:'call',name:'marivo_report_write'}},{type:'tool/result',seq:2,surfaceOp:'append',data:{turn:1,meta:{kind:'marivo.presentation.delivery',schemaVersion:2,surface:'tool',dshSessionId:'s',turn:1,receipt},message:{role:'tool',toolCallId:'call',source:{kind:'tool',callId:'call'},content:[{type:'text',text:'saved'}]}}}].map(event=>({type:'event',event}));events.set({revision:1,entries,change:{kind:'append',entries}});},release(){release();gate=undefined},remember(){sessionStorage.setItem('report-save-fixture-address',tabState.getSnapshot().navigation.address)},rememberFixed(){const view=decodeURIComponent(tabState.getSnapshot().navigation.address.split('/').at(-1));const suffix=encodeURIComponent(view);localStorage.setItem('dsh-data-analysis:report-view:'+JSON.stringify(['s','w',view,'/w']),JSON.stringify({workspacePath:'/w',address:'dsh-resource://marivo-report/w/r/build/c?view='+suffix}));sessionStorage.setItem('report-save-fixture-address','dsh-resource://marivo-report/w/r/build/b?view='+suffix)},reading:()=>reading,address:()=>tabState.getSnapshot().navigation.address};
`,
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
          name: 'host-ui-boundary',
          setup(build) {
            build.onResolve(
              { filter: /^@deepseek-ai\/dsh-client-ui-conversation\/client$/ },
              () => ({ path: 'conversation', namespace: 'fixture' }),
            )
            build.onLoad({ filter: /^conversation$/, namespace: 'fixture' }, () => ({
              contents:
                'export const conversationPhase=()=>{throw Error("Unused conversation toolbar")};',
            }))
            build.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({
              path: 'host-ui',
              namespace: 'fixture',
            }))
            build.onLoad({ filter: /^host-ui$/, namespace: 'fixture' }, () => ({
              contents: 'export const Modal=()=>null; export const ReferenceChip=()=>null;',
            }))
          },
        },
      ],
    })
    await writeFile(
      path.join(directory, 'index.html'),
      '<!doctype html><meta charset="utf-8"><title>Native report save regression</title><style>html,body,#root{height:100%;margin:0}</style><div id="root"></div><script src="page.js"></script>',
    )
    const artifacts = process.env.DSH_REPORT_SAVE_ARTIFACT_DIR
    if (artifacts) {
      await mkdir(artifacts, { recursive: true })
      for (const name of ['index.html', 'page.js'])
        await copyFile(path.join(directory, name), path.join(artifacts, name))
    }
    const page = await browser.newPage({ viewport: { width: 900, height: 650 } })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(pathToFileURL(path.join(directory, 'index.html')).href)
    assert.deepEqual(errors, [])
    await page.evaluate(() => Reflect.get(window, 'fixture').start())
    await page.getByRole('heading', { name: 'Revenue analysis' }).waitFor()
    await page.getByRole('tab', { name: 'Details', exact: true }).click()
    const heading = await page.getByRole('heading', { name: 'Revenue analysis' }).elementHandle()
    const body = await page.locator('.rt-page').elementHandle()
    await body!.evaluate((node) => {
      node.scrollTop = 180
    })
    await page.evaluate(() => Reflect.get(window, 'fixture').save())
    await page.waitForFunction(() => Reflect.get(window, 'fixture').reading())
    assert.match(
      await page.evaluate(() => Reflect.get(window, 'fixture').address()),
      /^dsh-resource:\/\/marivo-analysis-live\//,
    )
    assert.equal(await heading!.evaluate((node) => node.isConnected), true)
    assert.equal(await body!.evaluate((node) => node.isConnected && node.scrollTop === 180), true)
    await page.evaluate(() => Reflect.get(window, 'fixture').release())
    await page.locator('[data-analysis-phase=saved]').waitFor()
    assert.equal(await page.locator('.au-report-motion').getAttribute('data-progress'), 'saved')
    assert.equal(await heading!.evaluate((node) => node.isConnected), true)
    assert.equal(
      await page.getByRole('tab', { name: 'Details', exact: true }).getAttribute('aria-selected'),
      'true',
    )
    await page.locator('.rt-toolbar').waitFor()
    await page.locator('.au-report-motion').waitFor({ state: 'hidden' })
    assert.equal(await body!.evaluate((node) => node.isConnected && node.scrollTop === 180), true)
    assert.equal(await heading!.evaluate((node) => node.isConnected), true)
    await page.waitForFunction(() =>
      Object.keys(localStorage).some((key) => key.startsWith('dsh-data-analysis:report-view:')),
    )
    await page.evaluate(() => Reflect.get(window, 'fixture').remember())
    await page.reload()
    await page.getByRole('heading', { name: 'Revenue analysis' }).waitFor()
    await page.locator('.rt-toolbar').waitFor()
    assert.equal(await page.locator('[data-analysis-record]').count(), 1)
    await page.evaluate(() => Reflect.get(window, 'fixture').rememberFixed())
    await page.reload()
    await page.getByRole('heading', { name: 'Revenue analysis' }).waitFor()
    assert.match(
      (await page.locator('[data-analysis-record]').getAttribute('data-analysis-record'))!,
      /:b$/,
    )
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
    await rm(directory, { recursive: true, force: true })
  }
})
