import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { datasetSnapshot } from './dataset-fixtures.ts'
import { observeCategory } from './frame-fixtures.ts'

const program = `root = Stack([intro, tabs, plot, data, picture]);
intro = TextContent("Confirmed scope [source](https://example.com)\\n\\n> [nested source](https://example.com)");
tabs = Tabs([first, second]);
first = TabItem("first", "First", [TextContent("First panel")]);
second = TabItem("second", "Second", [TextContent("Second panel")]);
plot = AnalysisFrameView("frame", {chart:"bar", encoding:{axis:"region", values:["revenue"]}});
data = DatasetView("dataset", {chart:"bar", encoding:{axis:"category", values:["value"]}});
picture = Image(imageLabel, "image");
imageLabel = sharedImageLabel;
sharedImageLabel = "Admitted image";`

test('candidate prefixes retain readable siblings, local controls and explicit data configuration boundaries', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-progressive-reader-'))
  const browser = await chromium.launch()
  try {
    await build({
      stdin: {
        resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
        contents: `
import {createElement as h} from 'react';
import {createRoot} from 'react-dom/client';
import {PartialArguments} from '@deepseek-ai/dsh-util-values';
import {AnalysisRenderer} from './src/client/analysis-ui/surface.tsx';
import {analysisCandidate,candidateResources} from './src/client/analysis-ui/candidate.ts';
import {retainedResourceStatements,streamingAnalysisProgram} from './src/client/analysis-ui/streaming-program.ts';
const base=${JSON.stringify(program)};
const resources={
 frame:{kind:'snapshot',declaration:{kind:'frame-snapshot',snapshotRef:'frame-ref'},snapshot:${JSON.stringify(observeCategory(3))},binding:{workspaceId:'w'}},
 dataset:{kind:'snapshot',declaration:{kind:'dataset-snapshot',snapshotRef:'dataset-ref'},snapshot:${JSON.stringify(datasetSnapshot())},binding:{workspaceId:'w'}},
 image:{kind:'image',declaration:{kind:'image-file',path:'old.png'},mimeType:'image/png',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=',sha256:'a'.repeat(64)}
};
const root=createRoot(document.getElementById('root'));
window.requests=[];
window.progressive={update(patch='',resourcePrefix,streaming=true,candidate=true){
 const args=new PartialArguments();
 args.append(JSON.stringify({surface:'tool',stage:'preview',program:patch}).slice(0,-1)+(resourcePrefix===undefined?'}':',"resourcePatch":'+resourcePrefix));
 const value=analysisCandidate({phase:streaming?'preparing':'start',args,callId:'candidate',name:'marivo_present',turn:1,step:1,time:1,subCalls:[]},'s','w',{});
 root.render(h(AnalysisRenderer,{program:streamingAnalysisProgram(base,value.program,streaming,value.resourcePatchInput==='incomplete'),candidateProgram:value.program,retainedStatementIds:value.resourcePatchInput==='incomplete'?retainedResourceStatements(value.program,base):undefined,title:'Progressive reader',locale:'en-US',resources:candidateResources({resources},value),candidate,isStreaming:streaming,
 readCode:async()=>{window.requests.push('code');},openSemanticRef:()=>window.requests.push('semantic'),askPoint:async()=>window.requests.push('point'),askDataset:async()=>window.requests.push('dataset'),askResource:async()=>window.requests.push('resource')}));
}};
window.progressive.update();`,
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
      '<!doctype html><meta charset="utf-8"><title>Progressive reader regression</title><div id="root"></div><script src="page.js"></script>',
    )
    const artifacts = process.env.DSH_PROGRESSIVE_READER_ARTIFACT_DIR
    if (artifacts) {
      await mkdir(artifacts, { recursive: true })
      await copyFile(path.join(directory, 'index.html'), path.join(artifacts, 'index.html'))
      await copyFile(path.join(directory, 'page.js'), path.join(artifacts, 'page.js'))
    }
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(pathToFileURL(path.join(directory, 'index.html')).href)
    await page.locator('[data-resource="frame"]').waitFor()
    await page.getByRole('tab', { name: 'Second', exact: true }).click()
    assert.equal(await page.getByText('Second panel', { exact: true }).isVisible(), true)
    assert.equal(await page.locator('.au-text a').count(), 0)
    assert.equal(await page.locator('.au-image').getAttribute('alt'), 'Admitted image')

    // The official tolerant parser can keep wrong slot types and duplicate values.
    const mixedTabs =
      'tabs = Tabs([first, 12, "pending", DatasetView("dataset"), second, TabItem("second", "Duplicate", []), TabItem("", "Empty", [])]);'
    await page.evaluate((patch) => Reflect.get(window, 'progressive').update(patch), mixedTabs)
    await page.getByRole('tab', { name: 'Second', exact: true }).waitFor()
    assert.equal(await page.getByRole('tab').count(), 2)
    assert.equal(
      await page.getByRole('tab', { name: 'Second', exact: true }).getAttribute('aria-selected'),
      'true',
    )
    assert.equal(
      await page.getByText('Confirmed scope', { exact: false }).first().isVisible(),
      true,
    )
    await page.evaluate(() =>
      Reflect.get(window, 'progressive').update(
        'tabs = Tabs([first, second, TabItem("later", "Arriving',
      ),
    )
    assert.equal(await page.getByRole('tab').count(), 2)
    assert.equal(
      await page.getByRole('tab', { name: 'Second', exact: true }).getAttribute('aria-selected'),
      'true',
    )

    for (const [statement, name] of [
      ['plot', 'AnalysisFrameView'],
      ['data', 'DatasetView'],
    ] as const) {
      const resource = statement === 'plot' ? 'frame' : 'dataset'
      const sibling = statement === 'plot' ? 'dataset' : 'frame'
      await page.evaluate(
        (patch) => Reflect.get(window, 'progressive').update(patch),
        `${statement} = ${name}("${resource}", {chart:"bar", encoding:{axis:"unfinished`,
      )
      await page
        .getByRole('status')
        .filter({ has: page.locator('[data-slot="skeleton"]') })
        .waitFor()
      assert.equal(await page.locator(`[data-resource="${sibling}"]`).isVisible(), true)
      assert.equal(await page.locator(`[data-resource="${resource}"]`).count(), 0)
      assert.equal(await page.getByText('Second panel', { exact: true }).isVisible(), true)
      await page.evaluate(
        (patch) => Reflect.get(window, 'progressive').update(patch),
        `${statement} = ${name}("${resource}", {chart:"bar", encoding:{axis:"missing", values:["missing"]}});`,
      )
      await page.getByRole('alert').waitFor()
      assert.equal(await page.locator(`[data-resource="${sibling}"]`).isVisible(), true)
      await page.evaluate(
        (patch) => Reflect.get(window, 'progressive').update(patch),
        `${statement} = ${name}("${resource}", {chart:"unsupported"});`,
      )
      await page.getByRole('alert').waitFor()
      assert.equal(await page.locator(`[data-resource="${sibling}"]`).isVisible(), true)
    }

    await page.evaluate(() => Reflect.get(window, 'progressive').update())
    const frame = page.locator('[data-resource="frame"]')
    await frame.locator('[data-icon="data"] button').click()
    assert.equal(await page.getByRole('dialog').locator('tbody tr').count(), 3)
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    const dataset = page.locator('[data-resource="dataset"]')
    await dataset.locator('[data-icon="data"] button').click()
    assert.equal(await page.getByRole('dialog').locator('tbody tr').count(), 3)
    await page.getByRole('dialog').locator('th[data-column-id="value"] button').click()
    assert.equal(
      await page
        .getByRole('dialog')
        .locator('th[data-column-id="value"]')
        .getAttribute('aria-sort'),
      'ascending',
    )
    assert.equal(
      await page.getByRole('dialog').locator('tbody tr').first().getAttribute('data-row-index'),
      '2',
    )
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'requests')), [])
    if (artifacts)
      await page.screenshot({ path: path.join(artifacts, 'candidate-desktop.png'), fullPage: true })
    await page.evaluate(() =>
      Reflect.get(window, 'progressive').update('picture = Image("New image", "image'),
    )
    await page.locator('.au-image').waitFor({ state: 'hidden' })
    assert.equal(await page.locator('.au-image').count(), 0)
    assert.equal(await page.locator('[data-resource="frame"]').isVisible(), true)

    // Unknown patch scope keeps admitted resources under their original configuration; text continues.
    await page.evaluate(() =>
      Reflect.get(window, 'progressive').update(
        'sharedImageLabel = "Candidate indirect image"; intro = TextContent("New scope")',
        '{"put":{"frame":{"kind":"frame-snapshot","snapshotRef":"new',
      ),
    )
    await page.getByText('New scope', { exact: true }).waitFor()
    assert.equal(await page.locator('[data-resource]').count(), 2)
    assert.equal(await page.locator('.au-image').getAttribute('alt'), 'Admitted image')
    await page.evaluate(() =>
      Reflect.get(window, 'progressive').update(
        '',
        JSON.stringify({
          put: { frame: { kind: 'frame-snapshot', snapshotRef: 'frame-ref' } },
          remove: ['dataset', 'image'],
        }),
      ),
    )
    await page.locator('[data-resource="frame"]').waitFor()
    assert.equal(await page.locator('[data-resource="dataset"]').count(), 0)

    // Explicit removal stays removed; there is no last-valid-component resurrection.
    await page.evaluate(() =>
      Reflect.get(window, 'progressive').update(
        'root = Stack([intro, tabs]);\nplot = null;\ndata = null;\npicture = null;',
      ),
    )
    assert.equal(await page.getByRole('tab', { name: 'Second', exact: true }).isVisible(), true)
    assert.equal(await page.locator('[data-resource]').count(), 0)
    await page.evaluate(() =>
      Reflect.get(window, 'progressive').update('', undefined, false, false),
    )
    await page.locator('.au-text a').first().waitFor()
    assert.equal(await page.locator('.au-text a').count(), 2)
    // R1-001: a later incomplete sibling must not freeze a complete inline resource.
    for (const [source, resource] of [
      ['root = Stack([DatasetView("dataset"), TextContent("next', 'dataset'],
      [
        'root = Stack([DatasetView("dataset", {chart:"bar", encoding:{axis:"category", values:["value"]}}), TextContent("next',
        'dataset',
      ],
      ['root = Stack([AnalysisFrameView("frame"), TextContent("next', 'frame'],
    ]) {
      await page.evaluate((patch) => Reflect.get(window, 'progressive').update(patch), source)
      await page.getByText('next', { exact: true }).waitFor()
      await page.locator(`[data-resource="${resource}"]`).waitFor()
      assert.equal(await page.getByText('next', { exact: true }).isVisible(), true)
    }
    await page.evaluate(() =>
      Reflect.get(window, 'progressive').update(
        'root = Stack([Card([DatasetView("dataset"), AnalysisFrameView("frame"), Image("Stable image", "image")]), TextContent("next',
      ),
    )
    await page.locator('[data-resource="dataset"]').waitFor()
    await page.getByAltText('Stable image').waitFor()
    assert.equal(await page.locator('[data-resource="frame"]').isVisible(), true)
    assert.equal(await page.getByAltText('Stable image').isVisible(), true)
    assert.equal(await page.getByText('next', { exact: true }).isVisible(), true)
    for (const [name, encoding] of [
      ['DatasetView', 'axis:"unfinished'],
      ['AnalysisFrameView', 'axis:"unfinished'],
      ['DatasetView', 'axis:"category", values:["unfinished'],
      ['AnalysisFrameView', 'axis:"region", values:["unfinished'],
    ]) {
      const resource = name === 'DatasetView' ? 'dataset' : 'frame'
      await page.evaluate(
        (patch) => Reflect.get(window, 'progressive').update(patch),
        `root = Stack([TextContent("Readable sibling"), ${name}("${resource}", {chart:"bar", encoding:{${encoding}`,
      )
      await page.getByText('Readable sibling', { exact: true }).waitFor()
      assert.equal(await page.getByText('Readable sibling', { exact: true }).isVisible(), true)
      assert.equal(await page.locator(`[data-resource="${resource}"]`).count(), 0)
      await page.evaluate(
        (patch) => Reflect.get(window, 'progressive').update(patch, undefined, false),
        `root = Stack([TextContent("Readable sibling"), ${name}("${resource}", {chart:"bar", encoding:{${encoding}`,
      )
      await page.getByRole('alert').waitFor()
    }
    await page.evaluate(() =>
      Reflect.get(window, 'progressive').update(
        'root = Stack([DatasetView("dataset"), Image("Arriving image"',
      ),
    )
    await page.locator('[data-resource="dataset"]').waitFor()
    assert.equal(await page.locator('.au-image').count(), 0)
    // R2-001: an open explicit configuration is not a valid default view.
    for (const suffix of [
      'DatasetView("dataset", ',
      'DatasetView("dataset", {chart:"table", columns:["value',
      'AnalysisFrameView("fra',
      'Image("Pending", "ima',
    ]) {
      await page.evaluate(
        (patch) => Reflect.get(window, 'progressive').update(patch),
        `root = Stack([DatasetView("dataset"), AnalysisFrameView("frame"), TextContent("Closed siblings"), ${suffix}`,
      )
      await page.getByText('Closed siblings', { exact: true }).waitFor()
      assert.equal(await page.locator('[data-resource="dataset"]').count(), 1)
      assert.equal(await page.locator('[data-resource="frame"]').count(), 1)
      assert.equal(await page.locator('.au-image').count(), 0)
    }
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
    await rm(directory, { recursive: true, force: true })
  }
})
