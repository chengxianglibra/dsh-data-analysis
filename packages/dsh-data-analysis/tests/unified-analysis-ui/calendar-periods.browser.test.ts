import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import {
  type FramePeriods,
  parseAnalysisSnapshot,
} from '../../src/presentation/contracts/snapshot.ts'
import { comparedCalendarWithPeriods } from './frame-render-fixtures.ts'

test('calendar comparison shows saved correspondences and discloses truncated pages', async () => {
  const snapshot = comparedCalendarWithPeriods(3)
  const periods = snapshot.frame.sections.periods
  assert.equal(periods.status, 'captured')
  if (periods.status !== 'captured') return
  type Item = FramePeriods['pages'][number]['items'][number]
  type Endpoint = Extract<Item, { kind: 'calendar' | 'interval' }>
  const calendar = (item: Endpoint): Endpoint =>
    item.kind === 'calendar'
      ? {
          kind: 'calendar',
          key: item.key,
          timezone: item.timezone,
          label: item.label,
          selection: 'full',
          cutoff: null,
        }
      : item
  for (const page of periods.pages) {
    page.items = page.items.map((item) => {
      if (item.kind === 'comparison')
        return {
          ...item,
          current: calendar(item.current),
          baseline: item.baseline ? calendar(item.baseline) : null,
        }
      return item.kind === 'calendar' ? calendar(item) : item
    })
  }
  const full = parseAnalysisSnapshot(snapshot)
  const truncated = structuredClone(snapshot)
  const truncatedPeriods = truncated.frame.sections.periods
  if (truncatedPeriods.status !== 'captured') throw new Error('Missing period fixture')
  const comparison = truncatedPeriods.pages.find((page) => page.target.kind === 'comparison')
  if (!comparison) throw new Error('Missing comparison fixture')
  comparison.hasMore = true
  comparison.totalCount = 4
  parseAnalysisSnapshot(truncated)
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-period-browser-'))
  const browser = await chromium.launch()
  try {
    await build({
      stdin: {
        contents: `import {createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {AnalysisRenderer} from './src/client/analysis-ui/surface.tsx';
const full = ${JSON.stringify(full)}, truncated = ${JSON.stringify(truncated)};
const resource = snapshot => ({kind:'snapshot',declaration:{kind:'frame-snapshot',snapshotRef:'ref'},snapshot,binding:{workspaceId:'w'}});
createRoot(document.getElementById('root')).render(createElement(AnalysisRenderer, {
 program:'root = Stack([a,b]);\\na = AnalysisFrameView("full");\\nb = AnalysisFrameView("truncated");',
 title:'Periods',locale:'en-US',resources:{full:resource(full),truncated:resource(truncated)}
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
      '<!doctype html><div id="root"></div><script src="page.js"></script>',
    )
    const page = await browser.newPage()
    await page.goto(pathToFileURL(path.join(directory, 'index.html')).href)
    const fullCard = page.locator('[data-resource="full"]')
    await fullCard.locator('[data-icon="periods"] button').click()
    const dialog = fullCard.getByRole('dialog')
    assert.match(
      (await dialog.locator('tbody tr').first().locator('td').nth(0).textContent()) ?? '',
      /2025-01/,
    )
    assert.match(
      (await dialog.locator('tbody tr').first().locator('td').nth(1).textContent()) ?? '',
      /2026-01/,
    )
    assert.equal(await dialog.getByText('Full period', { exact: true }).count(), 6)
    assert.equal(await dialog.getByText(/Captured .* period correspondences/).count(), 0)
    await dialog.getByRole('button', { name: 'Close' }).click()
    const truncatedCard = page.locator('[data-resource="truncated"]')
    await truncatedCard.locator('[data-icon="periods"] button').click()
    const truncatedDialog = truncatedCard.getByRole('dialog')
    await truncatedDialog.getByText('Captured 3 / 4 period correspondences.').waitFor()
    assert.equal((await truncatedDialog.locator('thead').innerText()).trim(), 'Current\tBaseline')
  } finally {
    await browser.close()
    await rm(directory, { recursive: true, force: true })
  }
})
