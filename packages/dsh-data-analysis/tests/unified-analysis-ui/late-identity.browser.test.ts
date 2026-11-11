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

test('unseen and partial ref or onto retain successful program, resources, title, locale and DOM', async (t) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'late-report-identity-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(
    path.join(root, 'image.png'),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=',
      'base64',
    ),
  )
  const document = await createAnalysisDocument(
    {
      surface: 'tool',
      title: 'Successful title',
      locale: 'en-US',
      resourcePatch: { put: { image: { kind: 'image-file', path: 'image.png' } } },
      program:
        'root = Stack([intro, stable, image]); intro = TextContent("Successful body"); stable = TextContent("Stable DOM"); image = Image("Successful image", "image");',
    },
    { projectRoot: root },
    { workspaceId: 'workspace', reportId: 'report', buildId: randomUUID() },
    new AbortController().signal,
  )
  const bytes = Buffer.from(JSON.stringify(document)),
    sha256 = createHash('sha256').update(bytes).digest('hex')
  const receipt = {
    schemaVersion: 2,
    kind: 'marivo.presentation',
    workspaceId: 'workspace',
    reportId: 'report',
    buildId: document.buildId,
    title: document.title,
    summary: 'Saved report',
    files: {
      document: {
        asset: 'presentation.json',
        path: path.join(
          root,
          '.dsh-data-analysis/presentations/report/builds',
          document.buildId,
          'presentation.json',
        ),
        sha256,
        bytes: bytes.length,
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
import {ReportViews} from './src/client/analysis-ui/report-views.ts';
import {ReportView} from './src/client/analysis-ui/report-view.tsx';
import {analysisCandidate} from './src/client/analysis-ui/candidate.ts';
import {draftReportRef,savedReportRef} from './src/presentation/contracts/report-ref.ts';
const documentValue=${JSON.stringify(document)},receipt=${JSON.stringify(receipt)},generation={},views=new ReportViews();
const delivery={kind:'marivo.presentation.draft',dshSessionId:'session',workspaceId:'workspace',turn:1,surface:'tool',draftId:'11111111-1111-4111-8111-111111111111',draftRevision:documentValue.buildId};
const draftRef=draftReportRef({workspaceId:'workspace',sessionId:'session',turn:1,draftId:delivery.draftId,revision:delivery.draftRevision}),savedRef=savedReportRef({workspaceId:'workspace',reportId:'report',buildId:documentValue.buildId});
const rpc={call:async(_channel,endpoint)=>({ok:true,value:endpoint==='reports/history'?{workspaceId:'workspace',reportId:'report',currentBuildId:documentValue.buildId,versions:[{receipt,publishedAt:'2026-11-10T00:00:00.000Z',source:{kind:'agent',sessionId:'session',surface:'tool'}}]}:endpoint==='files/read'?{workspaceId:'workspace',reportId:'report',buildId:documentValue.buildId,asset:'presentation.json',mimeType:'application/json',sha256:${JSON.stringify(sha256)},bytes:${bytes.length},bodyBase64:${JSON.stringify(bytes.toString('base64'))}}:documentValue})};
let args,field;
function observe(){const candidate=analysisCandidate({phase:'preparing',args,callId:'patch',name:'marivo_report_write',turn:1,step:1,time:1,subCalls:[]},'session','workspace',generation);window.preview=candidate.preview;views.observe(candidate,${JSON.stringify(root)});}
function reset(){views.revoke('session');const view=views.accept(delivery,'initial',generation,${JSON.stringify(root)});views.document(view.id,{generation,workspacePath:${JSON.stringify(root)}},documentValue.buildId,documentValue);}
window.identity={reset,begin(nextField){reset();field=nextField;args=new PartialArguments();args.append(JSON.stringify({stage:'preview',title:'Candidate title',locale:'zh-CN',program:'root = Stack([intro, stable]); intro = TextContent("Candidate body"); image = null;',resourcePatch:{remove:['image']},...(field==='onto'?{ref:draftRef}:{})}).slice(0,-1));observe();},partial(){args.append(',"'+field+'":"mr1:');observe();},completeValue(){args.append(savedRef.slice(4)+'"');observe();},close(){args.append('}');observe();},standalone(close=false){views.revoke('session');args=new PartialArguments();args.append(JSON.stringify({stage:'preview',program:'root = TextContent("Standalone body");'}).slice(0,-1)+(close?'}':''));observe();},savedBase(){views.revoke('session');const saved={kind:'marivo.presentation.delivery',schemaVersion:2,dshSessionId:'session',turn:1,surface:'tool',receipt};const view=views.accept(saved,'initial',generation,${JSON.stringify(root)});views.document(view.id,{generation,workspacePath:${JSON.stringify(root)}},documentValue.buildId,documentValue);window.originalView=view.id;},savedPatch(fail=false){args=PartialArguments.fromObject({stage:'preview',ref:savedRef,program:'root = TextContent("Revised body");'});const next=analysisCandidate({phase:'preparing',args,callId:'patch',name:'marivo_report_write',turn:1,step:1,time:1,subCalls:[]},'session','workspace',generation);const view=views.observeReady(fail?{...next,phase:'failed'}:next,${JSON.stringify(root)});window.revisionView=view.id;}};
window.identity.admitSavedRevision=()=>{
  const draftRevision='22222222-2222-4222-8222-222222222222';
  const view=views.accept({...delivery,draftRevision},'patch',generation,${JSON.stringify(root)});
  views.document(view.id,{generation,workspacePath:${JSON.stringify(root)}},draftRevision,
    {...documentValue,buildId:draftRevision,recordId:'marivo-ui:report:'+draftRevision,program:'root = TextContent("Admitted revision");'});
};
window.identity.settle=()=>views.settle('session');
function App(){useSyncExternalStore(views.subscribe,views.getSnapshot);const view=views.forTurn('session',1).at(-1);return view?h(ReportView,{view,views,rpc}):null;}
reset();createRoot(document.getElementById('root')).render(h(App));
`,
    },
    outfile: path.join(root, 'page.js'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
    plugins: [
      {
        name: 'host-dialog',
        setup(builder) {
          builder.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({
            path: 'host-dialog',
            namespace: 'fixture',
          }))
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            contents: 'export const Modal = () => null;',
          }))
        },
      },
    ],
  })
  await writeFile(
    path.join(root, 'index.html'),
    '<div id="root"></div><script src="page.js"></script>',
  )
  const browser = await chromium.launch()
  t.after(() => browser.close())
  const page = await browser.newPage()
  page.setDefaultTimeout(5000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href)
  for (const field of ['ref', 'onto']) {
    await page.evaluate((field) => Reflect.get(window, 'identity').begin(field), field)
    await page.getByText('Successful body', { exact: true }).waitFor()
    const stable = await page.getByText('Stable DOM', { exact: true }).elementHandle()
    const surface = await page.locator('.au-surface').elementHandle()
    const image = await page.locator('.au-image').elementHandle()
    const assertRetained = async () => {
      assert.equal(await page.evaluate(() => Reflect.get(window, 'preview')), false)
      assert.equal(await page.getByText('Candidate body', { exact: true }).count(), 0)
      assert.equal(await page.locator('.au-surface').getAttribute('aria-label'), 'Successful title')
      assert.equal(await page.locator('.au-surface').getAttribute('lang'), 'en-US')
      for (const handle of [stable, surface, image])
        assert.equal(await handle!.evaluate((node) => node.isConnected), true)
    }
    await assertRetained()
    await page.evaluate(() => Reflect.get(window, 'identity').partial())
    await assertRetained()
    await page.evaluate(() => Reflect.get(window, 'identity').completeValue())
    if (field === 'ref') await assertRetained()
    await page.evaluate(() => Reflect.get(window, 'identity').close())
    await page.waitForTimeout(100)
    await page.getByText('Candidate body', { exact: true }).waitFor()
    assert.equal(await page.locator('.au-surface').getAttribute('aria-label'), 'Candidate title')
    assert.equal(await page.locator('.au-surface').getAttribute('lang'), 'zh-CN')
    assert.equal(await page.locator('.au-image').count(), 0)
    assert.equal(await stable!.evaluate((node) => node.isConnected), true)
    assert.equal(await surface!.evaluate((node) => node.isConnected), true)
  }
  await page.evaluate(() => Reflect.get(window, 'identity').standalone(false))
  assert.equal(await page.getByText('Standalone body', { exact: true }).count(), 0)
  await page.evaluate(() => Reflect.get(window, 'identity').standalone(true))
  await page.getByText('Standalone body', { exact: true }).waitFor()
  await page.evaluate(() => Reflect.get(window, 'identity').savedBase())
  await page.getByText('Successful body', { exact: true }).waitFor()
  await page.evaluate(() => Reflect.get(window, 'identity').savedPatch())
  await page.getByText('Revised body', { exact: true }).waitFor()
  assert.equal(
    await page.evaluate(() => Reflect.get(window, 'revisionView')),
    await page.evaluate(() => Reflect.get(window, 'originalView')),
  )
  await page.evaluate(() => Reflect.get(window, 'identity').savedPatch(true))
  await page.getByText('Successful body', { exact: true }).waitFor()
  assert.equal(await page.getByText('Revised body', { exact: true }).count(), 0)
  await page.evaluate(() => Reflect.get(window, 'identity').admitSavedRevision())
  await page.getByText('Admitted revision', { exact: true }).waitFor()
  await page.evaluate(() => Reflect.get(window, 'identity').settle())
  await page.locator('[data-analysis-phase="saved"]').waitFor()
  await page.getByText('Successful body', { exact: true }).waitFor()
  assert.deepEqual(errors, [])
})
