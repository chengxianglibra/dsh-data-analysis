import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LlmRuntime, {
  createUserMessage,
  type GenerateOptions,
  LlmAdapter,
  type LlmResolvedModelInfo,
  type StreamChunk,
  ToolCallId,
} from '@deepseek-ai/dsh-llm'
import { bindScopeParent, createScope, scopeParentOf } from '@deepseek-ai/dsh-scope'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SkillRuntime from '@deepseek-ai/dsh-skill'
import { apply as installSkillFilesystem } from '@deepseek-ai/dsh-skill-filesystem'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { apply as installSkillTool } from '@deepseek-ai/dsh-tool-skill'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import { MARIVO_VERSION } from '../src/compatibility.ts'
import { apply, inject } from '../src/plugin.ts'
import { removeSkillBuildFixture } from '../tests/plugin-integration-delivery/skill-build-fixture.ts'
import {
  installConnectionFixture,
  installStorage,
} from '../tests/semantic-reference-input/fixtures.ts'
import { TestShellEnv } from '../tests/test-shell-env.ts'

// Full in-process plugin and Harness registry with real Marivo, using scripted
// model responses. This is not an installed Web Host or a real-model check.
const pythonExecutable = process.env.DSH_DATA_ANALYSIS_PYTHON
if (!pythonExecutable || !path.isAbsolute(pythonExecutable))
  throw new Error(`DSH_DATA_ANALYSIS_PYTHON must name an absolute Marivo ${MARIVO_VERSION} Python`)

const root = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-runtime-skill-real-')))
const runtimeRoot = path.join(root, 'runtime')
const project = path.join(root, 'workspace')
const conflict = path.join(project, '.agents', 'skills', 'marivo-analysis')
await mkdir(path.join(project, '.git'), { recursive: true })
await mkdir(conflict, { recursive: true })
await writeFile(
  path.join(conflict, 'SKILL.md'),
  '---\nname: marivo-analysis\ndescription: project fixture\n---\nproject fixture instructions\n',
)

function skillCall(id: string): StreamChunk[] {
  const callId = ToolCallId(id)
  const args = JSON.stringify({ name: 'marivo-analysis' })
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: callId, name: 'skill', argumentsDelta: args },
    {
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id: callId, name: 'skill', arguments: args },
    },
    { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

function reply(): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: 'validation complete' },
    { type: 'block-end', index: 0, block: { type: 'text', text: 'validation complete' } },
    { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

class ValidationAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  readonly #script = [
    skillCall('runtime-skill'),
    reply(),
    skillCall('higher-skill'),
    reply(),
    skillCall('rebound-skill'),
    reply(),
  ]

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const chunks = this.#script.shift()
    if (!chunks) throw new Error('validation script exhausted')
    for (const chunk of chunks) yield chunk
  }
}

const ctx = new Context()
let plugin: { dispose(): Promise<void> } | undefined
try {
  installConnectionFixture(ctx)
  await installStorage(ctx, path.join(root, 'profile-storage'))
  await ctx.plugin(LocalCredentialProvider, {
    path: path.join(root, 'credentials.yaml'),
    watch: false,
  })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root: path.join(root, 'sessions') })
  await ctx.plugin(WorkspaceRegistry)
  await ctx.plugin(SkillRuntime)
  // A standard preset owns its filesystem provider in a parent scope shared by
  // multiple agents; a global-only test cannot reproduce this precedence.
  const presetA = {}
  const presetB = {}
  let scopeA: ReturnType<typeof createScope> | undefined
  let scopeB: ReturnType<typeof createScope> | undefined
  await ctx.plugin({
    name: 'validation-presets',
    inject: ['skills'],
    apply(presetCtx) {
      scopeA = createScope(presetCtx, presetA)
      scopeB = createScope(presetCtx, presetB)
      for (const scope of [scopeA, scopeB])
        installSkillFilesystem(scope.ctx, {
          providerName: 'validation-project-filesystem',
          includeDefaultRoots: true,
          dshHome: root,
          agentsHome: root,
          watch: false,
        })
    },
  })
  assert.ok(scopeA)
  assert.ok(scopeB)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(TestShellEnv)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(LocalFileSystem, { cwd: project })
  await ctx.plugin(WorkingDirectory, { defaultDirectory: project })
  installSkillTool(ctx)
  await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 })
  const adapter = new ValidationAdapter()
  ctx.llm.registerAdapter(['validation'], adapter)
  plugin = await ctx.plugin(
    { name: 'runtime-skill-real-validation', inject, apply },
    {
      runtimeRoot,
      pythonExecutable,
    },
  )

  const bindings = new Map<string, ReturnType<typeof bindScopeParent>>()
  async function createAgent(id: string) {
    return ctx.agents.create({
      sessionId: SessionId(`runtime-skill-real-${id}`),
      agentOptions: { provider: 'validation', model: 'validation' },
      meta: { cwd: project },
      setup(_agentCtx, agent) {
        bindings.set(id, bindScopeParent(agent, presetA))
      },
    })
  }
  const first = await createAgent('runtime')
  const second = await createAgent('higher')
  assert.equal(scopeParentOf(first.agent), presetA)
  assert.equal(scopeParentOf(second.agent), presetA)
  const runtimeSelected = await ctx.skills.get('marivo-analysis', {
    cwd: project,
    scope: first.agent,
  })
  assert.equal(runtimeSelected?.provider, 'dsh-data-analysis-marivo')
  assert.equal(runtimeSelected.resourceBase?.kind, 'directory')
  if (runtimeSelected.resourceBase?.kind !== 'directory')
    throw new Error('missing Runtime skill root')
  assert.equal(
    runtimeSelected.resourceBase.path,
    path.join(runtimeRoot, 'skills', 'marivo-analysis'),
  )
  const actualRuntimeSkill = await readFile(
    path.join(runtimeSelected.resourceBase.path, 'SKILL.md'),
    'utf8',
  )
  assert.ok(actualRuntimeSkill.includes(runtimeSelected.content))

  async function runScenario(
    agent: typeof first.agent,
    id: string,
    expectedContent: string,
    offset: number,
  ) {
    agent.followup(
      createUserMessage({
        content: [{ type: 'text', text: 'Activate the analysis Skill.' }],
        source: { kind: 'user' },
      }),
    )
    await agent.whenIdle()
    assert.equal(adapter.requests.length, offset + 2)
    const nextRequest = JSON.stringify(adapter.requests[offset + 1]?.messages)
    assert.ok(
      nextRequest.includes(JSON.stringify(expectedContent).slice(1, -1)),
      `${id}: selected Skill content missing`,
    )
    assert.match(nextRequest, /marivo_help_context/)
    assert.ok(
      nextRequest.includes(`Marivo version: ${MARIVO_VERSION}\\n`),
      `${id}: expected Marivo ${MARIVO_VERSION} in live Help`,
    )
    assert.match(nextRequest, /Target: analysis/)
    const events = agent.session.snapshotEvents()
    assert.ok(events.some((event) => event.type === 'tool/call' && event.data.name === 'skill'))
    assert.ok(
      events.some(
        (event) =>
          event.type === 'assistant/message' &&
          JSON.stringify(event.data.message).includes('validation complete'),
      ),
    )
  }

  assert.equal(
    (await ctx.skills.get('marivo-analysis', { cwd: project, scope: second.agent }))?.provider,
    'dsh-data-analysis-marivo',
  )
  await runScenario(first.agent, 'runtime', runtimeSelected.content.slice(0, 120), 0)
  const invocation = { modelInvocable: true, userInvocable: true }
  const higherContent = 'higher-priority Marivo analysis instructions accepted by Harness'
  const removeHigher = scopeA.ctx.skills.registerProvider(() => ({
    name: 'validation-rank-10',
    list: async () => [
      {
        name: 'marivo-analysis',
        description: 'higher priority fixture',
        provider: 'validation-rank-10',
        source: 'custom',
        invocation,
        rank: 10,
        locator: null,
      },
    ],
    get: async () => ({
      name: 'marivo-analysis',
      description: 'higher priority fixture',
      provider: 'validation-rank-10',
      source: 'custom',
      invocation,
      content: higherContent,
    }),
  }))
  try {
    const selected = await ctx.skills.get('marivo-analysis', { cwd: project, scope: second.agent })
    assert.equal(selected?.provider, 'validation-rank-10')
    assert.equal(selected.content, higherContent)
    await runScenario(second.agent, 'higher', higherContent, 2)
    await first.dispose()
    assert.equal(
      (await ctx.skills.get('marivo-analysis', { cwd: project, scope: second.agent }))?.content,
      higherContent,
    )
  } finally {
    removeHigher()
  }
  assert.equal(
    (await ctx.skills.get('marivo-analysis', { cwd: project, scope: second.agent }))?.provider,
    'dsh-data-analysis-marivo',
  )
  const scopedOverride = await second.agent.ctx.plugin({
    name: 'validation-agent-override',
    inject: ['skills'],
    apply(overrideCtx) {
      return overrideCtx.skills.register({
        name: 'marivo-analysis',
        description: 'nearest scoped fixture',
        source: 'custom',
        content: 'nearest scoped instructions',
      })
    },
  })
  assert.equal(
    (await ctx.skills.get('marivo-analysis', { cwd: project, scope: second.agent }))?.content,
    'nearest scoped instructions',
  )
  await scopedOverride.dispose()
  const rebound = await createAgent('rebound')
  bindings.get('rebound')!.rebind(presetB)
  assert.equal(scopeParentOf(rebound.agent), presetB)
  await runScenario(rebound.agent, 'rebound', runtimeSelected.content.slice(0, 120), 4)
  assert.equal(
    (await ctx.skills.get('marivo-analysis', { cwd: project, scope: rebound.agent }))?.provider,
    'dsh-data-analysis-marivo',
  )
  await second.dispose()
  assert.equal(
    (await ctx.skills.get('marivo-analysis', { cwd: project, scope: presetA }))?.provider,
    'validation-project-filesystem',
  )
  assert.equal(
    (await ctx.skills.get('marivo-analysis', { cwd: project, scope: rebound.agent }))?.provider,
    'dsh-data-analysis-marivo',
  )
  await rebound.dispose()
  assert.equal(
    (await ctx.skills.get('marivo-analysis', { cwd: project, scope: presetB }))?.provider,
    'validation-project-filesystem',
  )
  console.log(
    `Full in-process plugin: shared preset, rank 10 override, Agent disposal and preset rebind activate real Marivo ${MARIVO_VERSION} Help.`,
  )
} finally {
  await plugin?.dispose()
  await ctx.fiber.dispose()
  await removeSkillBuildFixture(root)
}
