import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
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
import {
  parseReportCatalog,
  parseReportHistory,
  REPORT_HISTORY_LIMIT,
} from '../../src/presentation/contracts/catalog.ts'
import { parseReportRef } from '../../src/presentation/contracts/report-ref.ts'
import { presentationReportPath } from '../../src/presentation/files.ts'
import { PresentationRecoveryError } from '../../src/presentation/recovery.ts'
import { createMarivoReportListTool } from '../../src/presentation/report-list.ts'
import {
  listReports,
  publishPresentation,
  readReportHistory,
} from '../../src/presentation/reports.ts'
import {
  MarivoPresentationFileService,
  registerMarivoPresentationRpc,
} from '../../src/presentation/rpc.ts'
import { createMarivoUiReadTool } from '../../src/presentation/tool.ts'
import { createConnectionFixture } from '../semantic-reference-input/fixtures.ts'
import { reportListOutput, reportReadOutput } from './report-protocol-fixture.ts'

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

/** Published versions keep their own record identity, as marivo_report_write does. */
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

test('Agent title search recovers distinct saved refs with bounded pages and no draft', async (t) => {
  const f = await fixture(t)
  const source = () => ({ id: 'workspace', path: f.root })
  // List and saved-read only consume the execution signal; no Agent or Runtime is needed.
  const exec = { signal: new AbortController().signal } as ToolRunContext
  const list = createMarivoReportListTool(source)
  for (const reportId of ['one', 'two'])
    await publishPresentation(
      f.root,
      analysisDocument(reportId, 'build', 'Ｔｒｉｎｏ 每日报告'),
      null,
      async () => {},
      undefined,
      tab,
    )
  const first = reportListOutput.parse(await list.execute({ query: 'trino 报告', limit: 1 }, exec))
  assert.equal(first.reports.length, 1)
  assert(first.nextCursor)
  const second = reportListOutput.parse(
    await list.execute({ query: 'trino 报告', limit: 1, cursor: first.nextCursor }, exec),
  )
  assert.equal(second.reports.length, 1)
  assert.equal(second.nextCursor, null)
  assert.notEqual(first.reports[0]!.ref, second.reports[0]!.ref)
  for (const item of [...first.reports, ...second.reports]) {
    assert.equal(item.title, 'Ｔｒｉｎｏ 每日报告')
    assert.equal(item.sourceSessionId, 'source')
    const read = await createMarivoUiReadTool(source).execute({ ref: item.ref }, exec)
    assert.equal(reportReadOutput(read).title, item.title)
  }
  const empty = reportListOutput.parse(await list.execute({ query: 'no matching report' }, exec))
  assert.deepEqual(empty.reports, [])
  assert.equal(empty.nextCursor, null)
  await assert.rejects(
    list.execute({ query: 'different', cursor: first.nextCursor }, exec),
    /report-list-cursor-stale/,
  )
  await assert.rejects(list.execute({ cursor: 'broken' }, exec), /report-list-cursor-invalid/)
  for (const args of [{ limit: 0 }, { limit: 51 }, { workspaceId: 'other' }])
    await assert.rejects(list.execute(args, exec))
  await publishPresentation(
    f.root,
    analysisDocument('new', 'build', 'trino 报告'),
    null,
    async () => {},
    undefined,
    tab,
  )
  await assert.rejects(
    list.execute({ query: 'trino 报告', cursor: first.nextCursor }, exec),
    /report-list-cursor-stale/,
  )
})

test('Agent discovery reports unreadable pointers and rejects changed Workspace or cancellation', async (t) => {
  const f = await fixture(t)
  const exec = { signal: new AbortController().signal } as ToolRunContext
  const directory = presentationReportPath(f.root, 'broken')
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'current.json'), '{}')
  const list = createMarivoReportListTool(() => ({ id: 'workspace', path: f.root }))
  const result = reportListOutput.parse(await list.execute({}, exec))
  assert.equal(result.unavailable, 1)
  assert.equal(result.reports.length, 1)
  assert.equal(parseReportRef(result.reports[0]!.ref).workspaceId, 'workspace')
  const other = reportListOutput.parse(
    await createMarivoReportListTool(() => ({ id: 'other', path: f.root })).execute({}, exec),
  )
  assert.deepEqual(other.reports, [])
  let changed = false
  const switching = createMarivoReportListTool(() => {
    const id = changed ? 'other' : 'workspace'
    changed = true
    return { id, path: f.root }
  })
  await assert.rejects(switching.execute({}, exec), /presentation-workspace-changed/)
  await assert.rejects(list.execute({}, { ...exec, signal: AbortSignal.abort() }), /abort/i)
})

test('refresh preparation accepts only the readable current build in the session workspace', async (t) => {
  const f = await fixture(t)
  const service = new MarivoPresentationFileService((sessionId) =>
    sessionId === 'session' ? { id: f.document.workspaceId, path: f.root } : undefined,
  )
  t.after(() => service.close())
  const request = {
    sessionId: 'session',
    workspaceId: f.document.workspaceId,
    recordId: f.document.recordId,
  }
  const { connection, channels } = createConnectionFixture()
  const stop = registerMarivoPresentationRpc(connection, service)
  t.after(() => stop())
  const call = (payload: unknown) =>
    channels.get('/marivo-presentation')!(
      'report/refresh-prepare',
      payload,
      new AbortController().signal,
    )
  const prepared = await call(request)
  assert.ok(prepared.ok)
  assert.ok(prepared.value && typeof prepared.value === 'object' && 'ref' in prepared.value)
  assert.deepEqual(parseReportRef(prepared.value.ref), {
    kind: 'saved',
    workspaceId: f.document.workspaceId,
    reportId: f.document.reportId,
    buildId: f.document.buildId,
  })
  await assert.rejects(
    service.refreshPrepare({ ...request, sessionId: 'other' }),
    /workspace-unavailable/,
  )
  await assert.rejects(
    service.refreshPrepare({ ...request, workspaceId: 'other' }),
    /workspace-unavailable/,
  )
  await assert.rejects(service.refreshPrepare({ ...request, unexpected: true }), /invalid-request/)

  const next = version(f.document)
  await publishPresentation(f.root, next, f.first.buildId, async () => {}, undefined, tab)
  assert.deepEqual(await call(request), {
    ok: false,
    error: { code: 'internal', message: 'report-not-current', details: {} },
  })
  assert.equal(
    parseReportRef((await service.refreshPrepare({ ...request, recordId: next.recordId })).ref)
      .kind,
    'saved',
  )
})

test('refresh preparation rejects a session workspace changed while resolving the report', async (t) => {
  const f = await fixture(t)
  let reads = 0
  const service = new MarivoPresentationFileService(() => ({
    id: f.document.workspaceId,
    path: ++reads === 1 ? f.root : path.join(f.root, 'different'),
  }))
  t.after(() => service.close())
  await assert.rejects(
    service.refreshPrepare({
      sessionId: 'session',
      workspaceId: f.document.workspaceId,
      recordId: f.document.recordId,
    }),
    /workspace-changed/,
  )
})

test('delete RPC requires the current build and removes the report and its history', async (t) => {
  const f = await fixture(t)
  const next = version(f.document)
  await publishPresentation(f.root, next, f.first.buildId, async () => {}, undefined, tab)
  const { connection, channels } = createConnectionFixture()
  const stop = registerMarivoPresentationRpc(connection, f.service)
  t.after(() => stop())
  const call = (payload: unknown) =>
    channels.get('/marivo-presentation')!('reports/delete', payload, new AbortController().signal)
  const request = {
    workspaceId: f.document.workspaceId,
    reportId: f.document.reportId,
    expectedBuildId: f.first.buildId,
  }
  assert.deepEqual(await call(request), {
    ok: false,
    error: { code: 'internal', message: 'report-delete-conflict', details: {} },
  })
  assert.equal(
    parseReportCatalog(await f.service.catalog('reports/list', { workspaceId: 'workspace' }))
      .reports.length,
    1,
  )
  assert.deepEqual(await call({ ...request, expectedBuildId: next.buildId }), {
    ok: true,
    value: { cleanupPending: false },
  })
  assert.equal(
    parseReportCatalog(await f.service.catalog('reports/list', { workspaceId: 'workspace' }))
      .reports.length,
    0,
  )
  assert.deepEqual(
    await channels.get('/marivo-presentation')!(
      'reports/history',
      { workspaceId: request.workspaceId, reportId: request.reportId },
      new AbortController().signal,
    ),
    { ok: false, error: { code: 'internal', message: 'report-not-found', details: {} } },
  )
  assert.deepEqual(await call(request), {
    ok: false,
    error: { code: 'internal', message: 'report-not-found', details: {} },
  })
})

test('resolve RPC distinguishes a missing view from a missing build', async (t) => {
  const f = await fixture(t)
  const { connection, channels } = createConnectionFixture()
  const stop = registerMarivoPresentationRpc(connection, f.service)
  t.after(() => stop())
  const call = () =>
    channels.get('/marivo-presentation')!(
      'reports/resolve',
      { workspaceId: f.document.workspaceId, reportId: f.document.reportId },
      new AbortController().signal,
    )
  await rm(f.first.files.document.path)
  assert.deepEqual(await call(), {
    ok: false,
    error: { code: 'internal', message: 'asset-missing', details: {} },
  })
  await rm(presentationReportPath(f.root, f.document.reportId), { recursive: true })
  assert.deepEqual(await call(), {
    ok: false,
    error: { code: 'internal', message: 'report-not-found', details: {} },
  })
})

test('delete RPC rejects unauthorized or changed workspace ownership', async (t) => {
  const f = await fixture(t)
  const request = {
    workspaceId: f.document.workspaceId,
    reportId: f.document.reportId,
    expectedBuildId: f.document.buildId,
  }
  await assert.rejects(
    f.service.deleteReport({ ...request, workspaceId: 'other' }),
    /workspace-unavailable/,
  )
  await assert.rejects(
    f.service.deleteReport({ ...request, sessionId: 'source' }),
    /invalid-request/,
  )
  let resolutions = 0
  const changed = new MarivoPresentationFileService(undefinedResolver, () => ({
    id: f.document.workspaceId,
    path: ++resolutions === 1 ? f.root : path.join(f.root, 'different'),
  }))
  t.after(() => changed.close())
  await assert.rejects(changed.deleteReport(request), /workspace-changed/)
  assert.equal(
    parseReportCatalog(await f.service.catalog('reports/list', { workspaceId: 'workspace' }))
      .reports.length,
    1,
  )
})

function undefinedResolver() {
  return undefined
}

test('publication history excludes concurrent losers and remains readable without the source Session', async (t) => {
  const f = await fixture(t)
  const candidates = ['B', 'C'].map((title) => version(f.document, title))
  const results = await Promise.allSettled(
    candidates.map((document) =>
      publishPresentation(f.root, document, f.first.buildId, async () => {}, undefined, tab),
    ),
  )
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  const history = readReportHistory(f.root, f.document.workspaceId, f.document.reportId)
  const versions = (await history).versions
  assert.equal(versions.length, 2)
  const buildDirectories = await readdir(
    path.join(presentationReportPath(f.root, f.document.reportId), 'builds'),
  )
  assert.deepEqual(buildDirectories.sort(), versions.map((v) => v.receipt.buildId).sort())
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

test('publication callback observes the new pointer and is not called on conflict', async (t) => {
  const f = await fixture(t)
  const currentPath = path.join(presentationReportPath(f.root, f.document.reportId), 'current.json')
  const next = version(f.document)
  let observedBuildId: string | undefined
  await publishPresentation(
    f.root,
    next,
    f.first.buildId,
    async () => {},
    undefined,
    tab,
    () => {
      observedBuildId = JSON.parse(readFileSync(currentPath, 'utf8')).receipt.buildId
    },
  )
  assert.equal(observedBuildId, next.buildId)

  let called = false
  await assert.rejects(
    publishPresentation(
      f.root,
      version(f.document),
      f.first.buildId,
      async () => {},
      undefined,
      tab,
      () => {
        called = true
      },
    ),
    /report-save-conflict/,
  )
  assert.equal(called, false)
  assert.equal(JSON.parse(await readFile(currentPath, 'utf8')).receipt.buildId, next.buildId)
})

test('history limit preserves current and removes the unpublished build with recovery guidance', async (t) => {
  const f = await fixture(t)
  const reportDirectory = presentationReportPath(f.root, f.document.reportId)
  const currentPath = path.join(reportDirectory, 'current.json')
  const pointer = JSON.parse(await readFile(currentPath, 'utf8'))
  // Synthetic history exercises the limit without writing thousands of irrelevant builds.
  const firstVersion = pointer.versions[0]
  for (let i = 1; i < REPORT_HISTORY_LIMIT; i++) {
    const buildId = `old-${i}`
    pointer.versions.push({
      ...firstVersion,
      receipt: {
        ...firstVersion.receipt,
        buildId,
        files: {
          document: {
            ...firstVersion.receipt.files.document,
            path: path.join(reportDirectory, 'builds', buildId, 'presentation.json'),
          },
        },
      },
    })
  }
  const before = JSON.stringify(pointer)
  await writeFile(currentPath, before)
  const next = version(f.document)
  await assert.rejects(
    publishPresentation(f.root, next, f.first.buildId, async () => {}, undefined, tab),
    (error: unknown) => {
      assert.ok(error instanceof PresentationRecoveryError)
      assert.equal(error.code, 'report-history-full')
      assert.ok(error.recovery.nextAction)
      const normalized = JSON.parse(error.message.slice(error.message.indexOf('error=') + 6))
      assert.equal(normalized.code, 'report-history-full')
      assert.equal(normalized.recovery.nextAction, error.recovery.nextAction)
      return true
    },
  )
  assert.equal(await readFile(currentPath, 'utf8'), before)
  assert.deepEqual(await readdir(path.join(reportDirectory, 'builds')), [f.first.buildId])
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
