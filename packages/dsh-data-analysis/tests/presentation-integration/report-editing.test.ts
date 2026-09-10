import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { translator } from './../../src/client/i18n/copy.ts'
import {
  applyPresentationEdits,
  presentationEdits,
} from '../../src/presentation/contracts/editing.ts'
import {
  parsePresentationDocument,
  parsePresentationDraft,
} from '../../src/presentation/contracts/index.ts'
import { presentationReportPath } from '../../src/presentation/files.ts'
import { publishPresentation, resolvePresentation } from '../../src/presentation/reports.ts'
import { MarivoPresentationFileService } from '../../src/presentation/rpc.ts'

async function fixture(
  t: { after(fn: () => Promise<void>): void },
  locale: 'zh-CN' | 'en-US' = 'zh-CN',
) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'report-editing-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const document = parsePresentationDocument(
    JSON.parse(
      await readFile(
        new URL('../presentation-s0/fixtures/computed.document.json', import.meta.url),
        'utf8',
      ),
    ),
  )
  document.locale = locale
  document.datasets[0]!.code = [
    {
      language: 'python',
      text: 'print("saved snapshot")\n',
      provenance: 'execution',
      executionId: '12345678-1234-4567-89ab-123456789abc',
      sha256: 'a'.repeat(64),
    },
  ]
  const source = document.sources.find((entry) => entry.status === 'available')!
  if (source.status === 'available')
    source.code = {
      snippets: [
        {
          language: 'sql',
          text: 'SELECT amount FROM saved_sales\n',
          provenance: 'execution',
          runId: 'run_saved',
          queryId: 'query_saved',
          artifactRef: source.ref.artifactRef,
        },
      ],
      notices: [],
    }
  const receipt = await publishPresentation(root, document, null, async () => {})
  const service = new MarivoPresentationFileService(async (session) =>
    session === 'session' ? { id: document.workspaceId, path: root } : undefined,
  )
  t.after(async () => service.close())
  const request = { sessionId: 'session', reportId: document.reportId }
  return { root, document, receipt, service, request }
}

test('edits preserve exact snapshots and code, allow reorder/delete including all cells, and reject data or identity changes', async (t) => {
  const f = await fixture(t)
  const edits = presentationEdits(f.document)
  edits.title = '编辑后的报告'
  edits.blocks.reverse()
  const saved = await f.service.report('reports/save', {
    ...f.request,
    expectedBuildId: f.receipt.buildId,
    edits,
  })
  assert.notEqual(saved.buildId, f.receipt.buildId)
  const result = await f.service.read({
    sessionId: 'session',
    receipt: saved,
    asset: 'presentation.json',
  })
  const document = parsePresentationDocument(
    JSON.parse(Buffer.from(result.bodyBase64, 'base64').toString()),
  )
  for (const field of ['datasets', 'sources', 'diagnostics'] as const)
    assert.deepEqual(document[field], f.document[field])
  assert.deepEqual(document.blocks, edits.blocks)
  assert.deepEqual(await f.service.report('reports/resolve', f.request), saved)
  assert.deepEqual(
    await resolvePresentation(f.root, f.document.workspaceId, f.document.reportId),
    saved,
  )
  const empty = await f.service.report('reports/save', {
    ...f.request,
    expectedBuildId: saved.buildId,
    edits: { title: '空报告', blocks: [] },
  })
  const html = await f.service.read({ sessionId: 'session', receipt: empty, asset: 'index.html' })
  assert.match(
    translator('zh-CN')(Buffer.from(html.bodyBase64, 'base64').toString()),
    /这份报告尚无 cell/,
  )
  assert.equal(
    (await readFile(f.receipt.files.document.path)).length,
    f.receipt.files.document.bytes,
  )
  assert.throws(() => applyPresentationEdits(f.document, { ...edits, datasets: [] }))
  assert.throws(() =>
    applyPresentationEdits(f.document, {
      title: 'x',
      blocks: [{ id: 'new', kind: 'markdown', text: 'x' }],
    }),
  )
  const metric = f.document.blocks.find((block) => block.kind === 'metric')!
  assert.throws(() =>
    applyPresentationEdits(f.document, { title: 'x', blocks: [{ ...metric, rowIndex: 1 }] }),
  )
  assert.throws(() =>
    parsePresentationDraft({
      schemaVersion: 2,
      locale: 'zh-CN',
      title: 'x',
      datasets: [],
      sources: [],
      blocks: [],
    }),
  )
  assert.throws(() => parsePresentationDocument({ ...f.document, schemaVersion: 1 }))
})

test('separate process writers cannot overwrite edits based on the same build', async (t) => {
  const f = await fixture(t)
  const moduleUrl = new URL('../../src/presentation/rpc.ts', import.meta.url).href
  const run = (title: string) =>
    new Promise<string>((resolve, reject) => {
      const code = `import { MarivoPresentationFileService } from ${JSON.stringify(moduleUrl)};
      const service = new MarivoPresentationFileService(() => (${JSON.stringify({ id: f.document.workspaceId, path: f.root })}));
      try { const receipt = await service.report('reports/save', ${JSON.stringify({ ...f.request, expectedBuildId: f.receipt.buildId, edits: { title, blocks: f.document.blocks } })}); process.stdout.write(receipt.title) }
      catch(error) { process.stdout.write(error.message) } finally { service.close() }`
      const child = spawn(
        process.execPath,
        ['--experimental-strip-types', '--input-type=module', '-e', code],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      )
      let output = '',
        errors = ''
      child.stdout.on('data', (data) => {
        output += data
      })
      child.stderr.on('data', (data) => {
        errors += data
      })
      child.on('error', reject)
      child.on('exit', (status) => (status === 0 ? resolve(output) : reject(new Error(errors))))
    })
  const results = await Promise.all([run('第一窗口'), run('第二窗口')])
  assert.equal(results.filter((value) => value === 'report-save-conflict').length, 1)
  const current = await f.service.report('reports/resolve', f.request)
  assert(results.includes(current.title))
})

test('a failure before pointer publication leaves the old report readable; invalid pointers never fall back', async (t) => {
  const f = await fixture(t)
  const next = { ...f.document, buildId: randomUUID(), title: '未发布' }
  let checks = 0
  await assert.rejects(
    publishPresentation(f.root, next, f.receipt.buildId, async () => {
      if (++checks === 2) throw new Error('owner-changed')
    }),
    /owner-changed/,
  )
  assert.equal((await f.service.report('reports/resolve', f.request)).buildId, f.receipt.buildId)
  const current = path.join(presentationReportPath(f.root, f.document.reportId), 'current.json')
  await writeFile(
    current,
    JSON.stringify({
      schemaVersion: 2,
      reportId: 'foreign',
      workspaceId: f.document.workspaceId,
      receipt: f.receipt,
    }),
  )
  await assert.rejects(f.service.report('reports/resolve', f.request), /invalid-report-current/)
})

test('snapshot tampering and Workspace disassociation reject saves', async (t) => {
  const f = await fixture(t)
  await assert.rejects(
    f.service.report('reports/save', {
      ...f.request,
      sessionId: 'foreign',
      expectedBuildId: f.receipt.buildId,
      edits: presentationEdits(f.document),
    }),
    /workspace-unavailable/,
  )
  await writeFile(f.receipt.files.document.path, 'changed')
  await assert.rejects(
    f.service.report('reports/save', {
      ...f.request,
      expectedBuildId: f.receipt.buildId,
      edits: presentationEdits(f.document),
    }),
    /digest-mismatch/,
  )
})

test('editor undo/cancel, conflict drafts and lost-response recovery use the original card identity', async (t) => {
  const f = await fixture(t)
  const { PresentationDeliveryModel } = await import(
    '../../src/client/presentation/delivery-model.ts'
  )
  const delivery = {
    kind: 'marivo.presentation.delivery' as const,
    schemaVersion: 2 as const,
    dshSessionId: 'session',
    turn: 1,
    receipt: f.receipt,
  }
  let loseResponse = false
  const calls: string[] = []
  const model = new PresentationDeliveryModel({
    async call(_channel, endpoint, payload, signal) {
      calls.push(endpoint)
      if (_channel === '/dsh-report-publishing' && endpoint === 'describe')
        return { ok: true, value: { enabled: false, fields: [] } }
      try {
        const value =
          endpoint === 'files/read'
            ? await f.service.read(payload, signal)
            : await f.service.report(endpoint as 'reports/save', payload, signal)
        if (endpoint === 'reports/save' && loseResponse) {
          loseResponse = false
          throw new Error('connection-lost')
        }
        return { ok: true, value }
      } catch (error) {
        if ((error as Error).message === 'connection-lost') throw error
        return { ok: false, error: { code: (error as Error).message } }
      }
    },
  })
  t.after(async () => model.dispose())
  await model.show(delivery, 'session', f.document.workspaceId)
  model.beginEdit()
  model.changeEdits({ title: '新标题', blocks: [] })
  assert.equal(model.dirty, true)
  model.undoEdit()
  assert.equal(model.dirty, false)
  model.redoEdit()
  assert.equal(model.getSnapshot().editing!.edits.blocks.length, 0)
  model.cancelEdit()
  assert.deepEqual(model.getSnapshot().document, f.document)
  model.beginEdit()
  model.changeEdits({ title: '响应丢失但保存完成', blocks: [] })
  loseResponse = true
  await model.saveEdit()
  assert.equal(model.getSnapshot().editing, undefined)
  const saved = model.getSnapshot().resolvedReceipt!
  assert.notEqual(saved.buildId, delivery.receipt.buildId)
  model.close()
  await model.show(delivery, 'session', f.document.workspaceId)
  assert.equal(model.getSnapshot().document!.title, saved.title)
  model.beginEdit()
  model.changeEdits({ title: '本窗口草稿', blocks: [] })
  await f.service.report('reports/save', {
    ...f.request,
    expectedBuildId: saved.buildId,
    edits: { title: '其他窗口', blocks: [] },
  })
  await model.saveEdit()
  assert.equal(model.getSnapshot().editing!.edits.title, '本窗口草稿')
  assert.match(translator('zh-CN')(model.getSnapshot().editError!), /其他窗口/)
  model.contextChanged('session', 'foreign-workspace')
  assert.equal(model.getSnapshot().document, undefined)
  assert.equal(model.getSnapshot().editing, undefined)
  assert(
    calls.every((endpoint) =>
      ['reports/resolve', 'reports/save', 'files/read', 'describe'].includes(endpoint),
    ),
  )
})

test('unknown writer locks time out without deleting the lock or damaging the current build', async (t) => {
  const f = await fixture(t)
  const lock = path.join(presentationReportPath(f.root, f.document.reportId), 'current.json.lock')
  await writeFile(lock, 'unknown-owner\n')
  await assert.rejects(
    f.service.report('reports/save', {
      ...f.request,
      expectedBuildId: f.receipt.buildId,
      edits: { title: '锁超时', blocks: f.document.blocks },
    }),
    /timed out waiting for the writer lock/,
  )
  assert.equal(await readFile(lock, 'utf8'), 'unknown-owner\n')
  assert.equal((await f.service.report('reports/resolve', f.request)).buildId, f.receipt.buildId)
})

test('failure at the pointer update boundary preserves the previously published bytes', async (t) => {
  const f = await fixture(t)
  const { readdir } = await import('node:fs/promises')
  const directory = presentationReportPath(f.root, f.document.reportId)
  const before = await readFile(path.join(directory, 'current.json'))
  let failedAtPointer = false
  await assert.rejects(
    publishPresentation(
      f.root,
      { ...f.document, buildId: randomUUID(), title: '指针失败' },
      f.receipt.buildId,
      async () => {
        if ((await readdir(directory)).some((name) => name.startsWith('.current-'))) {
          failedAtPointer = true
          throw new Error('pointer-update-failed')
        }
      },
    ),
    /pointer-update-failed/,
  )
  assert.equal(failedAtPointer, true)
  assert.deepEqual(await readFile(path.join(directory, 'current.json')), before)
  assert.equal((await f.service.report('reports/resolve', f.request)).buildId, f.receipt.buildId)
  assert.equal(
    (await readdir(directory)).some((name) => name.startsWith('.current-')),
    false,
  )
})

function barrier() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

test('unload before save admission waits for identity resolution and preserves current', async (t) => {
  const f = await fixture(t)
  const entered = barrier(),
    gate = barrier()
  const service = new MarivoPresentationFileService(async () => {
    entered.release()
    await gate.promise
    return { id: f.document.workspaceId, path: f.root }
  })
  const call = service.report('reports/save', {
    ...f.request,
    expectedBuildId: f.receipt.buildId,
    edits: { title: 'cancelled', blocks: [] },
  })
  const rejected = assert.rejects(call)
  await entered.promise
  let done = false
  const closing = service.close()
  void closing.then(() => {
    done = true
  })
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(done, false)
  gate.release()
  await rejected
  await closing
  assert.deepEqual(
    await resolvePresentation(f.root, f.document.workspaceId, f.document.reportId),
    f.receipt,
  )
})

test('unload after save commit drains lost response without deleting or replaying the saved build', async (t) => {
  const f = await fixture(t)
  const { registerPluginRpc } = await import('../../src/rpc.ts')
  const { createConnectionFixture } = await import('../semantic-reference-input/fixtures.ts')
  const { connection, routes } = createConnectionFixture()
  const committed = barrier(),
    response = barrier()
  let writes = 0
  const close = registerPluginRpc(
    connection,
    '/save-fixture',
    ['save'],
    async (_endpoint, payload, signal) => {
      writes++
      const receipt = await f.service.report('reports/save', payload, signal)
      committed.release()
      await response.promise
      throw new Error(`response-lost:${receipt.buildId}`)
    },
  )
  const route = routes.get('/api/save-fixture/save')!
  const call = route.fetch(
    new Request('http://fixture' + route.path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: 'save',
        method: 'save-fixture/save',
        payload: {
          ...f.request,
          expectedBuildId: f.receipt.buildId,
          edits: { title: 'committed', blocks: [] },
        },
      }),
    }),
  )
  const rejected = assert.rejects(call, /response-lost:/)
  await committed.promise
  const saved = await resolvePresentation(f.root, f.document.workspaceId, f.document.reportId)
  assert.notEqual(saved.buildId, f.receipt.buildId)
  let done = false
  const closing = close()
  void closing.then(() => {
    done = true
  })
  await f.service.close()
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(done, false)
  assert.equal(routes.size, 0)
  response.release()
  await rejected
  await closing
  assert.equal(writes, 1)
  assert.deepEqual(
    await resolvePresentation(f.root, f.document.workspaceId, f.document.reportId),
    saved,
  )
  assert.equal((await readFile(saved.files.document.path)).length, saved.files.document.bytes)
})

test('both report languages survive publication, editing, reopening and full HTML export', async (t) => {
  for (const locale of ['zh-CN', 'en-US'] as const) {
    const f = await fixture(t, locale)
    const original = await readFile(f.receipt.files.document.path)
    const edits = presentationEdits(f.document)
    edits.title = 'User-authored title / 用户标题'
    const saved = await f.service.report('reports/save', {
      ...f.request,
      expectedBuildId: f.receipt.buildId,
      edits,
    })
    assert.notEqual(saved.buildId, f.receipt.buildId)
    const reopened = await f.service.report('reports/resolve', f.request)
    const body = await f.service.read({
      sessionId: 'session',
      receipt: reopened,
      asset: 'presentation.json',
    })
    const document = parsePresentationDocument(
      JSON.parse(Buffer.from(body.bodyBase64, 'base64').toString()),
    )
    assert.equal(document.locale, locale)
    assert.equal(document.title, edits.title)
    const exported = await f.service.read({
      sessionId: 'session',
      receipt: reopened,
      asset: 'index.html',
    })
    assert.ok(
      Buffer.from(exported.bodyBase64, 'base64')
        .toString()
        .includes('<html lang="' + locale + '">'),
    )
    assert.deepEqual(await readFile(f.receipt.files.document.path), original)
  }
})
