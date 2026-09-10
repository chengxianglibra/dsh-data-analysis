import assert from 'node:assert/strict'
import test from 'node:test'
import type { ReferenceInsert } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { errorMessage as readError, translator } from '../../src/client/i18n/copy.ts'
import {
  type AskDshHost,
  appendPresentationContext,
} from '../../src/client/presentation/ask-dsh.ts'
import { presentationCellLabel } from '../../src/client/presentation/context-reference.ts'
import { followUpContext } from '../../src/client/presentation/model.ts'
import {
  createPresentationReferenceSource,
  presentationReference,
} from '../../src/client/presentation/reference-source.ts'
import { interactionFixture } from '../presentation-reader/interaction-fixture.ts'

function fixture() {
  const drafts = new Map([
    ['a', ''],
    ['b', '另一个会话的草稿'],
  ])
  const writes: { sessionId: string; reference: ReferenceInsert }[] = []
  const occurrences: { length: number }[] = []
  const state = {
    current: 'a',
    available: true,
    workspaceId: 'workspace',
    phase: 'ready',
    status: 'idle',
    failure: false,
  }
  const host = {
    sessions: {
      list: { getSnapshot: () => ({ current: state.current }) },
      scope: (sessionId: string) =>
        state.available
          ? {
              sessionId,
              bail(
                _ctx: unknown,
                event: string,
                request: {
                  reference: ReferenceInsert
                  span: { start: number; end: number; draftRev: number }
                },
              ) {
                assert.equal(event, 'slash/input-insert-reference')
                if (state.failure) throw new Error('input unavailable')
                const draft = drafts.get(sessionId)!
                assert.deepEqual(request.span, {
                  start: occurrences.reduce((n, o) => n - o.length + 1, draft.length),
                  end: occurrences.reduce((n, o) => n - o.length + 1, draft.length),
                  draftRev: 1,
                })
                drafts.set(sessionId, draft + request.reference.clipboardText + ' ')
                occurrences.push({ length: request.reference.clipboardText.length })
                writes.push({ sessionId, reference: request.reference })
                return true
              },
            }
          : undefined,
    },
    workspaces: {
      list: {
        getSnapshot: () => ({
          phase: state.phase,
          state: state.status,
          items: [{ workspaceId: state.workspaceId, sessionIds: ['a'] }],
        }),
      },
    },
    conversation: {
      input: {
        for: ({ sessionId }: { sessionId: string }) => ({
          state: {
            getSnapshot: () => ({ draft: drafts.get(sessionId), draftRev: 1, occurrences }),
          },
        }),
      },
    },
  } as unknown as AskDshHost
  return { host, state, drafts, writes }
}

test('Ask DSH inserts atomic cell references without trimming or deduplication', () => {
  const f = fixture()
  const text = 'Cell: a\nMetric raw value: "9007199254740993"'
  const context = { label: '收入', context: text }
  const wrapped = `【报告上下文】\n${text}\n【报告上下文结束】`
  appendPresentationContext(f.host, 'a', 'workspace', context)
  assert.equal(f.drafts.get('a'), wrapped + ' ')
  assert.equal(f.writes[0]!.reference.label, '# 收入')
  f.drafts.set('a', '  用户刚输入的问题\n')
  appendPresentationContext(f.host, 'a', 'workspace', context)
  assert.equal(f.drafts.get('a'), `  用户刚输入的问题\n\n\n${wrapped} `)
  appendPresentationContext(f.host, 'a', 'workspace', context)
  assert.equal(f.drafts.get('a'), `  用户刚输入的问题\n\n\n${wrapped} \n\n${wrapped} `)
  assert.equal(f.writes.length, 3)
  assert.equal(f.drafts.get('b'), '另一个会话的草稿')
})

test('Ask DSH rejects stale session/workspace identity and unavailable host before touching drafts', () => {
  for (const change of [
    { current: 'b' },
    { current: '' },
    { available: false },
    { workspaceId: 'other' },
    { phase: 'loading' },
    { status: 'error' },
  ]) {
    const f = fixture()
    Object.assign(f.state, change)
    assert.throws(
      () => appendPresentationContext(f.host, 'a', 'workspace', { label: 'a', context: 'context' }),
      (error: unknown) => {
        assert.match(translator('zh-CN')(readError(error)), /不可用|变化/)
        return true
      },
    )
    assert.equal(f.writes.length, 0)
    assert.deepEqual(
      [...f.drafts],
      [
        ['a', ''],
        ['b', '另一个会话的草稿'],
      ],
    )
  }
})

test('Ask DSH exposes a write failure without retrying or changing the other session', () => {
  const f = fixture()
  f.state.failure = true
  assert.throws(
    () => appendPresentationContext(f.host, 'a', 'workspace', { label: 'a', context: 'context' }),
    (error: unknown) => {
      assert.match(translator('zh-CN')(readError(error)), /input unavailable/)
      return true
    },
  )
  assert.equal(f.writes.length, 0)
  assert.equal(f.drafts.get('a'), '')
  assert.equal(f.drafts.get('b'), '另一个会话的草稿')
})

test('Ask DSH carries the selected cell and filter identity, not the complete report', async () => {
  const f = fixture()
  const { document } = await interactionFixture()
  f.state.workspaceId = document.workspaceId
  const block = document.blocks.find((entry) => entry.id === 'count')!
  const context = followUpContext(document, block, undefined, { day: 'mon', cluster: 'a' })
  appendPresentationContext(f.host, 'a', document.workspaceId, {
    label: presentationCellLabel(block),
    context,
  })
  const draft = f.drafts.get('a')!
  assert.ok(draft.includes(context))
  assert.match(draft, /Filters:/)
  assert.match(draft, /"optionId":"mon"/)
  assert.doesNotMatch(draft, /Metric raw value: "550"/)
  assert.doesNotMatch(draft, /"blocks":|"datasets":/)
})

test('oversize reference fails before Host editing and never trims an existing draft', () => {
  const f = fixture()
  f.drafts.set('a', '用户草稿'.repeat(5000))
  const before = f.drafts.get('a')
  assert.throws(
    () =>
      appendPresentationContext(f.host, 'a', 'workspace', {
        label: 'a',
        context: '中'.repeat(4096),
      }),
    (error: unknown) => {
      assert.match(translator('zh-CN')(readError(error)), /12 KiB/)
      return true
    },
  )
  assert.equal(f.drafts.get('a'), before)
  assert.equal(f.writes.length, 0)
  appendPresentationContext(f.host, 'a', 'workspace', { label: 'a', context: 'Cell: a' })
  assert.ok(f.drafts.get('a')!.startsWith(before!))
})

test('report reference codec retains full context and refuses stale ownership, invalid payloads and cancellation', async () => {
  const f = fixture()
  const lifetime = new AbortController()
  const source = createPresentationReferenceSource(f.host, lifetime.signal)
  const reference = presentationReference(
    'a',
    'workspace',
    { label: '收入', context: 'Cell: "a"\nBuild ID: old' },
    false,
  )
  const signal = new AbortController().signal
  const codec = source.codec!
  assert.equal(codec.clipboardText(reference.ref), reference.clipboardText)
  assert.equal(await codec.serialize(reference.ref, signal), reference.clipboardText)
  for (const change of [{ current: 'b' }, { workspaceId: 'other' }, { available: false }]) {
    const owner = fixture()
    Object.assign(owner.state, change)
    await assert.rejects(
      createPresentationReferenceSource(owner.host).codec!.serialize(reference.ref, signal),
      (error: unknown) => {
        assert.match(translator('zh-CN')(readError(error)), /input-owner-unavailable/)
        return true
      },
    )
  }
  for (const ref of [
    '{}',
    'null',
    JSON.stringify({ ...JSON.parse(reference.ref), context: '中'.repeat(4096 + 1) }),
    JSON.stringify({ ...JSON.parse(reference.ref), extra: true }),
  ])
    await assert.rejects(codec.serialize(ref, signal))
  await assert.rejects(codec.serialize(reference.ref, AbortSignal.abort()))
  lifetime.abort()
  await assert.rejects(codec.serialize(reference.ref, signal))
  assert.equal(f.writes.length, 0)
})

test('cell display labels are bounded and fall back to IDs without interpreting report content', () => {
  assert.equal(
    presentationCellLabel({ id: 'intro', kind: 'markdown', text: '# 正文不作为引用名称' }),
    'intro',
  )
  assert.equal(
    presentationCellLabel({ id: 'foo\nbar\t😀', kind: 'table', datasetId: 'd' }),
    'foo bar 😀',
  )
  const metric = { id: 'id', kind: 'metric' as const, datasetId: 'd', columnId: 'v', rowIndex: 0 }
  assert.equal(presentationCellLabel({ ...metric, label: '  收入\n趋势 ' }), '收入 趋势')
  assert.equal(presentationCellLabel({ ...metric, label: '  ' }), 'id')
  assert.equal(Array.from(presentationCellLabel({ ...metric, label: '😀'.repeat(81) })).length, 80)
})
