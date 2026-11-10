import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, {
  createUserMessage,
  type GenerateOptions,
  LlmAdapter,
  type StreamChunk,
  ToolCallId,
} from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import { waitForNextStepsAdvance } from '../../scripts/unified-analysis-ui/next-steps-host.ts'
import { NextStepsModel } from '../../src/client/next-steps-model.ts'
import { installNextStepsAgent } from '../../src/next-steps/agent.ts'
import { type NextStepsNotice, nextStepsInput } from '../../src/next-steps/contracts.ts'
import { NextStepsService } from '../../src/next-steps/service.ts'
import { TestShellEnv } from '../test-shell-env.ts'

const items = [{ label: 'Compare regions', prompt: 'Compare the regions in the saved analysis.' }]
const notice = { sessionId: 'session', workspaceId: 'workspace', turn: 1, items }
const stop: StreamChunk[] = [{ type: 'finish', reason: { kind: 'stop' } }]

test('acceptance inspection pause releases on advance and cancellation', async () => {
  for (const cancelled of [false, true]) {
    const controller = new AbortController()
    let release: (() => void) | undefined
    const waiting = waitForNextStepsAdvance(controller.signal, (value) => {
      release = value
    })
    assert.ok(release)
    if (cancelled) {
      controller.abort(new Error('inspection cancelled'))
      await assert.rejects(waiting, /inspection cancelled/)
    } else {
      release()
      await waiting
    }
    assert.equal(release, undefined)
  }
  const signal = AbortSignal.abort(new Error('already cancelled'))
  await assert.rejects(
    waitForNextStepsAdvance(signal, () => assert.fail()),
    /already cancelled/,
  )
})
function call(name: string, args: object): StreamChunk[] {
  const id = ToolCallId(randomUUID()),
    argumentsJson = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: argumentsJson },
    {
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id, name, arguments: argumentsJson },
    },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}
class Script extends LlmAdapter {
  requests = 0
  private readonly chunks: StreamChunk[][]
  constructor(chunks: StreamChunk[][]) {
    super()
    this.chunks = chunks
  }
  override async resolveModel(provider: string, model: string) {
    return { provider, id: model, name: model }
  }
  async *stream(_options: GenerateOptions) {
    this.requests++
    const chunks = this.chunks.shift()
    if (!chunks) throw new Error('script-exhausted')
    yield* chunks
  }
}
async function harness(script: Script) {
  const ctx = new Context()
  for (const plugin of [
    LlmRuntime,
    SessionStore,
    SystemPrompt,
    TestShellEnv,
    ToolRuntime,
    AgentRegistry,
    SessionProjectionRegistry,
  ])
    await ctx.plugin(plugin)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], script)
  return ctx
}

test('next-step schema validates Unicode lengths, closed fields and duplicate content', () => {
  assert.equal(nextStepsInput.parse({ items: [] }).items.length, 0)
  assert.equal(
    nextStepsInput.parse({ items: [{ label: '🙂'.repeat(40), prompt: ' x ' }] }).items[0]?.prompt,
    'x',
  )
  for (const value of [
    { items, sessionId: 'forged' },
    { items: [...items, ...items] },
    { items: [{ label: ' ', prompt: 'x' }] },
    { items: [{ label: '🙂'.repeat(41), prompt: 'x' }] },
  ])
    assert.equal(nextStepsInput.safeParse(value).success, false)
})

test('live stream has no baseline, cross-session publication or reconnect replay', async () => {
  const ctx = new Context(),
    bus = new NextStepsService(ctx),
    lifetime = new AbortController()
  bus.publish(notice)
  const iterator = bus.watch('session', lifetime.signal)[Symbol.asyncIterator]()
  const first = iterator.next()
  bus.publish({ ...notice, sessionId: 'another' })
  bus.publish({ ...notice, turn: 2 })
  assert.equal((await first).value?.turn, 2)
  lifetime.abort()
  await iterator.next()
  const second = bus.watch('session', new AbortController().signal)[Symbol.asyncIterator]()
  const pending = second.next()
  bus.close()
  assert.equal((await pending).done, true)
})

test('Chat model consumes once, rejects late or foreign notices and never restores consumed options', () => {
  const model = new NextStepsModel()
  model.accept({ ...notice, sessionId: 'another' }, notice)
  assert.equal(model.value, undefined)
  model.accept(notice, notice)
  let sends = 0
  model.submit(1, 0, () => false)
  assert.ok(model.value)
  model.submit(1, 0, (prompt) => {
    sends++
    assert.equal(prompt, items[0]!.prompt)
    model.submit(1, 0, () => {
      sends++
      return true
    })
    return true
  })
  model.accept(notice, notice)
  model.submit(1, 0, () => {
    sends++
    return true
  })
  assert.equal(sends, 1)
  assert.equal(model.value, undefined)
  assert.equal(new NextStepsModel().value, undefined)
})

for (const nested of [false, true])
  for (const completes of [false, true])
    for (const response of ['items', 'empty', 'omitted'] as const) {
      test(`real Harness completion generates live-only recommendations (nested=${nested}, concludesTurn=${completes}, response=${response})`, async () => {
        const invoke = (name: string, args: object) =>
          nested ? call('nested_transport', { target: name, params: args }) : call(name, args)
        const script = new Script([
          invoke('marivo_present', {}),
          ...(completes ? [] : [stop]),
          ...(response === 'omitted'
            ? []
            : [invoke('marivo_next_steps', { items: response === 'empty' ? [] : items })]),
          stop,
        ])
        const ctx = await harness(script)
        const agent = await ctx.agentLoop.create(
          SessionId(`next-${nested}-${completes}-${response}`),
          {
            provider: 'mock',
            model: 'mock',
          },
        )
        const published: NextStepsNotice[] = []
        const dispose = installNextStepsAgent(
          ctx,
          agent,
          () => ({ id: 'workspace', path: '/workspace' }),
          (value) => published.push(value),
        )
        const present = agent.ctx.tools.register(
          defineTool({
            name: 'marivo_present',
            description: 'fixture saved delivery',
            parameters: {},
            output: { schema: { type: 'json' }, render: () => [] },
            async execute(_args, exec) {
              const root = [...agent.session.snapshotEvents()]
                .reverse()
                .find(
                  (event) => event.type === 'tool/call' && event.data.callId === exec.rootCallId,
                )
              assert.equal(root?.type, 'tool/call')
              const delivery = {
                kind: 'marivo.presentation.delivery',
                schemaVersion: 2,
                surface: 'tool',
                dshSessionId: String(agent.session.id),
                turn: root.data.turn,
                receipt: {
                  kind: 'marivo.presentation',
                  schemaVersion: 2,
                  workspaceId: 'workspace',
                  reportId: 'report',
                  buildId: 'build',
                  title: 'Analysis',
                  summary: 'Saved',
                  files: {
                    document: {
                      asset: 'presentation.json',
                      path: '/workspace/.dsh-data-analysis/presentations/report/builds/build/presentation.json',
                      bytes: 10,
                      sha256: 'a'.repeat(64),
                    },
                  },
                },
              }
              if (completes) exec.concludeTurn()
              return { deliveryJson: JSON.stringify(delivery) }
            },
          }),
        )
        const code = agent.ctx.tools.register(
          defineTool({
            name: 'nested_transport',
            description: 'nested tool transport fixture',
            parameters: {
              target: { type: 'string', required: true },
              params: { type: 'json', required: true },
            },
            output: { schema: { type: 'json' }, render: () => [] },
            async execute(args, exec) {
              const result = await agent.ctx.tools.execute({
                callId: ToolCallId(randomUUID()),
                rootCallId: exec.rootCallId,
                name: args.target,
                arguments: args.params,
                agent,
                parent: exec.token,
                signal: exec.signal,
              })
              assert.equal(result.isError, false)
              if (!result.isError && result.concludesTurn) exec.concludeTurn()
              return { discarded: true }
            },
          }),
        )
        try {
          agent.followup(
            createUserMessage({
              source: { kind: 'user' },
              content: [{ type: 'text', text: 'Analyze' }],
            }),
          )
          await agent.whenIdle()
          assert.equal(script.requests, completes ? 2 : 3)
          assert.equal(
            [...agent.session.snapshotEvents()].reverse().find((event) => event.type === 'turn/end')
              ?.data.reason.kind,
            'completed',
          )
          assert.equal(
            published.filter((value) => value.items.length).length,
            response === 'items' ? 1 : 0,
          )
          if (response === 'items')
            assert.deepEqual(published.find((value) => value.items.length)?.items, items)
          const messages = agent.session
            .snapshotEvents()
            .filter(
              (event) =>
                event.type === 'user/message' && event.data.source.kind === 'marivo-next-steps',
            )
          assert.equal(messages.length, 1)
          assert.ok(
            !agent.session
              .snapshotEvents()
              .some(
                (event) =>
                  event.type === 'tool/result' &&
                  JSON.stringify(event.data.meta ?? {}).includes(items[0]!.prompt),
              ),
          )
        } finally {
          code()
          present()
          await dispose()
        }
      })
    }
