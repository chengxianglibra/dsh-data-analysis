/** Real model journeys against the packed plugin in isolated Workspaces and Harness profiles. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import BashLocal from '@deepseek-ai/dsh-bash-local'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import LocalCredentialProvider, {
  CREDENTIALS_FILENAME,
  parseCredentialsDocument,
  renderFlatLayoutMigration,
} from '@deepseek-ai/dsh-credentials-local'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import * as DeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import SessionStore, { type SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as ShellEnv from '@deepseek-ai/dsh-shell-env'
import SkillRuntime from '@deepseek-ai/dsh-skill'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as FilesystemTools from '@deepseek-ai/dsh-tool-fs'
import * as SkillTool from '@deepseek-ai/dsh-tool-skill'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import { bindMarivoEnvironment } from '../src/environment/index.ts'
import { parsePresentationDocument } from '../src/presentation/contracts/index.ts'
import {
  installConnectionFixture,
  installStorage,
} from '../tests/semantic-reference-input/fixtures.ts'
import { inspectStoredSession } from './harness-session.ts'
import {
  type Journey,
  journeys,
  seedProgram,
  workspaceFiles,
} from './presentation-agent-real/fixtures.ts'
import {
  assessLifecycle,
  type RuntimeObservation,
  verifyReport,
} from './presentation-agent-real/verify.ts'
import { actualDeliveries } from './presentation-s4/host.ts'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const repositoryRoot = path.resolve(packageRoot, '../..')
const pythonExecutable = process.env.DSH_DATA_ANALYSIS_PYTHON
assert.ok(pythonExecutable, 'Set DSH_DATA_ANALYSIS_PYTHON to a verified isolated Marivo Runtime')
const model = process.env.DSH_DATA_ANALYSIS_VALIDATION_MODEL ?? 'deepseek-v4-pro'
const effort = process.env.DSH_DATA_ANALYSIS_VALIDATION_EFFORT ?? 'high'
assert.ok(['off', 'low', 'high', 'max'].includes(effort), 'Unsupported DeepSeek reasoning effort')
const reasoningEffort = effort as 'off' | 'low' | 'high' | 'max'
const turnDeadlineMs = Number(process.env.DSH_DATA_ANALYSIS_VALIDATION_TURN_TIMEOUT_MS ?? 1_200_000)
assert.ok(Number.isSafeInteger(turnDeadlineMs) && turnDeadlineMs > 0)
const outputRoot = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-presentation-s5-agent-')))
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
let modelSecret = ''
const redact = (text: string) => (modelSecret ? text.replaceAll(modelSecret, '[REDACTED]') : text)
const save = (name: string, value: unknown) =>
  writeFile(path.join(outputRoot, name), redact(JSON.stringify(value, null, 2)), { mode: 0o600 })
process.stdout.write(`S5 isolated real Agent validation: ${outputRoot}\n`)

/** Use Harness's parser without booting its writable/migrating provider on a user profile. */
async function discoverModelCredential(): Promise<{ value: string; source: string }> {
  const inherited = process.env.DEEPSEEK_API_KEY
  if (inherited) return { value: inherited, source: 'inherited-reference' }
  const filename = path.join(resolveDshHome(), CREDENTIALS_FILENAME)
  try {
    const raw = await readFile(filename, 'utf8')
    const value = parseCredentialsDocument(
      renderFlatLayoutMigration(raw) ?? raw,
      filename,
    ).refs.get('DEEPSEEK_API_KEY')
    if (value) return { value, source: 'read-only-harness-reference' }
  } catch {
    throw new Error('Cannot read the configured Harness model credential reference')
  }
  throw new Error('DEEPSEEK_API_KEY is not configured; real-model validation cannot run')
}

function command(executable: string, args: string[], cwd: string): string {
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  if (result.error || result.status !== 0)
    throw new Error(redact(`Validation subprocess failed: ${executable}\n${result.stderr}`))
  return result.stdout
}

async function installPackedPlugin() {
  // The caller builds once before validation. Packing must not clean or mutate lib.
  const packed = JSON.parse(
    command(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['pack', '--ignore-scripts', '--json', '--pack-destination', outputRoot],
      packageRoot,
    ),
  ) as { filename: string; files: { path: string }[] }[]
  assert.equal(packed.length, 1)
  const item = packed[0]!
  const tarball = path.join(outputRoot, item.filename)
  const installedRoot = path.join(outputRoot, 'installed')
  await mkdir(installedRoot)
  command('tar', ['-xzf', tarball, '-C', installedRoot], outputRoot)
  await symlink(
    path.join(repositoryRoot, 'node_modules'),
    path.join(outputRoot, 'node_modules'),
    'dir',
  )
  const root = path.join(installedRoot, 'package')
  const modulePath = path.join(root, 'lib/index.js')
  const module = (await import(pathToFileURL(modulePath).href)) as typeof import('../src/index.ts')
  const removed = item.files
    .map((file) => file.path)
    .filter((file) =>
      /(?:report-kit|dsh-data-analysis-report|lib\/evidence\/|lib\/client\/evidence\/|classic)/.test(
        file,
      ),
    )
  assert.deepEqual(removed, [])
  assert.ok(
    item.files.some((file) => file.path === 'skills/dsh-data-analysis-presentation/SKILL.md'),
  )
  const modules = Object.fromEntries(
    await Promise.all(
      item.files
        .filter((file) => file.path.endsWith('.js'))
        .map(async (file) => [file.path, sha256(await readFile(path.join(root, file.path)))]),
    ),
  )
  return {
    module,
    root,
    evidence: {
      tarball,
      tarballSha256: sha256(await readFile(tarball)),
      modules,
      files: item.files.map((file) => file.path),
      removedFiles: removed,
    },
  }
}

async function prepareWorkspace(journey: Journey, workspaceRoot: string) {
  for (const [relative, contents] of Object.entries(workspaceFiles(journey))) {
    const filename = path.join(workspaceRoot, relative)
    await mkdir(path.dirname(filename), { recursive: true })
    await writeFile(filename, contents)
  }
  const environment = await bindMarivoEnvironment({ projectRoot: workspaceRoot, pythonExecutable })
  const setup = await environment.runChecked({ program: seedProgram(journey) })
  assert.equal(setup.exitCode, 0, setup.stderr.toString('utf8'))
  await save(`${journey.id}/fixture.json`, {
    files: workspaceFiles(journey),
    seedProgram: seedProgram(journey),
    binding: environment.binding,
    readiness: setup.stdout.toString('utf8'),
  })
  return environment.binding
}

function summarizeCalls(events: readonly SessionEvent[]) {
  return events.flatMap((event) => {
    if (event.type !== 'tool/call') return []
    const result = events.find(
      (candidate) =>
        candidate.type === 'tool/result' &&
        candidate.data.message.content.some(
          (block) => block.type === 'tool-result' && block.toolCallId === event.data.callId,
        ),
    )
    const block =
      result?.type === 'tool/result'
        ? result.data.message.content.find((item) => item.type === 'tool-result')
        : undefined
    return [
      {
        sequence: event.seq,
        callId: String(event.data.callId),
        name: event.data.name,
        arguments: JSON.parse(event.data.arguments) as Record<string, unknown>,
        isError: block?.type === 'tool-result' ? Boolean(block.isError) : null,
      },
    ]
  })
}

function finalText(events: readonly SessionEvent[]) {
  const last = events.filter((event) => event.type === 'assistant/message').at(-1)
  return last?.type === 'assistant/message'
    ? last.data.message.content
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('\n')
    : ''
}

async function readObservations(workspaceRoot: string) {
  const text = await readFile(path.join(outputRoot, 'runtime-observations.jsonl'), 'utf8')
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RuntimeObservation)
    .filter((item) => item.cwd === workspaceRoot)
}

type PackedPlugin = Awaited<ReturnType<typeof installPackedPlugin>>

async function runJourney(journey: Journey, packed: PackedPlugin, credentialSource: string) {
  const journeyRoot = path.join(outputRoot, journey.id)
  const workspaceRoot = path.join(journeyRoot, 'workspace')
  const profileRoot = path.join(journeyRoot, 'isolated-profile')
  await mkdir(journeyRoot)
  const binding = await prepareWorkspace(journey, workspaceRoot)
  if (process.env.DSH_DATA_ANALYSIS_VALIDATION_PREFLIGHT === '1')
    return { journeyId: journey.id, status: 'preflight-passed', workspaceRoot, binding }
  const ctx = new Context()
  const started = Date.now()
  const turns: { prompt: string; started: number; finished: number; finalText: string }[] = []
  try {
    await mkdir(profileRoot, { recursive: true, mode: 0o700 })
    ctx.provide(
      'launchEnvironment',
      createLaunchEnvironmentSnapshot([
        {
          source: 'process',
          values: {
            DEEPSEEK_API_KEY: modelSecret,
            ...(process.env.DEEPSEEK_BASE_URL
              ? { DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL }
              : {}),
          },
        },
      ]),
    )
    installConnectionFixture(ctx)
    await installStorage(ctx, path.join(profileRoot, 'storage'))
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LocalCredentialProvider, { dshHome: profileRoot, watch: false })
    assert.equal(
      (await ctx.credentials.describe(credentialRef('DEEPSEEK_API_KEY'))).configured,
      true,
    )
    await ctx.plugin(DeepSeek, {
      thinking: reasoningEffort === 'off' ? 'disabled' : 'enabled',
      reasoningEffort,
      maxTokens: 16_384,
      streamIdleTimeoutMs: 180_000,
      models: [{ id: model, contextWindow: 256_000, maxTokens: 16_384 }],
    })
    await ctx.plugin(SessionStore)
    await ctx.plugin(JsonlSessionPersistence, {
      root: path.join(profileRoot, 'sessions'),
      compression: 'none',
    })
    await ctx.plugin(WorkspaceRegistry)
    await ctx.plugin(SkillRuntime)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ShellEnv, { dshHome: profileRoot })
    await ctx.plugin(SubprocessLocal)
    await ctx.plugin(BashLocal, { cwd: workspaceRoot, timeoutMs: 120_000, maxOutputBytes: 65_536 })
    await ctx.plugin(LocalFileSystem, { cwd: workspaceRoot })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 })
    await ctx.plugin(SkillTool)
    await ctx.plugin(FilesystemTools)
    await ctx.plugin(packed.module, {
      pythonExecutable,
      runtimeRoot: path.join(profileRoot, 'runtime-marker'),
      credentialInteraction: 'none',
    })
    ctx.systemPrompt.section({
      name: 'real-validation-workspace',
      order: 10,
      text: `You are working in the isolated Workspace ${workspaceRoot}. Complete the user's task autonomously using available skills and tools. Read and write task data only in this Workspace; packaged skill resources may be read at their declared resource bases. Never inspect user profiles or credentials. Read the Workspace README for business context. This isolated task authorizes analysis, necessary minimal semantic definitions and report creation.`,
    })
    const workspace = await ctx.workspaceRegistry.create(workspaceRoot, journey.title)
    const sessionId = SessionId(`presentation-${journey.id}-${Date.now().toString(36)}`)
    const agent = await ctx.agentLoop.create(
      sessionId,
      { provider: 'deepseek-official', model, maxTokens: 16_384 },
      { cwd: workspace.path },
    )
    await workspace.attachSession(sessionId)
    const pluginTools = ctx.tools
      .schemas(agent)
      .filter((tool) => tool.name.startsWith('marivo_'))
      .map((tool) => tool.name)
      .sort()
    assert.deepEqual(pluginTools, [
      'marivo_datasource_test',
      'marivo_help',
      'marivo_present',
      'marivo_python',
    ])
    const skills = await ctx.skills.list({ cwd: workspaceRoot, scope: agent })
    assert.deepEqual(skills.map((skill) => skill.name).sort(), [
      'dsh-data-analysis-presentation',
      'marivo-analysis',
      'marivo-semantic',
    ])
    const skill = await ctx.skills.get('dsh-data-analysis-presentation', {
      cwd: workspaceRoot,
      scope: agent,
    })
    assert.ok(
      skill?.resourceBase?.kind === 'directory' &&
        skill.resourceBase.path.startsWith(`${packed.root}${path.sep}`),
    )
    await save(`${journey.id}/registration.json`, {
      binding,
      pluginTools,
      skills,
      model,
      reasoningEffort,
    })
    for (const [index, prompt] of journey.prompts.entries()) {
      const turnStarted = Date.now()
      let timedOut = false
      const deadline = setTimeout(() => {
        timedOut = true
        agent.cancel({ kind: 'user' }, { keepInbox: true })
      }, turnDeadlineMs)
      const progress = setInterval(() => {
        const calls = agent.session.snapshotEvents().filter((event) => event.type === 'tool/call')
        process.stdout.write(
          `${journey.id} turn ${index + 1}: ${Math.round((Date.now() - turnStarted) / 1000)}s, ${calls.length} calls, last=${calls.at(-1)?.data.name ?? 'thinking'}\n`,
        )
      }, 25_000)
      try {
        agent.followup(
          createUserMessage({
            content: [{ type: 'text', text: prompt }],
            source: { kind: 'user' },
          }),
        )
        await agent.whenIdle()
      } finally {
        clearTimeout(deadline)
        clearInterval(progress)
        await (ctx.get('sessions') as unknown as SessionStore).flush(agent.session)
        const stored = await inspectStoredSession(ctx.sessionPersistence, sessionId)
        assert.deepEqual(stored.events, agent.session.snapshotEvents())
        const turn = {
          prompt,
          started: turnStarted,
          finished: Date.now(),
          finalText: finalText(stored.events),
        }
        turns.push(turn)
        await save(`${journey.id}/turn-${index + 1}-events.json`, stored)
        await save(`${journey.id}/turn-${index + 1}-trace.json`, {
          ...turn,
          calls: summarizeCalls(stored.events),
          timedOut,
        })
      }
      assert.equal(timedOut, false, `Real-model turn ${index + 1} exceeded deadline`)
      if (journey.id === 'semantic-gap-reuse' && index === 0)
        assert.equal(
          actualDeliveries(agent.session.snapshotEvents(), String(sessionId)).length,
          0,
          'First turn should retain analysis without a report',
        )
    }
    const stored = await inspectStoredSession(ctx.sessionPersistence, sessionId)
    assert.ok(
      !JSON.stringify(stored).includes(modelSecret),
      'Model credential leaked into real session evidence',
    )
    const calls = summarizeCalls(stored.events)
    const deliveries = actualDeliveries(stored.events, String(sessionId))
    for (const required of ['marivo-analysis', 'dsh-data-analysis-presentation'])
      assert.ok(
        calls.some((call) => call.name === 'skill' && call.arguments.name === required),
        `Agent never selected ${required}`,
      )
    assert.ok(calls.some((call) => call.name === 'marivo_help' && !call.isError))
    const presentCalls = calls.filter((call) => call.name === 'marivo_present')
    assert.equal(deliveries.length, 1, 'Journey must produce one actual delivery')
    assert.equal(presentCalls.filter((call) => !call.isError).length, 1)
    const receipt = deliveries[0]!.receipt
    assert.equal(receipt.workspaceId, String(workspace.id))
    for (const file of Object.values(receipt.files)) {
      const bytes = await readFile(file.path)
      assert.equal(sha256(bytes), file.sha256)
      assert.ok(!bytes.toString('utf8').includes(modelSecret))
      await writeFile(path.join(journeyRoot, file.asset), bytes, { mode: 0o600 })
    }
    const document = parsePresentationDocument(
      JSON.parse(await readFile(receipt.files.document.path, 'utf8')),
    )
    const numericalEvidence = verifyReport(document, journey.id)
    const observations = await readObservations(workspaceRoot)
    await save(`${journey.id}/runtime-observations.json`, observations)
    const produced = observations.filter(
      (item) =>
        item.operation === 'observe' ||
        item.operation === 'compare' ||
        item.operation === 'attribute',
    )
    assert.ok(produced.length > 0, 'No actual typed Artifact production observed')
    const contractEnvironment = await bindMarivoEnvironment({
      projectRoot: workspaceRoot,
      pythonExecutable,
    })
    const contracts = await contractEnvironment.runChecked({
      program: await readFile(
        new URL('./presentation-agent-real/read-artifact-contracts.py', import.meta.url),
        'utf8',
      ),
      args: [
        JSON.stringify([
          ...produced.map(({ sessionId, artifactRef, operation, timeMs }) => ({
            sessionId,
            artifactRef,
            operation,
            timeMs,
          })),
          ...document.sources.map((source) => source.ref),
        ]),
      ],
    })
    assert.equal(contracts.exitCode, 0, contracts.stderr.toString('utf8'))
    const artifactContracts = JSON.parse(contracts.stdout.toString('utf8')) as {
      sessionId: string
      artifactRef: string
      createdAt: string
      contract: unknown
    }[]
    await save(`${journey.id}/artifact-contracts.json`, artifactContracts)
    const lifecycle = assessLifecycle(observations)
    for (const source of document.sources)
      assert.ok(
        artifactContracts.some(
          (item) =>
            item.sessionId === source.ref.sessionId && item.artifactRef === source.ref.artifactRef,
        ),
        'Report source must resolve to its exact persisted Session/Artifact identity',
      )
    let reuseEvidence: unknown = null
    if (journey.id === 'semantic-gap-reuse') {
      assert.ok(
        calls.some((call) => call.name === 'skill' && call.arguments.name === 'marivo-semantic'),
      )
      const semanticSource = await readFile(
        path.join(workspaceRoot, 'models/semantic/operations/requests.py'),
        'utf8',
      )
      await save(`${journey.id}/semantic-source-after.json`, { source: semanticSource })
      const second = turns[1]!
      const initial = produced.filter((item) => item.timeMs < second.started)
      const later = observations.filter((item) => item.timeMs >= second.started)
      const recovered = later.filter((item) => item.operation === 'artifact')
      reuseEvidence = {
        classification: 'observation-only',
        initial,
        recovered,
        secondTurnObserveCount: later.filter((item) => item.operation === 'observe').length,
        recoveredFirstTurnArtifacts: recovered.filter((item) =>
          initial.some(
            (prior) => prior.sessionId === item.sessionId && prior.artifactRef === item.artifactRef,
          ),
        ),
        sources: document.sources.map((source) => ({
          ...source.ref,
          observedProducedInFirstTurn: initial.some(
            (item) =>
              item.sessionId === source.ref.sessionId &&
              item.artifactRef === source.ref.artifactRef,
          ),
          persistedCreatedInFirstTurn: artifactContracts.some(
            (item) =>
              item.sessionId === source.ref.sessionId &&
              item.artifactRef === source.ref.artifactRef &&
              Date.parse(item.createdAt) >= turns[0]!.started &&
              Date.parse(item.createdAt) < second.started,
          ),
        })),
        boundary:
          'Reuse and repeated observation are efficiency observations, not report acceptance gates. Retained identities support review of whether new results were represented as earlier Artifacts.',
      }
    }
    const usage = stored.events.reduce(
      (total, event) => {
        if (event.type === 'assistant/message' && event.data.usage) {
          total.inputTokens += event.data.usage.inputTokens
          total.outputTokens += event.data.usage.outputTokens
        }
        return total
      },
      { inputTokens: 0, outputTokens: 0 },
    )
    assert.ok(usage.outputTokens > 0)
    const draftPaths = presentCalls
      .filter((call) => !call.isError)
      .map((call) => path.resolve(workspaceRoot, String(call.arguments.draft_path)))
    assert.ok(draftPaths.every((filename) => filename.startsWith(`${workspaceRoot}${path.sep}`)))
    const draftHashes = await Promise.all(
      draftPaths.map(async (filename) => ({
        path: filename,
        sha256: sha256(await readFile(filename)),
      })),
    )
    const evidence = {
      status: 'passed-awaiting-semantic-review',
      journeyId: journey.id,
      outputRoot,
      workspaceRoot,
      profileRoot,
      binding,
      model: { id: model, reasoningEffort, credentialSource },
      sessionId,
      workspaceId: workspace.id,
      durableSessionId: String(stored.meta.id),
      turns,
      calls,
      receipt,
      draftPaths,
      draftHashes,
      draftSha256: draftHashes.length === 1 ? draftHashes[0]!.sha256 : undefined,
      numericalEvidence,
      artifactContracts,
      executionReviewRequired:
        'Use the retained real calls/results and per-observation public contracts to check data/metadata datasource declarations and repeated successful observations in the first turn; a second-turn observe count alone does not prove those obligations.',
      lifecycle,
      reuseEvidence,
      usage,
      latencyMs: Date.now() - started,
      reviewObligations: journey.reviewObligations,
      semanticReview:
        'Required: inspect actual report narrative and transcript against the obligations; no keyword match establishes correctness.',
      boundary:
        'Packed production plugin, native Harness skill/fs/Shell services and real DeepSeek adapter. A read-only Python profiler observes Session calls without replacing functions. No scripted model response, analysis, draft or receipt.',
      userProfileOrRuntimeModified: false,
    }
    await save(`${journey.id}/agent-evidence.json`, evidence)
    await writeFile(
      path.join(journeyRoot, 'semantic-review.md'),
      [
        `# ${journey.title}：待审核实际正文`,
        '',
        '## 验收义务',
        '',
        ...journey.reviewObligations.map((item) => `- ${item}`),
        '',
        '## Agent 最终答复',
        '',
        ...turns.flatMap((turn, index) => [`### 第 ${index + 1} 轮`, '', turn.finalText, '']),
        '## 报告正文',
        '',
        ...document.blocks.flatMap((block) => (block.kind === 'markdown' ? [block.text, ''] : [])),
      ].join('\n'),
      { mode: 0o600 },
    )
    return evidence
  } finally {
    await ctx.fiber.dispose()
  }
}

const previousPythonPath = process.env.PYTHONPATH
try {
  const preflight = process.env.DSH_DATA_ANALYSIS_VALIDATION_PREFLIGHT === '1'
  const credential = preflight
    ? { value: '', source: 'preflight-no-model' }
    : await discoverModelCredential()
  modelSecret = credential.value
  const observerRoot = path.join(outputRoot, 'observer')
  await mkdir(observerRoot)
  const observerPath = path.join(outputRoot, 'runtime-observations.jsonl')
  await writeFile(observerPath, '', { mode: 0o600 })
  const observer = await readFile(
    new URL('./presentation-agent-real/sitecustomize.py', import.meta.url),
    'utf8',
  )
  await writeFile(
    path.join(observerRoot, 'sitecustomize.py'),
    observer.replace('LOG_PATH = None', `LOG_PATH = ${JSON.stringify(observerPath)}`),
    { mode: 0o600 },
  )
  await save('observer.json', {
    path: path.join(observerRoot, 'sitecustomize.py'),
    sha256: sha256(await readFile(path.join(observerRoot, 'sitecustomize.py'))),
    authority:
      'Observe public Session factory returns and close/Artifact operations. Private recovery constructors are retained but impose no caller close obligation.',
    changesRuntimeFunctions: false,
  })
  process.env.PYTHONPATH = observerRoot
  const packed = await installPackedPlugin()
  await save('packed-plugin.json', packed.evidence)
  const selection = process.env.DSH_DATA_ANALYSIS_VALIDATION_JOURNEYS?.split(',')
  const selected = selection
    ? journeys.filter((journey) => selection.includes(journey.id))
    : journeys
  assert.ok(
    selected.length > 0 && (!selection || selected.length === selection.length),
    'Unknown or repeated journey selection',
  )
  const results: unknown[] = []
  let failed = false
  for (const journey of selected) {
    try {
      const result = await runJourney(journey, packed, credential.source)
      results.push(result)
      process.stdout.write(`${journey.id}: ${result.status}\n`)
    } catch (error) {
      failed = true
      const result = {
        status: 'failed',
        journeyId: journey.id,
        message: error instanceof Error ? error.message : String(error),
      }
      results.push(result)
      await save(`${journey.id}/failure.json`, result)
      process.stderr.write(redact(`${journey.id} failed: ${result.message}\n`))
    }
  }
  await save('agent-evidence.json', {
    status: failed ? 'failed' : preflight ? 'preflight-passed' : 'passed-awaiting-semantic-review',
    outputRoot,
    model,
    reasoningEffort,
    packed: packed.evidence,
    results,
  })
  process.stdout.write(`Real Agent evidence: ${path.join(outputRoot, 'agent-evidence.json')}\n`)
  if (failed) process.exitCode = 1
} catch (error) {
  await save('failure.json', {
    status: 'failed',
    message: error instanceof Error ? error.message : String(error),
    outputRoot,
  })
  process.stderr.write(
    redact(
      `Real Agent validation failed: ${error instanceof Error ? error.message : String(error)}\nEvidence: ${outputRoot}\n`,
    ),
  )
  process.exitCode = 1
} finally {
  if (previousPythonPath === undefined) delete process.env.PYTHONPATH
  else process.env.PYTHONPATH = previousPythonPath
}
