import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { visibleReports } from '../../src/client/presentation/catalog-model.ts'
import { PresentationDeliveryModel } from '../../src/client/presentation/delivery-model.ts'
import {
  analysisRecordId,
  parseAnalysisDocument,
  parseSavedPresentation,
} from '../../src/presentation/contracts/analysis-document.ts'
import { datasetSnapshotRef } from '../../src/presentation/dataset-snapshot.ts'
import { presentationSha256 } from '../../src/presentation/files.ts'
import { MarivoPresentationProjection } from '../../src/presentation/projection/index.ts'
import { parsePresentationDelivery } from '../../src/presentation/receipt.ts'
import {
  publishPresentation,
  readAnalysisRecord,
  readReceiptDocument,
  resolvePresentation,
} from '../../src/presentation/reports.ts'
import { MarivoPresentationFileService } from '../../src/presentation/rpc.ts'
import { createMarivoPresentTool, createMarivoUiReadTool } from '../../src/presentation/tool.ts'
import { savePythonExecution } from '../../src/python-execution.ts'
import { resolvePublishingConfig } from '../../src/report-publishing/config.ts'
import { ReportPublishingService } from '../../src/report-publishing/service.ts'
import { frameSnapshot } from '../unified-analysis-ui/fixtures.ts'

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'analysis-ui-p2-')))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  t.after(async () => {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(root, { recursive: true, force: true })
  })
  const captureId = randomUUID(),
    captureDirectory = `.dsh-data-analysis/captures/${randomUUID()}`
  await mkdir(path.join(root, captureDirectory), { recursive: true })
  const snapshot = {
    schemaVersion: 1,
    kind: 'dataset',
    fetchedAt: '2026-10-28T00:00:00Z',
    source: { kind: 'dataframe', details: 'not-captured' },
    data: {
      schemaVersion: 1,
      columns: [
        { id: 'account', label: 'Account', type: 'int64', nullable: true },
        { id: 'amount', label: 'Amount', type: 'decimal', nullable: true },
      ],
      rows: [
        ['9007199254740993', '12345678901234.5678'],
        [null, null],
      ],
      rowCount: 2,
      limit: 5000,
      truncated: false,
    },
    coverage: {
      start: 0,
      totalRows: 2,
      capturedRows: 2,
      complete: true,
      columns: ['account', 'amount'],
      business: 'unknown',
    },
  }
  const capturePath = `${captureDirectory}/${captureId}.json`
  const bytes = Buffer.from(JSON.stringify(snapshot))
  await writeFile(path.join(root, capturePath), bytes)
  const codeRef = await savePythonExecution(root, {
    text: 'capture_dataset(df)',
    startedAt: '2026-10-28T00:00:00.000Z',
    finishedAt: '2026-10-28T00:00:01.000Z',
    captures: {
      workspaceId: 'workspace',
      sessionId: 'session',
      callId: 'producer',
      rootCallId: 'producer',
      entries: [{ captureId, path: capturePath, sha256: presentationSha256(bytes) }],
    },
  })
  const session = {
    id: 'session',
    snapshotEvents: () => [
      { type: 'tool/call', data: { callId: 'native', name: 'marivo_present', turn: 1 } },
      { type: 'tool/call', data: { callId: 'code', name: 'run_code', turn: 2 } },
    ],
  } as unknown as Session
  let reads = 0
  const runner = {
    status: 'ready' as const,
    binding: {
      projectRoot: root,
      pythonExecutable: '/bound/python',
      marivoVersion: '0.6.0.dev0',
      packagePath: '/bound/marivo',
      subprocessPolicyId: 'policy',
      fingerprint: 'fingerprint',
      presentationKit: { version: '1.2.0', packagePath: '/bound/helper' },
    },
    async runChecked() {
      reads++
      return {
        exitCode: 0,
        signal: null,
        durationMs: 0,
        stderr: Buffer.alloc(0),
        stdout: Buffer.from(JSON.stringify({ ok: true, snapshots: [frameSnapshot()] })),
      }
    },
  }
  const projection = new MarivoPresentationProjection(runner)
  const source = () => ({ workspaceId: 'workspace', projection })
  const tool = createMarivoPresentTool(source, session)
  const exec = {
    agent: { session },
    callId: 'native',
    signal: new AbortController().signal,
  } as unknown as ToolRunContext
  const service = new MarivoPresentationFileService(
    () => ({ id: 'workspace', path: root }),
    (id) => (id === 'workspace' ? { id, path: root } : undefined),
  )
  t.after(() => service.close())
  const resources = {
    data: { kind: 'dataset-snapshot', snapshotRef: datasetSnapshotRef(codeRef, captureId) },
    frame: { kind: 'marivo-frame', sessionId: 'session', artifactId: 'artifact' },
  }
  const present = async (args: Record<string, unknown>, code = false) =>
    parsePresentationDelivery(
      JSON.parse(
        (
          (await tool.execute(
            args,
            code ? { ...exec, callId: ToolCallId('child'), rootCallId: ToolCallId('code') } : exec,
          )) as { deliveryJson: string }
        ).deliveryJson,
      ),
    )
  return {
    root,
    resources,
    present,
    service,
    projection,
    source,
    exec,
    captureDirectory,
    reads: () => reads,
  }
}

test('reference-only results save exact resources and survive capture removal and cold service reopen', async (t) => {
  const f = await fixture(t)
  const data = await f.present({ resources: { data: f.resources.data } })
  const frame = await f.present({ resources: { frame: f.resources.frame }, surface: 'tab' }, true)
  assert.equal(data.surface, 'tool')
  assert.equal(frame.surface, 'tab')
  assert.equal(frame.turn, 2)
  assert.equal(f.reads(), 1)
  const catalog = await f.service.catalog('reports/list', { workspaceId: 'workspace' })
  assert('reports' in catalog)
  const state = { open: true, workspaceId: 'workspace', query: '', loading: false, catalog }
  assert.deepEqual(
    visibleReports(state).map((v) => v.receipt.reportId),
    [frame.receipt.reportId],
  )
  assert.deepEqual(
    visibleReports({ ...state, surface: 'tool' }).map((v) => v.receipt.reportId),
    [data.receipt.reportId],
  )
  const saved = parseAnalysisDocument(await readReceiptDocument(f.root, data.receipt))
  assert.equal(saved.program, 'root = DatasetView("data");')
  assert.deepEqual(
    saved.resources.data?.kind === 'snapshot' && saved.resources.data.snapshot.data.rows,
    [
      ['9007199254740993', '12345678901234.5678'],
      [null, null],
    ],
  )
  await rm(path.join(f.root, f.captureDirectory), { recursive: true })
  await f.service.close()
  const cold = new MarivoPresentationFileService(
    () => ({ id: 'workspace', path: f.root }),
    () => ({ id: 'workspace', path: f.root }),
  )
  t.after(() => cold.close())
  for (const receipt of [data.receipt, frame.receipt]) {
    const model = new PresentationDeliveryModel({
      async call(_channel, endpoint, payload, signal) {
        return {
          ok: true,
          value:
            endpoint === 'files/read'
              ? await cold.read(payload, signal)
              : endpoint === 'reports/history'
                ? await cold.catalog(endpoint, payload, signal)
                : await cold.report('reports/resolve', payload, signal),
        }
      },
    })
    t.after(() => model.dispose())
    await model.showBuild('workspace', receipt.reportId, receipt.buildId)
    assert.equal(model.getSnapshot().error, undefined)
    assert.equal(
      model.getSnapshot().analysisDocument?.recordId,
      analysisRecordId(receipt.reportId, receipt.buildId),
    )
    assert.equal(model.getSnapshot().document, undefined)
    assert.equal(model.getSnapshot().publishingUnavailable, true)
    await assert.rejects(
      cold.read({ workspaceId: 'workspace', receipt, asset: 'index.html' }),
      /analysis-ui-export-unavailable/,
    )
    await assert.rejects(
      cold.report('reports/save', {
        workspaceId: 'workspace',
        reportId: receipt.reportId,
        expectedBuildId: receipt.buildId,
        edits: {},
      }),
      /analysis-ui-edit-unavailable/,
    )
  }
  let uploads = 0
  const publishing = new ReportPublishingService(
    resolvePublishingConfig({
      enabled: true,
      storage: {
        name: 'test',
        endpoint: 'https://s3.example.test',
        region: 'us-east-1',
        bucket: 'reports',
        accessKeyIdRef: 'TEST_AK',
        secretAccessKeyRef: 'TEST_SK',
      },
      publicBaseUrl: 'https://reports.example.test',
      pathPrefix: 'test',
    }),
    {
      describe: async () => ({ configured: true, writable: true, source: 'test' }),
      resolve: async () => ({ value: 'test-only', source: 'test' }),
      set: async () => {},
      unset: async () => {},
    },
    cold,
    async () => {
      uploads++
    },
  )
  for (const view of [
    undefined,
    '<!doctype html><html lang="zh-CN"><head></head><body>View</body></html>',
  ]) {
    await assert.rejects(
      publishing.publish(
        { workspaceId: 'workspace' },
        data.receipt.reportId,
        data.receipt.buildId,
        new AbortController().signal,
        view,
      ),
      /analysis-ui-export-unavailable/,
    )
  }
  assert.equal(uploads, 0)
  assert.equal(f.reads(), 1)
})

test('eight-component composition admits only saved image resources and exact compatible data views', async (t) => {
  const f = await fixture(t)
  const image = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'base64',
  )
  await writeFile(path.join(f.root, 'image.png'), image)
  const resources = { ...f.resources, picture: { kind: 'image-file', path: 'image.png' } }
  const program =
    'root = Stack([Card([TextContent("Saved data"), AnalysisFrameView("frame", {chart:"table"})]), Tabs([TabItem("data","Data",[DatasetView("data")]),TabItem("image","Image",[Image("Saved image","picture")])])]);'
  const delivery = await f.present({ resources, program })
  const document = parseAnalysisDocument(await readReceiptDocument(f.root, delivery.receipt))
  assert.equal(document.resources.picture?.kind, 'image')
  for (const bad of [
    program.replace('DatasetView("data")', 'DatasetView("frame")'),
    program.replace('DatasetView("data")', 'DatasetView("missing")'),
    program.replace(
      'DatasetView("data")',
      'DatasetView("data", {chart:"metric",encoding:{value:"amount"}})',
    ),
    program.replace(
      'DatasetView("data")',
      'DatasetView("data", {chart:"table",columns:["missing"]})',
    ),
    program.replace(
      'Image("Saved image","picture")',
      'Image("remote","https://example.com/picture.png")',
    ),
    program.replace('TextContent("Saved data")', 'Stack([Button("unsupported")])'),
  ])
    await assert.rejects(f.present({ resources, program: bad }))
  await assert.rejects(
    f.present({ resources: { image: { kind: 'image-file', path: '../outside.png' } } }),
    /image-path-invalid/,
  )
})

test('record reads omit rows; failed resource reads, cancellation and stale saves preserve published current', async (t) => {
  const f = await fixture(t)
  const original = await f.present({ resources: { data: f.resources.data } })
  const document = parseAnalysisDocument(await readReceiptDocument(f.root, original.receipt))
  const bytes = await readFile(original.receipt.files.document.path)
  const read = createMarivoUiReadTool(() => ({ id: 'workspace', path: f.root }))
  const response = (await read.execute({ recordId: document.recordId }, f.exec)) as {
    definitionJson: string
  }
  const definition = JSON.parse(response.definitionJson)
  assert.equal(definition.program, document.program)
  assert.deepEqual(
    definition.resources.data.columns,
    document.resources.data?.kind === 'snapshot' && document.resources.data.snapshot.data.columns,
  )
  assert.equal(definition.resources.data.rows, undefined)
  assert.equal(f.reads(), 0)
  const nextId = randomUUID()
  const next = {
    ...document,
    buildId: nextId,
    recordId: analysisRecordId(document.reportId, nextId),
    title: 'New version',
  }
  const updated = await publishPresentation(f.root, next, document.buildId, async () => {})
  await assert.rejects(
    publishPresentation(
      f.root,
      { ...next, buildId: 'stale', recordId: analysisRecordId(document.reportId, 'stale') },
      document.buildId,
      async () => {},
    ),
    /report-save-conflict/,
  )
  assert.equal(
    (await readAnalysisRecord(f.root, 'workspace', document.reportId, document.buildId)).title,
    document.title,
  )
  await assert.rejects(readAnalysisRecord(f.root, 'other', document.reportId, document.buildId))
  await assert.rejects(read.execute({ recordId: 'invalid' }, f.exec), /record-id/)
  await rm(path.join(f.root, f.captureDirectory), { recursive: true })
  await assert.rejects(f.present({ resources: { data: f.resources.data } }))
  const abort = new AbortController()
  abort.abort()
  await assert.rejects(
    publishPresentation(f.root, next, updated.buildId, async () => {}, abort.signal),
    /abort/i,
  )
  assert.equal(
    (await resolvePresentation(f.root, 'workspace', document.reportId)).buildId,
    updated.buildId,
  )
  assert.deepEqual(await readFile(original.receipt.files.document.path), bytes)
  assert.equal(parseSavedPresentation(document).schemaVersion, 'dsh.analysis-ui/v1')
})
