import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { formatCell, parseTypedDataset } from '../src/presentation/contracts/index.ts'

// S2 data decoding only. This is not the S3 production reader/portable acceptance.
const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const projectRoot = path.join(packageRoot, 'python/presentation-kit')
const outputRoot = await mkdtemp(path.join(tmpdir(), 'dsh-presentation-s2-browser-'))
const emitted = spawnSync(
  'uv',
  [
    'run',
    '--project',
    projectRoot,
    '--frozen',
    'python',
    path.join(projectRoot, 'scripts/emit_contract_fixtures.py'),
    outputRoot,
  ],
  { encoding: 'utf8', timeout: 120_000, maxBuffer: 65_536 },
)
assert.equal(emitted.status, 0, emitted.stderr)
const files = JSON.parse(emitted.stdout) as Record<string, string>
const payloads = await Promise.all(
  Object.entries(files).map(async ([name, filename]) => ({
    name,
    json: await readFile(filename, 'utf8'),
  })),
)
const compiled = await build({
  entryPoints: [path.join(packageRoot, 'src/presentation/contracts/index.ts')],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  globalName: 'PresentationContracts',
  write: false,
  metafile: true,
})
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const context = await browser.newContext({ offline: true })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<!doctype html><meta charset="utf-8"><title>S2 data contract</title>')
  await page.addScriptTag({ content: compiled.outputFiles[0]!.text })
  const results = []
  for (const { name, json } of payloads) {
    const node = parseTypedDataset(JSON.parse(json))
    const actual = await page.evaluate((text) => {
      const api = (
        globalThis as unknown as {
          PresentationContracts: {
            parseTypedDataset: typeof parseTypedDataset
            formatCell: typeof formatCell
          }
        }
      ).PresentationContracts
      const data = api.parseTypedDataset(JSON.parse(text))
      return {
        data,
        cells: data.rows.map((row) =>
          row.map((value, index) => api.formatCell(value, data.columns[index]!)),
        ),
      }
    }, json)
    assert.deepEqual(actual.data, node)
    assert.deepEqual(
      actual.cells,
      node.rows.map((row) => row.map((value, index) => formatCell(value, node.columns[index]!))),
    )
    results.push({
      name,
      rows: node.rows.length,
      rowCount: node.rowCount,
      columns: node.columns,
      cells: actual.cells,
    })
  }
  assert.deepEqual(errors, [])
  const evidence = {
    browser: browser.version(),
    offline: true,
    boundary: 'Python typed JSON decoded by the same pure contracts in Node and Chromium',
    results,
    errors,
    bundleInputs: Object.keys(compiled.metafile!.inputs),
  }
  await writeFile(path.join(outputRoot, 'browser-evidence.json'), JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify({ outputRoot, ...evidence }, null, 2))
} finally {
  await browser.close()
}
