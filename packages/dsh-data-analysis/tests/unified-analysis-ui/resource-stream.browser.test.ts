import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { parseDraftDelivery } from '../../src/client/presentation/delivery.ts'
import { resourceStreamFixture } from '../presentation-integration/resource-stream-fixture.ts'

test('Host-admitted resource deltas update one mounted report before a slow sibling and retain unrelated DOM', async (t) => {
  const f = await resourceStreamFixture(t)
  const initial = (await f.tool.execute(
    {
      stage: 'preview',
      locale: 'en-US',
      program:
        'root=Stack([intro, kept]); intro=TextContent("Confirmed scope"); kept=TextContent("Untouched component");',
    },
    { ...f.exec, callId: 'initial' as ToolRunContext['callId'] },
  )) as { deliveryJson: string; draftId: string; draftRevision: string }
  const delivery = parseDraftDelivery(JSON.parse(initial.deliveryJson))!
  const args = {
    stage: 'preview',
    draftId: initial.draftId,
    draftRevision: initial.draftRevision,
    resourcePatch: { put: { fast: f.declaration('2'), slow: f.declaration('1') } },
    program:
      'root=Stack([intro, kept, fast, slow]); intro=TextContent("Updated scope"); fast=DatasetView("fast", {chart:"table"}); slow=DatasetView("slow", {chart:"table"});',
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
const views=new ReportViews(),generation={},delivery=${JSON.stringify(delivery)};
const rpc={call:async(_channel,endpoint,payload)=>window.hostRead(endpoint,payload)};
views.accept(delivery,'initial',generation,${JSON.stringify(f.root)});
function App(){useSyncExternalStore(views.subscribe,views.getSnapshot);return h(ReportView,{view:views.forTurn('session',1)[0],views,rpc})}
window.startStream=(args,callId='present')=>views.observe(analysisCandidate({phase:'start',args:PartialArguments.fromObject(args),callId,name:'marivo_present',turn:1,step:1,time:1,subCalls:[]},'session','workspace',generation),${JSON.stringify(f.root)});
window.acceptStream=(next,callId='present')=>views.accept(next,callId,generation,${JSON.stringify(f.root)});
createRoot(document.getElementById('root')).render(h(App));`,
    },
    outfile: path.join(f.root, 'page.js'),
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
    path.join(f.root, 'index.html'),
    '<html><meta charset="utf-8"><div id="root"></div><script src="page.js"></script></html>',
  )
  const browser = await chromium.launch()
  t.after(() => browser.close())
  const page = await browser.newPage()
  let releaseRead = () => {}
  let readGate: Promise<void> | undefined
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.exposeFunction('hostRead', async (endpoint: string, payload: unknown) => {
    await readGate
    return {
      ok: true,
      value:
        endpoint === 'draft/read'
          ? await f.service.draft(payload, f.exec.signal)
          : await f.service.resourceStream(payload, f.exec.signal),
    }
  })
  await page.goto(pathToFileURL(path.join(f.root, 'index.html')).href)
  await page.getByText('Untouched component', { exact: true }).waitFor()
  const untouched = await page.getByText('Untouched component', { exact: true }).elementHandle()
  const surface = await page.locator('.au-surface').elementHandle()
  const operation = f.tool.execute(args, f.exec)
  await page.evaluate((args) => Reflect.get(window, 'startStream')(args), args)
  await page.getByText('Fast ready', { exact: true }).waitFor()
  assert.equal(await page.getByText('Slow ready', { exact: true }).count(), 0)
  assert.equal(await page.locator('[data-resource="slow"]').count(), 0)
  assert.equal(f.drafts.get('session')?.document.buildId, initial.draftRevision)
  assert.equal(await untouched!.evaluate((node) => node.isConnected), true)
  assert.equal(await surface!.evaluate((node) => node.isConnected), true)
  assert.equal(await page.locator('[data-analysis-report]').count(), 1)
  f.release()
  const next = (await operation) as { deliveryJson: string }
  await page.getByText('Slow ready', { exact: true }).waitFor()
  readGate = new Promise((resolve) => {
    releaseRead = resolve
  })
  await page.evaluate(
    (value) => Reflect.get(window, 'acceptStream')(value),
    JSON.parse(next.deliveryJson),
  )
  await page.locator('[data-analysis-phase="draft"]').waitFor()
  const pendingRevision = parseDraftDelivery(JSON.parse(next.deliveryJson))!
  await page.evaluate(
    (revision) =>
      Reflect.get(window, 'startStream')(
        {
          stage: 'preview',
          draftId: revision.draftId,
          draftRevision: revision.draftRevision,
          program: 'intro=TextContent("Following revision");',
        },
        'following',
      ),
    pendingRevision,
  )
  await page.waitForTimeout(100)
  assert.equal(await page.getByText('Fast ready', { exact: true }).isVisible(), true)
  assert.equal(await page.getByText('Slow ready', { exact: true }).isVisible(), true)
  assert.equal(await page.getByText('Updated scope', { exact: true }).isVisible(), true)
  releaseRead()
  readGate = undefined
  await page.getByText('Following revision', { exact: true }).waitFor()

  assert.equal(await untouched!.evaluate((node) => node.isConnected), true)
  assert.equal(
    await page.locator('.au-surface-body').evaluate((node) => node.getAnimations().length),
    0,
  )
  const latest = parseDraftDelivery(JSON.parse(next.deliveryJson))!
  const replacement = {
    stage: 'preview',
    draftId: latest.draftId,
    draftRevision: latest.draftRevision,
    resourcePatch: { put: { fast: f.declaration('4') } },
  }
  readGate = new Promise((resolve) => {
    releaseRead = resolve
  })
  const oldTable = await page.locator('[data-resource="fast"] table').elementHandle()
  const replacing = f.tool.execute(replacement, {
    ...f.exec,
    callId: 'replace' as ToolRunContext['callId'],
  })
  await page.evaluate((value) => Reflect.get(window, 'startStream')(value, 'replace'), replacement)
  await page.waitForTimeout(100)
  assert.equal(await oldTable!.evaluate((node) => node.isConnected), true)
  assert.equal(await page.getByText('Fast ready', { exact: true }).isVisible(), true)
  assert.equal(await page.locator('[data-slot="skeleton"]').count(), 0)
  releaseRead()
  readGate = undefined
  await page.getByText('Replacement ready', { exact: true }).waitFor()
  assert.equal(await page.getByText('Fast ready', { exact: true }).count(), 0)
  assert.equal(await page.getByText('Slow ready', { exact: true }).isVisible(), true)
  assert.equal(await untouched!.evaluate((node) => node.isConnected), true)
  const replaced = (await replacing) as { deliveryJson: string }
  await page.evaluate(
    (value) => Reflect.get(window, 'acceptStream')(value, 'replace'),
    JSON.parse(replaced.deliveryJson),
  )
  const replacedDelivery = parseDraftDelivery(JSON.parse(replaced.deliveryJson))!
  const removal = {
    stage: 'preview',
    draftId: replacedDelivery.draftId,
    draftRevision: replacedDelivery.draftRevision,
    resourcePatch: { remove: ['slow'] },
    program: 'root=Stack([intro, kept, fast]); slow=null;',
  }
  const removing = f.tool.execute(removal, {
    ...f.exec,
    callId: 'remove' as ToolRunContext['callId'],
  })
  await page.evaluate((value) => Reflect.get(window, 'startStream')(value, 'remove'), removal)
  await page.getByText('Slow ready', { exact: true }).waitFor({ state: 'hidden' })
  const removed = (await removing) as { deliveryJson: string }
  await page.evaluate(
    (value) => Reflect.get(window, 'acceptStream')(value, 'remove'),
    JSON.parse(removed.deliveryJson),
  )
  assert.equal(await page.getByText('Replacement ready', { exact: true }).isVisible(), true)
  assert.equal(await untouched!.evaluate((node) => node.isConnected), true)
  assert.equal(await surface!.evaluate((node) => node.isConnected), true)
  assert.equal(await page.locator('[data-analysis-report]').count(), 1)
  assert.equal(f.reads, 3, 'replacement reads once and deletion does not read unchanged resources')
  assert.deepEqual(errors, [])
})
