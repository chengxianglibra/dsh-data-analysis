import assert from 'node:assert/strict'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, {
  CallId,
  createUserMessage,
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture, defineTool } from '@deepseek-ai/dsh-tools'
import { installMarivoDisclosure } from '../src/disclosure/index.ts'
import { bindMarivoEnvironment } from '../src/environment/index.ts'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workspaceRoot = path.resolve(packageRoot, '../..')

function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function toolCallResponse(): StreamChunk[] {
  const args = JSON.stringify({ name: 'marivo-analysis' })
  const id = CallId('slice3-real-skill')
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name: 'skill', argumentsDelta: args },
    {
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id, name: 'skill', arguments: args },
    },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

class ValidationAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  #script = [toolCallResponse(), textResponse('validation complete')]

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const chunks = this.#script.shift()
    if (chunks === undefined) throw new Error('validation adapter script exhausted')
    for (const chunk of chunks) yield chunk
  }
}

const environment = await bindMarivoEnvironment({ projectRoot: workspaceRoot })
const adapter = new ValidationAdapter()
const ctx = new Context()
await ctx.plugin(LlmRuntime)
await ctx.plugin(SessionStore)
await ctx.plugin(SystemPrompt)
await ctx.plugin(ToolRuntime)
await ctx.plugin(AgentRegistry)
await ctx.plugin(AgentLoop, { agents: [] })
ctx.llm.registerAdapter(['validation'], adapter)
ctx.tools.register(defineContentToolFixture({
  name: 'ordinary',
  description: 'ordinary validation tool',
  parameters: {},
  async execute() { return [{ type: 'text', text: 'ordinary' }] },
}))
ctx.tools.register(defineTool({
  name: 'skill',
  description: 'Load one available skill.',
  parameters: { name: { type: 'string', required: true } },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string', required: true },
        provider: { type: 'string', required: true },
        content: { type: 'string', required: true },
      },
    },
    render: (_args, value) => [{
      type: 'text',
      text: `<skill_content name="${value.name}">${value.content}</skill_content>`,
    }],
  },
  async execute({ name }) {
    return { name, provider: 'slice3-real', content: 'analysis instructions' }
  },
}))

const agent: Agent = ctx.agentLoop.create(SessionId('slice3-real'), {
  provider: 'validation',
  model: 'validation',
})
const controller = installMarivoDisclosure(ctx, agent, environment)
agent.followup(createUserMessage({
  content: [{ type: 'text', text: 'Run a known Marivo analysis task.' }],
  source: { kind: 'user' },
}))
await agent.whenIdle()

assert.equal(adapter.requests.length, 2)
assert.deepEqual(adapter.requests[0]?.tools?.map(tool => tool.name).sort(), ['marivo_help', 'ordinary', 'skill'])
assert.deepEqual(adapter.requests[1]?.tools?.map(tool => tool.name).sort(), ['marivo_help', 'ordinary', 'skill'])
assert.doesNotMatch(JSON.stringify(adapter.requests[0]?.messages), /marivo_help_context/)
assert.match(JSON.stringify(adapter.requests[1]?.messages), /marivo_help_context/)
assert.match(JSON.stringify(adapter.requests[1]?.messages), /Target: analysis/)
const telemetry = controller.telemetry()
assert.deepEqual(controller.activeSkills, ['marivo-analysis'])
assert.equal(telemetry.rootHelp[0]?.target, 'analysis')
assert.ok((telemetry.rootHelp[0]?.helpTextBytes ?? 0) > 0)

const helpResult = agent.session.events.find(event =>
  event.type === 'tool/result'
  && event.data.message.content.some(block => block.content.some(content =>
    content.type === 'text' && content.text.includes('marivo-analysis'))))
assert.ok(helpResult)

process.stdout.write(`${JSON.stringify({
  status: 'ok',
  binding: environment.binding,
  requestTools: adapter.requests.map(request => request.tools?.map(tool => tool.name) ?? []),
  helpInFirstRequest: JSON.stringify(adapter.requests[0]?.messages).includes('marivo_help_context'),
  helpInSecondRequest: JSON.stringify(adapter.requests[1]?.messages).includes('marivo_help_context'),
  persistedSkillResult: true,
  telemetry,
}, null, 2)}\n`)
