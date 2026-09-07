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
    path: `/workspace/.dsh-data-analysis/presentations/${document.buildId}/${asset}`,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  })
  const delivery: PresentationDelivery = {
    kind: 'marivo.presentation.delivery',
    schemaVersion: 1,
    dshSessionId: 'session-a',
    turn: 3,
    receipt: {
      kind: 'marivo.presentation',
      schemaVersion: 1,
      workspaceId: document.workspaceId,
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

test('reader and HTML download verify bytes and only call the saved-asset RPC', async () => {
  const { document, delivery, html, response } = await fixture()
  const calls: unknown[] = [],
    saved: unknown[] = []
  const rpc: PresentationRpc = {
    async call(channel, endpoint, payload, _signal) {
      calls.push({ channel, endpoint, payload })
      return response((payload as { asset: string }).asset)
    },
  }
  const model = new PresentationDeliveryModel(rpc, (bytes, filename) =>
    saved.push({ bytes: Buffer.from(bytes), filename }),
  )
  await model.show(delivery, 'session-a', document.workspaceId)
  assert.deepEqual(model.getSnapshot().document, document)
  await model.download(delivery, 'session-a', document.workspaceId)
  assert.deepEqual(saved, [{ bytes: html, filename: `marivo-${document.buildId}.html` }])
  assert.deepEqual(
    calls,
    ['presentation.json', 'index.html'].map((asset) => ({
      channel: '/marivo-presentation',
      endpoint: 'files/read',
      payload: { sessionId: 'session-a', receipt: delivery.receipt, asset },
    })),
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
      async call() {
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
