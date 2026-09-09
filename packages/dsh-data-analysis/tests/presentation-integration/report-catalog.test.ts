import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ReportCatalogModel, visibleReports } from '../../src/client/presentation/catalog-model.ts'
import { PresentationDeliveryModel } from '../../src/client/presentation/delivery-model.ts'
import { parseReportCatalog, parseReportHistory } from '../../src/presentation/contracts/catalog.ts'
import { parsePresentationDocument } from '../../src/presentation/contracts/index.ts'
import { presentationReportPath } from '../../src/presentation/files.ts'
import {
  listReports,
  publishPresentation,
  readReportHistory,
} from '../../src/presentation/reports.ts'
import { MarivoPresentationFileService } from '../../src/presentation/rpc.ts'

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'report-catalog-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const document = parsePresentationDocument(
    JSON.parse(
      await readFile(
        new URL('../presentation-s0/fixtures/computed.document.json', import.meta.url),
        'utf8',
      ),
    ),
  )
  const first = await publishPresentation(root, document, null, async () => {}, undefined, {
    kind: 'agent',
    sessionId: 'source',
  })
  let available = true
  const service = new MarivoPresentationFileService(
    async () => undefined,
    async (id) => (available && id === document.workspaceId ? { id, path: root } : undefined),
  )
  const rpc = {
    async call(_channel: string, endpoint: string, payload: unknown, signal: AbortSignal) {
      try {
        const value =
          endpoint === 'files/read'
            ? await service.read(payload, signal)
            : endpoint === 'reports/history' || endpoint === 'reports/list'
              ? await service.catalog(endpoint, payload, signal)
              : await service.report(
                  endpoint as 'reports/resolve' | 'reports/save',
                  payload,
                  signal,
                )
        return { ok: true, value }
      } catch (error) {
        return { ok: false, error: { message: String(error) } }
      }
    },
  }
  return {
    root,
    document,
    first,
    service,
    rpc,
    remove: () => {
      available = false
    },
  }
}

test('publication history excludes concurrent losers and remains readable without the source Session', async (t) => {
  const f = await fixture(t)
  const results = await Promise.allSettled(
    ['B', 'C'].map((title) =>
      publishPresentation(
        f.root,
        { ...f.document, buildId: randomUUID(), title },
        f.first.buildId,
        async () => {},
      ),
    ),
  )
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  const history = readReportHistory(f.root, f.document.workspaceId, f.document.reportId)
  const versions = (await history).versions
  assert.equal(versions.length, 2)
  assert.equal(versions[1]!.source?.sessionId, 'source')
  const catalog = parseReportCatalog(
    await f.service.catalog('reports/list', { workspaceId: f.document.workspaceId }),
  )
  assert.equal(catalog.reports.length, 1)
  assert.equal(catalog.reports[0]!.receipt.buildId, versions[0]!.receipt.buildId)
  const html = await f.service.read({
    workspaceId: f.document.workspaceId,
    receipt: f.first,
    asset: 'index.html',
  })
  assert.equal(html.sha256, f.first.files.html.sha256)
  f.remove()
  await assert.rejects(
    f.service.read({ workspaceId: f.document.workspaceId, receipt: f.first, asset: 'index.html' }),
    /workspace-unavailable/,
  )
})

test('legacy current is the only confirmed old version; damaged and symlinked reports are disclosed', async (t) => {
  const f = await fixture(t)
  const currentPath = path.join(presentationReportPath(f.root, f.document.reportId), 'current.json')
  await writeFile(
    currentPath,
    JSON.stringify({
      schemaVersion: 2,
      workspaceId: f.document.workspaceId,
      reportId: f.document.reportId,
      receipt: f.first,
    }),
  )
  const history = await readReportHistory(f.root, f.document.workspaceId, f.document.reportId)
  assert.equal(history.legacyHistoryUnavailable, true)
  assert.equal(history.versions[0]!.publishedAt, null)
  await publishPresentation(
    f.root,
    { ...f.document, buildId: randomUUID() },
    f.first.buildId,
    async () => {},
  )
  assert.equal(
    (await readReportHistory(f.root, f.document.workspaceId, f.document.reportId)).versions.length,
    2,
  )
  await symlink(
    presentationReportPath(f.root, f.document.reportId),
    presentationReportPath(f.root, 'symlink'),
  )
  const catalog = await listReports(f.root, f.document.workspaceId)
  assert.equal(catalog.reports.length, 1)
  assert.equal(catalog.unavailable, 1)
  const value = JSON.parse(await readFile(currentPath, 'utf8'))
  value.versions[1].receipt.workspaceId = 'other'
  await writeFile(currentPath, JSON.stringify(value))
  assert.equal((await listReports(f.root, f.document.workspaceId)).unavailable, 2)
  await assert.rejects(
    readReportHistory(f.root, f.document.workspaceId, f.document.reportId),
    /invalid-report-history/,
  )
})

test('workspace reader pins history and downloads, forbids historical edits, and refreshes current explicitly', async (t) => {
  const f = await fixture(t)
  const second = await publishPresentation(
    f.root,
    { ...f.document, title: '更新标题', buildId: randomUUID() },
    f.first.buildId,
    async () => {},
  )
  const saved: Uint8Array[] = []
  const model = new PresentationDeliveryModel(f.rpc, (bytes) => saved.push(bytes))
  await model.showReport(f.document.workspaceId, f.document.reportId)
  assert.equal(model.getSnapshot().resolvedReceipt?.buildId, second.buildId)
  await model.toggleHistory()
  await model.selectVersion(f.first.buildId)
  assert.equal(model.getSnapshot().historical, true)
  model.beginEdit()
  assert.equal(model.getSnapshot().editing, undefined)
  await publishPresentation(
    f.root,
    { ...f.document, title: '再次更新', buildId: randomUUID() },
    second.buildId,
    async () => {},
  )
  await model.downloadDisplayed()
  assert.deepEqual(Buffer.from(saved[0]!), await readFile(f.first.files.html.path))
  assert.equal(
    model.getSnapshot().receipts[`${f.document.workspaceId}/${f.document.reportId}`]?.buildId,
    second.buildId,
  )
  await model.selectVersion()
  assert.equal(model.getSnapshot().document?.title, '再次更新')
  model.beginEdit()
  assert.ok(model.getSnapshot().editing)
  await model.selectVersion(f.first.buildId)
  assert.ok(model.getSnapshot().editing, 'version switching cannot discard an edit')
  model.cancelEdit()
  f.remove()
  await model.downloadDisplayed()
  assert.equal(model.getSnapshot().document, undefined)
  assert.equal(model.getSnapshot().history, undefined)
  model.dispose()
})

test('catalog searches only titles, sorts deterministically, and suppresses responses after reset', async (t) => {
  const f = await fixture(t)
  await publishPresentation(
    f.root,
    { ...f.document, reportId: 'second-report', buildId: randomUUID(), title: 'ＡＢＣ 报告' },
    null,
    async () => {},
  )
  const model = new ReportCatalogModel(f.rpc)
  model.show(f.document.workspaceId)
  await model.refresh()
  const catalog = model.getSnapshot().catalog!
  const version = catalog.reports[0]!
  const chronological = [
    { id: 'legacy', title: 'A 最早', publishedAt: null },
    { id: 'older', title: 'B 较早', publishedAt: '2026-09-08T01:00:00.000Z' },
    { id: 'newer-b', title: 'C 最新', publishedAt: '2026-09-09T01:00:00.000Z' },
    { id: 'newer-a', title: 'Z 最新', publishedAt: '2026-09-09T01:00:00.000Z' },
  ].map(({ id, title, publishedAt }) => ({
    ...version,
    receipt: { ...version.receipt, reportId: id, title },
    publishedAt,
  }))
  assert.deepEqual(
    visibleReports({ ...model.getSnapshot(), catalog: { ...catalog, reports: chronological } }).map(
      (entry) => entry.receipt.reportId,
    ),
    ['newer-a', 'newer-b', 'older', 'legacy'],
    'always order by latest publication, then Report ID, with unknown times last',
  )
  model.patch({ query: 'abc 报告' })
  assert.deepEqual(
    visibleReports(model.getSnapshot()).map((v) => v.receipt.reportId),
    ['second-report'],
  )
  await model.refresh()
  assert.equal(model.getSnapshot().query, 'abc 报告')
  assert.deepEqual(
    visibleReports(model.getSnapshot()).map((entry) => entry.receipt.reportId),
    ['second-report'],
  )
  model.patch({ query: '不存在' })
  assert.equal(visibleReports(model.getSnapshot()).length, 0)
  let deliver: (value: unknown) => void = () => {}
  const delayed = new ReportCatalogModel({
    call: () =>
      new Promise((resolve) => {
        deliver = resolve
      }),
  })
  delayed.show(f.document.workspaceId)
  delayed.reset()
  deliver({ ok: true, value: await listReports(f.root, f.document.workspaceId) })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(delayed.getSnapshot().catalog, undefined)
  assert.equal(delayed.getSnapshot().open, false)
  const wrong = await readReportHistory(f.root, f.document.workspaceId, f.document.reportId)
  assert.throws(
    () => parseReportHistory({ ...wrong, currentBuildId: 'wrong' }),
    /invalid-report-history/,
  )
  model.dispose()
  delayed.dispose()
})

test('failed pointer publication never adds a historical version and scope parameters fail closed', async (t) => {
  const f = await fixture(t)
  const current = path.join(presentationReportPath(f.root, f.document.reportId), 'current.json')
  const before = await readFile(current)
  const buildId = randomUUID()
  await assert.rejects(
    publishPresentation(f.root, { ...f.document, buildId }, f.first.buildId, async () => {
      // Once the completed Build is present, abort before current can be replaced.
      try {
        await readFile(
          path.join(
            presentationReportPath(f.root, f.document.reportId),
            'builds',
            buildId,
            'presentation.json',
          ),
        )
      } catch {
        return
      }
      throw new Error('publication-interrupted')
    }),
    /publication-interrupted/,
  )
  assert.deepEqual(await readFile(current), before)
  assert.equal(
    (await readReportHistory(f.root, f.document.workspaceId, f.document.reportId)).versions.length,
    1,
  )
  await assert.rejects(
    f.service.catalog('reports/list', { workspaceId: f.document.workspaceId, sessionId: 'source' }),
    /invalid-request/,
  )
  await assert.rejects(
    f.service.catalog('reports/list', { workspaceId: 'wrong' }),
    /workspace-unavailable/,
  )
})
