import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import {
  type AnalysisSnapshot,
  parseAnalysisSnapshot,
} from '../../src/presentation/contracts/snapshot.ts'
import { frameSnapshot } from './fixtures.ts'

let directory: string
let render: (snapshot: AnalysisSnapshot, semantic?: boolean) => string
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'dsh-analysis-data-view-'))
  const outfile = path.join(directory, 'render.mjs')
  await build({
    stdin: {
      contents: `import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AnalysisDataView } from './src/client/analysis-ui/data-view.tsx';
import { AnalysisResources } from './src/client/analysis-ui/context.tsx';
export function render(snapshot, semantic) {
  return renderToStaticMarkup(createElement(AnalysisResources.Provider,
    {value: {readResource: () => ({kind: 'snapshot', snapshot, binding: {}}),
             openSemanticRef: semantic ? () => {} : undefined}},
    createElement(AnalysisDataView, {kind: snapshot.kind, resourceName: 'result'})));
}`,
      resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    jsx: 'automatic',
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
    logLevel: 'silent',
  })
  ;({ render } = await import(pathToFileURL(outfile).href))
})
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

function singleFrame(coordinate: boolean) {
  const s = parseAnalysisSnapshot(frameSnapshot())
  if (s.kind !== 'frame') throw new Error('frame-required')
  const index = coordinate ? 0 : 1
  s.data.columns = [s.data.columns[index]!]
  s.data.rows = [[s.data.rows[0]![index]!]]
  s.data.rowCount = 1
  s.data.truncated = false
  s.coverage.totalRows = 1
  s.coverage.complete = true
  s.coverage.columns = s.data.columns.map((c) => c.id)
  s.frame.fields = [s.frame.fields[index]!]
  s.frame.layout = [s.frame.layout[index]!]
  s.frame.slots = [s.frame.slots[index]!]
  if (!coordinate) {
    s.frame.axes = []
    s.frame.coordinates = {}
  }
  const parsed = parseAnalysisSnapshot(s)
  assert.equal(parsed.kind, 'frame')
  if (parsed.kind !== 'frame') throw new Error('frame-required')
  return parsed
}

test('auto uses Frame axes and value roles while preserving complete scalar Dataset display', () => {
  const coordinate = singleFrame(true)
  assert.match(render(coordinate), /<table/)
  assert.doesNotMatch(render(coordinate), /class="au-metric"/)

  const scalar = singleFrame(false)
  assert.match(render(scalar), /class="au-metric"/)
  const presence = structuredClone(scalar)
  presence.frame.fields[0]!.role = 'presence'
  assert.match(render(parseAnalysisSnapshot(presence)), /<table/)

  const withPresence = structuredClone(scalar)
  withPresence.data.columns.push({
    id: 'present',
    label: 'Present',
    type: 'boolean',
    nullable: false,
  })
  withPresence.data.rows[0]!.push(true)
  withPresence.coverage.columns.push('present')
  withPresence.frame.fields.push({ id: 'present', role: 'presence', slotId: 'presence' })
  withPresence.frame.layout.push({ kind: 'field', name: 'present', slotId: 'presence' })
  withPresence.frame.slots.push({
    id: 'present',
    slotId: 'presence',
    dtype: { type: 'boolean' },
    nullable: false,
    unit: null,
  })
  assert.match(render(parseAnalysisSnapshot(withPresence)), /class="au-metric"/)

  scalar.data.rowCount = 2
  scalar.data.truncated = true
  scalar.coverage.totalRows = 2
  scalar.coverage.complete = false
  assert.match(render(parseAnalysisSnapshot(scalar)), /<table/)
  const dataset = parseAnalysisSnapshot({
    schemaVersion: 1,
    kind: 'dataset',
    fetchedAt: coordinate.fetchedAt,
    data: coordinate.data,
    coverage: coordinate.coverage,
    source: { kind: 'dataframe', details: 'not-captured' },
  })
  assert.match(render(dataset), /class="au-metric"/)
})

function semanticSections() {
  return {
    evidence: 'not-captured',
    findings: 'not-captured',
    methods: 'not-captured',
    semantics: {
      status: 'captured',
      columns: [
        {
          role: 'value',
          id: 'amount',
          valueOrigins: [{ kind: 'metric', path: 'sales.revenue', definitionId: 'def-1' }],
          contextOrigins: [],
          omittedOrigins: 0,
        },
      ],
    },
  }
}

test('legacy v1 Frame keeps the table, source facts and semantic origins without process metadata', () => {
  const value = frameSnapshot() as Record<string, any>
  value.frame.sections = semanticSections()
  const snapshot = parseAnalysisSnapshot(value)
  const html = render(snapshot, true)
  assert.match(html, /<table/)
  assert.match(html, /data-meta="semantics"/)
  assert.match(html, /<button type="button">Metric: sales.revenue<\/button>/)
  assert.doesNotMatch(render(snapshot), /<button type="button">Metric/)
  assert.doesNotMatch(html, /data-meta="(?:evidence|findings|methods)"/)
  assert.doesNotMatch(html, /Evidence|Findings|Methods/)
  // The raw fields/layout JSON dump is gone.
  assert.doesNotMatch(html, /&quot;layout&quot;|"layout":/)
  assert.match(render(parseAnalysisSnapshot(frameSnapshot())), /Not captured when saved/)
})
