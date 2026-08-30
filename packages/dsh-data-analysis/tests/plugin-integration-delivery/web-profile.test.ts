import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import CredentialProvider, {
  type CredentialKey,
  type CredentialRecord,
  type CredentialRef,
} from '@deepseek-ai/dsh-credentials'
import LlmRuntime, {
  CallId,
  createUserMessage,
  type GenerateOptions,
  LlmAdapter,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SkillRuntime from '@deepseek-ai/dsh-skill'
import {
  apply as applySkillFilesystem,
  inject as skillFilesystemInject,
} from '@deepseek-ai/dsh-skill-filesystem'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { apply, inject } from '../../src/plugin.ts'
import { TestShellEnv } from '../test-shell-env.ts'

class TestCredentials extends CredentialProvider {
  resolve(_ref: CredentialRef) {
    return Promise.resolve(undefined)
  }
  describe(_ref: CredentialRef) {
    return Promise.resolve({ configured: false, writable: true })
  }
  set(_ref: CredentialRef, _value: string) {
    return Promise.resolve()
  }
  unset(_ref: CredentialRef) {
    return Promise.resolve()
  }
  readRecord(_key: CredentialKey) {
    return Promise.resolve(undefined)
  }
  describeRecord(_key: CredentialKey) {
    return Promise.resolve({ configured: false, writable: true })
  }
  listRecords() {
    return Promise.resolve([])
  }
  modifyRecord(
    _key: CredentialKey,
    _mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ) {
    return Promise.resolve(undefined)
  }
  deleteRecord(_key: CredentialKey) {
    return Promise.resolve()
  }
}

function runtimePython(packagePath: string, recordPath: string): string {
  return `#!/usr/bin/env node
import { appendFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const args = process.argv.slice(2)
const executable = path.resolve(process.argv[1])
if (args[0] === '-m' && args[1] === 'marivo' && args[2] === 'doctor') {
  const projectRoot = path.resolve(args[args.indexOf('--project-root') + 1])
  appendFileSync(${JSON.stringify(recordPath)}, projectRoot + '\\n')
  process.stdout.write(JSON.stringify({
    status: 'ok', project_root: projectRoot, python_executable: executable,
    marivo: { version: '0.5.0', package_path: ${JSON.stringify(packagePath)} },
    sections: [
      { id: 'installation', status: 'ok', checks: [
        { id: 'installation.python', status: 'ok', summary: 'shared Python' },
        { id: 'installation.marivo', status: 'ok', summary: 'shared Marivo' },
      ] },
      { id: 'project', status: 'ok', checks: [
        { id: 'project.marivo_toml', status: 'ok', summary: 'manifest' },
      ] },
    ],
  }))
  process.exit(0)
}
if (args[0] === '-c' && args.length === 2) {
  process.stdout.write(JSON.stringify({
    python_executable: executable,
    marivo_version: '0.5.0',
    package_path: ${JSON.stringify(packagePath)},
  }))
  process.exit(0)
}
if (args[0] === '-c' && args.length === 5) {
  process.stdout.write(JSON.stringify({
    python_executable: path.resolve(args[2]),
    marivo_version: args[3],
    package_path: path.resolve(args[4]),
  }))
  process.exit(0)
}
if (args[0] === '-c' && args.length === 6) {
  process.stdout.write(args[5] === 'targets' ? 'analysis\\n' : 'shared-help:' + args[5] + '\\n')
  process.exit(0)
}
process.exit(2)
`
}

function toolCall(id: string): StreamChunk[] {
  const callId = CallId(id)
  const argumentsJson = JSON.stringify({ targets: ['analysis'] })
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    {
      type: 'tool-call-delta',
      index: 0,
      id: callId,
      name: 'marivo_help',
      argumentsDelta: argumentsJson,
    },
    {
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id: callId, name: 'marivo_help', arguments: argumentsJson },
    },
    { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

class SequentialAdapter extends LlmAdapter {
  readonly #script = [
    toolCall('a-help'),
    textResponse('a-done'),
    toolCall('b-help'),
    textResponse('b-done'),
  ]
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }
  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    const response = this.#script.shift()
    if (response === undefined) throw new Error('adapter exhausted')
    for (const chunk of response) yield chunk
  }
}

function send(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

async function absent(target: string): Promise<void> {
  await assert.rejects(() => stat(target), { code: 'ENOENT' })
}

test('Web-profile plugin shares one Runtime while initializing and binding each session cwd independently', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-web-profile-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const firstRoot = path.join(root, 'workspace-a')
  const secondRoot = path.join(root, 'workspace-b')
  const runtimeRoot = path.join(root, 'dsh-home-runtime')
  const packagePath = path.join(root, 'site-packages', 'marivo', '__init__.py')
  const python = path.join(root, 'shared-python')
  const doctorRecord = path.join(root, 'doctor-roots.txt')
  await mkdir(firstRoot)
  await mkdir(secondRoot)
  await mkdir(path.dirname(packagePath), { recursive: true })
  await writeFile(packagePath, '__version__ = "0.5.0"\n')
  for (const skill of ['marivo-analysis', 'marivo-semantic']) {
    const directory = path.join(path.dirname(packagePath), 'skills', skill)
    await mkdir(directory, { recursive: true })
    await writeFile(
      path.join(directory, 'SKILL.md'),
      `---\nname: ${skill}\ndescription: shared ${skill}\n---\nshared body\n`,
    )
  }
  const projectSkill = path.join(firstRoot, '.dsh', 'skills', 'marivo-analysis')
  await mkdir(projectSkill, { recursive: true })
  await writeFile(
    path.join(projectSkill, 'SKILL.md'),
    '---\nname: marivo-analysis\ndescription: project override\n---\nproject body\n',
  )
  await writeFile(python, runtimePython(packagePath, doctorRecord))
  await chmod(python, 0o755)

  const ctx = new Context()
  await ctx.plugin(TestCredentials)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(TestShellEnv)
  await ctx.plugin(SkillRuntime)
  await ctx.plugin(
    {
      name: 'test-skill-filesystem',
      inject: skillFilesystemInject,
      apply: applySkillFilesystem,
    },
    { includeDefaultRoots: true, watch: false },
  )
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new SequentialAdapter()
  ctx.llm.registerAdapter(['mock'], adapter)

  const first = ctx.agentLoop.create(
    SessionId('web-a'),
    { provider: 'mock', model: 'mock' },
    { cwd: firstRoot },
  )
  const plugin = await ctx.plugin(
    { name: 'dsh-data-analysis-test', inject, apply },
    {
      runtimeRoot,
      pythonExecutable: python,
    },
  )
  const second = ctx.agentLoop.create(
    SessionId('web-b'),
    { provider: 'mock', model: 'mock' },
    { cwd: secondRoot },
  )

  const catalog = await ctx.skills.snapshot({ cwd: firstRoot, scope: first })
  assert.equal(
    catalog.skills.find((skill) => skill.name === 'marivo-analysis')?.description,
    'project override',
  )
  assert.equal(
    catalog.skills.find((skill) => skill.name === 'marivo-semantic')?.provider,
    'dsh-data-analysis-marivo',
  )

  send(first, 'analyze workspace a')
  await first.whenIdle()
  send(second, 'analyze workspace b')
  await second.whenIdle()

  const roots = (await readFile(doctorRecord, 'utf8')).trim().split('\n').sort()
  assert.deepEqual(roots, [await realpath(firstRoot), await realpath(secondRoot)].sort())
  for (const workspace of [firstRoot, secondRoot]) {
    await stat(path.join(workspace, 'marivo.toml'))
    await stat(path.join(workspace, 'models'))
    await stat(path.join(workspace, '.marivo'))
    await absent(path.join(workspace, '.venv'))
    await absent(path.join(workspace, '.agents', 'skills', 'marivo-analysis'))
    await absent(path.join(workspace, '.codex', 'skills', 'marivo-analysis'))
  }
  await stat(path.join(runtimeRoot, 'installation.json'))
  await stat(path.join(runtimeRoot, 'skills', 'marivo-analysis', 'SKILL.md'))
  await plugin.dispose()
})
