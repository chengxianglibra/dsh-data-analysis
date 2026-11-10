import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LlmRuntime, { ToolCallId } from '@deepseek-ai/dsh-llm'
import LocalSandbox from '@deepseek-ai/dsh-sandbox-local'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import { z } from 'zod'
import { AnalysisDrafts } from '../../src/presentation/drafts.ts'
import { createMarivoPresentTool, createMarivoUiReadTool } from '../../src/presentation/tool.ts'
import { TestShellEnv } from '../test-shell-env.ts'

const [root, savedRef, draftRef] = process.argv.slice(2)
assert(root)
process.env.DSH_HOME = root
const ctx = new Context()
try {
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(TestShellEnv)
  await ctx.plugin(LocalFileSystem, { cwd: root })
  await ctx.plugin(SubprocessLocal)
  await ctx.plugin(LocalSandbox, {})
  await ctx.plugin(SandboxPolicy, { mode: 'danger-full-access', workspaceRoot: root })
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(WorkingDirectory, { defaultDirectory: root })
  await ctx.plugin(ToolRuntime, { mode: 'native' })
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  const agent = await ctx.agentLoop.create(SessionId('session'), {
    provider: 'unused',
    model: 'unused',
  })
  const drafts = new AnalysisDrafts()
  const source = () => ({ id: 'workspace', path: root })
  const reader = createMarivoUiReadTool(source, drafts)
  const writer = createMarivoPresentTool(source, agent.session, undefined, drafts)
  agent.ctx.tools.register(reader)
  agent.ctx.tools.register(writer)
  const call = async (id: string, name: string, args: Record<string, unknown>) => {
    const callId = ToolCallId(id)
    agent.session.append('tool/call', {
      turn: 1,
      step: 0,
      callId,
      name,
      arguments: JSON.stringify(args),
    })
    return agent.ctx.tools.execute({
      agent,
      callId,
      signal: new AbortController().signal,
      name,
      arguments: args,
    })
  }
  if (!savedRef || !draftRef) {
    const saved = await call('cold-create-saved', writer.name, {
      stage: 'save',
      program: 'root = TextContent("Cold Host report");',
    })
    assert.equal(saved.isError, false, JSON.stringify(saved))
    if (saved.isError) throw new Error('save failed')
    const savedIdentity = z.object({ ref: z.string() }).parse(saved.value)
    const draft = await call('cold-create-draft', writer.name, {
      stage: 'preview',
      ref: savedIdentity.ref,
    })
    assert.equal(draft.isError, false, JSON.stringify(draft))
    if (draft.isError) throw new Error('preview failed')
    console.log(
      JSON.stringify({
        savedRef: savedIdentity.ref,
        draftRef: z.object({ ref: z.string() }).parse(draft.value).ref,
      }),
    )
  } else {
    const saved = await call('cold-saved', reader.name, { ref: savedRef })
    assert.equal(saved.isError, false, JSON.stringify(saved))
    if (saved.isError) throw new Error('saved read failed')
    const definition = z
      .object({ definition: z.object({ ref: z.string() }) })
      .parse(saved.value).definition
    assert.equal(definition.ref, savedRef)
    const expired = await call('cold-draft', reader.name, { ref: draftRef })
    assert.equal(expired.isError, true)
    assert.match(JSON.stringify(expired), /analysis-draft-unavailable/)
    console.log('COLD_HARNESS_NATIVE_SAVED_REF_OK_DRAFT_EXPIRED')
  }
} finally {
  await ctx.fiber.dispose()
}
