import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { object, snapshot } from '../semantic-browser/fixtures.ts'

test('business surfaces preserve report filters, semantic reading and settings revisions', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-shadcn-business-'))
  const browser = await chromium.launch()
  try {
    const catalog = snapshot('workspace', [object(), object('region', 'dimension')])
    await build({
      stdin: {
        contents: `import {createElement as h} from 'react';
import {createRoot} from 'react-dom/client';
import {ReportCopyProvider} from './src/client/i18n/context.tsx';
import {ReportCatalogView,catalogStyles} from './src/client/presentation/catalog.tsx';
import {SemanticBrowserPanel} from './src/client/semantic-browser/panel.tsx';
import {emptyView} from './src/client/semantic-browser/model.ts';
import {PythonSettingsCard} from './src/client/settings/card.tsx';
import {UIStyleSheet} from './src/client/ui/theme.ts';
const store = value => {let current=value;const listeners=new Set();return {getSnapshot:()=>current,subscribe:listener=>{listeners.add(listener);return ()=>listeners.delete(listener)},update:fn=>{current=fn(current);listeners.forEach(fn=>fn())},patch(change){this.update(value=>({...value,...change}))}}};
window.saved={};
const report=title=>({receipt:{reportId:title,title},source:{sessionId:'session',surface:title==='Tool result'?'tool':'tab'},publishedAt:'2026-11-03T00:00:00Z'});
const reports=store({workspaceId:'workspace',query:'',surface:'tab',loading:false,catalog:{reports:[report('Revenue report'),report('Tool result')],unavailable:0}});
const semantics=store({open:true,workspaceId:'workspace',views:{workspace:{...emptyView(),snapshot:${JSON.stringify(catalog)},selected:'metric:sales.revenue'}}});
const semanticModel={...semantics,patch(change){semantics.update(state=>({...state,views:{workspace:{...state.views.workspace,...change}}}))},navigate(selected){this.patch({selected})},back(){this.patch({selected:''})},refresh:async()=>{},unavailable:()=>{}};
const settings=store({status:'ready',value:{pythonTimeoutMs:180000},user:{},base:{},revision:7,writable:true});
settings.mutate=async(ops,revision)=>{window.saved.settings={ops,revision};settings.patch({value:{pythonTimeoutMs:ops[0].value},user:{pythonTimeoutMs:ops[0].value},revision:8});return true};
createRoot(document.getElementById('root')).render(h(ReportCopyProvider,{locale:'en-US'},h('main',{className:'mv-ui bg-background'},h(UIStyleSheet),h('style',null,catalogStyles),h('section',{id:'reports'},h(ReportCatalogView,{model:reports,reader:{showReport:(_workspace,id)=>{window.saved.report=id}},sessions:{session:{displayTitle:'Source session'}},onOpenSession:id=>{window.saved.session=id}})),h('section',{id:'semantics'},h(SemanticBrowserPanel,{model:semanticModel,workspaces:[{workspaceId:'workspace'}]})),h('ul',{id:'settings'},h(PythonSettingsCard,{scope:settings})))));`,
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
      '<!doctype html><html data-ds-theme-source="host"><head><title>Business surfaces</title></head><body><div id="root"></div><script src="page.js"></script></body></html>',
    )
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await page.goto(pathToFileURL(path.join(directory, 'index.html')).href)
    assert.equal(await page.title(), 'Business surfaces')
    const reports = page.locator('#reports')
    await reports.getByRole('button', { name: 'Revenue report', exact: true }).click()
    assert.equal(await page.evaluate(() => Reflect.get(window, 'saved').report), 'Revenue report')
    assert.equal(await reports.getByRole('combobox').count(), 0)
    assert.equal(await reports.getByRole('button', { name: 'Tool result', exact: true }).count(), 1)
    await reports.getByRole('searchbox').fill('no match')
    await reports.getByText('No reports match this title.').waitFor()
    const semantic = page.locator('#semantics')
    const definition = semantic.getByRole('tab', { name: 'Definition', exact: true })
    await semantic.getByRole('tab', { name: 'Overview', exact: true }).focus()
    await page.keyboard.press('ArrowRight')
    await page.waitForFunction(
      (id) => document.activeElement?.id === id,
      await definition.getAttribute('id'),
    )
    assert.equal(await definition.evaluate((node) => node === document.activeElement), true)
    assert.equal(await definition.getAttribute('aria-selected'), 'false')
    await page.keyboard.press('Enter')
    assert.equal(await definition.getAttribute('aria-selected'), 'true')
    await semantic.getByRole('tab', { name: 'Relationships', exact: true }).click()
    assert.equal(await semantic.getByRole('tabpanel').count(), 1)
    await semantic.getByText('No relationships declared.').waitFor()
    assert.equal(await semantic.getByRole('button', { name: 'View graph', exact: true }).count(), 0)
    const settings = page.locator('#settings')
    await settings.getByRole('button', { name: /^Expand settings:/ }).click()
    await settings.getByRole('spinbutton').fill('12.345')
    await settings.getByRole('button', { name: 'Save', exact: true }).click()
    await page.waitForFunction(() => Reflect.get(window, 'saved').settings)
    assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'saved').settings), {
      ops: [{ op: 'set', path: ['pythonTimeoutMs'], value: 12345 }],
      revision: 7,
    })
    await settings.getByRole('button', { name: /^Expand settings:/ }).click()
    for (const width of [1100, 420]) {
      if (width === 420)
        await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', ''))
      await page.setViewportSize({ width, height: 900 })
      for (const selector of ['#reports', '#semantics', '#settings']) {
        assert.equal(
          await page.locator(selector).evaluate((node) => node.scrollWidth <= node.clientWidth),
          true,
          `${selector} must contain its scrolling at ${width}px`,
        )
      }
      const evidence = process.env.MARIVO_SURFACES_EVIDENCE
      if (evidence) {
        await mkdir(evidence, { recursive: true })
        await page.screenshot({
          path: path.join(evidence, `business-${width}.png`),
          fullPage: true,
        })
      }
    }
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
    await rm(directory, { recursive: true, force: true })
  }
})
