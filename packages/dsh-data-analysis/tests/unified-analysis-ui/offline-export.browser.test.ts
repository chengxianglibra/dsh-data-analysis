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
    ['A', '10'],
    ['B', '20'],
    [payload, '30'],
  ])
  const document = parseAnalysisDocument({
    schemaVersion: ANALYSIS_UI_FORMAT,
    workspaceId: 'private_workspace_identity',
    reportId: 'private_report_identity',
    buildId: 'private_build_identity',
    recordId: analysisRecordId('private_report_identity', 'private_build_identity'),
    title: 'Offline report',
    locale: 'en-US',
    generatedAt: '2026-11-05T00:00:00Z',
    catalog: { id: analysisCatalogId, build: analysisCatalogBuild },
    program:
      'root = Tabs([chart, data]);\nchart = TabItem("chart", "Chart", [DatasetView("result", {chart:"line",encoding:{axis:"category",values:["value"]}})]);\ndata = TabItem("data", "Data", [DatasetView("result", {chart:"table"})]);',
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
        },
        snapshot,
        binding: {
          workspaceId: 'private_workspace_identity',
          sessionId: 'private_session_identity',
          callId: 'private_call_identity',
          codeRef: {
            executionId: '00000000-0000-4000-8000-000000000000',
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
    await page.getByRole('heading', { name: 'Offline report' }).waitFor()
    await page.locator('[data-resource="result"] .recharts-line-dots circle').first().waitFor()
    assert.ok(await page.locator('[data-resource="result"] svg.recharts-surface').count())
    await page
      .locator('[data-resource="result"] .recharts-line-dots circle')
      .first()
      .click({ force: true })
    assert.equal(await page.getByRole('menuitem', { name: 'Ask about this' }).count(), 0)
    await page.getByRole('tab', { name: 'Data' }).click()
    assert.equal(await page.getByText(payload, { exact: true }).isVisible(), true)
    await page.getByRole('button', { name: 'Data source and scope' }).click()
    const dialog = page.getByRole('dialog', { name: 'Data source and scope' })
    assert.equal(
      await dialog
        .getByText('The execution script is not included in the offline report.')
        .isVisible(),
      true,
    )
    assert.equal(
      await dialog
        .getByText('Execution datasource information is not included in the offline report.')
        .isVisible(),
      true,
    )
    assert.equal(await dialog.getByText('Developer', { exact: true }).count(), 0)
    assert.equal(await dialog.getByText('Session', { exact: true }).count(), 0)
    assert.equal(await page.evaluate(() => Reflect.get(globalThis, '__offlineInjected')), undefined)
    assert.deepEqual(remoteRequests, [])
    assert.deepEqual(errors, [])
    await context.close()
  } finally {
    await browser.close()
    await rm(directory, { recursive: true, force: true })
  }
})
