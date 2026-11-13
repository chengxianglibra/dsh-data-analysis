import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { datasetSnapshot } from './dataset-fixtures.ts'

test('filter controls share one Build selection, retain it on move, and reset independently', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-filter-reading-'))
  const browser = await chromium.launch()
  try {
    const snapshot = datasetSnapshot([
      ['A', '1'],
      ['B', '2'],
      ['A', '3'],
    ])
    await build({
      stdin: {
        resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
        loader: 'tsx',
        contents: `import React from 'react';
import {createRoot} from 'react-dom/client';
import {ReportReading} from './src/client/analysis-ui/reading-state.tsx';
import {SnapshotFilterProvider} from './src/client/analysis-ui/snapshot-filter-provider.tsx';
import {SnapshotFilterControl,useSnapshotFilters} from './src/client/analysis-ui/snapshot-filter-controls.tsx';
const declaration={filterId:'region',ref:'data',field:{kind:'column',name:'category'},label:'Region',mode:'multiple',defaultValues:['A']};
const program='root = Stack([filter, filter]);\\nfilter = SnapshotFilter("region", "data", {kind:"column", name:"category"}, "Region", "multiple", ["A"]);';
const resource={kind:'snapshot',snapshot:${JSON.stringify(snapshot)},declaration:{kind:'dataset-snapshot',snapshotRef:'ref'},binding:{workspaceId:'workspace'}};
const readings=[{tabs:new Map(),accordions:new Map(),tables:new Map(),scroll:new Map()},{tabs:new Map(),accordions:new Map(),tables:new Map(),scroll:new Map()}];
const root=createRoot(document.getElementById('root'));
let owner=0, build='build-1', host=0, candidate=false, loaded=true, source='data', currentProgram=program, pending, stage='initial';
function Output(){const filter=useSnapshotFilters(['region'],source,loaded?resource.snapshot:undefined); return <output data-testid="rows">{filter.ready?JSON.stringify(filter.visibleRows(3)):'not-ready'}</output>}
function render(){const readResource=()=>loaded?resource:undefined;root.render(<section data-stage={stage}><ReportReading.Provider value={readings[owner]}><SnapshotFilterProvider key={host} program={currentProgram} pendingStatementId={pending} readResource={readResource} recordId={candidate?undefined:build} candidate={candidate}><SnapshotFilterControl declaration={declaration}/><SnapshotFilterControl declaration={declaration}/><Output/></SnapshotFilterProvider></ReportReading.Provider></section>)}
window.change=(mode)=>{stage=mode;if(mode==='move')host++;if(mode==='build')build='build-2';if(mode==='owner')owner=1;if(mode==='original')owner=0;if(mode==='candidate'){candidate=true;loaded=false}if(mode==='load')loaded=true;if(mode==='saved')candidate=false;if(mode==='stream')currentProgram=program.replace('[filter, filter]','[filter, filter, tail]')+'\\ntail = TextContent("unfinished';if(mode==='unresolved')currentProgram=program.replace('[filter, filter]','[filter, filter, tail]');if(mode==='pending')pending='filter';if(mode==='wrong-resource'){pending=undefined;source='other'};render()};render();`,
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
    const rows = page.getByTestId('rows')
    const change = async (mode: string) => {
      await page.evaluate((value) => Reflect.get(window, 'change')(value), mode)
      await page.locator(`[data-stage="${mode}"]`).waitFor()
    }
    await rows.waitFor()
    assert.equal(await rows.textContent(), '[0,2]')
    await page.getByRole('checkbox', { name: 'B' }).first().check()
    assert.equal(await rows.textContent(), '[0,1,2]')
    assert.equal(await page.getByRole('checkbox', { name: 'B' }).last().isChecked(), true)
    await change('move')
    assert.equal(await page.getByRole('checkbox', { name: 'B' }).first().isChecked(), true)
    await change('owner')
    assert.equal(await rows.textContent(), '[0,2]')
    await change('original')
    assert.equal(await page.getByRole('checkbox', { name: 'B' }).first().isChecked(), true)
    await change('build')
    assert.equal(await rows.textContent(), '[0,2]')
    await page.getByRole('button', { name: 'Clear' }).first().click()
    assert.equal(await rows.textContent(), '[0,1,2]')
    await page.getByRole('button', { name: 'Restore defaults' }).first().click()
    assert.equal(await rows.textContent(), '[0,2]')
    await change('candidate')
    assert.equal(await page.locator('div[role="status"]').count(), 2)
    await change('load')
    assert.equal(await page.getByRole('checkbox', { name: 'A' }).first().isDisabled(), true)
    assert.equal(await rows.textContent(), '[0,2]')
    for (const mode of ['stream', 'unresolved']) {
      await change(mode)
      assert.equal(await page.getByRole('checkbox', { name: 'A' }).first().isDisabled(), true)
      assert.equal(await rows.textContent(), '[0,2]')
    }
    await change('pending')
    assert.equal(await rows.textContent(), 'not-ready')
    await change('wrong-resource')
    assert.equal(await rows.textContent(), 'not-ready')
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
    await rm(directory, { recursive: true, force: true })
  }
})
