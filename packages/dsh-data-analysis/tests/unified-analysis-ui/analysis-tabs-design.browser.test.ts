import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

test('report tabs use an adaptive underline and retain manual keyboard activation', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-report-tabs-'))
  const browser = await chromium.launch()
  try {
    await build({
      stdin: {
        contents: `import {createElement as h} from 'react';
import {createRoot} from 'react-dom/client';
import {AnalysisRenderer} from './src/client/analysis-ui/surface.tsx';
const program = 'root = Tabs([a,b,c,d,e]);\\na = TabItem("a","概览",[TextContent("概览内容")]);\\nb = TabItem("b","时间结构",[TextContent("时间内容")]);\\nc = TabItem("c","支付与空间",[TextContent("支付内容")]);\\nd = TabItem("d","与 5 月对比",[TextContent("比较内容")]);\\ne = TabItem("e","归因与关系",[TextContent("归因内容")]);';
createRoot(document.getElementById('root')).render(h(AnalysisRenderer,{program,title:'报告',locale:'zh-CN',resources:{},recordId:'test'}));`,
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
      '<!doctype html><div id="root"></div><script src="page.js"></script>',
    )
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
    await page.goto(pathToFileURL(path.join(directory, 'index.html')).href)
    const tabs = page.getByRole('tablist')
    const first = page.getByRole('tab', { name: '概览' })
    const last = page.getByRole('tab', { name: '归因与关系' })
    assert.equal(
      await tabs.evaluate((node) => getComputedStyle(node).backgroundColor),
      'rgba(0, 0, 0, 0)',
    )
    assert.equal(await first.evaluate((node) => getComputedStyle(node).borderBottomWidth), '2px')
    assert.notEqual(
      await first.evaluate((node) => getComputedStyle(node).borderBottomColor),
      'rgba(0, 0, 0, 0)',
    )
    await page.setViewportSize({ width: 360, height: 850 })
    assert.ok(await tabs.evaluate((node) => node.scrollWidth > node.clientWidth))
    await first.focus()
    await page.keyboard.press('End')
    // Radix applies roving focus after the key event; observe the settled target.
    await page.waitForFunction(() => document.activeElement?.textContent === '归因与关系')
    assert.equal(await first.getAttribute('aria-selected'), 'true')
    assert.equal(await last.evaluate((node) => node === document.activeElement), true)
    const visibility = await last.evaluate((node) => {
      const list = node.parentElement!.getBoundingClientRect()
      const box = node.getBoundingClientRect()
      return {
        left: box.left - list.left,
        right: box.right - list.right,
        outline: getComputedStyle(node).outlineStyle,
      }
    })
    assert.ok(visibility.left >= -1 && visibility.right <= 1)
    assert.notEqual(visibility.outline, 'none')
    await page.keyboard.press('Enter')
    assert.equal(await last.getAttribute('aria-selected'), 'true')
    assert.equal(await page.getByText('归因内容').isVisible(), true)
    assert.ok(
      (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1,
    )
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.waitForFunction(() => {
      const selected = document.querySelector<HTMLElement>(
        '.au-surface [role=tab][aria-selected=true]',
      )
      return (
        !!selected &&
        getComputedStyle(selected).colorScheme === 'dark' &&
        getComputedStyle(selected).color === 'rgb(101, 206, 176)'
      )
    })
  } finally {
    await browser.close()
    await rm(directory, { recursive: true, force: true })
  }
})
