import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

let directory: string
let render: (values: (number | null)[]) => string

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'dsh-area-baselines-'))
  const outfile = path.join(directory, 'render.mjs')
  await build({
    stdin: {
      contents: `import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {TimeChart} from './src/client/analysis-ui/charts/observation.tsx';
import {datasetChartModel} from './src/client/analysis-ui/charts/dataset-model.ts';
export function render(values) {
  const data = {schemaVersion:1, columns:[
    {id:'member', label:'Member', type:'string', nullable:false},
    {id:'value', label:'Value', type:'float64', nullable:true, unit:'USD'}
  ], rows:values.map((value,index)=>[String(index),value]), rowCount:values.length,
    limit:values.length, truncated:false};
  return renderToStaticMarkup(createElement(TimeChart, {
    model:datasetChartModel(data,['member']),
    view:{chart:'area',axis:'member',values:['value'],broadcast:[]},height:240
  }));
}`,
      resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    jsx: 'automatic',
    banner: {
      js: "import {createRequire} from 'node:module';const require=createRequire(import.meta.url);",
    },
    logLevel: 'silent',
  })
  render = (await import(pathToFileURL(outfile).href)).render
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

const areas = (markup: string) =>
  [...markup.matchAll(/<path d="([^"]+)" class="fv-area"/g)].map((match) => match[1]!)
const baseline = (area: string) => Number(/^M[^,]+,([^L]+)/.exec(area)?.[1])

test('positive areas fill down to zero and negative areas fill up to zero', () => {
  // With a 240px plot, the drawing edges are y=16 and y=214. Zero is
  // the lower edge for strictly positive data and the upper edge for negatives.
  const positive = areas(render([10, 20]))
  const negative = areas(render([-20, -10]))
  assert.equal(positive.length, 1)
  assert.equal(negative.length, 1)
  assert.equal(baseline(positive[0]!), 214)
  assert.equal(baseline(negative[0]!), 16)
})

test('mixed-sign areas share an interior zero rather than the bottom boundary', () => {
  const drawn = areas(render([-20, 20]))
  assert.equal(drawn.length, 1)
  assert.equal(baseline(drawn[0]!), 115)
})

test('nulls split filled segments and all-null data produces no filled area', () => {
  const drawn = areas(render([10, 20, null, 15, 25]))
  assert.equal(drawn.length, 2)
  assert.ok(drawn.every((area) => baseline(area) === 214))
  assert.equal(areas(render([null, null])).length, 0)
  assert.equal(areas(render([0, 0])).length, 1)
})
