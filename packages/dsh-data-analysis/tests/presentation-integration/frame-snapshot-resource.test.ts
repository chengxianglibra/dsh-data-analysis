import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import {
  type AnalysisDocument,
  parseAnalysisDocument,
  sameAnalysisDeclaration,
} from '../../src/presentation/contracts/analysis-document.ts'
import { datasetSnapshotRef, frameSnapshotRef } from '../../src/presentation/dataset-snapshot.ts'
import { presentationSha256 } from '../../src/presentation/files.ts'
import { parsePresentationDelivery } from '../../src/presentation/receipt.ts'
import { readReceiptDocument } from '../../src/presentation/reports.ts'
import {
  MarivoPresentationFileService,
  registerMarivoPresentationRpc,
} from '../../src/presentation/rpc.ts'
import { createMarivoPresentTool, createMarivoUiReadTool } from '../../src/presentation/tool.ts'
import { savePythonExecution } from '../../src/python-execution.ts'
import { createConnectionFixture } from '../semantic-reference-input/fixtures.ts'
import { frameSnapshot } from '../unified-analysis-ui/fixtures.ts'
import { frameSnapshotV2 } from './frame-v2-fixture.ts'

const dataset = {
  schemaVersion: 1,
  kind: 'dataset',
  fetchedAt: '2026-10-28T00:00:00Z',
  source: { kind: 'dataframe', details: 'not-captured' },
  data: {
    schemaVersion: 1,
    columns: [{ id: 'amount', label: 'Amount', type: 'decimal', nullable: true }],
    rows: [['1.5']],
    rowCount: 1,
    limit: 5000,
    truncated: false,
  },
  coverage: {
    start: 0,
    totalRows: 1,
    capturedRows: 1,
    complete: true,
    columns: ['amount'],
    business: 'unknown',
  },
}

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'frame-snapshot-resource-')))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  t.after(async () => {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(root, { recursive: true, force: true })
  })
  const directory = `.dsh-data-analysis/captures/${randomUUID()}`
  await mkdir(path.join(root, directory), { recursive: true })
  const entries = []
  for (const snapshot of [frameSnapshotV2(), dataset]) {
    const captureId = randomUUID()
    const bytes = Buffer.from(JSON.stringify(snapshot))
    await writeFile(path.join(root, directory, `${captureId}.json`), bytes)
    entries.push({
      captureId,
      path: `${directory}/${captureId}.json`,
      sha256: presentationSha256(bytes),
    })
  }
  const code = 'capture_frame(frame)\ncapture_dataset(df)'
  const codeRef = await savePythonExecution(root, {
    text: code,
    startedAt: '2026-10-28T00:00:00.000Z',
    finishedAt: '2026-10-28T00:00:01.000Z',
    captures: {
      workspaceId: 'workspace',
      sessionId: 'session',
      callId: 'producer',
      rootCallId: 'producer',
      entries,
    },
  })
  const session = {
    id: 'session',
    snapshotEvents: () => [
      { type: 'tool/call', data: { callId: 'native', name: 'marivo_present', turn: 1 } },
    ],
  } as unknown as Session
  const workspace = () => ({ id: 'workspace', path: root })
  // frame-snapshot and dataset-snapshot never resolve the Runtime projection.
  const tool = createMarivoPresentTool(
    async () => {
      throw new Error('Runtime must not be resolved')
    },
    session,
    undefined,
    workspace,
  )
  const exec = {
    agent: { session },
    callId: 'native',
    signal: new AbortController().signal,
  } as unknown as ToolRunContext
  const present = async (args: Record<string, unknown>) =>
    parsePresentationDelivery(
      JSON.parse(((await tool.execute(args, exec)) as { deliveryJson: string }).deliveryJson),
    )
  const service = new MarivoPresentationFileService(
    (sessionId) => (sessionId === 'session' ? workspace() : undefined),
    (id) => (id === 'workspace' ? workspace() : undefined),
  )
  t.after(() => service.close())
  return {
    root,
    code,
    codeRef,
    exec,
    present,
    service,
    frameRef: frameSnapshotRef(codeRef, entries[0]!.captureId),
    datasetRef: datasetSnapshotRef(codeRef, entries[1]!.captureId),
  }
}
const note = 'root = TextContent("Saved");'

test('frame-snapshot resources bind codeRef, Session and call; refs must match their kind', async (t) => {
  const f = await fixture(t)
  const delivery = await f.present({
    resources: { frame: { kind: 'frame-snapshot', snapshotRef: f.frameRef } },
    program: note,
  })
  const document = parseAnalysisDocument(await readReceiptDocument(f.root, delivery.receipt))
  const frame = document.resources.frame
  assert(frame?.kind === 'snapshot' && frame.snapshot.kind === 'frame')
  assert.equal(frame.snapshot.schemaVersion, 2)
  assert.deepEqual(frame.binding, {
    workspaceId: 'workspace',
    codeRef: f.codeRef,
    sessionId: 'session',
    callId: 'producer',
  })
  await assert.rejects(
    f.present({
      resources: { frame: { kind: 'frame-snapshot', snapshotRef: f.datasetRef } },
      program: note,
    }),
    /frame-snapshot-reference-invalid/,
  )
  await assert.rejects(
    f.present({
      resources: { data: { kind: 'dataset-snapshot', snapshotRef: f.frameRef } },
      program: note,
    }),
    /dataset-snapshot-reference-invalid/,
  )
  assert.equal(
    sameAnalysisDeclaration(
      { kind: 'frame-snapshot', snapshotRef: f.frameRef },
      { kind: 'frame-snapshot', snapshotRef: f.frameRef },
    ),
    true,
  )
  assert.equal(
    sameAnalysisDeclaration(
      { kind: 'frame-snapshot', snapshotRef: f.frameRef },
      { kind: 'dataset-snapshot', snapshotRef: f.frameRef },
    ),
    false,
  )
})

test('document owner checks require a v2 Frame with Host code, Session and call binding', async (t) => {
  const f = await fixture(t)
  const delivery = await f.present({
    resources: { frame: { kind: 'frame-snapshot', snapshotRef: f.frameRef } },
    program: note,
  })
  const saved = (await readReceiptDocument(f.root, delivery.receipt)) as AnalysisDocument
  const variants: ((d: AnalysisDocument) => void)[] = [
    (d) => {
      const r = d.resources.frame as Extract<
        AnalysisDocument['resources'][string],
        { kind: 'snapshot' }
      >
      delete r.binding.codeRef
    },
    (d) => {
      const r = d.resources.frame as Extract<
        AnalysisDocument['resources'][string],
        { kind: 'snapshot' }
      >
      delete r.binding.callId
    },
    (d) => {
      const r = d.resources.frame as Extract<
        AnalysisDocument['resources'][string],
        { kind: 'snapshot' }
      >
      delete r.binding.sessionId
    },
    (d) => {
      // A legacy v1 Frame has no interpretation facts and cannot back frame-snapshot.
      Object.assign(d.resources.frame!, { snapshot: frameSnapshot() })
    },
    (d) => {
      Object.assign(d.resources.frame!, {
        declaration: { kind: 'dataset-snapshot', snapshotRef: f.frameRef },
      })
    },
    (d) => {
      // marivo-frame requires an artifact and Runtime fingerprint; a memory capture has neither.
      Object.assign(d.resources.frame!, {
        declaration: { kind: 'marivo-frame', sessionId: 'session', artifactId: 'artifact' },
      })
    },
  ]
  for (const mutate of variants) {
    const value = structuredClone(saved)
    mutate(value)
    assert.throws(() => parseAnalysisDocument(value), /analysis-resource-owner-invalid/)
  }
  assert.equal(parseAnalysisDocument(structuredClone(saved)).recordId, saved.recordId)
})

test('marivo_ui_read returns Frame description, axis variants and interpretation names without rows', async (t) => {
  const f = await fixture(t)
  const delivery = await f.present({
    resources: { frame: { kind: 'frame-snapshot', snapshotRef: f.frameRef } },
    program: note,
  })
  const document = parseAnalysisDocument(await readReceiptDocument(f.root, delivery.receipt))
  const read = createMarivoUiReadTool(() => ({ id: 'workspace', path: f.root }))
  const { definitionJson } = (await read.execute({ recordId: document.recordId }, f.exec)) as {
    definitionJson: string
  }
  const frame = JSON.parse(definitionJson).resources.frame
  assert.equal(frame.kind, 'frame')
  assert.equal(frame.description, 'Revenue by region')
  assert.deepEqual(frame.values, ['amount'])
  assert.deepEqual(frame.axes[0].variant, { kind: 'ordinary' })
  assert.deepEqual(frame.interpretation, {
    status: 'captured',
    comparisons: [
      {
        alias: 'prior',
        binding: 'ordinary',
        groups: [{ name: 'amount', values: [{ role: 'current', name: 'amount' }] }],
      },
    ],
    decompositions: [],
    alignments: [],
  })
  assert.equal(definitionJson.includes('12345678901234.5678'), false)
  assert.equal(frame.rows, undefined)
  assert.equal(frame.periods, undefined)
})

test('code/read returns bound Python source only for the saved receipt document and Workspace', async (t) => {
  const f = await fixture(t)
  const delivery = await f.present({
    resources: { frame: { kind: 'frame-snapshot', snapshotRef: f.frameRef } },
    program: note,
  })
  const receipt = delivery.receipt
  const input = { sessionId: 'session', receipt, codeRef: f.codeRef }
  assert.deepEqual(await f.service.code(input), { text: f.code, sha256: f.codeRef.sha256 })
  assert.deepEqual(
    await f.service.code({ workspaceId: 'workspace', receipt, codeRef: f.codeRef }),
    { text: f.code, sha256: f.codeRef.sha256 },
  )
  // A valid record in the same Workspace that the document does not reference.
  const unbound = await savePythonExecution(f.root, {
    text: 'print("unrelated")',
    startedAt: '2026-10-28T00:00:00.000Z',
    finishedAt: '2026-10-28T00:00:01.000Z',
  })
  for (const [payload, error] of [
    [{ ...input, codeRef: unbound }, /code-not-bound/],
    [{ ...input, sessionId: 'other' }, /workspace-unavailable/],
    [{ ...input, receipt: { ...receipt, workspaceId: 'other' } }, /workspace-unavailable/],
    [{ ...input, extra: true }, /invalid-request/],
    [{ ...input, codeRef: { ...f.codeRef, text: 'x' } }, /invalid-request/],
    [{ ...input, codeRef: { executionId: '../x', sha256: f.codeRef.sha256 } }, /invalid-request/],
    [{ receipt, codeRef: f.codeRef }, /invalid-request/],
  ] as const)
    await assert.rejects(f.service.code(payload), error)
  const { connection, channels } = createConnectionFixture()
  const stop = registerMarivoPresentationRpc(connection, f.service)
  const call = (payload: unknown) =>
    channels.get('/marivo-presentation')!('code/read', payload, new AbortController().signal)
  assert.deepEqual(await call(input), {
    ok: true,
    value: { text: f.code, sha256: f.codeRef.sha256 },
  })
  const record = path.join(
    f.root,
    'dsh-data-analysis',
    'python-executions',
    createHash('sha256').update(f.root).digest('hex'),
    `${f.codeRef.executionId}.json`,
  )
  await rm(record)
  const missing = await call(input)
  assert.deepEqual(missing, {
    ok: false,
    error: { code: 'internal', message: 'code-unavailable', details: {} },
  })
  assert.equal(JSON.stringify(missing).includes(f.root), false)
  await stop()
})

// The following cases reach resolveFrameView through save-time validation.
test('a single frame-snapshot resource defaults to AnalysisFrameView', async (t) => {
  const f = await fixture(t)
  const delivery = await f.present({
    resources: { frame: { kind: 'frame-snapshot', snapshotRef: f.frameRef } },
  })
  const document = parseAnalysisDocument(await readReceiptDocument(f.root, delivery.receipt))
  assert.equal(document.program, 'root = AnalysisFrameView("frame");')
})

test('save-time view validation returns structured codes with statement-scoped paths', async (t) => {
  const f = await fixture(t)
  const resources = { frame: { kind: 'frame-snapshot', snapshotRef: f.frameRef } }
  const program = (view: string) =>
    `root = Stack([chart]);\nchart = AnalysisFrameView("frame", ${view});`
  for (const [view, code] of [
    ['{chart:"table",columns:["missing"]}', 'analysis-columns-invalid'],
    ['{chart:"table",columns:["amount","amount"]}', 'analysis-columns-invalid'],
    // The fixture Frame is truncated (1 of 2 rows).
    ['{chart:"metric",encoding:{value:"amount"}}', 'analysis-metric-requires-complete-single-row'],
  ] as const)
    await assert.rejects(f.present({ resources, program: program(view) }), (error: Error) => {
      assert.match(error.message, new RegExp(`^${code} at chart/view`))
      assert.equal((error as Error & { code?: string }).code, code)
      return true
    })
  const saved = await f.present({
    resources,
    program: program('{chart:"table",columns:["amount"]}'),
  })
  assert.ok(saved.receipt.reportId)
})
