import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

test('dashboard sections remain keyboard accessible and retain reading state after remount', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-accordion-'))
  const browser = await chromium.launch()
  try {
    await build({
      stdin: {
        contents: `import {createElement as h, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {DashboardAccordion, DashboardTextCallout, DASHBOARD_COMPONENT_STYLES} from './src/client/analysis-ui/dashboard-components.tsx';
import {ReportReading} from './src/client/analysis-ui/reading-state.tsx';
const reading={tabs:new Map(),accordions:new Map(),tables:new Map(),scroll:new Map()};
function App(){
 const [generation,setGeneration]=useState(0),[reverse,setReverse]=useState(false);
 const items=[{value:'a',trigger:'Details',content:h('input',{'aria-label':'Notes',defaultValue:'saved'})},{value:'b',trigger:'Method',content:h('p',null,'Method content')}];
 return h('div',{className:'au-surface',style:{'--mv-accent':'rgb(20, 40, 60)','--mv-success':'rgb(10, 90, 20)','--mv-warning':'rgb(180, 90, 10)','--chart-1':'rgb(220, 0, 0)','--chart-2':'rgb(220, 0, 0)','--chart-3':'rgb(220, 0, 0)'}},h('style',null,DASHBOARD_COMPONENT_STYLES),
   h('button',{onClick:()=>setGeneration(v=>v+1)},'Remount'),h('button',{onClick:()=>setReverse(v=>!v)},'Reorder'),
   h(ReportReading.Provider,{value:reading},h(DashboardAccordion,{key:generation,statementId:'section',items:reverse?items.reverse():items})),
   h(ReportReading.Provider,{value:reading},h('div',{key:generation},
     h(DashboardAccordion,{items:[{value:'x',trigger:'Inline one',content:h('p',null,'One')}]}),
     h(DashboardAccordion,{items:[{value:'x',trigger:'Inline two',content:h('p',null,'Two')}]}))),
   h(DashboardTextCallout,{variant:'warning',title:'Scope',description:'Captured snapshot'}),
   h(DashboardTextCallout,{variant:'success',title:'Ready'}),h(DashboardTextCallout,{variant:'info',title:'Context'}),
   h('div',{id:'narrow',style:{width:320,maxWidth:'100%'}},
     h(DashboardTextCallout,{title:'UnbrokenCalloutTitle'.repeat(10)}),
     h(DashboardAccordion,{items:[{value:'long',trigger:'UnbrokenAccordionTitle'.repeat(10),content:h('p',null,'Extra')}]})));
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
      '<!doctype html><html><body><div id="root"></div><script src="page.js"></script></body></html>',
    )
    const page = await browser.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(pathToFileURL(path.join(directory, 'index.html')).href)
    const details = page.getByRole('button', { name: 'Details' })
    const method = page.getByRole('button', { name: 'Method' })
    assert.equal(await details.getAttribute('aria-expanded'), 'false')
    assert.equal(await page.getByRole('textbox', { name: 'Notes' }).count(), 0)
    assert.equal(
      await page.locator('input[aria-label="Notes"]').evaluate((node: HTMLElement) => {
        node.focus()
        return document.activeElement === node
      }),
      false,
    )
    await details.focus()
    await page.keyboard.press('Enter')
    assert.equal(await details.getAttribute('aria-expanded'), 'true')
    const contentId = await details.getAttribute('aria-controls')
    assert.ok(contentId)
    assert.equal(
      await page.locator(`[id="${contentId}"]`).getAttribute('aria-labelledby'),
      await details.getAttribute('id'),
    )
    await page.getByRole('textbox', { name: 'Notes' }).fill('reading state')
    await method.focus()
    await page.keyboard.press('Space')
    assert.equal(await details.getAttribute('aria-expanded'), 'false')
    assert.equal(await page.getByRole('textbox', { name: 'Notes' }).count(), 0)
    await details.click()
    assert.equal(await page.getByRole('textbox', { name: 'Notes' }).inputValue(), 'reading state')
    await page.getByRole('button', { name: 'Reorder' }).click()
    assert.equal(await details.getAttribute('aria-expanded'), 'true')
    await page.getByRole('button', { name: 'Inline one' }).click()
    assert.equal(
      await page.getByRole('button', { name: 'Inline two' }).getAttribute('aria-expanded'),
      'false',
    )
    await page.getByRole('button', { name: 'Remount' }).click()
    assert.equal(await details.getAttribute('aria-expanded'), 'true')
    assert.equal(
      await page.getByRole('button', { name: 'Inline one' }).getAttribute('aria-expanded'),
      'false',
    )
    assert.equal(
      await page.getByRole('button', { name: 'Inline two' }).getAttribute('aria-expanded'),
      'false',
    )
    assert.equal(await page.locator('.au-callout').first().getAttribute('data-variant'), 'warning')
    assert.equal(await page.locator('.au-callout').first().innerText(), 'Scope\nCaptured snapshot')
    const statusBorders = () =>
      page
        .locator('.au-callout[data-variant]')
        .evaluateAll((nodes) =>
          nodes.slice(0, 3).map((node) => getComputedStyle(node).borderInlineStartColor),
        )
    assert.deepEqual(await statusBorders(), [
      'rgb(180, 90, 10)',
      'rgb(10, 90, 20)',
      'rgb(20, 40, 60)',
    ])
    await page.locator('.au-surface').evaluate((node: HTMLElement) => {
      node.style.setProperty('--chart-1', 'rgb(0, 0, 220)')
      node.style.setProperty('--chart-2', 'rgb(0, 0, 220)')
      node.style.setProperty('--chart-3', 'rgb(0, 0, 220)')
      node.style.setProperty('--mv-warning', 'rgb(210, 140, 30)')
    })
    assert.deepEqual(await statusBorders(), [
      'rgb(210, 140, 30)',
      'rgb(10, 90, 20)',
      'rgb(20, 40, 60)',
    ])
    const narrow = page.locator('#narrow')
    for (const selector of ['', '.au-callout', '.au-callout-title', '.au-accordion-trigger']) {
      const node = selector ? narrow.locator(selector) : narrow
      assert.equal(
        await node.evaluate((element) => element.scrollWidth <= element.clientWidth),
        true,
        `long unbroken title overflows ${selector || 'the narrow container'}`,
      )
    }
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('reused named accordion statements keep independent reading state across updates and remount', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-accordion-reading-'))
  const browser = await chromium.launch()
  try {
    await build({
      stdin: {
        resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
        contents: `import {createElement as h, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AnalysisRenderer} from './src/client/analysis-ui/surface.tsx';
import {ReportReading} from './src/client/analysis-ui/reading-state.tsx';
const reading={tabs:new Map(),accordions:new Map(),tables:new Map(),scroll:new Map()};
function App(){
 const [generation,setGeneration]=useState(0),[reverse,setReverse]=useState(false);
 const order=reverse?'[right,shared,shared,left,Accordion([item]),Accordion([item])]':'[shared,shared,left,right,Accordion([item]),Accordion([item])]';
 const program='root = Stack('+order+');\\nleft = Card([TextContent("Left"), shared]);\\nright = Card([TextContent("Right"), shared]);\\nshared = Accordion([item]);\\nitem = AccordionItem("details", "Details", [TextContent("Saved contents")]);';
 return h('div',null,h('button',{onClick:()=>setGeneration(v=>v+1)},'Remount'),h('button',{onClick:()=>setReverse(v=>!v)},'Reorder'),
 h('section',{key:generation},h(ReportReading.Provider,{value:reading},h(AnalysisRenderer,{program,title:'Dashboard',locale:'en-US',resources:{}}))));
}
createRoot(document.getElementById('root')).render(h(App));`,
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
      '<!doctype html><div id="root"></div><script src="page.js"></script>',
    )
    const page = await browser.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(pathToFileURL(path.join(directory, 'index.html')).href)
    const all = page.getByRole('button', { name: 'Details' })
    const left = page
      .locator('.au-card-scope')
      .filter({ hasText: 'Left' })
      .getByRole('button', { name: 'Details' })
    const right = page
      .locator('.au-card-scope')
      .filter({ hasText: 'Right' })
      .getByRole('button', { name: 'Details' })
    assert.equal(await all.count(), 6)
    await all.nth(1).click()
    await right.click()
    await all.nth(5).click()
    const assertStates = async () => {
      const standalone = page.locator(
        '.au-stack > .au-accordion > .au-accordion-item > .au-accordion-header > button',
      )
      assert.equal(await standalone.count(), 4)
      assert.equal(await standalone.nth(0).getAttribute('aria-expanded'), 'false')
      assert.equal(await standalone.nth(1).getAttribute('aria-expanded'), 'true')
      assert.equal(await standalone.nth(2).getAttribute('aria-expanded'), 'false')
      assert.equal(await standalone.nth(3).getAttribute('aria-expanded'), 'true')
      assert.equal(await left.getAttribute('aria-expanded'), 'false')
      assert.equal(await right.getAttribute('aria-expanded'), 'true')
    }
    await assertStates()
    await page.getByRole('button', { name: 'Reorder' }).click()
    await assertStates()
    await page.getByRole('button', { name: 'Remount' }).click()
    await assertStates()
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
    await rm(directory, { recursive: true, force: true })
  }
})
