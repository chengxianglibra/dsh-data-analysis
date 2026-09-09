/** Isolated production Agent/Tool driver. Only the model boundary is scripted. */
import assert from 'node:assert/strict'
import type { Context } from '@deepseek-ai/cordis'
import {
  createUserMessage,
  type GenerateOptions,
  LlmAdapter,
  type StreamChunk,
  ToolCallId,
} from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as FilesystemTools from '@deepseek-ai/dsh-tool-fs'
import { actualDeliveries, ScriptedPresentationAdapter } from '../presentation-s4/host.ts'
import { verifyReferenceRead } from './reference-read.ts'

class CredentialAdapter extends LlmAdapter {
  #sent = false
  override async resolveModel(provider: string, model: string) {
    return { provider, id: model, name: model }
  }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.purpose === 'session-title' || this.#sent) {
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    this.#sent = true
    const id = ToolCallId('right-tabs-credential-test'),
      name = 'marivo_datasource_test',
      args = JSON.stringify({ name: 'protected' })
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args }
    yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: args } }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  }
}

export async function createRightTabsDriver(
  ctx: Context,
  workspace: any,
  draftPaths: readonly string[],
) {
  const agents = new Map<string, any>()
  for (const mode of ['native', 'ptc', 'cold', 'credentials'] as const) {
    const id = SessionId(`right-tabs-${mode}`),
      provider = `right-tabs-${mode}`
    ctx.llm.registerAdapter(
      [provider],
      mode === 'credentials'
        ? new CredentialAdapter()
        : new ScriptedPresentationAdapter(
            mode === 'cold' ? 'native' : mode,
            Array.from({ length: 12 }, (_, i) => draftPaths[i % draftPaths.length]!),
            () => actualDeliveries(agents.get(mode).session.snapshotEvents(), id).at(-1)?.receipt,
          ),
    )
    const agent = await ctx.agentLoop.create(
      id,
      { provider, model: 'deterministic-seam' },
      { cwd: workspace.path },
    )
    agents.set(mode, agent)
    await agent.ctx.plugin(FilesystemTools)
    await workspace.attachSession(id)
  }
  return async (payload: any) => {
    if (payload.action === 'reference-read')
      return { ok: true, value: await verifyReferenceRead(ctx, workspace, payload.reference) }
    const agent = agents.get(payload?.mode)
    assert.ok(agent, 'Unknown isolated session')
    if (payload.action === 'detach') {
      await workspace.detachSession(agent.session.id)
      return { ok: true }
    }
    if (payload.action === 'attach') {
      await workspace.attachSession(agent.session.id)
      return { ok: true }
    }
    if (payload.action === 'credential-start') {
      agent.followup(
        createUserMessage({
          content: [{ type: 'text', text: 'Test protected datasource.' }],
          source: { kind: 'user' },
        }),
      )
      return { ok: true }
    }
    if (payload.action === 'credential-idle') {
      await agent.whenIdle()
      return {
        ok: true,
        value: agent.session
          .snapshotEvents()
          .filter((event: any) => event.type === 'tool/result')
          .map((event: any) => ({ isError: event.data.message.content[0]?.isError })),
      }
    }
    if (payload.action === 'history') {
      assert.equal(payload.mode, 'credentials')
      for (let i = 0; i < 55; i++) {
        agent.followup(
          createUserMessage({
            content: [{ type: 'text', text: `Isolated pagination fixture ${i}` }],
            source: { kind: 'user' },
          }),
        )
        await agent.whenIdle()
      }
      return { ok: true }
    }
    if (payload.action === 'run') {
      agent.followup(
        createUserMessage({
          content: [{ type: 'text', text: 'Build the isolated report.' }],
          source: { kind: 'user' },
        }),
      )
      await agent.whenIdle()
      const deliveries = actualDeliveries(agent.session.snapshotEvents(), agent.session.id)
      assert.ok(deliveries.length, 'Production tool must deliver a report')
      return { ok: true, value: deliveries.at(-1) }
    }
    if (payload.action === 'duplicate') {
      const event = agent.session
        .snapshotEvents()
        .findLast(
          (event: any) =>
            event.type === 'tool/ptc-dispatch' && event.data.name === 'marivo_present',
        )
      assert.ok(event)
      agent.session.append('tool/ptc-dispatch', event.data)
      return { ok: true }
    }
    if (payload.action === 'status')
      return {
        ok: true,
        value: {
          sessionId: agent.session.id,
          deliveries: actualDeliveries(agent.session.snapshotEvents(), agent.session.id),
        },
      }
    throw new Error('Unknown isolated action')
  }
}
