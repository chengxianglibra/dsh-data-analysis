import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import {
  MARIVO_DATASOURCE_TEST_TOOL_NAME,
  MarivoDatasourceBridge,
  type MarivoDatasourceTestOptions,
  type MarivoDatasourceTestValue,
  marivoCredentialStorageRef,
  registerMarivoDatasourceTestTool,
} from '../../src/datasource/index.ts'
import { FixedSubprocessPolicy, MarivoEnvironment } from '../../src/environment/index.ts'

const FAKE_PYTHON = String.raw`#!/usr/bin/env node
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const args = process.argv.slice(2)
const script = args[1] ?? ''
const name = args[5]
if (args[0] !== '-c' || name === undefined) process.exit(2)
if (script.includes('result = md.test')) {
  const record = {
    stage: 'test',
    name,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    persistCredentials: process.env.MARIVO_PERSIST_CREDENTIALS,
  }
  appendFileSync(process.env.RECORD_PATH, JSON.stringify(record) + '\n')
  if (process.env.MARIVO_PERSIST_CREDENTIALS !== '0') {
    const directory = path.join(process.env.HOME, '.marivo')
    mkdirSync(directory, { recursive: true })
    writeFileSync(path.join(directory, 'secrets.toml'), 'should-not-exist')
  }
  if (process.env.TEST_STDERR_SECRET === '1') process.stderr.write('stderr:' + process.env.DB_PASSWORD)
  const ok = process.env.TEST_OK !== '0'
  process.stdout.write(JSON.stringify(ok ? {
    name, ok: true, latency_ms: 7, failure: null, repair: null,
  } : {
    name, ok: false, latency_ms: 9,
    failure: {
      code: 'connection_open_failed', exception_type: 'AuthError', backend_code: null,
      backend_name: null, message: 'rejected credential ' + process.env.DB_PASSWORD,
    },
    repair: {
      kind: 'reconnect', help_target: 'datasource.test', action: 'replace ' + process.env.DB_PASSWORD,
      snippet: null, candidates: [], preserves_evidence: null,
    },
  }))
  process.exit(0)
}
if (script.includes('md.describe')) {
  const refs = (process.env.DESCRIBE_REFS ?? '').split(',').filter(Boolean)
  process.stdout.write(JSON.stringify({ name, refs }))
  process.exit(0)
}
process.exit(2)
`

class FakeCredentials {
  readonly values = new Map<string, { value: string; source: string }>()
  readonly resolved: string[] = []

  async resolve(ref: CredentialRef) {
    this.resolved.push(ref)
    return this.values.get(ref)
  }
}

async function fixture(
  options: { refs: string; ok?: boolean; stderrSecret?: boolean } = { refs: '' },
  toolOptions: MarivoDatasourceTestOptions = {
    revokeShellLease: () => {},
  },
) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-marivo-test-')))
  const executable = path.join(root, 'fixture-python')
  const recordPath = path.join(root, 'calls.jsonl')
  const home = path.join(root, 'home')
  await writeFile(executable, FAKE_PYTHON)
  await chmod(executable, 0o755)
  const policy = new FixedSubprocessPolicy(root, {
    PATH: process.env.PATH,
    HOME: home,
    RECORD_PATH: recordPath,
    DESCRIBE_REFS: options.refs,
    TEST_OK: options.ok === false ? '0' : '1',
    TEST_STDERR_SECRET: options.stderrSecret ? '1' : '0',
    MARIVO_PERSIST_CREDENTIALS: '1',
  })
  const environment = new MarivoEnvironment(
    {
      projectRoot: root,
      pythonExecutable: executable,
      marivoVersion: '0.0.test',
      packagePath: path.join(root, 'fake-marivo', '__init__.py'),
      subprocessPolicyId: policy.id,
      fingerprint: 'd'.repeat(64),
    },
    policy,
  )
  const bridge = new MarivoDatasourceBridge(environment)
  const credentials = new FakeCredentials()
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  registerMarivoDatasourceTestTool(ctx, bridge, credentials, toolOptions)
  return {
    root,
    home,
    recordPath,
    credentials,
    ctx,
    environment,
    bridge,
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

let sequence = 0
async function execute(ctx: Context, name = 'warehouse') {
  sequence++
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId(`marivo-test-${sequence}`),
    name: MARIVO_DATASOURCE_TEST_TOOL_NAME,
    arguments: { name },
  })
}

async function absent(target: string): Promise<void> {
  await assert.rejects(() => stat(target), { code: 'ENOENT' })
}

test('missing and partial credentials return only deduplicated original refs without connecting', async (t) => {
  const f = await fixture({ refs: 'DB_USER,DB_PASSWORD,DB_PASSWORD' })
  t.after(f.cleanup)
  assert.ok(f.ctx.tools.get(MARIVO_DATASOURCE_TEST_TOOL_NAME))
  assert.equal(f.ctx.tools.get('marivo_test'), undefined)
  f.credentials.values.set(marivoCredentialStorageRef('DB_USER'), {
    value: 'readonly-user',
    source: 'env',
  })

  const result = await execute(f.ctx)
  assert.equal(result.isError, false)
  if (result.isError) return
  assert.deepEqual(result.value as unknown as MarivoDatasourceTestValue, {
    status: 'needs-credentials',
    name: 'warehouse',
    refs: ['DB_PASSWORD'],
  })
  assert.deepEqual(f.credentials.resolved, [
    marivoCredentialStorageRef('DB_USER'),
    marivoCredentialStorageRef('DB_PASSWORD'),
  ])
  assert.equal(
    result.content[0]?.type === 'text' ? result.content[0].text : '',
    '{"status":"needs-credentials","name":"warehouse","refs":["DB_PASSWORD"]}',
  )
  await absent(f.recordPath)
})

test('every explicit test revokes prior datasource access before describing credentials', async (t) => {
  const revoked: string[] = []
  const f = await fixture(
    { refs: 'DB_USER,DB_PASSWORD' },
    {
      revokeShellLease: (_bridge, name) => {
        revoked.push(name)
      },
    },
  )
  t.after(f.cleanup)

  const result = await execute(f.ctx)

  assert.equal(result.isError, false)
  assert.deepEqual(revoked, ['warehouse'])
})

test('an original Host credential is a canary and is never resolved directly', async (t) => {
  const f = await fixture({ refs: 'DEEPSEEK_API_KEY' })
  t.after(f.cleanup)
  f.credentials.values.set('DEEPSEEK_API_KEY', {
    value: 'host-canary-must-stay-unread',
    source: 'env',
  })

  const result = await execute(f.ctx)

  assert.equal(result.isError, false)
  if (!result.isError) {
    assert.deepEqual(result.value as unknown as MarivoDatasourceTestValue, {
      status: 'needs-credentials',
      name: 'warehouse',
      refs: ['DEEPSEEK_API_KEY'],
    })
  }
  assert.deepEqual(f.credentials.resolved, [marivoCredentialStorageRef('DEEPSEEK_API_KEY')])
  assert.doesNotMatch(JSON.stringify(result), /host-canary-must-stay-unread/)
  await absent(f.recordPath)
})

test('invalid and reserved datasource references fail before credential resolution or connection', async (t) => {
  const f = await fixture({ refs: 'DB-PASSWORD' })
  t.after(f.cleanup)

  const result = await execute(f.ctx)

  assert.equal(result.isError, true)
  assert.match(JSON.stringify(result), /invalid credential reference/)
  assert.deepEqual(f.credentials.resolved, [])
  await absent(f.recordPath)

  const reserved = await fixture({ refs: 'marivo_persist_credentials' })
  t.after(reserved.cleanup)
  const reservedResult = await execute(reserved.ctx)
  assert.equal(reservedResult.isError, true)
  assert.match(JSON.stringify(reservedResult), /reserved runtime namespace/)
  assert.deepEqual(reserved.credentials.resolved, [])
  await absent(reserved.recordPath)
})

test('configured credentials reach one child overlay and are re-resolved on the next operation', async (t) => {
  const revoked: string[] = []
  const f = await fixture(
    { refs: 'DB_USER,DB_PASSWORD' },
    {
      revokeShellLease: (_bridge, name) => {
        revoked.push(name)
      },
    },
  )
  t.after(f.cleanup)
  f.credentials.values.set(marivoCredentialStorageRef('DB_USER'), {
    value: 'alice',
    source: 'user-env',
  })
  f.credentials.values.set(marivoCredentialStorageRef('DB_PASSWORD'), {
    value: 'first-secret',
    source: 'file',
  })

  const first = await execute(f.ctx)
  assert.equal(first.isError, false, JSON.stringify(first))
  f.credentials.values.set(marivoCredentialStorageRef('DB_PASSWORD'), {
    value: 'second-secret',
    source: 'file',
  })
  const second = await execute(f.ctx)
  assert.equal(second.isError, false)
  assert.deepEqual(revoked, ['warehouse', 'warehouse'])
  if (!first.isError) {
    const value = first.value as unknown as MarivoDatasourceTestValue
    assert.deepEqual(value, { status: 'ok', name: 'warehouse', latency_ms: 7 })
    assert.doesNotMatch(JSON.stringify(first), /shell_lease|credential-lease/)
  }

  assert.deepEqual(f.credentials.resolved, [
    marivoCredentialStorageRef('DB_USER'),
    marivoCredentialStorageRef('DB_PASSWORD'),
    marivoCredentialStorageRef('DB_USER'),
    marivoCredentialStorageRef('DB_PASSWORD'),
  ])
  const calls = (await readFile(f.recordPath, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  assert.deepEqual(calls, [
    {
      stage: 'test',
      name: 'warehouse',
      user: 'alice',
      password: 'first-secret',
      persistCredentials: '0',
    },
    {
      stage: 'test',
      name: 'warehouse',
      user: 'alice',
      password: 'second-secret',
      persistCredentials: '0',
    },
  ])
  assert.doesNotMatch(JSON.stringify(first), /first-secret/)
  assert.doesNotMatch(JSON.stringify(second), /second-secret/)
  await absent(path.join(f.home, '.marivo', 'secrets.toml'))
})

test('structured md.test failure redacts exact credential values from result and rendered output', async (t) => {
  const f = await fixture({ refs: 'DB_PASSWORD', ok: false, stderrSecret: true })
  t.after(f.cleanup)
  f.credentials.values.set(marivoCredentialStorageRef('DB_PASSWORD'), {
    value: 'ultra-private',
    source: 'file',
  })

  const result = await execute(f.ctx)
  assert.equal(result.isError, false, JSON.stringify(result))
  assert.doesNotMatch(JSON.stringify(result), /ultra-private/)
  assert.match(JSON.stringify(result), /\[REDACTED\]/)
  if (!result.isError) {
    const value = result.value as unknown as MarivoDatasourceTestValue
    assert.equal(value.status, 'failed')
  }
  await absent(path.join(f.home, '.marivo', 'secrets.toml'))
})

test('fixed persistence policy cannot be overridden by a datasource credential', async (t) => {
  const f = await fixture({ refs: 'DB_PASSWORD' })
  t.after(f.cleanup)
  f.credentials.values.set(marivoCredentialStorageRef('DB_PASSWORD'), {
    value: 'ordinary-secret',
    source: 'file',
  })
  const result = await execute(f.ctx)
  assert.equal(result.isError, false, JSON.stringify(result))
  const call = JSON.parse((await readFile(f.recordPath, 'utf8')).trim()) as {
    persistCredentials: string
  }
  assert.equal(call.persistCredentials, '0')
  await absent(path.join(f.home, '.marivo', 'secrets.toml'))
})

test('subprocess start validation never exposes a malformed credential value', async (t) => {
  const f = await fixture({ refs: 'DB_PASSWORD' })
  t.after(f.cleanup)
  f.credentials.values.set(marivoCredentialStorageRef('DB_PASSWORD'), {
    value: 'nul-private\u0000tail',
    source: 'file',
  })

  const result = await execute(f.ctx)

  assert.equal(result.isError, true)
  assert.doesNotMatch(JSON.stringify(result), /nul-private|tail/)
  if (result.isError) {
    assert.equal(result.error.message, 'Could not start Marivo subprocess')
  }
  await absent(f.recordPath)
  await absent(path.join(f.home, '.marivo', 'secrets.toml'))
})
