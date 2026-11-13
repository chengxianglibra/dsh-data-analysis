import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import LlmRuntime, {
  createUserMessage,
  type GenerateOptions,
  LlmAdapter,
  type LlmResolvedModelInfo,
  type StreamChunk,
  ToolCallId,
} from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SkillRegistry, { renderSkillContent } from '@deepseek-ai/dsh-skill'
import { apply as installSkillFilesystem } from '@deepseek-ai/dsh-skill-filesystem'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { apply as installSkillTool } from '@deepseek-ai/dsh-tool-skill'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import {
  installMarivoDisclosure,
  loadTargetInventory,
  MARIVO_HELP_TOOL_NAME,
  MarivoHelpBridge,
  type MarivoHelpValue,
  registerMarivoHelpTool,
} from '../src/disclosure/index.ts'
import { bindMarivoEnvironment } from '../src/environment/index.ts'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workspaceRoot = path.resolve(packageRoot, '../..')
const pythonExecutable =
  process.env.DSH_DATA_ANALYSIS_PYTHON ??
  path.join(
    resolveDshHome(),
    'dsh-data-analysis',
    'runtimes',
    'marivo',
    process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python',
  )

const environment = await bindMarivoEnvironment({ projectRoot: workspaceRoot, pythonExecutable })
const helpBridge = new MarivoHelpBridge(environment)
const serviceSkillFile = path.join(
  path.dirname(environment.binding.packagePath),
  'skills',
  'marivo-service',
  'SKILL.md',
)
let serviceAvailable = false
try {
  serviceAvailable = (await stat(serviceSkillFile)).isFile()
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
}
const firstInventory = await loadTargetInventory(helpBridge)
const secondInventory = await loadTargetInventory(helpBridge)
assert.notEqual(secondInventory, '')
assert.equal(secondInventory, firstInventory)

const directBodies = new Map<string, string>()
for (const target of ['analysis.session.observe', 'analysis.analysis_frame.compare']) {
  const body = await helpBridge.runTarget(target, {
    timeoutMs: 30_000,
    stdoutMaxBytes: 262_144,
    stderrMaxBytes: 65_536,
  })
  directBodies.set(target, body.toString('utf8'))
}

const focusedContext = new Context()
await focusedContext.plugin(SystemPrompt)
await focusedContext.plugin(ToolRuntime)
registerMarivoHelpTool(focusedContext, helpBridge)

let focusedSequence = 0
async function executeFocused(targets: string[]) {
  focusedSequence++
  return focusedContext.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`help-disclosure-focused-${String(focusedSequence)}`),
    name: MARIVO_HELP_TOOL_NAME,
    arguments: { targets },
  })
}

const success = await executeFocused([
  'analysis.session.observe',
  'analysis.analysis_frame.compare',
  'analysis.session.observe',
])
assert.equal(success.isError, false)
if (success.isError) throw new Error('unreachable focused Help result')
const focusedValue = success.value as unknown as MarivoHelpValue
assert.deepEqual(
  focusedValue.targets.map((item) => item.target),
  ['analysis.session.observe', 'analysis.analysis_frame.compare'],
)
for (const result of focusedValue.targets)
  assert.equal(result.body, directBodies.get(result.target))

if (serviceAvailable) {
  const service = await executeFocused([
    'analysis.results.service.scripts',
    'analysis.results.service.http',
  ])
  assert.equal(service.isError, false)
  if (service.isError) throw new Error('unreachable service Help result')
  const value = service.value as unknown as MarivoHelpValue
  assert.match(value.targets[0]!.body, /main\(session: mv.Session\)/)
  assert.match(value.targets[1]!.body, /refresh=true/)
}

const empty = await executeFocused([])
assert.equal(empty.isError, true)
const emptyText = empty.content[0]?.type === 'text' ? empty.content[0].text : ''
assert.match(emptyText, /at least one target/i)
const invalid = await executeFocused([
  'analysis.session.observe',
  'definitely.not.a.target',
  'analysis-frame',
  'report',
  'analysis.analysis_frame.compare',
])
assert.equal(invalid.isError, false)
if (invalid.isError) throw new Error('mixed targets must return per-target outcomes')
const mixed = invalid.value as unknown as MarivoHelpValue
assert.deepEqual(
  mixed.targets.map((item) => item.target),
  ['analysis.session.observe', 'analysis.analysis_frame.compare'],
)
assert.equal(mixed.errors?.[0]?.target, 'definitely.not.a.target')
assert.equal(mixed.errors?.[0]?.code, 'target-failed')
const invalidText = invalid.content[0]?.type === 'text' ? invalid.content[0].text : ''
assert.match(invalidText, /definitely\.not\.a\.target/)
assert.deepEqual(
  mixed.errors?.map(({ target }) => target),
  ['definitely.not.a.target', 'analysis-frame', 'report'],
)
assert.match(mixed.errors?.[1]?.recovery.message ?? '', /analysis\.analysis_frame/)
assert.match(mixed.errors?.[2]?.recovery.message ?? '', /dsh-data-analysis-presentation/)
assert.ok(mixed.errors?.every(({ recovery }) => invalidText.includes(recovery.message)))
assert.ok(invalidText.includes(directBodies.get('analysis.session.observe')!))
assert.ok(invalidText.includes(directBodies.get('analysis.analysis_frame.compare')!))

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
  const id = ToolCallId('help-disclosure-skill')
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
  #script = [
    skillCallResponse(),
    textResponse('validation complete'),
    textResponse('explicit analysis complete'),
    textResponse('explicit semantic complete'),
    textResponse('explicit service complete'),
  ]

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
await activationContext.plugin(SkillRegistry)
installSkillFilesystem(activationContext, {
  providerName: 'help-disclosure-real',
  includeDefaultRoots: false,
  customSkillDirs: [path.join(path.dirname(environment.binding.packagePath), 'skills')],
  watch: false,
})
installSkillTool(activationContext)
await activationContext.plugin(AgentRegistry)
await activationContext.plugin(SessionProjectionRegistry)
await activationContext.plugin(LocalFileSystem, { cwd: workspaceRoot })
await activationContext.plugin(WorkingDirectory, { defaultDirectory: workspaceRoot })
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

const agent: Agent = await activationContext.agentLoop.create(SessionId('help-disclosure-real'), {
  provider: 'validation',
  model: 'validation',
})
const controller = installMarivoDisclosure(activationContext, agent, helpBridge)
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

const explicitActivations = []
const explicitSkills: Array<'marivo-analysis' | 'marivo-semantic' | 'marivo-service'> = [
  'marivo-analysis',
  'marivo-semantic',
]
if (serviceAvailable) explicitSkills.push('marivo-service')
for (const skill of explicitSkills) {
  const explicitAgent = await activationContext.agentLoop.create(SessionId(`help-only-${skill}`), {
    provider: 'validation',
    model: 'validation',
  })
  const disclosure = installMarivoDisclosure(activationContext, explicitAgent, helpBridge)
  try {
    const before: number = adapter.requests.length
    const selected = await activationContext.skills.get(skill, {
      cwd: explicitAgent.session.header.cwd,
      scope: explicitAgent,
    })
    assert.ok(selected)
    explicitAgent.followup(
      createUserMessage({
        content: [{ type: 'text', text: renderSkillContent(selected) }],
        source: { kind: 'skill-invocation', name: skill, form: 'instructions' },
      }),
    )
    await explicitAgent.whenIdle()
    assert.equal(adapter.requests.length, before + 1)
    const request: GenerateOptions = adapter.requests[before]!
    const tools = request.tools?.map((tool) => tool.name).sort()
    assert.deepEqual(tools, ['marivo_help', 'ordinary', 'skill'])
    const messages = JSON.stringify(request.messages)
    assert.match(messages, /marivo_help_context/)
    assert.doesNotMatch(
      messages,
      /marivo_execution_guidance|marivo_python|Harness credential forms/,
    )
    assert.deepEqual(disclosure.activeSkills, [skill])
    explicitActivations.push({ skill, requestCount: 1, tools, executionGuidanceVisible: false })
  } finally {
    disclosure.dispose()
  }
}

// Exercise the actual DSH project-root precedence with isolated symlinks. Never
// mutate a user's Workspace skill or override the Host's selection rules.
const skillConflictRoot = await mkdtemp(path.join(tmpdir(), 'dsh-skill-identity-real-'))
try {
  const runtimeSkill = path.join(
    path.dirname(environment.binding.packagePath),
    'skills',
    'marivo-analysis',
  )
  const original = await readFile(path.join(runtimeSkill, 'SKILL.md'), 'utf8')
  const stale = path.join(skillConflictRoot, 'stale-skill')
  await mkdir(stale)
  await writeFile(path.join(stale, 'SKILL.md'), `${original}\nConflicting instructions.\n`)
  installSkillFilesystem(activationContext, {
    providerName: 'help-disclosure-project-real',
    includeDefaultRoots: true,
    dshHome: skillConflictRoot,
    agentsHome: skillConflictRoot,
    watch: false,
  })
  for (const mode of ['conflicting', 'matching'] as const) {
    const project = path.join(skillConflictRoot, mode)
    await mkdir(path.join(project, '.git'), { recursive: true })
    await mkdir(path.join(project, '.agents', 'skills'), { recursive: true })
    await symlink(
      mode === 'matching' ? runtimeSkill : stale,
      path.join(project, '.agents', 'skills', 'marivo-analysis'),
      'dir',
    )
    const testAgent = await activationContext.agentLoop.create(
      SessionId(`help-skill-symlink-${mode}`),
      { provider: 'validation', model: 'validation' },
      { cwd: project },
    )
    const controller = installMarivoDisclosure(activationContext, testAgent, helpBridge)
    try {
      const selected = await activationContext.skills.get('marivo-analysis', {
        cwd: project,
        scope: testAgent,
      })
      assert.ok(selected)
      assert.equal(selected.provider, 'help-disclosure-project-real')
      const message = createUserMessage({
        content: [{ type: 'text', text: renderSkillContent(selected) }],
        source: { kind: 'skill-invocation', name: 'marivo-analysis', form: 'instructions' },
      })
      const pending = controller.prepareStep([message], new AbortController().signal)
      if (mode === 'conflicting') await assert.rejects(pending, /different instructions/)
      else assert.equal((await pending).length, 1)
    } finally {
      await controller.close()
    }
  }
} finally {
  await rm(skillConflictRoot, { recursive: true, force: true })
}

process.stdout.write(
  `${JSON.stringify(
    {
      status: 'ok',
      serviceAvailable,
      binding: environment.binding,
      inventoryStdoutBytes: Buffer.byteLength(firstInventory),
      focusedStdoutBytes: Object.fromEntries(
        [...directBodies].map(([target, body]) => [target, Buffer.byteLength(body)]),
      ),
      focusedResults: {
        empty: empty.isError ? 'error' : 'success',
        multipleDeduplicated: focusedValue.targets.length,
        invalid: 'per-target-error-with-successful-help',
      },
      activation: {
        requestTools: adapter.requests
          .slice(0, 2)
          .map((request) => request.tools?.map((tool) => tool.name) ?? []),
        rootHelp: telemetry.rootHelp.map((item) => item.target),
        explicitActivations,
      },
      projectSkillSymlink: { conflicting: 'rejected', matching: 'accepted' },
    },
    null,
    2,
  )}\n`,
)
