import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { withChartSeries } from '../../src/client/presentation/chart-view.ts'
import { sortedRowIndices } from '../../src/client/presentation/model.ts'
import type { MarivoCheckedRunner, MarivoCheckedRunRequest } from '../../src/environment/types.ts'
import { buildPresentation } from '../../src/presentation/build/index.ts'
import type { PresentationDraft } from '../../src/presentation/contracts/index.ts'
import { MarivoPresentationProjection } from '../../src/presentation/projection/index.ts'

const options = {
  workspaceId: 'workspace',
  reportId: 'report',
  buildId: 'build',
  generatedAt: '2026-09-07T00:00:00Z',
}
function computedDraft(sourceIds: string[] = []): PresentationDraft {
  return {
    schemaVersion: 1,
    title: 'computed',
    sources: [],
    datasets: [{ id: 'data', kind: 'computed', path: 'computed.json', sourceIds }],
    blocks: [{ id: 'table', kind: 'table', datasetId: 'data' }],
  }
}
async function fixture() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-presentation-projection-')))
  const requests: MarivoCheckedRunRequest[] = []
  const runner = {
    status: 'ready' as const,
    binding: {
      projectRoot: root,
      pythonExecutable: '/selected/python',
      marivoVersion: '0.5.4',
      packagePath: '/selected/marivo/__init__.py',
      subprocessPolicyId: 'policy',
      fingerprint: 'f'.repeat(64),
      presentationKit: {
        version: '1.0.0',
        packagePath: '/selected/dsh_data_analysis_presentation/__init__.py',
      },
    },
    async runChecked(request: MarivoCheckedRunRequest) {
      requests.push(request)
      return {
        exitCode: 0,
        signal: null,
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
        durationMs: 1,
      }
    },
  } satisfies MarivoCheckedRunner
  return {
    root,
    requests,
    runner,
    bridge: new MarivoPresentationProjection(runner),
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

test('Python labels survive computed projection, reader controls, tooltip and portable HTML', async (t) => {
  const f = await fixture()
  t.after(f.cleanup)
  const packageRoot = fileURLToPath(new URL('../..', import.meta.url))
  const written = spawnSync(
    'uv',
    [
      'run',
      '--project',
      path.join(packageRoot, 'python/presentation-kit'),
      '--frozen',
      'python',
      '-c',
      [
        'import sys',
        'import pandas as pd',
        'from dsh_data_analysis_presentation import write_dataset',
        'write_dataset(pd.DataFrame({"period": ["A", "B"], "base_0831": [20, 10], "cur_0907": [30, 40]}), sys.argv[1], labels={"base_0831": "基期（08月31日）", "cur_0907": "本期（09月07日）"})',
      ].join('\n'),
      path.join(f.root, 'computed.json'),
    ],
    { encoding: 'utf8', timeout: 60_000 },
  )
  assert.equal(written.status, 0, written.stderr)
  const draft = computedDraft()
  const chart = {
    id: 'chart',
    kind: 'chart' as const,
    datasetId: 'data',
    chart: 'bar' as const,
    x: 'period',
    y: ['base_0831', 'cur_0907'],
    numericMode: 'exact' as const,
  }
  draft.blocks.push(chart)
  const document = await f.bridge.project(draft, options)
  const data = document.datasets[0]!.data
  assert.deepEqual(
    data.columns.map(({ id, label }) => [id, label]),
    [
      ['period', 'period'],
      ['base_0831', '基期（08月31日）'],
      ['cur_0907', '本期（09月07日）'],
    ],
  )
  assert.equal(f.requests.length, 0)
  assert.deepEqual(
    sortedRowIndices(data, { columnId: 'base_0831', direction: 'ascending' }),
    [1, 0],
  )
  assert.deepEqual(withChartSeries(chart, ['cur_0907']).y, ['cur_0907'])
  const outfile = path.join(f.root, 'labels-render.mjs')
  await build({
    stdin: {
      contents: `import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChartRenderer } from './src/client/presentation/chart-renderer.tsx';
import { ExactTooltip } from './src/client/presentation/chart-tooltip.tsx';
export function render(document, block) {
 const dataset = document.datasets[0];
 return [ChartRenderer, ExactTooltip].map(Component => renderToStaticMarkup(createElement(Component, { dataset, block, mode: 'interactive', rowIndex: 0 })));
}`,
      resolveDir: packageRoot,
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
    logLevel: 'silent',
  })
  const { render } = await import(pathToFileURL(outfile).href)
  const [chartHtml, tooltipHtml] = render(document, chart)
  for (const html of [chartHtml, tooltipHtml]) {
    assert.match(html, /基期（08月31日）/)
    assert.match(html, /本期（09月07日）/)
  }
  assert.match(chartHtml, /aria-label="显示系列 基期（08月31日）"/)
  assert.match(tooltipHtml, /<dt>基期（08月31日）<\/dt>/)
  const { htmlBytes } = await buildPresentation(document)
  const fallback = htmlBytes.toString().split('<div id="reader">')[0]!
  assert.match(fallback, /基期（08月31日）/)
  assert.match(fallback, /本期（09月07日）/)
  assert.doesNotMatch(fallback, />base_0831<|>cur_0907</)
  assert.match(fallback, /data-column-id="base_0831"/)
})
