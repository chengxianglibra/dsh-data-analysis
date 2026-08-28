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
  type GenerateOptions,
  LlmAdapter,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture, defineTool } from '@deepseek-ai/dsh-tools'
import {
  installMarivoDisclosure,
  loadTargetInventory,
  MARIVO_HELP_TOOL_NAME,
  type MarivoHelpValue,
  registerMarivoHelpTool,
} from '../src/disclosure/index.ts'
import { bindMarivoEnvironment } from '../src/environment/index.ts'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workspaceRoot = path.resolve(packageRoot, '../..')

const environment = await bindMarivoEnvironment({ projectRoot: workspaceRoot })
const firstInventory = await loadTargetInventory(environment)
const secondInventory = await loadTargetInventory(environment)
assert.notEqual(secondInventory, '')
assert.equal(secondInventory, firstInventory)

const directBodies = new Map<string, string>()
for (const target of ['analysis.observe', 'analysis.compare']) {
  const result = await environment.runCheckedHelpTarget(target, {
    timeoutMs: 30_000,
    stdoutMaxBytes: 262_144,
    stderrMaxBytes: 65_536,
  })
  assert.equal(result.exitCode, 0, result.stderr.toString('utf8'))
  directBodies.set(target, result.stdout.toString('utf8'))
}

const focusedContext = new Context()
await focusedContext.plugin(SystemPrompt)
await focusedContext.plugin(ToolRuntime)
registerMarivoHelpTool(focusedContext, environment)

let focusedSequence = 0
async function executeFocused(targets: string[]) {
  focusedSequence++
  return focusedContext.tools.execute({
    signal: new AbortController().signal,
    callId: CallId(`help-disclosure-focused-${String(focusedSequence)}`),
    name: MARIVO_HELP_TOOL_NAME,
    arguments: { targets },
  })
}

const success = await executeFocused(['analysis.observe', 'analysis.compare', 'analysis.observe'])
assert.equal(success.isError, false)
if (success.isError) throw new Error('unreachable focused Help result')
const focusedValue = success.value as unknown as MarivoHelpValue
assert.deepEqual(
  focusedValue.targets.map((item) => item.target),
  ['analysis.observe', 'analysis.compare'],
)
for (const result of focusedValue.targets)
  assert.equal(result.body, directBodies.get(result.target))

const empty = await executeFocused([])
assert.equal(empty.isError, false)
const invalid = await executeFocused(['analysis.observe', 'definitely.not.a.target'])
assert.equal(invalid.isError, true)
const invalidText = invalid.content[0]?.type === 'text' ? invalid.content[0].text : ''
assert.match(invalidText, /definitely\.not\.a\.target/)
assert.ok(!invalidText.includes(directBodies.get('analysis.observe')!))

function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function skillCallResponse(): StreamChunk[] {
  const args = JSON.stringify({ name: 'marivo-analysis' })
  const id = CallId('help-disclosure-skill')
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
  #script = [skillCallResponse(), textResponse('validation complete')]

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const chunks = this.#script.shift()
    if (chunks === undefined) throw new Error('validation adapter script exhausted')
    for (const chunk of chunks) yield chunk
  }
}

const adapter = new ValidationAdapter()
const activationContext = new Context()
await activationContext.plugin(LlmRuntime)
await activationContext.plugin(SessionStore)
await activationContext.plugin(SystemPrompt)
await activationContext.plugin(ToolRuntime)
await activationContext.plugin(AgentRegistry)
await activationContext.plugin(AgentLoop, { agents: [] })
activationContext.llm.registerAdapter(['validation'], adapter)
activationContext.tools.register(
  defineContentToolFixture({
    name: 'ordinary',
    description: 'ordinary validation tool',
    parameters: {},
    async execute() {
      return [{ type: 'text', text: 'ordinary' }]
    },
  }),
)
activationContext.tools.register(
  defineTool({
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
      render: (_args, value) => [
        {
          type: 'text',
          text: `<skill_content name="${value.name}">${value.content}</skill_content>`,
        },
      ],
    },
    async execute({ name }) {
      return { name, provider: 'help-disclosure-real', content: 'analysis instructions' }
    },
  }),
)

const agent: Agent = activationContext.agentLoop.create(SessionId('help-disclosure-real'), {
  provider: 'validation',
  model: 'validation',
})
const controller = installMarivoDisclosure(activationContext, agent, environment)
agent.followup(
  createUserMessage({
    content: [{ type: 'text', text: 'Run a known Marivo analysis task.' }],
    source: { kind: 'user' },
  }),
)
await agent.whenIdle()

assert.equal(adapter.requests.length, 2)
assert.deepEqual(adapter.requests[0]?.tools?.map((tool) => tool.name).sort(), [
  'marivo_help',
  'ordinary',
  'skill',
])
assert.deepEqual(adapter.requests[1]?.tools?.map((tool) => tool.name).sort(), [
  'marivo_help',
  'ordinary',
  'skill',
])
assert.doesNotMatch(JSON.stringify(adapter.requests[0]?.messages), /marivo_help_context/)
assert.match(JSON.stringify(adapter.requests[1]?.messages), /marivo_help_context/)
assert.match(JSON.stringify(adapter.requests[1]?.messages), /Target: analysis/)
const telemetry = controller.telemetry()
assert.deepEqual(controller.activeSkills, ['marivo-analysis'])
assert.equal(telemetry.rootHelp[0]?.target, 'analysis')
assert.ok((telemetry.rootHelp[0]?.helpTextBytes ?? 0) > 0)
controller.dispose()

process.stdout.write(
  `${JSON.stringify(
    {
      status: 'ok',
      binding: environment.binding,
      inventoryStdoutBytes: Buffer.byteLength(firstInventory),
      focusedStdoutBytes: Object.fromEntries(
        [...directBodies].map(([target, body]) => [target, Buffer.byteLength(body)]),
      ),
      focusedResults: {
        empty: empty.isError ? 'error' : 'success',
        multipleDeduplicated: focusedValue.targets.length,
        invalid: invalid.isError ? 'isError' : 'unexpected-success',
      },
      activation: {
        requestTools: adapter.requests.map(
          (request) => request.tools?.map((tool) => tool.name) ?? [],
        ),
        rootHelp: telemetry.rootHelp.map((item) => item.target),
      },
    },
    null,
    2,
  )}\n`,
)
