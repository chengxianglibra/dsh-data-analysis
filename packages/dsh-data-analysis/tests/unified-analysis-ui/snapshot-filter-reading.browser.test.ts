import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { datasetSnapshot } from './dataset-fixtures.ts'

test('official OpenUI selections drive shared saved views and survive reader moves', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-openui-selection-'))
  const browser = await chromium.launch()
  try {
    const snapshot = datasetSnapshot(
      [
        ['A', '2026-11-12', '1'],
        ['B', '2026-11-13', '2'],
        ['A', '2026-11-13', '3'],
      ],
      [
        { id: 'category', label: 'Category', type: 'string', nullable: false },
        { id: 'day', label: 'Day', type: 'string', nullable: false },
        { id: 'value', label: 'Value', type: 'decimal', nullable: false },
      ],
    )
    const program = `$region = "a";
$group = {};
$period = null;
root = Stack([single, multi, multiApply, date, dateApply, dateClear, dateRestore, first, second]);
single = Select("region", @Each($source_6_region_options, "i", SelectItem(i.id, i.label)), null, null, $region);
multi = CheckBoxGroup("group", @Each($source_5_group_options, "i", CheckBoxItem(i.label, "", i.id)), null, $source_5_group_draft);
multiApply = Button("Apply group", @Set($group, @SelectionOrCurrent($group, $source_5_group_draft, $source_5_group_options, "multiple", false)));
date = DatePicker("period", "range", null, $source_6_period_draft);
dateApply = Button("Apply date", @Set($period, @SelectionOrCurrent($period, $source_6_period_draft, $source_6_period_options, "date-range", true)));
dateClear = Button("Clear date", Action([@Set($period, {}), @Set($source_6_period_draft, {})]));
dateRestore = Button("Restore date", Action([@Set($period, $source_6_period_default), @Set($source_6_period_draft, $source_6_period_default)]));
first = DatasetView("data", {chart:"table"}, {title:"First"}, [{source:"region",selection:$region},{source:"group",selection:$group},{source:"period",selection:$period}]);
second = DatasetView("data", {chart:"table"}, {title:"Second"}, [{source:"region",selection:$region},{source:"group",selection:$group},{source:"period",selection:$period}]);`
    const sources = {
      region: { ref: 'data', field: { kind: 'column', name: 'category' }, label: 'Region' },
      group: {
        ref: 'data',
        field: { kind: 'column', name: 'category' },
        mode: 'multiple',
        defaultValues: ['A'],
        options: { allowAll: false },
      },
      period: {
        ref: 'data',
        field: { kind: 'column', name: 'day' },
        mode: 'date-range',
        defaultValues: ['2026-11-13', '2026-11-13'],
      },
    }
    await build({
      stdin: {
        resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
        loader: 'tsx',
        contents: `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { AnalysisRenderer } from './src/client/analysis-ui/surface.tsx';
import { ReportReading } from './src/client/analysis-ui/reading-state.tsx';
const program=${JSON.stringify(program)}, sources=${JSON.stringify(sources)};
const resource={kind:'snapshot',snapshot:${JSON.stringify(snapshot)},declaration:{kind:'dataset-snapshot',snapshotRef:'ref'},binding:{workspaceId:'workspace'}};
const readings=[{tabs:new Map(),accordions:new Map(),tables:new Map(),scroll:new Map()},{tabs:new Map(),accordions:new Map(),tables:new Map(),scroll:new Map()}];
const root=createRoot(document.getElementById('root')); let owner=0, host=0, build='one';
function render(){root.render(<ReportReading.Provider value={readings[owner]}><AnalysisRenderer key={host} program={program} title="Test" locale="en-US" resources={{data:resource}} selectionSources={sources} recordId={build}/></ReportReading.Provider>)}
window.change=(name)=>{if(name==='move')host++; if(name==='other'){owner=1;host++} if(name==='original'){owner=0;host++} if(name==='build'){build='two';host++} render()}; render();`,
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
    // A tall viewport puts the calendar below the trigger, where it would
    // otherwise overlap the next action in the vertical report layout.
    await page.setViewportSize({ width: 1280, height: 1200 })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(pathToFileURL(path.join(directory, 'index.html')).href)
    await page.getByRole('button', { name: 'Apply group' }).waitFor()
    assert.deepEqual(await page.locator('tbody tr[data-row-index]').allTextContents(), [
      'A2026-11-133',
      'A2026-11-133',
    ])
    await page.locator('.openui-date-picker-renderer-floating-input-container').click()
    await page
      .locator('.openui-date-picker-renderer-floating-content')
      .locator('button')
      .filter({ hasText: /^12$/ })
      .click()
    assert.equal(
      await page.locator('.openui-date-picker-renderer-floating-content').isVisible(),
      true,
    )
    await page
      .locator('.openui-date-picker-renderer-floating-content')
      .locator('button')
      .filter({ hasText: /^13$/ })
      .click()
    await page.locator('.openui-date-picker-renderer-floating-content').waitFor({ state: 'hidden' })
    await page.waitForFunction(() => {
      const text = document.querySelector(
        '.openui-date-picker-renderer-floating-input-container-text',
      )?.textContent
      return text?.includes('Nov 12, 2026') && text.includes('Nov 13, 2026')
    })
    await page.getByRole('button', { name: 'Apply date' }).click()
    await page.waitForFunction(
      () => document.querySelectorAll('tbody tr[data-row-index]').length === 4,
    )
    assert.deepEqual(await page.locator('tbody tr[data-row-index]').allTextContents(), [
      'A2026-11-121',
      'A2026-11-133',
      'A2026-11-121',
      'A2026-11-133',
    ])
    // Begin after the existing range, then finish before it: both endpoints
    // must come from this open session, including a reverse selection.
    await page.locator('.openui-date-picker-renderer-floating-input-container').click()
    for (const day of ['14', '12'])
      await page
        .locator('.openui-date-picker-renderer-floating-content button')
        .filter({ hasText: new RegExp(`^${day}$`) })
        .click()
    await page.locator('.openui-date-picker-renderer-floating-content').waitFor({ state: 'hidden' })
    assert.match(
      (await page.locator('.openui-date-picker-renderer-floating-input-container').textContent()) ??
        '',
      /Nov 12, 2026.*Nov 14, 2026/,
    )
    await page.getByRole('button', { name: 'Apply date' }).click()
    await page.waitForFunction(
      () => document.querySelectorAll('tbody tr[data-row-index]').length === 4,
    )
    await page.getByRole('button', { name: 'Clear date' }).click()
    assert.match(
      (await page.locator('.openui-date-picker-renderer-floating-input-container').textContent()) ??
        '',
      /Select a range/,
    )
    await page.getByRole('button', { name: 'Restore date' }).click()
    assert.deepEqual(await page.locator('tbody tr[data-row-index]').allTextContents(), [
      'A2026-11-133',
      'A2026-11-133',
    ])
    // The official calendar may flip at a narrow viewport; its portal must
    // still leave the following action clickable at increased page zoom.
    await page.setViewportSize({ width: 390, height: 900 })
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '12px'
      document.body.style.zoom = '1.25'
    })
    await page.locator('.openui-date-picker-renderer-floating-input-container').click()
    await page.locator('.openui-date-picker-renderer-floating-input-container').click()
    await page.locator('.openui-date-picker-renderer-floating-input-container').click()
    await page
      .locator('.openui-date-picker-renderer-floating-content')
      .locator('button')
      .filter({ hasText: /^12$/ })
      .click()
    await page
      .locator('.openui-date-picker-renderer-floating-content')
      .locator('button')
      .filter({ hasText: /^12$/ })
      .click()
    await page.locator('.openui-date-picker-renderer-floating-content').waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: 'Apply date' }).click()
    await page.waitForFunction(
      () => document.querySelectorAll('tbody tr[data-row-index]').length === 2,
    )
    assert.deepEqual(await page.locator('tbody tr[data-row-index]').allTextContents(), [
      'A2026-11-121',
      'A2026-11-121',
    ])
    await page.locator('.openui-date-picker-renderer-floating-input-container').click()
    await page
      .locator('.openui-date-picker-renderer-floating-content')
      .locator('button')
      .filter({ hasText: /^12$/ })
      .click()
    await page
      .locator('.openui-date-picker-renderer-floating-content')
      .locator('button')
      .filter({ hasText: /^13$/ })
      .click()
    await page.locator('.openui-date-picker-renderer-floating-content').waitFor({ state: 'hidden' })
    await page.waitForFunction(() => {
      const text = document.querySelector(
        '.openui-date-picker-renderer-floating-input-container-text',
      )?.textContent
      return text?.includes('Nov 12, 2026') && text.includes('Nov 13, 2026')
    })
    await page.getByRole('button', { name: 'Apply date' }).click()
    await page.waitForFunction(
      () => document.querySelectorAll('tbody tr[data-row-index]').length === 4,
    )
    assert.deepEqual(await page.locator('tbody tr[data-row-index]').allTextContents(), [
      'A2026-11-121',
      'A2026-11-133',
      'A2026-11-121',
      'A2026-11-133',
    ])
    await page.evaluate(() => {
      document.documentElement.style.fontSize = ''
      document.body.style.zoom = ''
    })
    await page.setViewportSize({ width: 1280, height: 1200 })
    const a = page.getByRole('checkbox', { name: '"A"' })
    const b = page.getByRole('checkbox', { name: '"B"' })
    await a.waitFor()
    assert.equal(await a.isChecked(), true)
    await a.uncheck()
    await page.getByRole('button', { name: 'Apply group' }).click()
    assert.deepEqual(await page.locator('tbody tr[data-row-index]').allTextContents(), [
      'A2026-11-121',
      'A2026-11-133',
      'A2026-11-121',
      'A2026-11-133',
    ])
    await a.check()
    await b.check()
    await page.getByRole('button', { name: 'Apply group' }).click()
    const select = page.getByRole('combobox').first()
    await select.click()
    await page.getByRole('option', { name: '"B"' }).click()
    assert.equal(await page.locator('.openui-select-trigger').first().textContent(), '"B"')
    assert.deepEqual(await page.locator('tbody tr[data-row-index]').allTextContents(), [
      'B2026-11-132',
      'B2026-11-132',
    ])
    await select.click()
    const portal = page.locator('.openui-select-content')
    await portal.waitFor()
    const themeValue = () =>
      portal.evaluate((node) =>
        getComputedStyle(node).getPropertyValue('--openui-foreground').trim(),
      )
    const light = await themeValue()
    assert.ok(light)
    await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', ''))
    await page.waitForFunction(
      (previous) =>
        getComputedStyle(document.querySelector('.openui-select-content')!)
          .getPropertyValue('--openui-foreground')
          .trim() !== previous,
      light,
    )
    const dark = await themeValue()
    assert.equal(
      dark,
      await page
        .locator('article[data-openui-scope]')
        .evaluate((node) => getComputedStyle(node).getPropertyValue('--openui-foreground').trim()),
    )
    assert.equal(await page.locator('.openui-select-trigger').first().textContent(), '"B"')
    await page.evaluate(() => document.body.removeAttribute('data-ds-dark-theme'))
    await page.waitForFunction(
      (expected) =>
        getComputedStyle(document.querySelector('.openui-select-content')!)
          .getPropertyValue('--openui-foreground')
          .trim() === expected,
      light,
    )
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.waitForFunction(
      (expected) =>
        getComputedStyle(document.querySelector('.openui-select-content')!)
          .getPropertyValue('--openui-foreground')
          .trim() === expected,
      dark,
    )
    await page.emulateMedia({ colorScheme: 'light' })
    await page.waitForFunction(
      (expected) =>
        getComputedStyle(document.querySelector('.openui-select-content')!)
          .getPropertyValue('--openui-foreground')
          .trim() === expected,
      light,
    )
    await page.keyboard.press('Escape')
    assert.equal(await select.textContent(), '"B"')
    await page.evaluate(() => Reflect.get(window, 'change')('move'))
    await page.getByRole('button', { name: 'Apply group' }).waitFor()
    assert.equal(await page.getByRole('checkbox', { name: '"B"' }).isChecked(), true)
    assert.equal(await page.getByRole('combobox').first().textContent(), '"B"')
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('single date picker follows OpenUI clear and reset after a selection', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-single-date-'))
  const browser = await chromium.launch()
  try {
    const program = `$chosen = null;
root = Stack([date, clear, reset, status]);
date = DatePicker("chosen", "single", null, $chosen);
clear = Button("Clear single", @Set($chosen, null));
reset = Button("Reset single", @Reset($chosen));
status = TextContent($chosen == null ? "No date" : "Date selected");`
    await build({
      stdin: {
        resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
        loader: 'tsx',
        contents: `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { AnalysisRenderer } from './src/client/analysis-ui/surface.tsx';
createRoot(document.getElementById('root')).render(<AnalysisRenderer program={${JSON.stringify(program)}} title="Single date" locale="en-US" resources={{}} />);`,
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
    const trigger = page.locator('.openui-date-picker-renderer-floating-input-container')
    await trigger.waitFor()
    assert.match((await trigger.textContent()) ?? '', /Select a date/)
    const choose = async (day: string) => {
      await trigger.click()
      await page
        .locator('.openui-date-picker-renderer-floating-content button')
        .filter({ hasText: new RegExp(`^${day}$`) })
        .click()
      await page.getByText('Date selected', { exact: true }).waitFor()
      assert.match((await trigger.textContent()) ?? '', new RegExp(`\\b${day},`))
    }
    await choose('12')
    await page.getByRole('button', { name: 'Clear single' }).click()
    await page.getByText('No date', { exact: true }).waitFor()
    assert.match((await trigger.textContent()) ?? '', /Select a date/)
    await choose('13')
    await page.getByRole('button', { name: 'Reset single' }).click()
    await page.getByText('No date', { exact: true }).waitFor()
    assert.match((await trigger.textContent()) ?? '', /Select a date/)
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
    await rm(directory, { recursive: true, force: true })
  }
})
