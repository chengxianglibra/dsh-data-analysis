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
import type { DatasetSnapshot } from '../../src/presentation/contracts/snapshot.ts'
import { datasetSnapshotRef, frameSnapshotRef } from '../../src/presentation/dataset-snapshot.ts'
import { presentationSha256 } from '../../src/presentation/files.ts'
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
import { datasetSnapshot } from '../unified-analysis-ui/dataset-fixtures.ts'
import { frameSnapshot } from '../unified-analysis-ui/fixtures.ts'

async function fixture(t: { after(fn: () => Promise<void>): void }, dataset?: DatasetSnapshot) {
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
  const snapshot = dataset ?? {
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
  const frameId = randomUUID()
  const framePath = `${captureDirectory}/${frameId}.json`
  const frameBytes = Buffer.from(JSON.stringify(frameSnapshot()))
  await writeFile(path.join(root, framePath), frameBytes)
  const codeRef = await savePythonExecution(root, {
    text: 'capture_dataset(df)',
    startedAt: '2026-10-28T00:00:00.000Z',
    finishedAt: '2026-10-28T00:00:01.000Z',
    captures: {
      workspaceId: 'workspace',
      sessionId: 'session',
      callId: 'producer',
      rootCallId: 'producer',
      entries: [
        { captureId, path: capturePath, sha256: presentationSha256(bytes) },
        { captureId: frameId, path: framePath, sha256: presentationSha256(frameBytes) },
      ],
    },
  })
  const session = {
    id: 'session',
    snapshotEvents: () => [
      { type: 'tool/call', data: { callId: 'native', name: 'marivo_present', turn: 1 } },
      { type: 'tool/call', data: { callId: 'code', name: 'run_code', turn: 2 } },
    ],
  } as unknown as Session
  const source = () => ({ id: 'workspace', path: root })
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
    frame: { kind: 'frame-snapshot', snapshotRef: frameSnapshotRef(codeRef, frameId) },
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
    source,
    exec,
    captureDirectory,
  }
}

test('reference-only results save exact resources and survive capture removal and cold service reopen', async (t) => {
  const f = await fixture(t)
  const data = await f.present({ resources: { data: f.resources.data } })
  const frame = await f.present({ resources: { frame: f.resources.frame }, surface: 'tab' }, true)
  assert.equal(data.surface, 'tool')
  assert.equal(frame.surface, 'tab')
  assert.equal(frame.turn, 2)
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
                : await cold.report(payload, signal),
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
    await assert.rejects(
      cold.read({ workspaceId: 'workspace', receipt, asset: 'index.html' }),
      /invalid-request/,
    )
  }
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
  const nextId = randomUUID()
  const next = {
    ...document,
    buildId: nextId,
    recordId: analysisRecordId(document.reportId, nextId),
    title: 'New version',
  }
  const updated = await publishPresentation(
    f.root,
    next,
    document.buildId,
    async () => {},
    undefined,
    { kind: 'agent', sessionId: 'session', surface: 'tool' },
  )
  await assert.rejects(
    publishPresentation(
      f.root,
      { ...next, buildId: 'stale', recordId: analysisRecordId(document.reportId, 'stale') },
      document.buildId,
      async () => {},
      undefined,
      { kind: 'agent', sessionId: 'session', surface: 'tool' },
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
    publishPresentation(f.root, next, updated.buildId, async () => {}, abort.signal, {
      kind: 'agent',
      sessionId: 'session',
      surface: 'tool',
    }),
    /abort/i,
  )
  assert.equal(
    (await resolvePresentation(f.root, 'workspace', document.reportId)).buildId,
    updated.buildId,
  )
  assert.deepEqual(await readFile(original.receipt.files.document.path), bytes)
  assert.equal(parseSavedPresentation(document).schemaVersion, 'dsh.analysis-ui/v1')
})

test('statement updates reuse embedded snapshots without resolving Runtime and save independent versions', async (t) => {
  const f = await fixture(t)
  const original = await f.present({
    resources: f.resources,
    title: 'Original',
    locale: 'en-US',
    program:
      'heading = TextContent("Before");\nroot = Stack([heading, AnalysisFrameView("frame"), DatasetView("data")]);',
  })
  const base = parseAnalysisDocument(await readReceiptDocument(f.root, original.receipt))
  await rm(path.join(f.root, f.captureDirectory), { recursive: true })
  const tool = createMarivoPresentTool(f.source, f.exec.agent!.session)
  const update = async (args: Record<string, unknown>) =>
    parsePresentationDelivery(
      JSON.parse(((await tool.execute(args, f.exec)) as { deliveryJson: string }).deliveryJson),
    )
  const result = await update({
    basedOnRecordId: base.recordId,
    program: 'heading = TextContent("After");',
  })
  const next = parseAnalysisDocument(await readReceiptDocument(f.root, result.receipt))
  assert.equal(next.reportId, base.reportId)
  assert.notEqual(next.buildId, base.buildId)
  assert.equal(next.title, 'Original')
  assert.equal(next.locale, 'en-US')
  assert.match(next.program, /After/)
  assert.deepEqual(next.resources, base.resources)
  await assert.rejects(
    update({ basedOnRecordId: base.recordId, program: 'heading = TextContent("Stale");' }),
    /report-save-conflict/,
  )
  for (const program of [
    'heading = null;',
    'bad = TotallyMissing("bad")',
    'bad = TextContent(42)',
    'bad = TextContent("unreachable")',
    'garbage',
    'heading = TextContent("unterminated',
    'garbage\nheading = TextContent("valid");',
  ])
    await assert.rejects(update({ basedOnRecordId: next.recordId, program }))
  await assert.rejects(
    update({ basedOnRecordId: next.recordId, resources: {} }),
    /resource-missing/,
  )
  const retained = await update({
    basedOnRecordId: next.recordId,
    resources: f.resources,
    title: 'Retained',
  })
  const latest = parseAnalysisDocument(await readReceiptDocument(f.root, retained.receipt))
  assert.equal(latest.program, next.program)
  assert.deepEqual(latest.resources, base.resources)
  const removed = await update({
    basedOnRecordId: latest.recordId,
    resources: {},
    program: 'root = Stack([note]);\nnote = TextContent("Independent");\nheading = null;',
  })
  await rm(path.dirname(original.receipt.files.document.path), { recursive: true })
  const independent = await readReceiptDocument(f.root, removed.receipt)
  assert.deepEqual(independent.resources, {})
  assert.equal(
    (await resolvePresentation(f.root, 'workspace', base.reportId)).buildId,
    removed.receipt.buildId,
  )
})

test('Dataset chart programs save, reopen and update embedded data after capture removal', async (t) => {
  const snapshot = datasetSnapshot(
    [
      ['A', 'X', '9007199254740993'],
      ['B', 'X', null],
      ['A', 'Y', '-2.50'],
      ['B', 'Y', '0.00'],
    ],
    [
      { id: 'category', label: 'Category', type: 'string', nullable: false },
      { id: 'series', label: 'Series', type: 'string', nullable: false },
      { id: 'value', label: 'Value', type: 'decimal', nullable: true },
    ],
  )
  const f = await fixture(t, snapshot)
  const views = ['line', 'area', 'bar'].map(
    (chart) =>
      `DatasetView("data", {chart:"${chart}",encoding:{axis:"category",values:["value"],series:"series"}})`,
  )
  views.push(
    'DatasetView("data", {chart:"heatmap",encoding:{x:"category",y:"series",value:"value"}})',
  )
  const program = `root = Stack([${views.join(',')}]);`
  const delivery = await f.present({ resources: { data: f.resources.data }, program })
  const saved = parseAnalysisDocument(await readReceiptDocument(f.root, delivery.receipt))
  assert.deepEqual(
    saved.resources.data?.kind === 'snapshot' && saved.resources.data.snapshot.data.rows,
    snapshot.data.rows,
  )
  await assert.rejects(
    f.present({
      basedOnRecordId: saved.recordId,
      program:
        'root = DatasetView("data", {chart:"line",encoding:{axis:"category",values:["value"]}});',
    }),
    /analysis-view-target-ambiguous at root\/view\/encoding/,
  )
  assert.equal(
    (await resolvePresentation(f.root, 'workspace', saved.reportId)).buildId,
    saved.buildId,
  )
  await rm(path.join(f.root, f.captureDirectory), { recursive: true })
  await f.service.close()
  const cold = new MarivoPresentationFileService(
    () => ({ id: 'workspace', path: f.root }),
    () => ({ id: 'workspace', path: f.root }),
  )
  t.after(() => cold.close())
  const reopened = await readAnalysisRecord(f.root, 'workspace', saved.reportId, saved.buildId)
  assert.equal(reopened.program, saved.program)
  assert.deepEqual(reopened.resources, saved.resources)
  const model = new PresentationDeliveryModel({
    async call(_channel, endpoint, payload, signal) {
      return {
        ok: true,
        value:
          endpoint === 'files/read'
            ? await cold.read(payload, signal)
            : endpoint === 'reports/history'
              ? await cold.catalog(endpoint, payload, signal)
              : await cold.report(payload, signal),
      }
    },
  })
  t.after(() => model.dispose())
  await model.showBuild('workspace', saved.reportId, saved.buildId)
  assert.equal(model.getSnapshot().error, undefined)
  assert.equal(model.getSnapshot().analysisDocument?.program, saved.program)
  const updated = await f.present({
    basedOnRecordId: saved.recordId,
    program:
      'root = DatasetView("data", {chart:"bar",encoding:{axis:"category",values:["value"],series:"series"}});',
  })
  assert.deepEqual((await readReceiptDocument(f.root, updated.receipt)).resources, saved.resources)
})

test('only the current Catalog reads Frame and Dataset reports', async (t) => {
  const f = await fixture(t)
  const previous = '55bf072e4cc809433d3bc4c3436a7d4a917c2052cf27bfe6b4637d7aa03d0053'
  const predecessor = 'c42feb51cff7113f2de9d48dd61992672a4dc0b13b832b73aef72de7e0b56d0f'
  for (const resource of ['frame', 'data'] as const) {
    const delivery = await f.present({ resources: { [resource]: f.resources[resource] } })
    const saved = await readReceiptDocument(f.root, delivery.receipt)
    assert.equal(parseAnalysisDocument(saved).program, saved.program)
    for (const build of [predecessor, previous, 'unknown'])
      assert.throws(() => parseAnalysisDocument({ ...saved, catalog: { ...saved.catalog, build } }))
  }
})
