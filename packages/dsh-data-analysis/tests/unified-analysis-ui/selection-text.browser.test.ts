import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

test('selection codecs render the same chips in sent, queued and reloaded user text', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-selection-chips-'))
  const browser = await chromium.launch()
  try {
    await build({
      stdin: {
        resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
        contents: `
import {createElement as h} from 'react';
import {createRoot} from 'react-dom/client';
import {SelectionReference} from './src/client/selection-text.tsx';
import {selectionTextRule} from './src/client/selection-text-rule.ts';
import {selectionModelText} from './src/presentation/contracts/selection-text.ts';
import {reportRefFromRecordId} from './src/presentation/contracts/report-ref.ts';
import {createComponentReferenceSource} from './src/client/component-reference.ts';
import {createDatasetReferenceSource} from './src/client/dataset-reference.ts';
import {createPointReferenceSource} from './src/client/point-reference.ts';
const identity={sessionId:'s',workspaceId:'w',recordId:'marivo-ui:r:b',resourceName:'Revenue'};
const component={...identity,schema:'dsh-data-analysis-component/v1',digest:'a'.repeat(64),component:{kind:'frame'}};
const dataset={...identity,schema:'dsh-data-analysis-dataset-point/v1',digest:'a'.repeat(64),row:0,field:'amount'};
const point={...identity,schema:'dsh-data-analysis-frame-point/v1',row:0,field:'amount',point:{column:{id:'amount',label:'Revenue',type:'decimal',nullable:false},value:'9007199254740993.2300',role:'value',description:null,axes:[{token:'region',name:'region',role:'index',variant:'{}',keys:[{id:'region',slotId:'region',dtype:{type:'string'},value:'North'}]}],coordinates:[],presence:[],related:[],coverageComplete:true,interpretation:null,periods:'{}'}};
window.modelRequests=[];
window.errors=[];
window.addEventListener('error',e=>window.errors.push(e.message));
const rpc={async call(channel,endpoint,{envelope}){
 const name=endpoint.startsWith('point')?'Revenue · North':endpoint.startsWith('dataset')?'Revenue · amount · 1':'Revenue';
 return {ok:true,value:{text:selectionModelText(endpoint.startsWith('point')?'frame-point':endpoint.startsWith('dataset')?'dataset-point':'component',name,{ref:reportRefFromRecordId(identity.recordId,identity.workspaceId),resource:identity.resourceName,...(endpoint.startsWith('component')?{resultRef:{schema:'marivo.frame_ref/v2',store_id:'store',session_id:'ms',artifact_id:'artifact'}}:{value:'9007199254740993.2300'})})}}}};
const lifetime=new AbortController();
const choices={component:[component,createComponentReferenceSource(rpc,lifetime.signal)],point:[point,createPointReferenceSource(rpc,lifetime.signal)],dataset:[dataset,createDatasetReferenceSource(rpc,lifetime.signal)]};
const inputRoot=createRoot(document.getElementById('input-chip'));
const sentRoot=createRoot(document.getElementById('sent'));
const queueRoot=createRoot(document.getElementById('queue'));
let current;
function show(wire,root){
 const node=selectionTextRule.match(wire,0,{read(){}});
 root.render(node?h(SelectionReference,{node,raw:wire,interactive:false}):wire);
}
window.choose=kind=>{current=choices[kind];const [value,source]=current;inputRoot.render(source.codec.clipboardText(JSON.stringify(value)).slice(1));};
window.send=async()=>{const [value,source]=current;const wire=await source.codec.serialize(JSON.stringify(value),lifetime.signal);window.modelRequests.push(wire);localStorage.setItem('selection-chip',wire);show(wire,queueRoot);show(wire,sentRoot);};
document.querySelectorAll('[data-kind]').forEach(button=>button.onclick=()=>window.choose(button.dataset.kind));
document.getElementById('send').onclick=window.send;
const stored=localStorage.getItem('selection-chip');if(stored)show(stored,sentRoot);
window.choose('component');`,
      },
      outfile: path.join(directory, 'page.js'),
      plugins: [
        {
          // The published Host barrel initializes optional Markdown engines and brand
          // icons. Chip rendering uses none of them; keep the actual ReferenceChip.
          name: 'unmounted-host-features',
          setup(build) {
            build.onResolve(
              { filter: /^(simple-icons|anser|katex\/|shiki\/|@shikijs\/)/ },
              (args) => ({ path: args.path, namespace: 'unmounted' }),
            )
            build.onLoad({ filter: /.*/, namespace: 'unmounted' }, async (args) => {
              let contents = 'export default {}'
              if (args.path === 'simple-icons') {
                const barrel = await readFile(
                  new URL(
                    '../../../../node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/index.js',
                    import.meta.url,
                  ),
                  'utf8',
                )
                const names =
                  barrel.match(/import \{ ([^}]+) \} from "simple-icons"/)?.[1]?.split(', ') ?? []
                assert.ok(names.length > 0)
                contents = names
                  .map((name) => `export const ${name} = {path:"",title:""};`)
                  .join('\n')
              } else if (args.path === 'shiki/core') {
                contents =
                  'export const createCssVariablesTheme = x => x; export const createHighlighterCoreSync = () => ({ codeToTokens(){return {tokens:[]}}, getLoadedLanguages(){return []} })'
              } else if (args.path === 'shiki/engine/javascript') {
                contents =
                  'export const createJavaScriptRegexEngine = () => ({}); export const defaultJavaScriptRegexConstructor = () => {throw Error("Markdown must not mount in chip tests")}'
              }
              return { contents, loader: 'js' }
            })
          },
        },
      ],
      bundle: true,
      platform: 'browser',
      format: 'iife',
      jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' },
      logLevel: 'silent',
    })
    await writeFile(
      path.join(directory, 'index.html'),
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Marivo selection chips</title><link rel="stylesheet" href="page.css"><style>body{font:16px system-ui;max-width:760px;margin:60px auto;color:#18202a;background:#fafafa}section{padding:24px;margin:18px 0;border:1px solid #ddd;border-radius:12px;background:white}button{font:inherit;padding:8px 14px;margin:4px}h1{font-size:24px}h2{font-size:15px;color:#667}#input-chip{padding:12px}</style><h1>Marivo selection chips</h1><button data-kind="component">Choose component</button><button data-kind="point">Choose Frame point</button><button data-kind="dataset">Choose Dataset point</button><section><h2>Input</h2><div id="input-chip"></div><button id="send">Send</button></section><section><h2>Queue / steer</h2><div id="queue"></div></section><section><h2>Sent / history</h2><div id="sent"></div></section><script src="page.js"></script>`,
    )
    const artifacts = process.env.DSH_SELECTION_ARTIFACT_DIR
    if (artifacts) {
      await mkdir(artifacts, { recursive: true })
      for (const file of ['index.html', 'page.js', 'page.css'])
        await copyFile(path.join(directory, file), path.join(artifacts, file))
    }
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(pathToFileURL(path.join(directory, 'index.html')).href)
    for (const kind of ['component', 'point', 'dataset']) {
      await page.locator(`[data-kind="${kind}"]`).click()
      const label = await page.locator('#input-chip').innerText()
      await page.locator('#send').click()
      await page.waitForFunction(
        (expected) => document.querySelector('#sent')?.textContent === expected,
        label,
      )
      assert.equal(await page.locator('#queue').innerText(), label)
      assert.equal(await page.locator('#sent').innerText(), label)
      assert.equal(await page.locator('#sent').getByText('9007199254740993.2300').count(), 0)
      await page.reload()
      await page.waitForFunction(
        (expected) => document.querySelector('#sent')?.textContent === expected,
        label,
      )
    }
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
    await rm(directory, { recursive: true, force: true })
  }
})
