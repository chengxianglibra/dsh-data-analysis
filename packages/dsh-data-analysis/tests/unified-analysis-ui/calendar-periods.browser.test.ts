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
  const unavailable = structuredClone(snapshot)
  unavailable.frame.sections.periods = { status: 'unavailable', reason: 'read-failed' }
  unavailable.frame.sections.semantics = { status: 'unavailable', reason: 'read-failed' }
  parseAnalysisSnapshot(unavailable)
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-period-browser-'))
  const browser = await chromium.launch()
  try {
    await build({
      stdin: {
        contents: `import {createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {AnalysisRenderer} from './src/client/analysis-ui/surface.tsx';
const full = ${JSON.stringify(full)}, truncated = ${JSON.stringify(truncated)}, unavailable = ${JSON.stringify(unavailable)};
const resource = snapshot => ({kind:'snapshot',declaration:{kind:'frame-snapshot',snapshotRef:'ref'},snapshot,binding:{workspaceId:'w'}});
createRoot(document.getElementById('root')).render(createElement(AnalysisRenderer, {
 program:'root = Stack([a,b,c]);\\na = AnalysisFrameView("full");\\nb = AnalysisFrameView("truncated");\\nc = AnalysisFrameView("unavailable");',
 title:'Periods',locale:'en-US',resources:{full:resource(full),truncated:resource(truncated),unavailable:resource(unavailable)}
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
    await fullCard.locator('[data-icon="periods"] button').hover()
    await page.getByRole('tooltip', { name: 'Period correspondence', exact: true }).waitFor()
    await fullCard.locator('[data-icon="periods"] button').click()
    const dialog = page.getByRole('dialog')
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
    const truncatedDialog = page.getByRole('dialog')
    await truncatedDialog.getByText('Captured 3 / 4 period correspondences.').waitFor()
    assert.equal((await truncatedDialog.locator('thead').innerText()).trim(), 'Current\tBaseline')
    await truncatedDialog.getByRole('button', { name: 'Close' }).click()
    const unavailableCard = page.locator('[data-resource="unavailable"]')
    for (const kind of ['periods', 'origins']) {
      const button = unavailableCard.locator(`[data-icon="${kind}"] button`)
      assert.equal(await button.getAttribute('aria-disabled'), null)
      assert.equal(await button.getAttribute('aria-haspopup'), 'dialog')
      await button.hover()
      await page
        .getByRole('tooltip', {
          name: kind === 'periods' ? 'Period correspondence' : 'Semantic origins',
          exact: true,
        })
        .waitFor()
      await button.click()
      const details = page.getByRole('dialog').locator('[data-unavailable-details]')
      await details.waitFor()
      assert.equal(await details.locator('svg').count(), 1)
      assert.equal(await details.locator('p').count(), 2)
      assert.equal(await page.getByRole('dialog').locator('table').count(), 0)
      await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click()
    }
  } finally {
    await browser.close()
    await rm(directory, { recursive: true, force: true })
  }
})
