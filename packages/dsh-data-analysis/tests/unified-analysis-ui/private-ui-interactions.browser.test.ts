import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

test('private Tooltip and Tabs preserve keyboard access and modal ownership', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-private-interactions-'))
  const browser = await chromium.launch()
  try {
    await build({
      stdin: {
        contents: `import {createElement as h,useState,useRef,useLayoutEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {createPortal} from 'react-dom';
import {Button,IconButton} from './src/client/ui/controls.tsx';
import {Tabs} from './src/client/ui/tabs.tsx';
import {DetailsDialog,OverlayProvider} from './src/client/ui/overlays.tsx';
import {UI_STYLES} from './src/client/ui/theme.ts';
import {LAYOUT_STYLES} from './src/client/analysis-ui/layout.tsx';
const text='Source metadata was not captured in the original analysis.\\nThe saved results remain available.';
// Boundary fixture: a portal shell with the Host's bubble-phase Escape ownership.
function PortalShell({title,open,onClose,className,children}){
 const root=useRef(null);
 useLayoutEffect(()=>{
  if(!open)return;
  const previous=document.activeElement;
  root.current.querySelector('button').focus();
  const keydown=event=>{if(event.key==='Escape'&&!event.defaultPrevented){event.preventDefault();onClose()}};
  document.addEventListener('keydown',keydown);
  return()=>{document.removeEventListener('keydown',keydown);if(previous instanceof HTMLElement)previous.focus()};
 },[open]);
 return open?createPortal(h('div',{style:{position:'fixed',inset:0,display:'flex',alignItems:'center',justifyContent:'center',padding:16}},h('div',{ref:root,role:'dialog','aria-label':title,className},children)),document.body):null;
}
function App(){
 const [open,setOpen]=useState(false);
 return h('main',{className:'mv-ui',style:{padding:16}},h('style',null,UI_STYLES),h('style',null,LAYOUT_STYLES),
 h('p',{id:'extra-description',hidden:true},'Saved metadata'),
 h(IconButton,{label:'Tip trigger',tip:text,'aria-describedby':'extra-description'},'i'),
 h(IconButton,{label:'Unavailable source',tip:'Not captured',unavailable:true,onClick:()=>{window.unavailableCalls++}},'i'),
 h(Button,{id:'before'},'Before sections'),
 h(Tabs,{label:'Saved report sections',items:[{value:'a',trigger:'Summary',content:h('p',null,'Saved summary')},{value:'b',trigger:'Details',content:h('p',null,'Saved details')}]}),
 h(Button,{id:'after'},'After sections'),
 h(Button,{onClick:()=>setOpen(true)},'Open details'),
 h(DetailsDialog,{title:'Saved details',closeLabel:'Close details',open,onClose:()=>setOpen(false)},
 h(IconButton,{label:'Dialog metadata',tip:text},'i'),h('div',{style:{height:600}},'Saved scrollable content')));
}
window.unavailableCalls=0;
const app=h(App);
createRoot(document.getElementById('root')).render(new URLSearchParams(location.search).has('portal')?h(OverlayProvider,{shell:PortalShell},app):app);`,
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
      '<!doctype html><html lang="en" data-ds-theme-source="host"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Private UI interactions</title></head><body style="margin:0"><div id="root"></div><script src="page.js"></script></body></html>',
    )
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const url = pathToFileURL(path.join(directory, 'index.html')).href
    await page.goto(url)

    await t.test('manual Tabs enter their panel and re-enter on the selected tab', async () => {
      const list = page.getByRole('tablist', { name: 'Saved report sections' })
      const summary = list.getByRole('tab', { name: 'Summary' })
      const details = list.getByRole('tab', { name: 'Details' })
      await page.locator('#before').focus()
      await page.keyboard.press('Tab')
      assert.equal(await summary.evaluate((node) => node === document.activeElement), true)
      await page.keyboard.press('ArrowRight')
      assert.equal(await details.evaluate((node) => node === document.activeElement), true)
      assert.equal(await summary.getAttribute('aria-selected'), 'true')
      await page.keyboard.press('Tab')
      const panel = page.getByRole('tabpanel', { name: 'Summary' })
      assert.equal(await panel.evaluate((node) => node === document.activeElement), true)
      await page.keyboard.press('Shift+Tab')
      assert.equal(await summary.evaluate((node) => node === document.activeElement), true)
      await page.keyboard.press('End')
      await page.keyboard.press('Space')
      assert.equal(await details.getAttribute('aria-selected'), 'true')
      await page.keyboard.press('Tab')
      await page.keyboard.press('Tab')
      assert.equal(
        await page.locator('#after').evaluate((node) => node === document.activeElement),
        true,
      )
      assert.equal(await page.locator('[role=tabpanel][hidden]').getAttribute('tabindex'), '-1')
    })

    await t.test(
      'Tooltip remains hoverable, dismisses on Escape, and preserves descriptions',
      async () => {
        const trigger = page.getByRole('button', { name: 'Tip trigger', exact: true })
        const description = await trigger.getAttribute('aria-describedby')
        assert.match(description ?? '', /^extra-description mv-tip-/)
        const tooltip = trigger.locator('..').getByRole('tooltip')
        await page.locator('#before').focus()
        await trigger.hover()
        await tooltip.waitFor({ state: 'visible' })
        const box = await tooltip.boundingBox()
        const triggerBox = await trigger.boundingBox()
        assert.ok(box)
        assert.ok(triggerBox)
        assert.ok(box.x >= 8 && box.y >= triggerBox.y + triggerBox.height)
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
        // The trigger-to-popup grace period must not close a hovered popup.
        await page.waitForTimeout(200)
        assert.equal(await tooltip.isVisible(), true)
        await page.keyboard.press('Escape')
        await tooltip.waitFor({ state: 'hidden' })
        assert.equal(
          await page.locator('#before').evaluate((node) => node === document.activeElement),
          true,
        )
        await trigger.focus()
        await tooltip.waitFor({ state: 'visible' })
        await page.keyboard.press('Escape')
        await tooltip.waitFor({ state: 'hidden' })
        assert.equal(await trigger.evaluate((node) => node === document.activeElement), true)
        await page.keyboard.press('Tab')
        const unavailable = page.getByRole('button', { name: 'Unavailable source' })
        assert.equal(await unavailable.evaluate((node) => node === document.activeElement), true)
        await unavailable.press('Enter')
        assert.equal(await page.evaluate(() => Reflect.get(window, 'unavailableCalls')), 0)
        await page.locator('#before').focus()
        assert.equal(await unavailable.locator('..').getByRole('tooltip').isVisible(), false)
      },
    )

    for (const portal of [false, true]) {
      await t.test(
        `Tooltip escapes scroll clipping inside ${portal ? 'portal adapter' : 'native'} modal`,
        async () => {
          await page.goto(portal ? `${url}?portal` : url)
          await page.setViewportSize({ width: 390, height: 844 })
          const opener = page.getByRole('button', { name: 'Open details', exact: true })
          await opener.click()
          const dialog = page.getByRole('dialog', { name: 'Saved details', exact: true })
          await dialog.waitFor()
          const trigger = dialog.getByRole('button', { name: 'Dialog metadata' })
          await trigger.focus()
          const tooltip = trigger.locator('..').getByRole('tooltip')
          await tooltip.waitFor({ state: 'visible' })
          assert.equal(
            await tooltip.evaluate((node) => {
              const rect = node.getBoundingClientRect()
              return (
                node.matches(':popover-open') &&
                rect.left >= 8 &&
                rect.right <= document.documentElement.clientWidth - 8 &&
                rect.top >= 8 &&
                rect.bottom <= document.documentElement.clientHeight - 8 &&
                node.contains(document.elementFromPoint(rect.left + 2, rect.top + rect.height / 2))
              )
            }),
            true,
          )
          await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', ''))
          assert.equal(
            await tooltip.evaluate((node) => getComputedStyle(node).backgroundColor),
            'rgb(28, 28, 31)',
          )
          await dialog.locator('.mv-dialog-body').evaluate((node) => {
            node.scrollTop = 16
          })
          assert.equal(await tooltip.isVisible(), true)
          await dialog.locator('.mv-dialog-body').evaluate((node) => {
            node.scrollTop = 200
          })
          await tooltip.waitFor({ state: 'hidden' })
          assert.equal(await dialog.isVisible(), true)
          await dialog.locator('.mv-dialog-body').evaluate((node) => {
            node.scrollTop = 0
          })
          await dialog.getByRole('button', { name: 'Close details', exact: true }).focus()
          await trigger.focus()
          await tooltip.waitFor({ state: 'visible' })
          await page.keyboard.press('Escape')
          await tooltip.waitFor({ state: 'hidden' })
          assert.equal(await dialog.isVisible(), true)
          assert.equal(await trigger.evaluate((node) => node === document.activeElement), true)
          await page.keyboard.press('Escape')
          await dialog.waitFor({ state: 'hidden' })
          assert.equal(await opener.evaluate((node) => node === document.activeElement), true)
        },
      )
    }
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
    await rm(directory, { recursive: true, force: true })
  }
})
