import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import test from 'node:test'
import {
  PresentationDeliveryModel,
  type PresentationRpc,
  verifyPresentationAsset,
} from '../../src/client/presentation/delivery-model.ts'
import { parsePresentationDocument } from '../../src/presentation/contracts/index.ts'
import type { PresentationDelivery } from '../../src/presentation/receipt.ts'

async function fixture() {
  const document = parsePresentationDocument(
    JSON.parse(
      await fs.readFile(
        new URL('../presentation-s0/fixtures/computed.document.json', import.meta.url),
        'utf8',
      ),
    ),
  )
  const json = Buffer.from(JSON.stringify(document)),
    html = Buffer.from('<!doctype html><html><body>分析快照 9007199254740993</body></html>')
  const file = <Asset extends 'presentation.json' | 'index.html'>(asset: Asset, bytes: Buffer) => ({
    asset,
    path: `/workspace/.dsh-data-analysis/presentations/report/builds/${document.buildId}/${asset}`,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  })
  const delivery: PresentationDelivery = {
    kind: 'marivo.presentation.delivery',
    schemaVersion: 2,
    dshSessionId: 'session-a',
    turn: 3,
    receipt: {
      kind: 'marivo.presentation',
      schemaVersion: 2,
      workspaceId: document.workspaceId,
      reportId: 'report',
      buildId: document.buildId,
      title: document.title,
      summary: '保存的数据与来源',
      files: { document: file('presentation.json', json), html: file('index.html', html) },
    },
  }
  const response = (asset: string) => {
    const body = asset === 'presentation.json' ? json : html
    return {
      ok: true,
      value: {
        workspaceId: document.workspaceId,
        reportId: 'report',
        buildId: document.buildId,
        asset,
        mimeType:
          asset === 'presentation.json'
            ? 'application/json; charset=utf-8'
            : 'text/html; charset=utf-8',
        bytes: body.length,
        sha256: createHash('sha256').update(body).digest('hex'),
        bodyBase64: body.toString('base64'),
      },
    }
  }
  return { document, delivery, json, html, response }
}

test('reader and HTML download verify bytes and only read saved assets and publishing status', async () => {
  const { document, delivery, html, response } = await fixture()
  const calls: unknown[] = [],
    saved: unknown[] = []
  const rpc: PresentationRpc = {
    async call(channel, endpoint, payload, _signal) {
      calls.push({ channel, endpoint, payload })
      if (channel === '/dsh-report-publishing' && endpoint === 'describe')
        return { ok: true, value: { enabled: false, fields: [] } }
      if (endpoint === 'reports/resolve') return { ok: true, value: delivery.receipt }
      return response((payload as { asset: string }).asset)
    },
  }
  const model = new PresentationDeliveryModel(rpc, (bytes, filename) =>
    saved.push({ bytes: Buffer.from(bytes), filename }),
  )
  await model.show(delivery, 'session-a', document.workspaceId)
  assert.deepEqual(model.getSnapshot().document, document)
  await model.download(delivery, 'session-a', document.workspaceId)
  assert.deepEqual(saved, [
    { bytes: html, filename: `marivo-${document.reportId}-${document.buildId}.html` },
  ])
  assert.deepEqual(
    calls.filter((call: any) => call.channel === '/marivo-presentation'),
    ['presentation.json', 'index.html'].flatMap((asset) => [
      {
        channel: '/marivo-presentation',
        endpoint: 'reports/resolve',
        payload: { sessionId: 'session-a', reportId: delivery.receipt.reportId },
      },
      {
        channel: '/marivo-presentation',
        endpoint: 'files/read',
        payload: { sessionId: 'session-a', receipt: delivery.receipt, asset },
      },
    ]),
  )
  assert.deepEqual(
    calls.filter((call: any) => call.channel === '/dsh-report-publishing'),
    [
      {
        channel: '/dsh-report-publishing',
        endpoint: 'describe',
        payload: { workspaceId: document.workspaceId },
      },
    ],
  )
  assert.equal(
    model.getSnapshot().document!.sources.filter((source) => source.status === 'unavailable')
      .length,
    1,
  )
  model.dispose()
})

test('asset verification rejects changed digest, size, file identity, MIME, and excess base64 before use', async () => {
  const { delivery, response } = await fixture()
  const valid = response('index.html').value
  for (const override of [
    { workspaceId: 'other' },
    { buildId: 'other' },
    { asset: 'presentation.json' },
    { sha256: '0'.repeat(64) },
    { bytes: valid.bytes + 1 },
    { mimeType: 'text/javascript' },
    { bodyBase64: valid.bodyBase64 + 'A'.repeat(100000) },
    { bodyBase64: '!'.repeat(valid.bodyBase64.length) },
  ])
    await assert.rejects(
      verifyPresentationAsset({ ...valid, ...override }, delivery.receipt, 'index.html'),
      /identity-mismatch/,
    )
  const changed = Buffer.from(valid.bodyBase64, 'base64')
  changed[0] = 0
  await assert.rejects(
    verifyPresentationAsset(
      { ...valid, bodyBase64: changed.toString('base64') },
      delivery.receipt,
      'index.html',
    ),
    /digest-mismatch/,
  )
})

test('Workspace and Session mismatches never issue RPC; mid-flight changes clear snapshots and prevent late completion', async () => {
  const { delivery, document, response } = await fixture()
  let resolve!: (value: unknown) => void
  const signals: AbortSignal[] = []
  const rpc: PresentationRpc = {
    async call(_channel, _endpoint, _payload, signal) {
      signals.push(signal)
      return new Promise((done) => {
        resolve = done
      })
    },
  }
  let saves = 0
  const model = new PresentationDeliveryModel(rpc, () => {
    saves++
  })
  await model.show(delivery, 'foreign-session', document.workspaceId)
  await model.download(delivery, 'session-a', 'foreign-workspace')
  assert.equal(signals.length, 0)
  assert.match(model.getSnapshot().error!, /Workspace 或 Session 已变化/)
  const pending = model.show(delivery, 'session-a', document.workspaceId)
  model.contextChanged('session-a', 'foreign-workspace')
  assert.equal(signals[0]!.aborted, true)
  resolve(response('presentation.json'))
  await pending
  assert.equal(model.getSnapshot().document, undefined)
  assert.equal(model.getSnapshot().loading, false)
  const download = model.download(delivery, 'session-a', document.workspaceId)
  model.resetConnection()
  resolve(response('index.html'))
  await download
  assert.equal(saves, 0)
  assert.match(model.getSnapshot().error!, /Host 连接已重置/)
})

test('missing files and corrupt HTML surface explicit errors without saving; closing cancels late reader responses', async () => {
  const { delivery, document, response } = await fixture()
  let saves = 0
  const model = new PresentationDeliveryModel(
    {
      async call() {
        return { ok: false, error: { code: 'file-missing', message: 'Saved file is missing.' } }
      },
    },
    () => {
      saves++
    },
  )
  await model.show(delivery, 'session-a', document.workspaceId)
  assert.match(model.getSnapshot().error!, /文件已缺失/)
  await model.download(delivery, 'session-a', document.workspaceId)
  assert.match(model.getSnapshot().downloadError!, /文件已缺失/)
  assert.equal(saves, 0)
  const corrupted = new PresentationDeliveryModel(
    {
      async call(_channel, endpoint) {
        if (endpoint === 'reports/resolve') return { ok: true, value: delivery.receipt }
        const value = response('index.html').value
        const bytes = Buffer.from(value.bodyBase64, 'base64')
        bytes[0] = 0
        return { ok: true, value: { ...value, bodyBase64: bytes.toString('base64') } }
      },
    },
    () => {
      saves++
    },
  )
  await corrupted.download(delivery, 'session-a', document.workspaceId)
  assert.match(corrupted.getSnapshot().downloadError!, /文件已变化.*摘要不一致/)
  assert.equal(saves, 0)
  let resolve!: (value: unknown) => void
  const closing = new PresentationDeliveryModel({
    async call() {
      return new Promise((done) => {
        resolve = done
      })
    },
  })
  const flight = closing.show(delivery, 'session-a', document.workspaceId)
  closing.close()
  resolve(response('presentation.json'))
  await flight
  assert.equal(closing.getSnapshot().open, false)
  assert.equal(closing.getSnapshot().document, undefined)
})

test('publishing sends the displayed Build and filtered HTML, never downloads, and discards late results', async () => {
  const { document, delivery, response } = await fixture()
  const payloads: any[] = []
  let complete: ((value: unknown) => void) | undefined
  let defer = false
  let downloads = 0
  const model = new PresentationDeliveryModel(
    {
      async call(channel, endpoint, payload) {
        if (channel === '/dsh-report-publishing') {
          if (endpoint === 'describe')
            return { ok: true, value: { enabled: true, name: 'reports', configId: 'test-config' } }
          payloads.push(payload)
          if (defer)
            return new Promise((resolve) => {
              complete = resolve
            })
          return {
            ok: true,
            value: {
              workspaceId: document.workspaceId,
              reportId: delivery.receipt.reportId,
              buildId: document.buildId,
              url: 'https://reports.example.test/view.html',
            },
          }
        }
        if (endpoint === 'reports/resolve') return { ok: true, value: delivery.receipt }
        return response((payload as { asset: string }).asset)
      },
    },
    () => {
      downloads++
    },
  )
  await model.show(delivery, 'session-a', document.workspaceId)
  const view = new TextEncoder().encode('<html>filtered rows</html>')
  await model.publishDisplayed(view)
  assert.equal(downloads, 0)
  assert.deepEqual(payloads[0], {
    configId: 'test-config',
    workspaceId: document.workspaceId,
    reportId: delivery.receipt.reportId,
    buildId: document.buildId,
    viewHtml: '<html>filtered rows</html>',
  })
  assert.equal(model.getSnapshot().publicationUrl, 'https://reports.example.test/view.html')
  defer = true
  const pending = model.publishDisplayed()
  model.close()
  complete!({ ok: true, value: { ...payloads[0], url: 'https://reports.example.test/late.html' } })
  await pending
  assert.notEqual(model.getSnapshot().publicationUrl, 'https://reports.example.test/late.html')
  assert.equal(model.getSnapshot().document, undefined)
  model.dispose()
})

test('late publication success and failure cannot replace the state of an edited Build', async () => {
  for (const outcome of ['success', 'failure', 'transport-error']) {
    const f = await fixture()
    let document = f.document
    let receipt = f.delivery.receipt
    let finish!: () => void
    const model = new PresentationDeliveryModel({
      async call(channel, endpoint, payload: any) {
        if (channel === '/dsh-report-publishing') {
          if (endpoint === 'describe')
            return { ok: true, value: { enabled: true, name: 'reports', configId: 'test-config' } }
          return new Promise((resolve, reject) => {
            finish = () => {
              if (outcome === 'transport-error') reject(new Error('network failed'))
              else if (outcome === 'failure')
                resolve({ ok: false, error: { message: 'report-publishing-upload-unconfirmed' } })
              else
                resolve({
                  ok: true,
                  value: {
                    workspaceId: f.document.workspaceId,
                    reportId: f.delivery.receipt.reportId,
                    buildId: f.document.buildId,
                    url: 'https://reports.example.test/old.html',
                  },
                })
            }
          })
        }
        if (endpoint === 'reports/save') {
          document = { ...document, title: payload.edits.title, buildId: 'edited-build' }
          const bytes = Buffer.from(JSON.stringify(document))
          receipt = {
            ...receipt,
            title: document.title,
            buildId: document.buildId,
            files: {
              document: {
                ...receipt.files.document,
                path: receipt.files.document.path.replace(
                  `/${receipt.buildId}/`,
                  `/${document.buildId}/`,
                ),
                bytes: bytes.length,
                sha256: createHash('sha256').update(bytes).digest('hex'),
              },
            },
          }
          return { ok: true, value: receipt }
        }
        if (endpoint === 'reports/resolve') return { ok: true, value: receipt }
        const bytes = Buffer.from(JSON.stringify(document))
        return {
          ok: true,
          value: {
            ...f.response('presentation.json').value,
            buildId: document.buildId,
            bytes: bytes.length,
            sha256: createHash('sha256').update(bytes).digest('hex'),
            bodyBase64: bytes.toString('base64'),
          },
        }
      },
    })
    await model.show(f.delivery, 'session-a', document.workspaceId)
    const pending = model.publishDisplayed()
    model.beginEdit()
    model.changeEdits({ ...model.getSnapshot().editing!.edits, title: 'Edited during upload' })
    await model.saveEdit()
    assert.equal(model.getSnapshot().document?.buildId, 'edited-build')
    finish()
    await pending
    assert.equal(model.getSnapshot().publicationUrl, undefined, outcome)
    assert.equal(model.getSnapshot().downloadError, undefined, outcome)
    assert.equal(model.getSnapshot().notice, '编辑已保存', outcome)
    assert.equal(model.getSnapshot().downloading, false, outcome)
    model.dispose()
  }
})
