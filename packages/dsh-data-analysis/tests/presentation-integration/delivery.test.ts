import assert from 'node:assert/strict'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { CodeDispatchLog, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { installMarivoPresentationCodeDelivery } from '../../src/presentation/delivery.ts'
import {
  MARIVO_PRESENT_TOOL_NAME,
  MARIVO_PRESENTATION_DELIVERY_KIND,
  parsePresentationDelivery,
} from '../../src/presentation/receipt.ts'

function delivery() {
  return parsePresentationDelivery({
    kind: MARIVO_PRESENTATION_DELIVERY_KIND,
    schemaVersion: 1,
    dshSessionId: 'session',
    turn: 2,
    receipt: {
      schemaVersion: 1,
      kind: 'marivo.presentation',
      workspaceId: 'workspace',
      buildId: 'build',
      title: 'Title',
      summary: 'Summary',
      files: {
        document: {
          asset: 'presentation.json',
          path: '/workspace/.dsh-data-analysis/presentations/build/presentation.json',
          bytes: 10,
          sha256: 'a'.repeat(64),
        },
        html: {
          asset: 'index.html',
          path: '/workspace/.dsh-data-analysis/presentations/build/index.html',
          bytes: 20,
          sha256: 'b'.repeat(64),
        },
      },
    },
  })
}
function fixture() {
  const callbacks = new Map<string, unknown>()
  const ctx = {
    on(name: string, listener: unknown) {
      callbacks.set(name, listener)
      return () => {
        callbacks.delete(name)
      }
    },
  } as unknown as Context
  const dispose = installMarivoPresentationCodeDelivery(ctx)
  const result = callbacks.get('tools/result') as (
    exec: ToolExecution,
    result: ToolExecutionResult,
  ) => void
  const log = callbacks.get('tools/code-dispatch-log') as (
    dispatch: CodeDispatchLog,
    next: () => Promise<ContentBlock[]>,
  ) => Promise<ContentBlock[]>
  const agent = {
    session: { id: 'session', events: [{ type: 'tool/call', data: { callId: 'root', turn: 2 } }] },
  }
  const exec = {
    name: MARIVO_PRESENT_TOOL_NAME,
    callId: 'child',
    rootCallId: 'root',
    parent: {},
    agent,
  } as unknown as ToolExecution
  const dispatch = {
    name: MARIVO_PRESENT_TOOL_NAME,
    subCallId: 'child',
    agent,
    exec: { rootCallId: 'root' },
    isError: false,
  } as unknown as CodeDispatchLog
  const value = {
    isError: false,
    value: { deliveryJson: JSON.stringify(delivery()) },
  } as unknown as ToolExecutionResult
  return { callbacks, dispose, result, log, agent, exec, dispatch, value }
}

test('Code dispatch persists exactly the canonical Native envelope and consumes duplicate rendezvous events', async () => {
  const f = fixture()
  f.result(f.exec, f.value)
  const content = await f.log(f.dispatch, async () => [{ type: 'text', text: 'Headless receipt' }])
  assert.deepEqual(content, [
    { type: 'text', text: 'Headless receipt' },
    { type: MARIVO_PRESENTATION_DELIVERY_KIND, delivery: delivery() },
  ])
  assert.deepEqual(await f.log(f.dispatch, async () => []), [])
  f.dispose()
  f.dispose()
  assert.equal(f.callbacks.size, 0)
})

test('Code delivery rejects cross Session, wrong Turn, wrong root and failed dispatches', async () => {
  for (const variant of ['session', 'turn', 'root', 'error'] as const) {
    const f = fixture()
    f.result(f.exec, f.value)
    if (variant === 'session') f.agent.session.id = 'other'
    if (variant === 'turn') f.agent.session.events[0]!.data.turn = 3
    const dispatch =
      variant === 'root'
        ? ({ ...f.dispatch, exec: { rootCallId: 'other' } } as unknown as CodeDispatchLog)
        : variant === 'error'
          ? { ...f.dispatch, isError: true }
          : f.dispatch
    assert.deepEqual(await f.log(dispatch, async () => []), [])
    f.dispose()
  }
})

test('invalid delivery metadata and failed or top-level tool results never enter Code delivery', async () => {
  const f = fixture()
  for (const [exec, result] of [
    [f.exec, { ...f.value, isError: true }],
    [{ ...f.exec, parent: undefined }, f.value],
    [f.exec, { ...f.value, value: { deliveryJson: '{' } }],
  ] as const) {
    f.result(exec, result as ToolExecutionResult)
    assert.deepEqual(await f.log(f.dispatch, async () => []), [])
  }
  f.dispose()
})
