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
import { observeTime } from './frame-fixtures.ts'

for (const referenceKind of ['frame-snapshot', 'analysis-frame'] as const) {
  test(`exported ${referenceKind} renders its saved chart offline without Host actions or identities`, async () => {
    const snapshot = observeTime(3)
    snapshot.source.sessionId = 'private-marivo-session'
    snapshot.source.artifactId = 'private-artifact'
    snapshot.frame.inputId = 'private-frame-input'
    const report = parseAnalysisDocument({
      schemaVersion: ANALYSIS_UI_FORMAT,
      workspaceId: 'private-workspace',
      reportId: 'report',
      buildId: 'build',
      recordId: analysisRecordId('report', 'build'),
      title: 'Offline Frame',
      locale: 'en-US',
      generatedAt: '2026-11-05T00:00:00Z',
      catalog: { id: analysisCatalogId, build: analysisCatalogBuild },
      program: 'root = AnalysisFrameView("result", {chart: "line"});',
      resources: {
        result: {
          kind: 'snapshot',
          declaration:
            referenceKind === 'analysis-frame'
              ? {
                  kind: 'analysis-frame',
                  ref: {
                    schema: 'marivo.frame_ref/v2',
                    store_id: 'private-store',
                    session_id: 'private-marivo-session',
                    artifact_id: 'private-artifact',
                  },
                }
              : { kind: 'frame-snapshot', snapshotRef: 'private-snapshot' },
          snapshot,
          binding:
            referenceKind === 'analysis-frame'
              ? { workspaceId: 'private-workspace' }
              : {
                  workspaceId: 'private-workspace',
                  sessionId: 'private-host-session',
                  callId: 'private-call',
                  codeRef: {
                    executionId: '00000000-0000-4000-8000-000000000001',
                    sha256: 'a'.repeat(64),
                  },
                },
        },
      },
    })
    const html = exportAnalysisHtml(report)
    const data = /<script type="application\/json" id="report-data">(.*?)<\/script>/s.exec(html)
    assert.ok(data)
    const offline = parseAnalysisDocument(JSON.parse(data[1]!))
    const resource = offline.resources.result
    assert.ok(resource && resource.kind === 'snapshot' && resource.snapshot.kind === 'frame')
    assert.deepEqual(resource.snapshot.data, snapshot.data)
    assert.deepEqual(resource.snapshot.coverage, snapshot.coverage)
    assert.deepEqual(resource.snapshot.frame.sections, snapshot.frame.sections)
    for (const identity of [
      'private-marivo-session',
      'private-artifact',
      'private-frame-input',
      'private-workspace',
      'private-host-session',
      'private-call',
      'private-snapshot',
      'private-store',
    ])
      assert.equal(html.includes(identity), false, `export exposes ${identity}`)

    const directory = await mkdtemp(path.join(tmpdir(), 'dsh-offline-frame-'))
    const browser = await chromium.launch()
    try {
      const file = path.join(directory, 'report.html')
      await writeFile(file, html)
      const context = await browser.newContext({
        offline: true,
        viewport: { width: 1024, height: 900 },
      })
      const page = await context.newPage()
      const errors: string[] = []
      const requests: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('request', (request) => {
        if (/^https?:/i.test(request.url())) requests.push(request.url())
      })
      await page.goto(pathToFileURL(file).href)
      const card = page.locator('[data-resource="result"]')
      const point = card.locator('.recharts-line-dots circle').first()
      await point.waitFor()
      assert.ok(await card.locator('svg.recharts-surface').count())
      await point.click({ force: true })
      assert.equal(await page.getByRole('menuitem', { name: 'Ask about this' }).count(), 0)
      await card.getByRole('button', { name: 'Python' }).click()
      assert.equal(await page.getByRole('dialog').locator('[data-unavailable-details]').count(), 1)
      assert.equal(await page.getByRole('button', { name: 'Ask about this' }).count(), 0)
      assert.deepEqual(requests, [])
      assert.deepEqual(errors, [])
      await context.close()
    } finally {
      await browser.close()
      await rm(directory, { recursive: true, force: true })
    }
  })
}
