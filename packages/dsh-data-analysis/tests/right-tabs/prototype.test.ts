import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import type { SessionEventWindow } from '@deepseek-ai/dsh-api-session-controller/client'
import { followUpContext } from '../../src/client/presentation/model.ts'
import { LiveDeliveryObserver } from '../../src/client/right-tabs/live-delivery.ts'
import {
  canOpenResource,
  parseResource,
  type Resource,
  resourceAddress,
} from '../../src/client/right-tabs/navigation.ts'
import { TabPage } from '../../src/client/right-tabs/page.ts'
import { parsePresentationDocument } from '../../src/presentation/contracts/index.ts'
import type { PresentationDelivery } from '../../src/presentation/receipt.ts'

const base = parsePresentationDocument(
  JSON.parse(
    await readFile(
      new URL('../presentation-s0/fixtures/computed.document.json', import.meta.url),
      'utf8',
    ),
  ),
)
function fixture() {
  const documents = ['old', 'new'].map((buildId) => ({ ...base, buildId }))
  const receipts = documents.map((doc) => ({
    kind: 'marivo.presentation' as const,
    schemaVersion: 2 as const,
    workspaceId: doc.workspaceId,
    reportId: doc.reportId,
    buildId: doc.buildId,
    title: doc.title,
    summary: 'saved',
    files: Object.fromEntries(
      [
        ['document', 'presentation.json'],
        ['html', 'index.html'],
      ].map(([key, asset]) => {
        const body = asset === 'presentation.json' ? JSON.stringify(doc) : '<html>saved</html>'
        return [
          key,
          {
            asset,
            path: `/workspace/.dsh-data-analysis/presentations/${doc.reportId}/builds/${doc.buildId}/${asset}`,
            bytes: Buffer.byteLength(body),
            sha256: createHash('sha256').update(body).digest('hex'),
          },
        ]
      }),
    ) as any,
  }))
  let current = 0
  const calls: string[] = []
  const rpc = {
    call: async (_channel: string, endpoint: string, payload: any, _signal: AbortSignal) => {
      calls.push(endpoint)
      if (endpoint === 'reports/resolve') return { ok: true, value: receipts[current] }
      if (endpoint === 'reports/history')
        return {
          ok: true,
          value: {
            workspaceId: base.workspaceId,
            reportId: base.reportId,
            currentBuildId: receipts[current]!.buildId,
            legacyHistoryUnavailable: false,
            versions: receipts
              .slice(0, current + 1)
              .reverse()
              .map((receipt) => ({ receipt, publishedAt: null, source: null })),
          },
        }
      if (endpoint === 'files/read') {
        const doc = documents.find((d) => d.buildId === payload.receipt.buildId)!
        const body = JSON.stringify(doc),
          bytes = Buffer.from(body)
        return {
          ok: true,
          value: {
            workspaceId: doc.workspaceId,
            reportId: doc.reportId,
            buildId: doc.buildId,
            asset: 'presentation.json',
            mimeType: 'application/json',
            bytes: bytes.length,
            sha256: createHash('sha256').update(bytes).digest('hex'),
            bodyBase64: bytes.toString('base64'),
          },
        }
      }
      throw new Error(endpoint)
    },
  }
  const delivery: PresentationDelivery = {
    kind: 'marivo.presentation.delivery',
    schemaVersion: 2,
    dshSessionId: 's1',
    turn: 1,
    receipt: receipts[0]!,
  }
  return {
    rpc,
    receipts,
    delivery,
    calls,
    advance: () => {
      current = 1
    },
  }
}
test('resource identities round-trip without collisions or file-preview claims', () => {
  const targets: Resource[] = [
    { kind: 'report', workspaceId: '空间/a', reportId: 'same title?#' },
    { kind: 'report', workspaceId: '空间/a', reportId: 'same title?#', buildId: 'build/1' },
    {
      kind: 'semantic',
      workspaceId: '空间/a',
      ref: { schema: 'marivo.semantic_ref/v1', kind: 'metric', path: 'sales/a?b#c' },
    },
  ]
  assert.equal(new Set(targets.map(resourceAddress)).size, 3)
  for (const target of targets) assert.deepEqual(parseResource(resourceAddress(target)), target)
  for (const address of [
    'dsh-resource://file/session/s1/report.html',
    'dsh-resource://marivo-report/w/r/current?secret=x',
    'dsh-resource://marivo-report/w/r/build/',
    'dsh-resource://marivo-report/w/%72/current',
    'dsh-resource://marivo-report/w/%ZZ/current',
  ]) {
    assert.equal(canOpenResource(address, 'report'), false)
    assert.throws(() => parseResource(address))
  }
})
test('only appended canonical deliveries open; replay, settlement, duplicates and foreign owners cannot open', () => {
  const { delivery, receipts } = fixture(),
    opened: PresentationDelivery[] = []
  const observer = new LiveDeliveryObserver('s1', (d) => opened.push(d))
  const call = {
    type: 'tool/call',
    seq: 1,
    data: { turn: 1, callId: 'call', name: 'marivo_present' },
  }
  const result = {
    type: 'tool/result',
    seq: 2,
    surfaceOp: 'append',
    data: {
      turn: 1,
      meta: delivery,
      message: {
        source: { callId: 'call' },
        content: [{ type: 'tool-result', toolCallId: 'call', isError: false }],
      },
    },
  }
  let revision = 0
  const consume = (kind: string, events: any[], baseline = false) =>
    observer.consume(
      {
        revision: ++revision,
        entries: events.map((event) => ({ type: 'event', event })),
        hasMore: false,
        change: { kind, entries: events.map((event) => ({ type: 'event', event })) },
      } as SessionEventWindow,
      baseline,
    )
  consume('replace', [])
  consume('append', [call])
  observer.consume({
    revision: ++revision,
    entries: [],
    hasMore: false,
    change: { kind: 'settle-assistant', attemptId: 'attempt' },
  } as unknown as SessionEventWindow)
  consume('append', [result])
  consume('append', [result])
  assert.equal(opened.length, 1)
  consume('replace', [call, result])
  consume('prepend', [call, result])
  consume('append', [result])
  consume('append', [call, result], true)
  assert.equal(opened.length, 1)
  const code = {
    type: 'tool/ptc-dispatch',
    seq: 4,
    data: {
      name: 'marivo_present',
      isError: false,
      rootCallId: 'root',
      subCallId: 'sub',
      content: [
        {
          type: delivery.kind,
          delivery: { ...delivery, receipt: receipts[1] },
        },
      ],
    },
  }
  consume('append', [{ ...call, seq: 3, data: { turn: 1, callId: 'root', name: 'run_code' } }])
  consume('append', [code])
  consume('append', [code])
  assert.equal(opened.length, 2)
  consume('append', [
    {
      ...code,
      seq: 5,
      data: {
        ...code.data,
        content: [
          {
            type: delivery.kind,
            delivery: {
              ...delivery,
              dshSessionId: 'other',
              receipt: { ...delivery.receipt, buildId: 'foreign' },
            },
          },
        ],
      },
    },
  ])
  assert.equal(opened.length, 2)
})
test('fixed Build never resolves current; current announces updates until explicit refresh', async () => {
  const f = fixture()
  const current = new TabPage(
    's1',
    { kind: 'report', workspaceId: base.workspaceId, reportId: base.reportId },
    f.rpc,
  )
  const fixed = new TabPage(
    's1',
    { kind: 'report', workspaceId: base.workspaceId, reportId: base.reportId, buildId: 'old' },
    f.rpc,
  )
  await current.navigate(1)
  const assertContext = (page: TabPage, buildId: string) => {
    const document = page.reader.getSnapshot().document!
    const cell = document.blocks[0]!
    const lines = followUpContext(document, cell).split('\n')
    assert.ok(lines.includes(`Workspace: ${base.workspaceId}`))
    assert.ok(lines.includes(`Report ID: ${base.reportId}`))
    assert.ok(lines.includes(`Build ID: ${buildId}`))
    assert.ok(lines.includes(`Cell: ${cell.id}`))
  }
  assertContext(current, 'old')
  current.viewMemory.set(`${base.workspaceId}/${base.reportId}/old/interactive`, {
    chosen: { region: 'old-selection' },
    tableSorts: {},
    explorations: {},
  })
  f.advance()
  const before = f.calls.length
  await fixed.navigate(1)
  assert.deepEqual(f.calls.slice(before), ['reports/history', 'files/read'])
  assert.equal(fixed.reader.getSnapshot().document?.buildId, 'old')
  await current.publicationChanged(base.workspaceId, base.reportId)
  assert.equal(current.getSnapshot().newer?.buildId, 'new')
  assert.equal(current.reader.getSnapshot().document?.buildId, 'old')
  assertContext(current, 'old')
  assertContext(fixed, 'old')
  assert.equal(current.viewMemory.size, 1, 'a new-version hint preserves the displayed filters')
  await current.refresh()
  assert.equal(current.viewMemory.size, 0, 'switching Build discards old-version filters')
  assert.equal(current.reader.getSnapshot().document?.buildId, 'new')
  assert.equal(fixed.reader.getSnapshot().document?.buildId, 'old')
  assertContext(current, 'new')
  assertContext(fixed, 'old')
  current.dispose()
  fixed.dispose()
})
test('late reads cannot revive revoked, disposed or superseded pages, even when transport ignores abort', async () => {
  const f = fixture(),
    waiting: (() => void)[] = []
  const rpc = {
    call: async (...args: Parameters<typeof f.rpc.call>) => {
      if (args[1] === 'files/read') await new Promise<void>((r) => waiting.push(r))
      return f.rpc.call(...args)
    },
  }
  const page = new TabPage(
    's1',
    { kind: 'report', workspaceId: base.workspaceId, reportId: base.reportId },
    rpc,
  )
  const first = page.navigate(1)
  await new Promise((r) => setImmediate(r))
  page.unavailable('revoked')
  waiting.shift()!()
  await first
  assert.equal(page.reader.getSnapshot().document, undefined)
  assert.equal(page.getSnapshot().error, 'revoked')
  const second = page.navigate(2)
  await new Promise((r) => setImmediate(r))
  page.dispose()
  waiting.shift()!()
  await second
  assert.equal(page.reader.getSnapshot().document, undefined)
})

test('history is navigation positioning on a current report, not a second resource identity', async () => {
  const f = fixture()
  const target = { kind: 'report' as const, workspaceId: base.workspaceId, reportId: base.reportId }
  const page = new TabPage('s1', target, f.rpc)
  await page.navigate(1, false, true)
  assert.equal(page.reader.getSnapshot().historyOpen, true)
  assert.equal(page.reader.getSnapshot().document?.buildId, 'old')
  await page.navigate(2)
  assert.equal(page.reader.getSnapshot().historyOpen, false)
  assert.equal(resourceAddress(page.target as typeof target), resourceAddress(target))
  page.dispose()
})
