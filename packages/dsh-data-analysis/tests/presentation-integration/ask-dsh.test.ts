import assert from 'node:assert/strict'
import test from 'node:test'
import {
  type AskDshHost,
  appendPresentationContext,
} from '../../src/client/presentation/ask-dsh.ts'
import { followUpContext } from '../../src/client/presentation/model.ts'
import { interactionFixture } from '../presentation-reader/interaction-fixture.ts'

function fixture() {
  const drafts = new Map([
    ['a', ''],
    ['b', '另一个会话的草稿'],
  ])
  const writes: { sessionId: string; text: string }[] = []
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
      scope: (sessionId: string) => (state.available ? { sessionId } : undefined),
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
          state: { getSnapshot: () => ({ draft: drafts.get(sessionId) }) },
          setDraft(text: string) {
            if (state.failure) throw new Error('input unavailable')
            writes.push({ sessionId, text })
            drafts.set(sessionId, text)
          },
        }),
      },
    },
  } as unknown as AskDshHost
  return { host, state, drafts, writes }
}

test('Ask DSH wraps one context and appends to the latest draft without trimming or deduplication', () => {
  const f = fixture()
  const context = 'Cell: a\nMetric raw value: "9007199254740993"'
  const wrapped = `【报告上下文】\n${context}\n【报告上下文结束】`
  appendPresentationContext(f.host, 'a', 'workspace', context)
  assert.equal(f.drafts.get('a'), wrapped)
  f.drafts.set('a', '  用户刚输入的问题\n')
  appendPresentationContext(f.host, 'a', 'workspace', context)
  assert.equal(f.drafts.get('a'), `  用户刚输入的问题\n\n\n${wrapped}`)
  appendPresentationContext(f.host, 'a', 'workspace', context)
  assert.equal(f.drafts.get('a'), `  用户刚输入的问题\n\n\n${wrapped}\n\n${wrapped}`)
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
      () => appendPresentationContext(f.host, 'a', 'workspace', 'context'),
      /不可用|变化/,
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
    () => appendPresentationContext(f.host, 'a', 'workspace', 'context'),
    /input unavailable/,
  )
  assert.equal(f.writes.length, 0)
  assert.equal(f.drafts.get('a'), '')
  assert.equal(f.drafts.get('b'), '另一个会话的草稿')
})

test('Ask DSH carries the selected cell and exact filtered metric, not the complete report', async () => {
  const f = fixture()
  const { document } = await interactionFixture()
  f.state.workspaceId = document.workspaceId
  const block = document.blocks.find((entry) => entry.id === 'count')!
  const context = followUpContext(document, block, undefined, { day: 'mon', cluster: 'a' })
  appendPresentationContext(f.host, 'a', document.workspaceId, context)
  const draft = f.drafts.get('a')!
  assert.ok(draft.includes(context))
  assert.match(draft, /当前筛选:/)
  assert.match(draft, /Metric raw value: "150"/)
  assert.doesNotMatch(draft, /Metric raw value: "550"/)
  assert.doesNotMatch(draft, /"blocks":|"datasets":/)
})
