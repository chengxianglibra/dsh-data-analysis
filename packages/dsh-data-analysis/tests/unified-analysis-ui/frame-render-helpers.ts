import { after, before } from 'node:test'
import { resolveFrameView } from '../../src/presentation/contracts/frame-view.ts'
import type { FrameSnapshotV2 } from '../../src/presentation/contracts/snapshot.ts'
import { bundleRenderer, type Renderer } from './frame-render-fixtures.ts'

/** Inline `<style>` carries palette hexes and class names; assertions read only the markup. */
export const strip = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/g, '')

/** Shared renderer for a module: register before/after hooks and return the accessor. */
export function sharedRenderer(): () => Renderer {
  let renderer: Renderer
  before(async () => {
    const bundled = await bundleRenderer()
    renderer = {
      ...bundled,
      render: async (...args) => strip(await bundled.render(...args)),
      shell: async (...args) => strip(await bundled.shell(...args)),
    }
  })
  after(async () => {
    await renderer?.dispose()
  })
  return () => renderer
}

export const viewOf = (html: string) => /data-frame-view="([^"]+)"/.exec(html)?.[1]
export const count = (html: string, pattern: RegExp) =>
  html.match(new RegExp(pattern, 'g'))?.length ?? 0
export const comparisonTable = (html: string) =>
  /<section[^>]*data-table-layout="comparison"[\s\S]*?<\/section>/.exec(html)?.[0] ?? ''
/** Path `d` attributes of drawn lines; each `M` starts a segment. */
export const segments = (html: string) =>
  [...html.matchAll(/<path[^>]*class="recharts-curve recharts-line-curve"[^>]*d="([^"]*)"/g)].map(
    (m) => count(m[1]!, /M/),
  )
export const factualText = (html: string) =>
  [...html.matchAll(/<(?:title|desc)>([\s\S]*?)<\/(?:title|desc)>|aria-label="([^"]*)"/g)]
    .map((match) => match[1] ?? match[2])
    .join(' ')
export const resolved = (snapshot: FrameSnapshotV2) => {
  const resolution = resolveFrameView(snapshot)
  if (!resolution.ok) throw new Error(resolution.code)
  return resolution
}
