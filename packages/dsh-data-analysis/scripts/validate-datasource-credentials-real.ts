import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
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
import { bindMarivoEnvironment, type MarivoEnvironment } from '../src/environment/index.ts'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workspaceRoot = path.resolve(packageRoot, '../..')
const pythonExecutable =
  process.env.DSH_DATA_ANALYSIS_PYTHON ??
  path.join(
    workspaceRoot,
    process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python',
  )
const datasourceName = 'credential_validation'
const expectedRefs = ['DSH_VALIDATION_PASSWORD', 'DSH_VALIDATION_USER']

const datasourceProjectRoot = await realpath(
  await mkdtemp(path.join(tmpdir(), 'dsh-datasource-real-')),
)
try {
  await writeFile(
    path.join(datasourceProjectRoot, 'marivo.toml'),
    '[project]\nname = "dsh-datasource-real"\n',
    'utf8',
  )
  const datasourceDirectory = path.join(datasourceProjectRoot, 'models', 'datasources')
  await mkdir(datasourceDirectory, { recursive: true })
  await writeFile(
    path.join(datasourceDirectory, `${datasourceName}.py`),
    [
      'import marivo.datasource as md',
      'md.postgres(',
      `    name=${JSON.stringify(datasourceName)},`,
      '    host="127.0.0.1",',
      '    database="validation",',
      '    user_env="DSH_VALIDATION_USER",',
      '    password_env="DSH_VALIDATION_PASSWORD",',
      ')',
      '',
    ].join('\n'),
    'utf8',
  )

  const environment = await bindMarivoEnvironment({
    projectRoot: datasourceProjectRoot,
    pythonExecutable,
  })
  const inventoryResult = await environment.runCheckedDatasourceInventory({
    timeoutMs: 30_000,
    stdoutMaxBytes: 262_144,
    stderrMaxBytes: 65_536,
  })
  assert.equal(inventoryResult.exitCode, 0, inventoryResult.stderr.toString('utf8'))
  const inventory = JSON.parse(inventoryResult.stdout.toString('utf8')) as {
    datasources: Array<{ name: string; refs: string[] }>
  }
  assert.deepEqual(inventory.datasources, [
    {
      name: datasourceName,
      refs: ['DSH_VALIDATION_USER', 'DSH_VALIDATION_PASSWORD'],
    },
  ])
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
    resolve() {
      return Promise.resolve(undefined)
    },
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

  process.stdout.write(
    `${JSON.stringify(
      {
        status: 'ok',
        binding: environment.binding,
        inventory,
        datasource: value,
        connectionAttempts,
        credentialValuesRecorded: false,
      },
      null,
      2,
    )}\n`,
  )
} finally {
  await rm(datasourceProjectRoot, { recursive: true, force: true })
}
