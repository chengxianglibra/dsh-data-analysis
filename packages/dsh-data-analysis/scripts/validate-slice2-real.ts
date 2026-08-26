import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import {
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
assert.equal(secondInventory, firstInventory)

const directBodies = new Map<string, string>()
for (const target of ['analysis.observe', 'analysis.compare']) {
  const result = await environment.subprocessPolicy.run({
    executable: environment.binding.pythonExecutable,
    args: ['-c', 'import marivo, sys; marivo.help(sys.argv[1])', target],
    limits: { timeoutMs: 30_000, stdoutMaxBytes: 262_144, stderrMaxBytes: 65_536 },
  })
  assert.equal(result.exitCode, 0, result.stderr.toString('utf8'))
  directBodies.set(target, result.stdout.toString('utf8'))
}

const ctx = new Context()
await ctx.plugin(SystemPrompt)
await ctx.plugin(ToolRuntime)
registerMarivoHelpTool(ctx, environment)

let sequence = 0
async function execute(targets: string[]) {
  sequence++
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId(`slice2-real-${sequence}`),
    name: MARIVO_HELP_TOOL_NAME,
    arguments: { targets },
  })
}

const success = await execute(['analysis.observe', 'analysis.compare', 'analysis.observe'])
assert.equal(success.isError, false)
if (success.isError) throw new Error('unreachable')
const value = success.value as unknown as MarivoHelpValue
assert.deepEqual(value.targets.map(item => item.target), ['analysis.observe', 'analysis.compare'])
for (const result of value.targets) assert.equal(result.body, directBodies.get(result.target))

const empty = await execute([])
assert.equal(empty.isError, false)

const invalid = await execute(['analysis.observe', 'definitely.not.a.target'])
assert.equal(invalid.isError, true)
const invalidText = invalid.content[0]?.type === 'text' ? invalid.content[0].text : ''
assert.match(invalidText, /definitely\.not\.a\.target/)
assert.ok(!invalidText.includes(directBodies.get('analysis.observe')!))

const shadowRoot = await mkdtemp(path.join(tmpdir(), 'dsh-slice2-shadow-'))
let shadowStatus: string
try {
  await writeFile(path.join(shadowRoot, 'marivo.toml'), '[project]\nname = "shadow-test"\n', 'utf8')
  const shadowEnvironment = await bindMarivoEnvironment({
    projectRoot: shadowRoot,
    pythonExecutable: environment.binding.pythonExecutable,
  })
  await mkdir(path.join(shadowRoot, 'marivo'))
  await writeFile(
    path.join(shadowRoot, 'marivo', '__init__.py'),
    '__version__ = "9.9.shadow"\n',
    'utf8',
  )
  await assert.rejects(
    () => loadTargetInventory(shadowEnvironment),
    (error: unknown) => error instanceof Error && error.message.includes('explicit rebind'),
  )
  shadowStatus = shadowEnvironment.status
} finally {
  await rm(shadowRoot, { recursive: true, force: true })
}
assert.equal(shadowStatus!, 'failed')

process.stdout.write(`${JSON.stringify({
  status: 'ok',
  binding: environment.binding,
  inventoryStdoutBytes: Buffer.byteLength(firstInventory),
  focusedStdoutBytes: Object.fromEntries(
    [...directBodies].map(([target, body]) => [target, Buffer.byteLength(body)]),
  ),
  standardToolResults: {
    empty: empty.isError ? 'error' : 'success',
    multipleDeduplicated: value.targets.length,
    invalid: invalid.isError ? 'isError' : 'unexpected-success',
    shadowBinding: shadowStatus!,
  },
}, null, 2)}\n`)
