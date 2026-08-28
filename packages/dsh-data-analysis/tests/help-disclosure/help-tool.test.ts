import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import {
  createMarivoHelpTool,
  loadTargetInventory,
  MARIVO_HELP_TOOL_NAME,
  type MarivoHelpValue,
  normalizeHelpTargets,
  registerMarivoHelpTool,
  resolveMarivoHelpLimits,
} from '../../src/disclosure/index.ts'
import { FixedSubprocessPolicy, MarivoEnvironment } from '../../src/environment/index.ts'

const FAKE_PYTHON = String.raw`#!/usr/bin/env node
import { appendFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const args = process.argv.slice(2)
if (args[0] !== '-c') {
  process.stderr.write('expected -c')
  process.exit(2)
}
const target = args[5]
if (target === undefined) {
  process.stdout.write(JSON.stringify({
    python_executable: path.resolve(args[2]),
    marivo_version: args[3],
    package_path: path.resolve(args[4]),
  }))
  process.exit(0)
}
if (process.env.RECORD_PATH !== undefined) {
  appendFileSync(process.env.RECORD_PATH, target + '\n')
}
if (process.env.IDENTITY_MODE === 'mismatch') {
  process.stderr.write(JSON.stringify({ kind: 'identity-mismatch', target }))
  process.exit(78)
}
if (target === 'invalid.target') {
  process.stderr.write('MarivoHelpTargetError: not registered: ' + target)
  process.exit(1)
}
if (target === 'empty.target') process.exit(0)
if (target === 'large.target') {
  process.stdout.write('x'.repeat(2_000))
  process.exit(0)
}
if (target === 'slow.target') {
  setTimeout(() => process.stdout.write('late'), 10_000)
} else {
  process.stdout.write('help-body:' + target + '\n')
}
`

interface HelpFixture {
  root: string
  executable: string
  recordPath: string
  environment: MarivoEnvironment
  cleanup: () => Promise<void>
}

async function helpFixture(extraEnvironment: NodeJS.ProcessEnv = {}): Promise<HelpFixture> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-help-tool-')))
  const executable = path.join(root, 'fixture-python')
  const recordPath = path.join(root, 'targets.log')
  await writeFile(executable, FAKE_PYTHON, 'utf8')
  await chmod(executable, 0o755)
  const policy = new FixedSubprocessPolicy(root, {
    PATH: process.env.PATH,
    RECORD_PATH: recordPath,
    ...extraEnvironment,
  })
  const environment = new MarivoEnvironment(
    {
      projectRoot: root,
      pythonExecutable: executable,
      marivoVersion: '0.0.test',
      packagePath: path.join(root, 'fake-marivo', '__init__.py'),
      subprocessPolicyId: policy.id,
      fingerprint: 'f'.repeat(64),
    },
    policy,
  )
  return {
    root,
    executable,
    recordPath,
    environment,
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

async function setupRuntime(environment: MarivoEnvironment, limits = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  registerMarivoHelpTool(ctx, environment, limits)
  return ctx
}

let callSequence = 0

async function executeHelp(ctx: Context, targets: unknown, signal = new AbortController().signal) {
  callSequence++
  return ctx.tools.execute({
    signal,
    callId: CallId(`marivo-help-${callSequence}`),
    name: MARIVO_HELP_TOOL_NAME,
    arguments: { targets },
  })
}

test('registered tool exposes only the native targets schema and keeps timeout host-side', async (t) => {
  const fixture = await helpFixture()
  t.after(fixture.cleanup)
  const ctx = await setupRuntime(fixture.environment)
  const schema = ctx.tools.schemas().find((item) => item.name === MARIVO_HELP_TOOL_NAME)
  assert.deepEqual(schema, {
    name: MARIVO_HELP_TOOL_NAME,
    description:
      'Request current live Marivo API help for zero, one, or multiple canonical string targets from the bound project environment.',
    parameters: {
      type: 'object',
      properties: {
        targets: {
          type: 'array',
          description:
            'Canonical Marivo help targets. Use an empty array when no additional API information is needed.',
          items: { type: 'string' },
        },
      },
      required: ['targets'],
    },
  })
  assert.equal('timeoutMs' in (schema as object), false)
})

test('targets=[] succeeds without starting a help subprocess', async (t) => {
  const fixture = await helpFixture()
  t.after(fixture.cleanup)
  const ctx = await setupRuntime(fixture.environment)
  const result = await executeHelp(ctx, [])
  assert.equal(result.isError, false)
  assert.match(
    result.content[0]?.type === 'text' ? result.content[0].text : '',
    /no targets requested/,
  )
  await assert.rejects(() => stat(fixture.recordPath), { code: 'ENOENT' })
})

test('multiple targets deduplicate in first-seen order and preserve each raw stdout body', async (t) => {
  const fixture = await helpFixture()
  t.after(fixture.cleanup)
  const ctx = await setupRuntime(fixture.environment)
  const result = await executeHelp(ctx, [
    'analysis.observe',
    'analysis.compare',
    'analysis.observe',
  ])
  assert.equal(result.isError, false)
  if (result.isError) return
  const targets = (result.value as unknown as MarivoHelpValue).targets
  assert.deepEqual(
    targets.map((item) => ({
      target: item.target,
      body: item.body,
      delivery: item.delivery,
    })),
    [
      { target: 'analysis.observe', body: 'help-body:analysis.observe\n', delivery: 'delivered' },
      { target: 'analysis.compare', body: 'help-body:analysis.compare\n', delivery: 'delivered' },
    ],
  )
  assert.ok(targets.every((item) => /^[0-9a-f]{64}$/.test(item.bodyDigest)))
  assert.deepEqual((await readFile(fixture.recordPath, 'utf8')).trim().split('\n'), [
    'analysis.observe',
    'analysis.compare',
  ])
  const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
  assert.ok(text.includes('Target: analysis.observe\nhelp-body:analysis.observe\n'))
  assert.ok(text.includes('Target: analysis.compare\nhelp-body:analysis.compare\n'))
})

test('invalid target is a standard isError result and discards earlier batch stdout', async (t) => {
  const fixture = await helpFixture()
  t.after(fixture.cleanup)
  const ctx = await setupRuntime(fixture.environment)
  const result = await executeHelp(ctx, ['analysis.observe', 'invalid.target'])
  assert.equal(result.isError, true)
  const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
  assert.match(text, /invalid\.target/)
  assert.doesNotMatch(text, /help-body:analysis\.observe/)
  assert.equal(fixture.environment.status, 'ready')
})

test('mechanical request bounds fail without target membership validation', async (t) => {
  const fixture = await helpFixture()
  t.after(fixture.cleanup)
  const ctx = await setupRuntime(fixture.environment, { maxTargetChars: 5 })
  const missing = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId('missing-targets'),
    name: MARIVO_HELP_TOOL_NAME,
    arguments: {},
  })
  assert.equal(missing.isError, true)
  const tooLong = await executeHelp(ctx, ['abcdef'])
  assert.equal(tooLong.isError, true)
  assert.deepEqual(normalizeHelpTargets(['unknown', 'unknown'], resolveMarivoHelpLimits()), [
    'unknown',
  ])
})

test('empty, per-target size, and combined size failures never return partial help', async (t) => {
  const fixture = await helpFixture()
  t.after(fixture.cleanup)
  const emptyCtx = await setupRuntime(fixture.environment)
  assert.equal((await executeHelp(emptyCtx, ['empty.target'])).isError, true)

  const targetLimitCtx = await setupRuntime(fixture.environment, { focusedStdoutMaxBytes: 100 })
  assert.equal((await executeHelp(targetLimitCtx, ['large.target'])).isError, true)

  const combinedCtx = await setupRuntime(fixture.environment, { combinedStdoutMaxBytes: 35 })
  const combined = await executeHelp(combinedCtx, ['one.target', 'two.target'])
  assert.equal(combined.isError, true)
  const text = combined.content[0]?.type === 'text' ? combined.content[0].text : ''
  assert.doesNotMatch(text, /help-body:one\.target/)
})

test('target timeout and caller cancellation settle as bounded Tool failures', async (t) => {
  const fixture = await helpFixture()
  t.after(fixture.cleanup)
  const timeoutCtx = await setupRuntime(fixture.environment, { targetTimeoutMs: 30 })
  assert.equal((await executeHelp(timeoutCtx, ['slow.target'])).isError, true)

  const cancelCtx = await setupRuntime(fixture.environment)
  const controller = new AbortController()
  const pending = executeHelp(cancelCtx, ['slow.target'], controller.signal)
  setTimeout(() => controller.abort(), 30)
  assert.equal((await pending).isError, true)
})

test('inventory is raw passthrough and is executed again on every call', async (t) => {
  const fixture = await helpFixture()
  t.after(fixture.cleanup)
  assert.equal(await loadTargetInventory(fixture.environment), 'help-body:targets\n')
  assert.equal(await loadTargetInventory(fixture.environment), 'help-body:targets\n')
  assert.deepEqual((await readFile(fixture.recordPath, 'utf8')).trim().split('\n'), [
    'targets',
    'targets',
  ])
})

test('same-process identity mismatch fails the binding and prevents later help', async (t) => {
  const fixture = await helpFixture({ IDENTITY_MODE: 'mismatch' })
  t.after(fixture.cleanup)
  const tool = createMarivoHelpTool(fixture.environment)
  const ctx = await setupRuntime(fixture.environment)
  assert.equal(tool.name, MARIVO_HELP_TOOL_NAME)
  assert.equal((await executeHelp(ctx, ['analysis.observe'])).isError, true)
  assert.equal(fixture.environment.status, 'failed')
  const second = await executeHelp(ctx, ['analysis.compare'])
  assert.equal(second.isError, true)
  assert.equal((await readFile(fixture.recordPath, 'utf8')).trim(), 'analysis.observe')
})
