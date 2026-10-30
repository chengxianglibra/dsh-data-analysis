import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { type Browser, chromium, type Page } from 'playwright'

const CODE = 'print("frame")\n'
let directory: string
let browser: Browser
let page: Page
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'dsh-frame-browser-'))
  const sha256 = createHash('sha256').update(CODE).digest('hex')
  await build({
    stdin: {
      contents: `import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { AnalysisRenderer } from './src/client/analysis-ui/surface.tsx';
import { frame, categoryAxis, observeTime } from './tests/unified-analysis-ui/frame-fixtures.ts';
const ref = (sha256) => ({ executionId: '6f9619ff-8b86-4d01-b42d-00cf4fc964ff', sha256 });
const resource = (snapshot, codeRef) => ({ kind: 'snapshot',
  declaration: { kind: 'frame-snapshot', snapshotRef: 'ref' }, snapshot,
  binding: { workspaceId: 'w', codeRef } });
const records = frame({
  axes: [categoryAxis(3, 'identity'), { name: 'channel', role: 'identity', keys: ['web', 'app', 'store'] }],
  values: [{ name: 'note', type: 'string', values: ['a long saved note', 'b', 'c'] }],
});
const resources = {
  good: resource(observeTime(3), ref(${JSON.stringify(sha256)})),
  bad: resource(observeTime(3), ref('0'.repeat(64))),
  records: resource(records),
};
const program = 'root = Stack([good, bad, records]);\\ngood = AnalysisFrameView("good");\\nbad = AnalysisFrameView("bad");\\nrecords = AnalysisFrameView("records");';
createRoot(document.getElementById('root')).render(createElement(AnalysisRenderer, {
  program, title: 'Frames', locale: 'en-US', resources,
  readCode: async () => ({ text: ${JSON.stringify(CODE)} }),
}));`,
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
    '<!doctype html><meta charset="utf-8"><body style="width:420px"><div id="root"></div><script src="page.js"></script>',
  )
  browser = await chromium.launch()
  page = await browser.newPage({ viewport: { width: 420, height: 900 } })
  await page.goto(pathToFileURL(path.join(directory, 'index.html')).href)
  await page.locator('[data-resource="records"] table').waitFor()
})
after(async () => {
  await browser?.close()
  await rm(directory, { recursive: true, force: true })
})

test('the Python icon shows the bound source only when its sha256 matches', async () => {
  await page.locator('[data-resource="good"] [data-icon="python"] button').click()
  const code = page.locator('[data-resource="good"] dialog[open] pre code')
  assert.equal(await code.textContent(), CODE)
  await page.keyboard.press('Escape')
  await page.locator('[data-resource="bad"] [data-icon="python"] button').click()
  const dialog = page.locator('[data-resource="bad"] dialog[open]')
  await dialog.getByText('Script does not match sha256').waitFor()
  assert.equal(await dialog.locator('pre code').count(), 0)
  await page.keyboard.press('Escape')
  assert.equal(
    await page.locator('[data-resource="bad"] [data-icon="python"]').getAttribute('data-disabled'),
    'true',
  )
})

test('record tables keep every key column in view while scrolling', async () => {
  const table = page.locator('[data-resource="records"] [data-frozen]').first()
  assert.equal(await table.getAttribute('data-frozen'), '2')
  const cells = await table.locator('thead th').evaluateAll((items) =>
    items.map((item) => {
      const style = getComputedStyle(item)
      return {
        position: style.position,
        left: style.left,
        width: (item as HTMLElement).offsetWidth,
      }
    }),
  )
  assert.equal(cells[0]!.position, 'sticky')
  assert.equal(cells[1]!.position, 'sticky')
  assert.equal(cells[1]!.left, `${cells[0]!.width}px`)
  assert.notEqual(cells[2]!.position, 'sticky')
})
