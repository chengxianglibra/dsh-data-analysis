import assert from 'node:assert/strict'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import {
  MARIVO_TEST_TOOL_NAME,
  type MarivoTestValue,
  registerMarivoTestTool,
} from '../src/datasource/index.ts'
import {
  bindMarivoEnvironment,
  type MarivoEnvironment,
} from '../src/environment/index.ts'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workspaceRoot = path.resolve(packageRoot, '../..')
const datasourceProjectRoot = path.resolve(workspaceRoot, '../marivo')
const pythonExecutable = process.env.DSH_DATA_ANALYSIS_PYTHON
  ?? path.join(workspaceRoot, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python')
const datasourceName = 'cdn_replica'
const expectedRefs = [
  'MARIVO_CDN_REPLICA_PASSWORD',
  'MARIVO_CDN_REPLICA_USER',
]

const environment = await bindMarivoEnvironment({
  projectRoot: datasourceProjectRoot,
  pythonExecutable,
})
let connectionAttempts = 0
const guardedEnvironment = new Proxy(environment, {
  get(target, property) {
    if (property === 'runCheckedDatasourceTest') {
      return async () => {
        connectionAttempts++
        throw new Error('connection test must not run while credentials are missing')
      }
    }
    const value = Reflect.get(target, property, target)
    return typeof value === 'function' ? value.bind(target) : value
  },
}) as MarivoEnvironment

const ctx = new Context()
await ctx.plugin(SystemPrompt)
await ctx.plugin(ToolRuntime)
registerMarivoTestTool(ctx, guardedEnvironment, {
  resolve() { return Promise.resolve(undefined) },
})

const result = await ctx.tools.execute({
  signal: new AbortController().signal,
  callId: CallId('datasource-credentials-real'),
  name: MARIVO_TEST_TOOL_NAME,
  arguments: { name: datasourceName },
})
assert.equal(result.isError, false)
if (result.isError) throw new Error('unreachable datasource validation result')
const value = result.value as unknown as MarivoTestValue
assert.equal(value.status, 'needs-credentials')
if (value.status !== 'needs-credentials') throw new Error('expected missing credentials')
assert.equal(value.name, datasourceName)
assert.deepEqual([...value.refs].sort(), expectedRefs)
assert.equal(connectionAttempts, 0)

process.stdout.write(`${JSON.stringify({
  status: 'ok',
  binding: environment.binding,
  datasource: value,
  connectionAttempts,
  credentialValuesRecorded: false,
}, null, 2)}\n`)
