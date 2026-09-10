import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { PresentationDeliveryModel } from '../../src/client/presentation/delivery-model.ts'
import { presentationEdits } from '../../src/presentation/contracts/editing.ts'
import {
  type PresentationReceipt,
  parsePresentationDocument,
} from '../../src/presentation/contracts/index.ts'
import { MarivoPresentationProjection } from '../../src/presentation/projection/index.ts'
import { parsePresentationDelivery } from '../../src/presentation/receipt.ts'
import { MarivoPresentationFileService } from '../../src/presentation/rpc.ts'
import { createMarivoPresentTool } from '../../src/presentation/tool.ts'

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'report-update-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const session = {
    id: 'session',
    snapshotEvents: () => [
      { type: 'tool/call', data: { callId: 'native', name: 'marivo_present', turn: 1 } },
      { type: 'tool/call', data: { callId: 'code', name: 'run_code', turn: 2 } },
    ],
  } as unknown as Session
  const projection = new MarivoPresentationProjection({
    status: 'ready',
    binding: {
      projectRoot: root,
      pythonExecutable: '/bound/python',
      marivoVersion: '0.5.5',
      packagePath: '/bound/marivo',
      subprocessPolicyId: 'policy',
      fingerprint: 'fingerprint',
      presentationKit: { version: '1.0.0', packagePath: '/bound/presentation' },
    },
    async runChecked(): Promise<never> {
      throw new Error('Computed report updates must not execute Python')
    },
  })
  let workspaceId = 'workspace'
  const tool = createMarivoPresentTool(() => ({ workspaceId, projection }), session)
  const exec = {
    agent: { session },
    callId: 'native',
    signal: new AbortController().signal,
  } as unknown as ToolRunContext
  const service = new MarivoPresentationFileService((id) =>
    id === 'session' ? { id: workspaceId, path: root } : undefined,
  )
  t.after(async () => service.close())
  const draft = {
    schemaVersion: 2,
    locale: 'zh-CN',
    title: 'Original KPI',
    sources: [],
    datasets: [{ id: 'data', kind: 'computed', path: 'data.json', sourceIds: [] }],
    blocks: [
      {
        id: 'total',
        kind: 'metric',
        datasetId: 'data',
        columnId: 'value',
        rowIndex: 0,
        label: 'Total',
      },
      {
        id: 'duplicate',
        kind: 'metric',
        datasetId: 'data',
        columnId: 'value',
        rowIndex: 0,
        label: 'Duplicate total',
      },
    ],
  }
  async function writeDraft(value = '9007199254740993') {
    await writeFile(
      path.join(root, 'data.json'),
      JSON.stringify({
        schemaVersion: 1,
        columns: [{ id: 'value', label: 'Value', type: 'int64', nullable: false }],
        rows: [[value]],
        rowCount: 1,
        limit: 1,
        truncated: false,
      }),
    )
    await writeFile(path.join(root, 'draft.json'), JSON.stringify(draft))
  }
  async function present(target: Record<string, unknown> = {}, mode: 'native' | 'code' = 'native') {
    const context = (mode === 'code'
      ? { ...exec, callId: 'code:code:1', rootCallId: 'code' }
      : exec) as unknown as ToolRunContext
    const result = (await tool.execute({ draft_path: 'draft.json', ...target }, context)) as {
      deliveryJson: string
    }
    return parsePresentationDelivery(JSON.parse(result.deliveryJson))
  }
  async function document(receipt: PresentationReceipt) {
    const result = await service.read({ sessionId: 'session', receipt, asset: 'presentation.json' })
    return parsePresentationDocument(
      JSON.parse(Buffer.from(result.bodyBase64, 'base64').toString()),
    )
  }
  async function entries() {
    return (
      await readdir(path.join(root, '.dsh-data-analysis', 'presentations'), { recursive: true })
    ).sort()
  }
  await writeDraft()
  return {
    root,
    projection,
    service,
    draft,
    writeDraft,
    present,
    document,
    entries,
    setWorkspace(id: string) {
      workspaceId = id
    },
  }
}

function target(receipt: PresentationReceipt) {
  return { report_id: receipt.reportId, expected_build_id: receipt.buildId }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test('Agent updates keep one Report across Native and Code calls, preserve historical files, and reopen the original card at current', async (t) => {
  const f = await fixture(t)
  const original = await f.present()
  const before = await Promise.all(
    Object.values(original.receipt.files).map((file) => readFile(file.path)),
  )
  const model = new PresentationDeliveryModel({
    async call(_channel, endpoint, payload, signal) {
      const value =
        endpoint === 'files/read'
          ? await f.service.read(payload, signal)
          : await f.service.report(endpoint as 'reports/resolve', payload, signal)
      return { ok: true, value }
    },
  })
  t.after(async () => model.dispose())
  await model.show(original, 'session', original.receipt.workspaceId)
  assert.equal(model.getSnapshot().document?.blocks.length, 2)

  f.draft.title = 'Merged KPI'
  f.draft.blocks.splice(1)
  await f.writeDraft('9007199254740995')
  const merged = await f.present(target(original.receipt), 'code')
  assert.equal(merged.receipt.reportId, original.receipt.reportId)
  assert.notEqual(merged.receipt.buildId, original.receipt.buildId)
  assert.equal(merged.dshSessionId, original.dshSessionId)
  assert.equal(original.turn, 1)
  assert.equal(merged.turn, 2)
  assert.equal(model.getSnapshot().document?.buildId, original.receipt.buildId)

  f.draft.title = 'Revised KPI'
  f.draft.blocks[0]!.label = 'Revised total'
  await f.writeDraft('9007199254740997')
  const revised = await f.present(target(merged.receipt))
  assert.equal(revised.receipt.reportId, original.receipt.reportId)
  assert.equal(new Set([original, merged, revised].map((entry) => entry.receipt.buildId)).size, 3)
  const latest = await f.document(revised.receipt)
  assert.equal(latest.title, f.draft.title)
  assert.deepEqual(latest.blocks, f.draft.blocks)
  assert.deepEqual(latest.datasets[0]!.data.rows, [['9007199254740997']])
  assert.deepEqual((await f.document(merged.receipt)).datasets[0]!.data.rows, [
    ['9007199254740995'],
  ])
  assert.deepEqual(
    await f.service.report('reports/resolve', {
      sessionId: 'session',
      reportId: original.receipt.reportId,
    }),
    revised.receipt,
  )
  await model.show(original, 'session', original.receipt.workspaceId)
  assert.deepEqual(model.getSnapshot().resolvedReceipt, revised.receipt)
  assert.deepEqual(model.getSnapshot().document, latest)
  assert.deepEqual(
    await Promise.all(Object.values(original.receipt.files).map((file) => readFile(file.path))),
    before,
  )
  assert.equal((await f.entries()).filter((entry) => entry.endsWith('current.json')).length, 1)
  assert.equal((await f.entries()).filter((entry) => entry.endsWith('presentation.json')).length, 3)

  const separate = await f.present()
  assert.notEqual(separate.receipt.reportId, original.receipt.reportId)
  assert.notEqual(separate.receipt.buildId, revised.receipt.buildId)
  assert.equal((await f.entries()).filter((entry) => entry.endsWith('current.json')).length, 2)
})

test('invalid, missing, foreign Workspace and stale update targets reject before projection without creating another Report', async (t) => {
  const f = await fixture(t)
  const original = await f.present()
  const entries = await f.entries()
  const project = t.mock.method(f.projection, 'project')
  for (const invalid of [
    { report_id: original.receipt.reportId },
    { expected_build_id: original.receipt.buildId },
  ]) {
    await assert.rejects(f.present(invalid), /invalid-report-update-target/)
  }
  for (const invalid of [
    { report_id: null, expected_build_id: original.receipt.buildId },
    { report_id: original.receipt.reportId, expected_build_id: null },
    { report_id: null, expected_build_id: null },
    { report_id: original.receipt.reportId, expected_build_id: 42 },
  ]) {
    await assert.rejects(f.present(invalid), /invalid arguments/)
  }
  for (const invalid of [
    { report_id: '../outside', expected_build_id: original.receipt.buildId },
    { report_id: original.receipt.reportId, expected_build_id: '../outside' },
    { report_id: '', expected_build_id: original.receipt.buildId },
    { report_id: 'r'.repeat(81), expected_build_id: original.receipt.buildId },
  ]) {
    await assert.rejects(f.present(invalid), {
      name: 'PresentationContractError',
      code: 'invalid_value',
    })
  }
  await assert.rejects(
    f.present({ report_id: 'missing-report', expected_build_id: original.receipt.buildId }),
    /ENOENT/,
  )
  await assert.rejects(
    f.present({ report_id: original.receipt.reportId, expected_build_id: 'missing-build' }),
    /report-save-conflict/,
  )
  f.setWorkspace('foreign-workspace')
  await assert.rejects(f.present(target(original.receipt)), /invalid-report-current/)
  f.setWorkspace(original.receipt.workspaceId)
  assert.equal(project.mock.callCount(), 0)
  assert.deepEqual(await f.entries(), entries)

  const newer = await f.present(target(original.receipt))
  const afterUpdate = await f.entries()
  project.mock.resetCalls()
  await assert.rejects(f.present(target(original.receipt)), /report-save-conflict/)
  assert.equal(project.mock.callCount(), 0)
  assert.deepEqual(await f.entries(), afterUpdate)
  assert.deepEqual(
    await f.service.report('reports/resolve', {
      sessionId: 'session',
      reportId: original.receipt.reportId,
    }),
    newer.receipt,
  )
})

test('a reader save during Agent projection wins and the Agent receives a conflict without replacing current', {
  timeout: 15_000,
}, async (t) => {
  const f = await fixture(t)
  const original = await f.present()
  const document = await f.document(original.receipt)
  const entered = deferred()
  const release = deferred()
  const project = f.projection.project.bind(f.projection)
  t.mock.method(f.projection, 'project', async (...args: Parameters<typeof project>) => {
    const projected = await project(...args)
    entered.resolve()
    await Promise.race([
      release.promise,
      new Promise<never>((_resolve, reject) => {
        const signal = AbortSignal.timeout(10_000)
        signal.addEventListener('abort', () => reject(new Error('projection-barrier-timeout')), {
          once: true,
        })
      }),
    ])
    return projected
  })
  f.draft.title = 'Agent replacement'
  f.draft.blocks.splice(1)
  await f.writeDraft('9007199254740995')
  const pending = f.present(target(original.receipt))
  const conflict = assert.rejects(pending, /report-save-conflict/)
  await entered.promise
  let saved: PresentationReceipt
  try {
    saved = await f.service.report('reports/save', {
      sessionId: 'session',
      reportId: original.receipt.reportId,
      expectedBuildId: original.receipt.buildId,
      edits: { ...presentationEdits(document), title: 'Saved in reader' },
    })
  } finally {
    release.resolve()
  }
  await conflict
  assert.deepEqual(
    await f.service.report('reports/resolve', {
      sessionId: 'session',
      reportId: original.receipt.reportId,
    }),
    saved,
  )
  const current = await f.document(saved)
  assert.equal(current.title, 'Saved in reader')
  assert.deepEqual(current.blocks, document.blocks)
  assert.deepEqual(current.datasets, document.datasets)
  assert.deepEqual(await f.document(original.receipt), document)
  assert.equal((await f.entries()).filter((entry) => entry.endsWith('current.json')).length, 1)
})
