import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { exportAnalysisHtml } from '../../src/client/analysis-ui/offline-export.ts'
import {
  analysisCatalogBuild,
  analysisCatalogId,
} from '../../src/presentation/contracts/analysis-catalog.ts'
import {
  ANALYSIS_UI_FORMAT,
  analysisRecordId,
  parseAnalysisDocument,
} from '../../src/presentation/contracts/analysis-document.ts'
import { datasetSnapshot } from './dataset-fixtures.ts'

test('exported report opens offline, renders data and charts, and keeps local interaction', async () => {
  const payload = '</script><script>globalThis.__offlineInjected = true</script>'
  const snapshot = datasetSnapshot([
    ['A', '0.237'],
    ['B', '0.112'],
    [payload, '0.305'],
  ])
  const document = parseAnalysisDocument({
    schemaVersion: ANALYSIS_UI_FORMAT,
    contentReview: 'required',
    workspaceId: 'private_workspace_identity',
    reportId: 'private_report_identity',
    buildId: 'private_build_identity',
    recordId: analysisRecordId('private_report_identity', 'private_build_identity'),
    title: 'Offline report',
    locale: 'en-US',
    generatedAt: '2026-11-05T00:00:00Z',
    catalog: { id: analysisCatalogId, build: analysisCatalogBuild },
    program:
      'root = Tabs([chart, data, dashboard]);\nchart = TabItem("chart", "Chart", [DatasetView("result", {chart:"line",encoding:{axis:"category",values:["value"]}}, {title:"Share trend",subtitle:"Saved ratios",formats:[{value:"value",format:"percent",decimals:1}]})]);\ndata = TabItem("data", "Data", [DatasetView("result", {chart:"table"}, {title:"Family shares",subtitle:"Saved ratios",formats:[{value:"value",format:"percent",decimals:1}]})]);\ndashboard = TabItem("dashboard", "Dashboard", [DashboardGrid([DashboardGridItem([TextCallout("info", "Scope", "Snapshot data")], 1), DashboardGridItem([Accordion([AccordionItem("details", "Details", [DatasetView("result", {chart:"table"})])])], 1)], 2)]);',
    resources: {
      result: {
        kind: 'snapshot',
        declaration: {
          kind: 'dataframe',
          ref: {
            schema: 'marivo.dataframe_ref/v2',
            project_root: '/private_workspace_identity',
            result_id: `df_${'a'.repeat(32)}`,
          },
          codeRef: {
            executionId: '12345678-1234-4123-8123-123456789abc',
            sha256: 'a'.repeat(64),
          },
        },
        snapshot,
        binding: {
          workspaceId: 'private_workspace_identity',
          sessionId: 'private_session_identity',
          callId: 'private_call_identity',
          codeRef: {
            executionId: '12345678-1234-4123-8123-123456789abc',
            sha256: 'a'.repeat(64),
          },
        },
      },
    },
  })
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-offline-export-'))
  const browser = await chromium.launch()
  try {
    const reportPath = path.join(directory, 'report.html')
    const html = exportAnalysisHtml(document)
    for (const identity of [
      'private_workspace_identity',
      'private_report_identity',
      'private_build_identity',
      'private_snapshot_reference',
      'private_session_identity',
      'private_call_identity',
      '12345678-1234-4123-8123-123456789abc',
    ]) {
      assert.equal(html.includes(identity), false, `export exposes ${identity}`)
    }
    await writeFile(reportPath, html)
    const context = await browser.newContext({
      offline: true,
      viewport: { width: 1024, height: 900 },
    })
    const page = await context.newPage()
    page.setDefaultTimeout(10_000)
    const remoteRequests: string[] = []
    const errors: string[] = []
    page.on('request', (request) => {
      if (/^https?:/i.test(request.url())) remoteRequests.push(request.url())
    })
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(pathToFileURL(reportPath).href)
    await page.getByRole('article', { name: 'Offline report', exact: true }).waitFor()
    assert.equal(await page.title(), 'Offline report')
    const review = page.locator('[data-content-review=required]')
    assert.equal(await review.textContent(), 'Data changed. Static narrative needs review.')
    assert.equal(await page.locator('.au-surface-body [data-content-review]').count(), 0)
    await page.reload()
    await review.waitFor()
    assert.equal(await page.getByRole('heading', { name: 'Offline report' }).count(), 0)
    await page.locator('[data-resource="result"] .recharts-line-dots circle').first().waitFor()
    assert.equal(await page.getByRole('heading', { name: 'Share trend' }).isVisible(), true)
    assert.equal(
      await page
        .getByRole('tabpanel', { name: 'Chart' })
        .getByText('Saved ratios', { exact: true })
        .isVisible(),
      true,
    )
    assert.match((await page.locator('.recharts-yAxis-tick-labels').textContent()) ?? '', /%/)
    assert.ok(await page.locator('[data-resource="result"] svg.recharts-surface').count())
    await page
      .locator('[data-resource="result"] .recharts-line-dots circle')
      .first()
      .click({ force: true })
    assert.equal(await page.getByRole('menuitem', { name: 'Ask about this' }).count(), 0)
    await page.locator('[data-resource="result"] [data-icon="data"] button').click()
    const chartData = page.getByRole('dialog')
    assert.equal(await chartData.getByText('0.237', { exact: true }).isVisible(), true)
    await chartData.getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('tab', { name: 'Data' }).click()
    const table = page.getByRole('tabpanel', { name: 'Data' })
    assert.equal(await table.getByRole('heading', { name: 'Family shares' }).isVisible(), true)
    assert.equal(await table.getByText('Saved ratios', { exact: true }).isVisible(), true)
    assert.equal(await table.getByText('23.7%', { exact: true }).isVisible(), true)
    assert.equal(await table.locator('[data-row-index="0"] [title="0.237"]').count(), 1)
    await table.getByRole('button', { name: 'Sort by Value' }).click()
    assert.equal(await table.locator('tbody tr').first().getAttribute('data-row-index'), '1')
    assert.equal(
      await page
        .getByRole('tabpanel', { name: 'Data' })
        .getByText(payload, { exact: true })
        .isVisible(),
      true,
    )
    await page.getByRole('button', { name: 'Data source and scope' }).click()
    const dialog = page.getByRole('dialog', { name: 'Data source and scope' })
    assert.equal(
      await dialog
        .getByText('The execution script is not included in the offline analysis view.')
        .isVisible(),
      true,
    )
    assert.equal(
      await dialog
        .getByText('Execution datasource information is not included in the offline analysis view.')
        .isVisible(),
      true,
    )
    assert.equal(await dialog.getByText('Developer', { exact: true }).count(), 0)
    assert.equal(await dialog.getByText('Session', { exact: true }).count(), 0)
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('tab', { name: 'Dashboard' }).click()
    assert.equal(await page.locator('.au-dashboard-grid .au-dashboard-item').count(), 2)
    assert.equal(await page.getByText('Snapshot data', { exact: true }).isVisible(), true)
    const details = page.getByRole('button', { name: 'Details', exact: true })
    assert.equal(await details.getAttribute('aria-expanded'), 'false')
    await details.focus()
    await page.keyboard.press('Enter')
    assert.equal(await details.getAttribute('aria-expanded'), 'true')
    assert.equal(await page.locator('.au-accordion-content').getByText(payload).isVisible(), true)
    assert.equal(await page.evaluate(() => Reflect.get(globalThis, '__offlineInjected')), undefined)
    assert.deepEqual(remoteRequests, [])
    assert.deepEqual(errors, [])
    await context.close()
  } finally {
    await browser.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('offline filters begin at saved defaults and operate on the complete embedded snapshot', async () => {
  const snapshot = datasetSnapshot([
    ['A', '10'],
    ['B', '20'],
    ['A', '30'],
  ])
  const document = parseAnalysisDocument({
    schemaVersion: ANALYSIS_UI_FORMAT,
    contentReview: 'not-needed',
    workspaceId: 'workspace',
    reportId: 'report',
    buildId: 'build',
    recordId: analysisRecordId('report', 'build'),
    title: 'Offline filter',
    locale: 'en-US',
    generatedAt: '2026-11-05T00:00:00Z',
    catalog: { id: analysisCatalogId, build: analysisCatalogBuild },
    program:
      'root = Stack([f, v]);\nf = SnapshotFilter("category", "result", {kind:"column", name:"category"}, "Category", "multiple", ["A"]);\nv = DatasetView("result", {chart:"table"}, {}, ["category"]);',
    resources: {
      result: {
        kind: 'snapshot',
        declaration: { kind: 'dataset-snapshot', snapshotRef: 'ref' },
        snapshot,
        binding: {
          workspaceId: 'workspace',
          sessionId: 'session',
          callId: 'call',
          codeRef: {
            executionId: '12345678-1234-4123-8123-123456789abc',
            sha256: 'a'.repeat(64),
          },
        },
      },
    },
  })
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-offline-filter-'))
  const browser = await chromium.launch()
  try {
    const html = exportAnalysisHtml(document)
    const reportPath = path.join(directory, 'report.html')
    await writeFile(reportPath, html)
    const context = await browser.newContext({ offline: true })
    const page = await context.newPage()
    const remoteRequests: string[] = []
    const errors: string[] = []
    page.on('request', (request) => {
      if (/^https?:/i.test(request.url())) remoteRequests.push(request.url())
    })
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(pathToFileURL(reportPath).href)
    await page.getByRole('checkbox', { name: 'A' }).waitFor()
    assert.deepEqual(
      await page
        .locator('tbody tr')
        .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-row-index'))),
      ['0', '2'],
    )
    await page.getByRole('checkbox', { name: 'B' }).check()
    assert.deepEqual(
      await page
        .locator('tbody tr')
        .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-row-index'))),
      ['0', '1', '2'],
    )
    await page.getByRole('button', { name: 'Clear', exact: true }).click()
    assert.equal(await page.getByRole('checkbox', { name: 'A' }).isChecked(), false)
    await page.getByRole('button', { name: 'Restore defaults' }).click()
    assert.deepEqual(
      await page
        .locator('tbody tr')
        .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-row-index'))),
      ['0', '2'],
    )
    await page.getByRole('checkbox', { name: 'B' }).check()
    await page.reload()
    await page.getByRole('checkbox', { name: 'A' }).waitFor()
    assert.equal(await page.getByRole('checkbox', { name: 'B' }).isChecked(), false)
    assert.deepEqual(
      await page
        .locator('tbody tr')
        .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-row-index'))),
      ['0', '2'],
    )
    assert.deepEqual(remoteRequests, [])
    assert.deepEqual(errors, [])
    await context.close()
  } finally {
    await browser.close()
    await rm(directory, { recursive: true, force: true })
  }
})
