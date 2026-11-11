import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { type Browser, chromium, type Page } from 'playwright'

let directory: string
let browser: Browser
let page: Page
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'next-steps-client-'))
  await build({
    stdin: {
      contents: `import {createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {installNextSteps} from './src/client/next-steps.tsx';
import {RemoteStream} from '../../node_modules/@deepseek-ai/dsh-api-gateway/lib/types/client/remote-stream.js';
import {RemoteStreamCarrierError} from '../../node_modules/@deepseek-ai/dsh-api-gateway/lib/types/client/stream-client.js';
const observable=value=>{const listeners=new Set();return {getSnapshot:()=>value,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},set:next=>{value=next;for(const fn of listeners)fn()}}};
const generation=observable({}), session=observable({running:false,removed:false,pendingSubmissions:[]});
const input=observable({phase:'plain',draft:'',occurrences:[],attachmentIds:[],queue:[]});
const events=observable({entries:[{type:'event',event:{type:'turn/start',data:{turn:1}}}]});
let channel, mounts=0, opens=0, submitted=0, turnTail;
const effects=[];
const ctx={
 connection:{generation},
 sessions:{list:observable({byId:{s:{id:'s',retainedBy:{mainView:1}}}}),scope:()=>({}),binding:()=>({session,eventSource:events})},
 workspaces:{list:observable({phase:'ready',items:[{workspaceId:'w',path:'/workspace',sessionIds:['s']}]})},
 conversation:{input:{for:()=>({state:input,setDraft:prompt=>input.set({...input.getSnapshot(),draft:prompt}),submit:()=>{submitted++},notify:()=>{}})}},
 locale:{getSnapshot:()=>({active:'en'}),bind:()=>()=>undefined},
 effect:fn=>{effects.push(fn())},
 slots:{inject:(_name,fn)=>fn(),register:(meta,fn)=>{if(meta.name!=="conversation.chat.turnTail")throw Error("Recommendations must render outside collapsed tools");turnTail=fn}},
 inject:(_deps,fn)=>{fn(ctx);return Object.assign(Promise.resolve(),{dispose:async()=>{}})},
 remote:{
  $mount:async()=>{if(++mounts===1)throw Error('mount failed');return()=>{}},
  $stream:options=>new RemoteStream({generation},options),
  dshDataAnalysisNextSteps:{async *watch(_id,signal){
   opens++;const queue=[];let wake;
   channel=value=>{queue.push(value);wake?.()};
   const abort=()=>wake?.();signal.addEventListener('abort',abort);
   try{while(!signal.aborted){if(!queue.length)await new Promise(r=>wake=r);wake=undefined;if(signal.aborted)return;const value=queue.shift();if(value instanceof Error)throw value;if(value)yield value;}}
   finally{signal.removeEventListener('abort',abort)}
  }}
 }
};
const {NextSteps,model}=installNextSteps(ctx), root=createRoot(document.getElementById('root'));
const render=callId=>root.render(createElement(NextSteps,{sessionId:'s',turn:1,callId}));render();
window.fixture={
 stats:()=>({mounts,opens,submitted}),
 publish:extra=>channel({sessionId:'s',workspaceId:'w',turn:1,reportId:'r',buildId:'b',status:'available',items:[{label:'Compare regions',prompt:'Compare the saved regions.'}],...extra}),
 carrier:()=>channel(new RemoteStreamCarrierError('carrier lost')),
 terminal:()=>channel(Error('terminal')),
 submit:()=>session.set({...session.getSnapshot(),pendingSubmissions:[{}]}),
 idle:()=>session.set({...session.getSnapshot(),pendingSubmissions:[]}),
 draft:value=>input.set({...input.getSnapshot(),draft:value}),
 input:value=>input.set({...input.getSnapshot(),...value}),
 generation:()=>generation.set({}),
 workspace:()=>ctx.workspaces.list.set({phase:'ready',items:[{workspaceId:'w',path:'/replacement',sessionIds:['s']}]}),
 hideWorkspace:()=>ctx.workspaces.list.set({phase:'ready',items:[]}),
 restoreWorkspace:()=>ctx.workspaces.list.set({phase:'ready',items:[{workspaceId:'w',path:'/workspace',sessionIds:['s']}]}),
 render,
 explicit:()=>{events.set({entries:[...events.getSnapshot().entries,{type:'event',event:{type:'tool/result',data:{turn:1,message:{isError:false,toolCallId:'explicit'},meta:{kind:'marivo.next-steps',sessionId:'s',turn:1,callId:'explicit'}}}}]});root.render(createElement(turnTail,{sessionId:'s',turn:{turn:1}}));},
 both:()=>{events.set({entries:[...events.getSnapshot().entries,{type:'event',event:{type:'tool/result',data:{turn:1,message:{isError:false,toolCallId:'explicit'},meta:{kind:'marivo.next-steps',sessionId:'s',turn:1,callId:'explicit'}}}}]});root.render(createElement('div',null,createElement(NextSteps,{sessionId:'s',turn:1}),createElement(turnTail,{sessionId:'s',turn:{turn:1}})));},
 advance:()=>{events.set({entries:[...events.getSnapshot().entries,{type:'event',event:{type:'turn/start',data:{turn:2}}}]});root.render(createElement(NextSteps,{sessionId:'s',turn:2}));session.set({...session.getSnapshot(),running:true});},
 close:async()=>{root.unmount();for(const dispose of effects.reverse())await dispose?.()}
};`,
      resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
    },
    outfile: path.join(directory, 'page.js'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  })
  await writeFile(
    path.join(directory, 'index.html'),
    '<div id="root"></div><script src="page.js"></script>',
  )
  browser = await chromium.launch()
  page = await browser.newPage()
})
after(async () => {
  await browser?.close()
  await rm(directory, { recursive: true, force: true })
})
async function start() {
  await page.goto(pathToFileURL(path.join(directory, 'index.html')).href)
  await page.locator('[data-next-steps-status="connection-failed"]').waitFor()
  await page.getByRole('button', { name: 'Retry connection' }).click()
  await page.waitForFunction('window.fixture.stats().opens === 1')
}

test('failed mount can retry; accepted notices keep the real stream healthy across two interruptions', async () => {
  await start()
  for (let i = 1; i <= 2; i++) {
    await page.evaluate('window.fixture.publish()')
    await page.getByRole('button', { name: 'Compare regions' }).waitFor()
    await page.evaluate('window.fixture.carrier()')
    await page.waitForFunction(`window.fixture.stats().opens === ${i + 1}`)
  }
  await page.evaluate('window.fixture.publish()')
  await page.getByRole('button', { name: 'Compare regions' }).waitFor()
  await page.evaluate('window.fixture.terminal()')
  await page.getByRole('button', { name: 'Retry connection' }).click()
  await page.waitForFunction('window.fixture.stats().opens === 4')
  assert.deepEqual(await page.evaluate('window.fixture.stats()'), {
    mounts: 2,
    opens: 4,
    submitted: 0,
  })
  await page.evaluate('window.fixture.close()')
})

test('a notice arriving before its Turn remains visible when the event and session catch up', async () => {
  await start()
  await page.evaluate('window.fixture.publish({turn:2})')
  await page.waitForTimeout(30)
  assert.equal(await page.getByRole('button', { name: 'Compare regions' }).count(), 0)
  await page.evaluate('window.fixture.advance()')
  await page.getByRole('button', { name: 'Compare regions' }).waitFor()
  assert.equal(await page.locator('[data-next-steps-turn="2"]').count(), 1)
  await page.evaluate('window.fixture.close()')
})

test('a delayed decline retires a pending recommendation for the same Turn', async () => {
  await start()
  await page.evaluate(
    'window.fixture.publish({turn:2}); window.fixture.publish({turn:2,status:"declined",items:[]})',
  )
  await page.waitForTimeout(30)
  await page.evaluate('window.fixture.advance()')
  await page.waitForTimeout(30)
  assert.equal(await page.getByRole('button', { name: 'Compare regions' }).count(), 0)
  await page.evaluate('window.fixture.publish({turn:2})')
  await page.waitForTimeout(30)
  assert.equal(await page.getByRole('button', { name: 'Compare regions' }).count(), 0)
  await page.evaluate('window.fixture.close()')
})

test('an explicit Turn tail remains mounted while its Workspace owner loads', async () => {
  await start()
  await page.evaluate('window.fixture.hideWorkspace(); window.fixture.explicit()')
  await page.waitForTimeout(30)
  await page.evaluate('window.fixture.restoreWorkspace()')
  await page.waitForFunction('window.fixture.stats().opens === 2')
  await page.evaluate('window.fixture.publish({callId:"explicit"})')
  await page.getByRole('button', { name: 'Compare regions' }).waitFor()
  await page.evaluate('window.fixture.close()')
})

test('a Turn with both report and explicit anchors shows one connection failure and keeps a saved notice', async () => {
  await start()
  await page.evaluate('window.fixture.both(); window.fixture.terminal()')
  await page.locator('[data-next-steps-status="connection-failed"]').waitFor()
  assert.equal(await page.locator('[data-next-steps-status="connection-failed"]').count(), 1)
  await page.getByRole('button', { name: 'Retry connection' }).click()
  await page.waitForFunction('window.fixture.stats().opens === 2')
  await page.evaluate('window.fixture.publish()')
  await page.getByRole('button', { name: 'Compare regions' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Compare regions' }).count(), 1)
  await page.evaluate('window.fixture.close()')
})

test('explicit report recommendations render at the Turn tail outside collapsed tools and cannot return after a new submission', async () => {
  await start()
  await page.evaluate('window.fixture.publish({callId:"explicit"})')
  await page.waitForTimeout(30)
  assert.equal(await page.getByRole('button', { name: 'Compare regions' }).count(), 0)
  await page.evaluate('window.fixture.explicit()')
  await page.getByRole('button', { name: 'Compare regions' }).waitFor()
  await page.getByRole('button', { name: 'Compare regions' }).click()
  assert.equal(await page.evaluate('window.fixture.stats().submitted'), 1)
  await page.evaluate(
    'window.fixture.submit(); window.fixture.idle(); window.fixture.publish({callId:"explicit"})',
  )
  await page.waitForTimeout(30)
  assert.equal(await page.getByRole('button', { name: 'Compare regions' }).count(), 0)
  await page.evaluate('window.fixture.close()')
})

test('a queued submission retires the Turn even after carrier failure hid its notice', async () => {
  await start()
  await page.evaluate('window.fixture.publish()')
  await page.getByRole('button', { name: 'Compare regions' }).waitFor()
  await page.evaluate('window.fixture.carrier()')
  await page.waitForFunction('window.fixture.stats().opens === 2')
  await page.evaluate('window.fixture.submit(); window.fixture.idle(); window.fixture.publish()')
  await page.waitForTimeout(30)
  assert.equal(await page.getByRole('button', { name: 'Compare regions' }).count(), 0)
  await page.evaluate('window.fixture.close()')
})

test('a normal empty result shows an empty status without a failure or retry control', async () => {
  await start()
  await page.evaluate('window.fixture.publish({status:"empty",items:[]})')
  await page.locator('[data-next-steps-status="empty"]').waitFor()
  assert.equal(await page.getByRole('button').count(), 0)
  assert.equal(await page.locator('[data-next-steps-status="unavailable"]').count(), 0)
  assert.equal(await page.locator('[data-next-steps-status="connection-failed"]').count(), 0)
  await page.evaluate('window.fixture.close()')
})

test('generation failure stays separate from normal empty and a decline hides the Turn', async () => {
  await start()
  await page.evaluate(
    'window.fixture.publish({status:"unavailable",reason:"generation-failed",items:[]})',
  )
  await page.locator('[data-next-steps-status="unavailable"]').waitFor()
  await page.evaluate('window.fixture.publish({status:"declined",items:[]})')
  await page.waitForFunction('!document.querySelector("[data-next-steps-status]")')
  await page.evaluate('window.fixture.publish()')
  assert.equal(await page.getByRole('button', { name: 'Compare regions' }).count(), 0)
  await page.evaluate('window.fixture.close()')
})

test('composer content disables submission until the native input is empty', async () => {
  await start()
  await page.evaluate('window.fixture.publish()')
  const button = page.getByRole('button', { name: 'Compare regions' })
  await button.waitFor()
  for (const state of [
    { draft: 'Keep my draft' },
    { occurrences: [{}] },
    { attachmentIds: ['attachment'] },
    { phase: 'command' },
    { claim: {} },
  ]) {
    await page.evaluate(`window.fixture.input(${JSON.stringify(state)})`)
    assert.equal(await button.isDisabled(), true)
    assert.equal(await page.evaluate('window.fixture.stats().submitted'), 0)
    await page.evaluate(
      'window.fixture.input({phase:"plain",draft:"",occurrences:[],attachmentIds:[],claim:undefined})',
    )
  }
  assert.equal(await button.isEnabled(), true)
  await button.click()
  assert.equal(await page.evaluate('window.fixture.stats().submitted'), 1)
  assert.equal(await button.count(), 0)
  await page.evaluate('window.fixture.close()')
})

for (const invalidation of ['generation', 'workspace'])
  test(`connection and Workspace ownership changes discard old notices (${invalidation})`, async () => {
    await start()
    await page.evaluate('window.fixture.publish()')
    await page.getByRole('button', { name: 'Compare regions' }).waitFor()
    await page.evaluate(`window.fixture[${JSON.stringify(invalidation)}]()`)
    await page.waitForFunction('!document.querySelector("[data-next-steps-status]")')
    await page.waitForFunction('window.fixture.stats().opens === 2')
    assert.equal(await page.getByRole('button', { name: 'Compare regions' }).count(), 0)
    await page.evaluate('window.fixture.close()')
  })
