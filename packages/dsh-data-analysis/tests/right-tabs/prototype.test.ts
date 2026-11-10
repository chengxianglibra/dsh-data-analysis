import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import test from 'node:test'
import type { SessionEventWindow } from '@deepseek-ai/dsh-api-session-controller/client'
import { LiveDeliveryObserver } from '../../src/client/right-tabs/live-delivery.ts'
import {
  canOpenResource,
  liveReportAddress,
  parseResource,
  type Resource,
  reportViewFromAddress,
  resourceAddress,
} from '../../src/client/right-tabs/navigation.ts'
import { TabPage } from '../../src/client/right-tabs/page.ts'
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
  type DraftDelivery,
  MARIVO_DRAFT_DELIVERY_KIND,
  type PresentationDelivery,
} from '../../src/presentation/receipt.ts'

const base = {
  schemaVersion: ANALYSIS_UI_FORMAT,
  contentReview: 'not-needed',
  workspaceId: 'workspace',
  reportId: 'report',
  title: 'Saved analysis',
  locale: 'zh-CN',
  generatedAt: '2026-10-29T00:00:00Z',
  catalog: { id: analysisCatalogId, build: analysisCatalogBuild },
  program: 'root = TextContent("Saved analysis");',
  resources: {},
} as const
function fixture() {
  const documents: AnalysisDocument[] = ['old', 'new'].map((buildId) => ({
    ...base,
    buildId,
    recordId: analysisRecordId(base.reportId, buildId),
  }))
  const receipts = documents.map((doc) => ({
    kind: 'marivo.presentation' as const,
    schemaVersion: 2 as const,
    workspaceId: doc.workspaceId,
    reportId: doc.reportId,
    buildId: doc.buildId,
    title: doc.title,
    summary: 'saved',
    files: {
      document: {
        asset: 'presentation.json' as const,
        path: `/workspace/.dsh-data-analysis/presentations/${doc.reportId}/builds/${doc.buildId}/presentation.json`,
        bytes: Buffer.byteLength(JSON.stringify(doc)),
        sha256: createHash('sha256').update(JSON.stringify(doc)).digest('hex'),
      },
    },
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
            versions: receipts
              .slice(0, current + 1)
              .reverse()
              .map((receipt) => ({
                receipt,
                publishedAt: '2026-10-31T00:00:00.000Z',
                source: { kind: 'agent', sessionId: 's1', surface: 'tab' },
              })),
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
    surface: 'tab',
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
    data: { turn: 1, callId: 'call', name: 'marivo_report_write' },
  }
  const result = {
    type: 'tool/result',
    seq: 2,
    surfaceOp: 'append',
    data: {
      turn: 1,
      meta: delivery,
      message: {
        role: 'tool',
        toolCallId: 'call',
        source: { kind: 'tool', callId: 'call' },
        content: [{ type: 'text', text: 'saved' }],
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
      name: 'marivo_report_write',
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
test('live Native and Code previews deliver successive revisions of the same draft without saved delivery', () => {
  const drafts: DraftDelivery[] = []
  const saved: PresentationDelivery[] = []
  const observer = new LiveDeliveryObserver(
    's1',
    (value) => saved.push(value),
    (value) => drafts.push(value),
  )
  let revision = 0
  const append = (...events: object[]) => {
    const entries = events.map((event) => ({ type: 'event', event }))
    observer.consume({
      revision: ++revision,
      entries,
      hasMore: false,
      change: { kind: 'append', entries },
    } as SessionEventWindow)
  }
  append()
  const draft: DraftDelivery = {
    kind: MARIVO_DRAFT_DELIVERY_KIND,
    dshSessionId: 's1',
    workspaceId: 'workspace',
    turn: 1,
    surface: 'tab',
    draftId: randomUUID(),
    draftRevision: randomUUID(),
  }
  const call = (callId: string, name: string, seq: number) => ({
    type: 'tool/call',
    seq,
    data: { turn: 1, callId, name },
  })
  const native = {
    type: 'tool/result',
    seq: 2,
    surfaceOp: 'append',
    data: {
      turn: 1,
      meta: draft,
      message: {
        role: 'tool',
        toolCallId: 'native',
        source: { kind: 'tool', callId: 'native' },
        content: [],
      },
    },
  }
  append(call('native', 'marivo_report_write', 1), native)
  append(native)
  const updated = { ...draft, draftRevision: randomUUID() }
  append(call('root', 'run_code', 3), {
    type: 'tool/ptc-dispatch',
    seq: 4,
    data: {
      rootCallId: 'root',
      subCallId: 'sub',
      name: 'marivo_report_write',
      isError: false,
      content: [{ type: draft.kind, delivery: updated }],
    },
  })
  assert.deepEqual(drafts, [draft, updated])
  assert.deepEqual(saved, [])
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
  assert.equal(current.reader.getSnapshot().analysisDocument?.buildId, 'old')
  f.advance()
  const before = f.calls.length
  await fixed.navigate(1)
  assert.deepEqual(f.calls.slice(before), ['reports/history', 'files/read'])
  assert.equal(fixed.reader.getSnapshot().analysisDocument?.buildId, 'old')
  await current.publicationChanged(base.workspaceId, base.reportId)
  assert.equal(current.getSnapshot().newer?.buildId, 'new')
  assert.equal(current.reader.getSnapshot().analysisDocument?.buildId, 'old')
  await current.refresh()
  assert.equal(current.reader.getSnapshot().analysisDocument?.buildId, 'new')
  assert.equal(fixed.reader.getSnapshot().analysisDocument?.buildId, 'old')
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
  assert.equal(page.reader.getSnapshot().analysisDocument, undefined)
  assert.equal(page.getSnapshot().error, 'revoked')
  const second = page.navigate(2)
  await new Promise((r) => setImmediate(r))
  page.dispose()
  waiting.shift()!()
  await second
  assert.equal(page.reader.getSnapshot().analysisDocument, undefined)
})

test('history is navigation positioning on a current report, not a second resource identity', async () => {
  const f = fixture()
  const target = { kind: 'report' as const, workspaceId: base.workspaceId, reportId: base.reportId }
  const page = new TabPage('s1', target, f.rpc)
  await page.navigate(1, false, true)
  assert.equal(page.reader.getSnapshot().historyOpen, true)
  assert.equal(page.reader.getSnapshot().analysisDocument?.buildId, 'old')
  await page.navigate(2)
  assert.equal(page.reader.getSnapshot().historyOpen, false)
  assert.equal(resourceAddress(page.target as typeof target), resourceAddress(target))
  page.dispose()
})

test('moved report addresses persist view identity without changing ordinary report links', () => {
  const viewId = JSON.stringify(['session', 1, 'call'])
  const target = {
    kind: 'report' as const,
    workspaceId: 'workspace',
    reportId: 'report',
    buildId: 'build',
    reportViewId: viewId,
  }
  const address = resourceAddress(target)
  assert.deepEqual(parseResource(address), target)
  assert.deepEqual(reportViewFromAddress(address), { workspaceId: 'workspace', viewId })
  assert.equal(
    reportViewFromAddress(resourceAddress({ ...target, reportViewId: undefined })),
    undefined,
  )
  assert.deepEqual(reportViewFromAddress(liveReportAddress('workspace', viewId)), {
    workspaceId: 'workspace',
    viewId,
  })
  for (const invalid of [
    address + '&extra=1',
    address + '#fragment',
    'dsh-resource://marivo-analysis-live/workspace/%ZZ',
  ])
    assert.equal(reportViewFromAddress(invalid), undefined)
})
