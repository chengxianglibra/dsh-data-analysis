import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ReportCatalogModel, visibleReports } from '../../src/client/presentation/catalog-model.ts'
import {
  PresentationDeliveryModel,
  verifyPresentationAsset,
} from '../../src/client/presentation/delivery-model.ts'
import {
  analysisCatalogBuild,
  analysisCatalogId,
} from '../../src/presentation/contracts/analysis-catalog.ts'
import {
  ANALYSIS_UI_FORMAT,
  type AnalysisDocument,
  analysisRecordId,
} from '../../src/presentation/contracts/analysis-document.ts'
import { parseReportCatalog, parseReportHistory } from '../../src/presentation/contracts/catalog.ts'
import { presentationReportPath } from '../../src/presentation/files.ts'
import {
  listReports,
  publishPresentation,
  readReportHistory,
} from '../../src/presentation/reports.ts'
import { MarivoPresentationFileService } from '../../src/presentation/rpc.ts'

const tab = { kind: 'agent', sessionId: 'source', surface: 'tab' } as const

function analysisDocument(reportId: string, buildId: string, title: string): AnalysisDocument {
  return {
    schemaVersion: ANALYSIS_UI_FORMAT,
    workspaceId: 'workspace',
    reportId,
    buildId,
    recordId: analysisRecordId(reportId, buildId),
    title,
    locale: 'zh-CN',
    generatedAt: '2026-10-29T00:00:00Z',
    catalog: { id: analysisCatalogId, build: analysisCatalogBuild },
    program: `root = TextContent(${JSON.stringify(title)});`,
    resources: {},
  }
}

/** Published versions keep their own record identity, as marivo_present does. */
function version(base: AnalysisDocument, title = base.title): AnalysisDocument {
  return analysisDocument(base.reportId, randomUUID(), title)
}

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'report-catalog-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const document = analysisDocument('report', 'build', '报告')
  const first = await publishPresentation(root, document, null, async () => {}, undefined, {
    kind: 'agent',
    sessionId: 'source',
    surface: 'tab',
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
              : await service.report(payload, signal)
        return { ok: true, value }
      } catch (error) {
        return {
          ok: false,
          error: { message: error instanceof Error ? error.message : String(error) },
        }
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
        version(f.document, title),
        f.first.buildId,
        async () => {},
        undefined,
        tab,
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
  const input = {
    workspaceId: f.document.workspaceId,
    receipt: f.first,
    asset: 'presentation.json',
  }
  const saved = await f.service.read(input)
  assert.deepEqual(Object.keys(f.first.files), ['document'])
  assert.deepEqual(
    Buffer.from(saved.bodyBase64, 'base64'),
    await readFile(f.first.files.document.path),
  )
  f.remove()
  await assert.rejects(f.service.read(input), /workspace-unavailable/)
})

test('legacy current pointers and incomplete publication records are rejected without changing files', async (t) => {
  const f = await fixture(t)
  const currentPath = path.join(presentationReportPath(f.root, f.document.reportId), 'current.json')
  const pointer = JSON.parse(await readFile(currentPath, 'utf8'))
  assert.equal(pointer.schemaVersion, 4)
  const variants = [
    { ...pointer, schemaVersion: 2, versions: undefined },
    { ...pointer, schemaVersion: 3, legacyHistoryUnavailable: false },
    {
      ...pointer,
      versions: [{ ...pointer.versions[0], source: { kind: 'agent', sessionId: 'source' } }],
    },
    { ...pointer, versions: [{ ...pointer.versions[0], source: null }] },
    { ...pointer, versions: [{ ...pointer.versions[0], publishedAt: null }] },
  ]
  for (const value of variants) {
    const bytes = JSON.stringify(value)
    await writeFile(currentPath, bytes)
    await assert.rejects(
      readReportHistory(f.root, f.document.workspaceId, f.document.reportId),
      /invalid-report/,
    )
    assert.deepEqual(await listReports(f.root, f.document.workspaceId), {
      workspaceId: f.document.workspaceId,
      reports: [],
      unavailable: 1,
    })
    assert.equal(await readFile(currentPath, 'utf8'), bytes)
  }
})

test('damaged and symlinked reports are disclosed without hiding valid analysis reports', async (t) => {
  const f = await fixture(t)
  const currentPath = path.join(presentationReportPath(f.root, f.document.reportId), 'current.json')
  await publishPresentation(
    f.root,
    version(f.document),
    f.first.buildId,
    async () => {},
    undefined,
    tab,
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

test('workspace reader pins history versions and returns to current explicitly', async (t) => {
  const f = await fixture(t)
  const second = await publishPresentation(
    f.root,
    version(f.document, '更新标题'),
    f.first.buildId,
    async () => {},
    undefined,
    tab,
  )
  const model = new PresentationDeliveryModel(f.rpc)
  await model.showReport(f.document.workspaceId, f.document.reportId)
  assert.equal(model.getSnapshot().resolvedReceipt?.buildId, second.buildId)
  assert.equal(model.getSnapshot().analysisDocument?.title, '更新标题')
  await model.toggleHistory()
  await model.selectVersion(f.first.buildId)
  assert.equal(model.getSnapshot().historical, true)
  assert.equal(model.getSnapshot().analysisDocument?.buildId, f.first.buildId)
  await publishPresentation(
    f.root,
    version(f.document, '再次更新'),
    second.buildId,
    async () => {},
    undefined,
    tab,
  )
  assert.equal(model.getSnapshot().resolvedReceipt?.buildId, f.first.buildId)
  await model.selectVersion()
  assert.equal(model.getSnapshot().analysisDocument?.title, '再次更新')
  assert.equal(model.getSnapshot().historical, false)
  f.remove()
  await model.selectVersion(f.first.buildId)
  assert.equal(model.getSnapshot().analysisDocument, undefined)
  assert.equal(model.getSnapshot().history, undefined)
  model.dispose()
})

test('catalog searches only titles, sorts deterministically, and suppresses responses after reset', async (t) => {
  const f = await fixture(t)
  await publishPresentation(
    f.root,
    analysisDocument('second-report', randomUUID(), 'ＡＢＣ 报告'),
    null,
    async () => {},
    undefined,
    tab,
  )
  const model = new ReportCatalogModel(f.rpc)
  model.show(f.document.workspaceId)
  await model.refresh()
  const catalog = model.getSnapshot().catalog!
  const version = catalog.reports[0]!
  const chronological = [
    { id: 'earliest', title: 'A 最早', publishedAt: '2026-09-07T01:00:00.000Z' },
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
    ['newer-a', 'newer-b', 'older', 'earliest'],
    'always order by latest publication, then Report ID, with deterministic ordering for equal times',
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
    publishPresentation(
      f.root,
      analysisDocument(f.document.reportId, buildId, f.document.title),
      f.first.buildId,
      async () => {
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
      },
      undefined,
      tab,
    ),
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

test('JSON-only publication serves only the saved document and rejects changed source bytes', async (t) => {
  const f = await fixture(t)
  assert.deepEqual(Object.keys(f.first.files), ['document'])
  const directory = path.dirname(f.first.files.document.path)
  assert.deepEqual(await readdir(directory), ['presentation.json'])
  const input = {
    workspaceId: f.document.workspaceId,
    receipt: f.first,
    asset: 'presentation.json',
  }
  await assert.rejects(f.service.read({ ...input, asset: 'index.html' }), /invalid-request/)
  const saved = await f.service.read(input)
  const bytes = await verifyPresentationAsset(saved, f.first)
  assert.equal(JSON.parse(Buffer.from(bytes).toString()).schemaVersion, ANALYSIS_UI_FORMAT)
  assert.deepEqual(await readdir(directory), ['presentation.json'])
  await assert.rejects(
    verifyPresentationAsset({ ...saved, bytes: saved.bytes + 1 }, f.first),
    /presentation-file-(identity|size)-mismatch/,
  )
  await writeFile(f.first.files.document.path, '{}')
  await assert.rejects(f.service.read(input), /asset-digest-mismatch/)
})
