import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { resolveFrameView } from '../../src/presentation/contracts/frame-view.ts'
import { parseAnalysisSnapshot } from '../../src/presentation/contracts/snapshot.ts'
import { bundleRenderer, type Renderer } from './frame-render-fixtures.ts'

const directory = new URL('./fixtures/frames/', import.meta.url)
let r: Renderer
before(async () => {
  r = await bundleRenderer()
})
after(async () => {
  await r?.dispose()
})

test('every real Marivo Frame renders its auto view without banner text', async () => {
  const names = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort()
  assert.ok(names.length >= 20)
  for (const name of names) {
    const snapshot = parseAnalysisSnapshot(
      JSON.parse(await readFile(new URL(name, directory), 'utf8')),
    )
    const resolution = resolveFrameView(snapshot)
    assert.ok(resolution.ok, name)
    const html = r.render(snapshot).replace(/<style>[\s\S]*?<\/style>/g, '')
    assert.match(html, new RegExp(`data-frame-view="${resolution.view.chart}"`), name)
    assert.match(html, /data-frame-class="[a-z]+"/, name)
    // Process facts and explanatory notes never reach the Frame view.
    assert.doesNotMatch(html, /Evidence|Finding|method_facts|role="note"/i, name)
  }
})
