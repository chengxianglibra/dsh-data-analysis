import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

test('Coverage details follow saved facts', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-coverage-copy-'))
  const browser = await chromium.launch()
  try {
    await build({
      stdin: {
        contents: `import {createElement as h,useLayoutEffect,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {createPortal} from 'react-dom';
import {AnalysisRenderer} from './src/client/analysis-ui/surface.tsx';
import {OverlayProvider} from './src/client/ui/overlays.tsx';
import {datasetSnapshot} from './tests/unified-analysis-ui/dataset-fixtures.ts';
import {frame,timeAxis} from './tests/unified-analysis-ui/frame-fixtures.ts';
const partial=frame({axes:[timeAxis(3)],values:[{name:'amount',values:[1,2,3]}],totalRows:5});
const complete=frame({axes:[timeAxis(3)],values:[{name:'amount',values:[1,2,3]}]});
const resource=snapshot=>({kind:'snapshot',declaration:{kind:snapshot.kind==='frame'?'frame-snapshot':'dataset-snapshot',snapshotRef:'ref'},snapshot,binding:{workspaceId:'w'}});
const resources={partial:resource(partial),compact:resource(partial),complete:resource(complete),table:resource(datasetSnapshot())};
window.calls={code:0,ask:0,copy:0};window.completedWrites=0;window.pendingWrites=[];
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{
 window.calls.copy++;const fail=window.failCopy;
 try{if(window.deferCopy)await new Promise(resolve=>window.pendingWrites.push(resolve));if(fail)throw Error('Clipboard unavailable');window.copiedText=text}
 finally{window.completedWrites++}
}}});
// Boundary fixture; the real Harness remains responsible for its own Modal lifecycle.
function PortalShell({title,open,onClose,className,children}){
 const root=useRef(null);
 useLayoutEffect(()=>{if(!open)return;const previous=document.activeElement;root.current.querySelector('button').focus();
 const keydown=event=>{if(event.key==='Escape'&&!event.defaultPrevented){event.preventDefault();onClose()}};
 document.addEventListener('keydown',keydown);
 return()=>{document.removeEventListener('keydown',keydown);if(previous instanceof HTMLElement)previous.focus()};},[open]);
 return open?createPortal(h('div',{style:{position:'fixed',inset:0,display:'flex',alignItems:'center',justifyContent:'center',padding:16}},h('div',{ref:root,role:'dialog','aria-label':title,className},children)),document.body):null;
}
const params=new URLSearchParams(location.search);
const surface=h(AnalysisRenderer,{recordId:'build-1',resources,title:'Saved results',locale:params.get('locale')||'en-US',candidate:params.has('candidate'),
 program:'root = Stack([partial,compact,complete,table]);\\npartial = AnalysisFrameView("partial");\\ncompact = AnalysisFrameView("compact",{chart:"auto"},{density:"compact"});\\ncomplete = AnalysisFrameView("complete");\\ntable = DatasetView("table");',
 readCode:async()=>{window.calls.code++;return undefined},askPoint:async()=>{window.calls.ask++}});
createRoot(document.getElementById('root')).render(params.has('portal')?h(OverlayProvider,{shell:PortalShell},surface):surface);`,
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
      '<!doctype html><html lang="en" data-ds-theme-source="host"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Coverage and copy feedback</title></head><body style="margin:0"><div id="root"></div><script src="page.js"></script></body></html>',
    )
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    page.setDefaultTimeout(5000)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const url = pathToFileURL(path.join(directory, 'index.html')).href
    await page.goto(url)
    await page.locator('[data-resource="partial"]').waitFor()

    await t.test(
      'full and compact Coverage open saved details with mouse and keyboard',
      async () => {
        assert.equal(
          await page.locator('[data-resource="complete"] [data-icon="coverage"]').count(),
          0,
        )
        for (const name of ['partial', 'compact']) {
          const card = page.locator(`[data-resource="${name}"]`)
          const trigger = card.getByRole('button', {
            name: 'Coverage',
            exact: true,
            includeHidden: true,
          })
          assert.equal(await trigger.getAttribute('aria-haspopup'), 'dialog')
          assert.equal(await trigger.getAttribute('aria-expanded'), 'false')
          await trigger.hover()
          await page.getByRole('tooltip', { name: 'Coverage', exact: true }).waitFor()
          if (name === 'partial') await trigger.click()
          else {
            await trigger.focus()
            await trigger.press('Enter')
          }
          const dialog = page.getByRole('dialog', { name: 'Coverage', exact: true })
          await dialog.waitFor()
          assert.equal(await trigger.getAttribute('aria-expanded'), 'true')
          assert.match((await dialog.textContent()) ?? '', /Captured 3 \/ 5 rows/)
          assert.match((await dialog.textContent()) ?? '', /Snapshot time: 2026-10-30T00:00:00Z/)
          assert.match((await dialog.textContent()) ?? '', /Business coverage is unknown/)
          await dialog.getByRole('button', { name: 'Close', exact: true }).click()
          await dialog.waitFor({ state: 'detached' })
          assert.equal(await trigger.getAttribute('aria-expanded'), 'false')
          assert.equal(await trigger.evaluate((node) => node === document.activeElement), true)
          assert.match((await card.getByRole('status').first().textContent()) ?? '', /3.*5/)
        }
        assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'calls')), {
          code: 0,
          ask: 0,
          copy: 0,
        })
      },
    )

    await t.test(
      'Coverage follows locale and theme through the portal adapter on narrow screens',
      async () => {
        await page.goto(`${url}?portal&locale=zh-CN`)
        await page.setViewportSize({ width: 390, height: 844 })
        await page.evaluate(() => {
          document.body.setAttribute('data-ds-dark-theme', '')
          document.body.style.setProperty('--dsw-alias-bg-base', '#1c1c1f')
        })
        const trigger = page
          .locator('[data-resource="partial"]')
          .getByRole('button', { name: '覆盖', exact: true })
        await trigger.hover()
        await page.getByRole('tooltip', { name: '覆盖', exact: true }).waitFor()
        await trigger.click()
        const dialog = page.getByRole('dialog', { name: '覆盖', exact: true })
        await dialog.waitFor()
        assert.match((await dialog.textContent()) ?? '', /捕获 3 \/ 5 行/)
        assert.match((await dialog.textContent()) ?? '', /业务覆盖范围未知/)
        assert.equal(
          await dialog
            .locator('.mv-dialog-body')
            .evaluate((node) => getComputedStyle(node.parentElement!).backgroundColor),
          'rgb(28, 28, 31)',
        )
        assert.equal(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth), true)
        await page.keyboard.press('Escape')
        assert.equal(await dialog.isVisible(), true)
        await page.keyboard.press('Escape')
        await dialog.waitFor({ state: 'hidden' })
        assert.equal(await trigger.evaluate((node) => node === document.activeElement), true)
      },
    )

    await t.test('candidate Coverage cannot open dialogs even with synthetic clicks', async () => {
      await page.goto(`${url}?candidate`)
      await page.locator('[data-icon="coverage"]').first().waitFor()
      await page.evaluate(() => {
        for (const button of document.querySelectorAll('[data-icon="coverage"] button'))
          button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      assert.equal(await page.getByRole('dialog').count(), 0)
      assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'calls')), {
        code: 0,
        ask: 0,
        copy: 0,
      })
    })
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
    await rm(directory, { recursive: true, force: true })
  }
})
