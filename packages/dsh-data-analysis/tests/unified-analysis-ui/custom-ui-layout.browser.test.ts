import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

test('private layout preserves manual Tabs, reading state, and container reflow', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-custom-ui-'))
  const browser = await chromium.launch()
  try {
    await build({
      stdin: {
        contents: `import {createElement as h, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AnalysisRenderer} from './src/client/analysis-ui/surface.tsx';
import {Tabs} from './src/client/ui/tabs.tsx';
import {UI_STYLES} from './src/client/ui/theme.ts';
import {IconButton} from './src/client/ui/controls.tsx';
import {DetailsDialog} from './src/client/ui/overlays.tsx';
const program = 'root = Stack([tabs,row]);\\ntabs = Tabs([a,b]);\\na = TabItem("a","Alpha",[TextContent("Alpha content")]);\\nb = TabItem("b","Beta",[TextContent("Beta content")]);\\nrow = Stack([Card([TextContent("Long saved business label that wraps across narrow cards")]),Card([TextContent("Second card")])],"row","m","stretch","start",true);';
function App(){
 const [build,setBuild] = useState('build-1'),[locale,setLocale]=useState('en-US'),[open,setOpen]=useState(false);
 return h('div',{className:'mv-ui'},h('style',null,UI_STYLES),
  h('button',{onClick:()=>setBuild('build-2')},'Next build'),h('button',{onClick:()=>setLocale('zh-CN')},'Switch locale'),
  h('div',{id:'report',style:{width:320,maxWidth:'100%'}},h(AnalysisRenderer,{program,title:'A long saved report title / 已保存的完整分析标题与业务范围',locale,resources:{},recordId:build})),
  h(Tabs,{items:[{value:'a',trigger:'Reading',content:h('input',{'aria-label':'Reading state',defaultValue:'saved'})},{value:'b',trigger:'Other',content:h('p',null,'Other panel')}]}),
  h(IconButton,{label:'Unavailable source',tip:'Source was not captured',unavailable:true,onClick:()=>{throw Error('Unavailable executed')}},'i'),
  h(IconButton,{label:'Open details',onClick:()=>setOpen(true)},'i'),
  h(DetailsDialog,{title:'Saved details',open,onClose:()=>setOpen(false),closeLabel:'Close details'},h('p',null,'Saved immutable data')));
}
createRoot(document.getElementById('root')).render(h(App));`,
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
      '<!doctype html><html data-ds-theme-source="host"><head></head><body><div id="root"></div><script src="page.js"></script></body></html>',
    )
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      colorScheme: 'dark',
    })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(pathToFileURL(path.join(directory, 'index.html')).href)
    const report = page.locator('#report')
    const alpha = report.getByRole('tab', { name: 'Alpha' })
    const beta = report.getByRole('tab', { name: 'Beta' })
    await alpha.focus()
    await page.keyboard.press('ArrowRight')
    assert.equal(await beta.evaluate((node) => node === document.activeElement), true)
    assert.equal(await alpha.getAttribute('aria-selected'), 'true')
    await page.keyboard.press('Enter')
    assert.equal(await beta.getAttribute('aria-selected'), 'true')
    await page.keyboard.press('Home')
    assert.equal(await alpha.evaluate((node) => node === document.activeElement), true)
    assert.equal(await beta.getAttribute('aria-selected'), 'true')
    await page.keyboard.press('Space')
    assert.equal(await alpha.getAttribute('aria-selected'), 'true')
    const panelId = await alpha.getAttribute('aria-controls')
    assert.ok(panelId)
    assert.equal(
      await page.locator(`#${panelId}`).getAttribute('aria-labelledby'),
      await alpha.getAttribute('id'),
    )
    assert.equal(await report.locator('[role=tab][tabindex="0"]').count(), 1)
    await beta.click()
    await page.getByRole('button', { name: 'Switch locale' }).click()
    assert.equal(await beta.getAttribute('aria-selected'), 'true')
    await page.getByRole('button', { name: 'Next build' }).click()
    assert.equal(await alpha.getAttribute('aria-selected'), 'true')
    await page.getByRole('textbox', { name: 'Reading state' }).fill('kept across panels')
    await page.getByRole('tab', { name: 'Other', exact: true }).click()
    await page.getByRole('tab', { name: 'Reading', exact: true }).click()
    assert.equal(
      await page.getByRole('textbox', { name: 'Reading state' }).inputValue(),
      'kept across panels',
    )
    assert.equal(
      await report
        .locator('.au-card')
        .first()
        .evaluate((node) => getComputedStyle(node).padding),
      '12px',
    )
    assert.equal(
      await report
        .locator('.au-surface-content')
        .evaluate((node) => getComputedStyle(node).padding),
      '10px',
    )
    assert.equal(await report.evaluate((node) => node.scrollWidth <= node.clientWidth), true)
    for (const width of [480, 720, 1360]) {
      await report.evaluate((node, size) => {
        node.style.width = `${size}px`
      }, width)
      assert.equal(await report.evaluate((node) => node.scrollWidth <= node.clientWidth), true)
      assert.equal(
        await report
          .locator('.au-surface-content')
          .evaluate((node) => getComputedStyle(node).padding),
        '16px',
      )
    }
    const tabIds = await page
      .locator('[role=tab]')
      .evaluateAll((nodes) => nodes.map((node) => node.id))
    assert.equal(new Set(tabIds).size, tabIds.length)
    const unavailable = page.getByRole('button', { name: 'Unavailable source' })
    await unavailable.focus()
    assert.equal(await unavailable.getAttribute('aria-disabled'), 'true')
    await page
      .getByRole('tooltip', { name: 'Source was not captured' })
      .waitFor({ state: 'visible' })
    await unavailable.press('Enter')
    const opener = page.getByRole('button', { name: 'Open details' })
    await opener.click()
    const dialog = page.getByRole('dialog', { name: 'Saved details' })
    await dialog.waitFor()
    const outsideInput = page.locator('input[aria-label="Reading state"]')
    await outsideInput.evaluate((node) => node.focus())
    assert.equal(await outsideInput.evaluate((node) => node === document.activeElement), false)
    assert.equal(
      await dialog
        .locator('.mv-dialog-content')
        .evaluate((node) => getComputedStyle(node).backgroundColor),
      'rgb(255, 255, 255)',
    )
    await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', ''))
    await page.waitForFunction(
      () =>
        getComputedStyle(document.querySelector('.mv-dialog-content')!).backgroundColor ===
        'rgb(28, 28, 31)',
    )
    assert.equal(
      await page.getByRole('textbox', { name: 'Reading state' }).inputValue(),
      'kept across panels',
    )
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(await opener.evaluate((node) => node === document.activeElement), true)
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
    await rm(directory, { recursive: true, force: true })
  }
})
