import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import vm from 'node:vm'
import { Context } from '@deepseek-ai/cordis'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { MARIVO_TEST_TOOL_NAME, registerMarivoTestTool } from '../../src/datasource/index.ts'
import { FixedSubprocessPolicy, MarivoEnvironment } from '../../src/environment/index.ts'

interface ClientExports {
  parseNeedsCredentials(text: string): { name: string; refs: string[] } | null
  shouldAutoOpen(sessionId: string, callId: string, result: unknown): boolean
  blankCredentialValues(refs: readonly string[]): Record<string, string>
  CredentialDialogController: new (api: unknown) => {
    describe(refs: readonly string[]): Promise<Record<string, { configured: boolean }>>
    save(values: Readonly<Record<string, string>>): Promise<{
      ok: boolean; saved: string[]; errors: Record<string, string>
    }>
  }
}

async function loadClient(): Promise<ClientExports> {
  const source = await readFile(new URL('../../lib/client.js', import.meta.url), 'utf8')
  let registration: { factory: (require: (id: string) => unknown) => ClientExports } | undefined
  const context = {
    window: { __ModuleLoader__: { load(value: typeof registration) { registration = value } } },
  }
  vm.runInNewContext(source, context)
  assert.ok(registration)
  return registration.factory((id) => {
    if (id === 'react/jsx-runtime') return { Fragment: Symbol('Fragment'), jsx() {}, jsxs() {} }
    if (id === 'react') return { useEffect() {}, useMemo: (factory: () => unknown) => factory(), useState() {} }
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return { Button() {}, Modal() {} }
    throw new Error(`unexpected client module request: ${id}`)
  })
}

const FAKE_PYTHON = String.raw`#!/usr/bin/env node
import { appendFileSync } from 'node:fs'
import process from 'node:process'
const args = process.argv.slice(2)
const script = args[1] ?? ''
const name = args[5]
if (script.includes('result = md.test')) {
  appendFileSync(process.env.RECORD_PATH, JSON.stringify({
    key: process.env.WEB_API_KEY,
    persistSecrets: process.env.MARIVO_PERSIST_SECRETS,
    persistCredentials: process.env.MARIVO_PERSIST_CREDENTIALS,
  }) + '\n')
  process.stdout.write(JSON.stringify({
    name, ok: true, latency_ms: 3, failure: null, repair: null,
  }))
  process.exit(0)
}
if (script.includes('md.describe')) {
  process.stdout.write(JSON.stringify({ name, refs: ['WEB_API_KEY'] }))
  process.exit(0)
}
process.exit(2)
`

class MapCredentials {
  readonly values = new Map<string, string>()
  async resolve(ref: CredentialRef) {
    const value = this.values.get(ref)
    return value === undefined ? undefined : { value, source: 'file' }
  }
}

test('browser bundle opens once per session, keeps fields blank, saves, then waits for manual retry', async (t) => {
  const client = await loadClient()
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-web-credential-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const executable = path.join(root, 'fixture-python')
  const recordPath = path.join(root, 'test-calls.jsonl')
  await writeFile(executable, FAKE_PYTHON)
  await chmod(executable, 0o755)
  const policy = new FixedSubprocessPolicy(root, {
    PATH: process.env.PATH,
    RECORD_PATH: recordPath,
  })
  const environment = new MarivoEnvironment({
    projectRoot: root,
    pythonExecutable: executable,
    marivoVersion: '0.0.web-test',
    packagePath: path.join(root, 'fake-marivo', '__init__.py'),
    subprocessPolicyId: policy.id,
    fingerprint: 'e'.repeat(64),
  }, policy)
  const credentials = new MapCredentials()
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  registerMarivoTestTool(ctx, environment, credentials)

  const first = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId('web-missing'),
    name: MARIVO_TEST_TOOL_NAME,
    arguments: { name: 'warehouse' },
  })
  assert.equal(first.isError, false)
  const text = first.content[0]?.type === 'text' ? first.content[0].text : ''
  const missing = client.parseNeedsCredentials(text)
  assert.deepEqual(JSON.parse(JSON.stringify(missing)), {
    status: 'needs-credentials', name: 'warehouse', refs: ['WEB_API_KEY'],
  })
  assert.equal(client.shouldAutoOpen('session-a', 'web-missing', missing), true)
  assert.equal(client.shouldAutoOpen('session-a', 'web-missing', missing), false)
  assert.equal(client.shouldAutoOpen('session-b', 'web-missing', missing), true)
  assert.deepEqual(JSON.parse(JSON.stringify(client.blankCredentialValues(missing?.refs ?? []))), {
    WEB_API_KEY: '',
  })
  await assert.rejects(() => stat(recordPath), { code: 'ENOENT' })

  const sets: Array<{ ref: string; value: string }> = []
  const controller = new client.CredentialDialogController({
    credentials: {
      async describe({ refs }: { refs: string[] }) {
        return {
          result: {
            ok: true,
            value: { credentials: Object.fromEntries(refs.map(ref => [ref, { configured: false }])) },
          },
        }
      },
      async set(payload: { ref: string; value: string }) {
        sets.push(payload)
        credentials.values.set(payload.ref, payload.value)
        return { result: { ok: true, value: {} } }
      },
    },
  })
  assert.deepEqual(JSON.parse(JSON.stringify(await controller.describe(['WEB_API_KEY']))), {
    WEB_API_KEY: { configured: false },
  })
  assert.deepEqual(JSON.parse(JSON.stringify(await controller.save({ WEB_API_KEY: 'web-secret' }))), {
    ok: true, saved: ['WEB_API_KEY'], errors: {},
  })
  assert.deepEqual(JSON.parse(JSON.stringify(sets)), [{ ref: 'WEB_API_KEY', value: 'web-secret' }])
  assert.deepEqual(JSON.parse(JSON.stringify(client.parseNeedsCredentials(text))), {
    status: 'needs-credentials', name: 'warehouse', refs: ['WEB_API_KEY'],
  })
  // Saving never resumes the Tool; the fake Python has still not been called.
  await assert.rejects(() => stat(recordPath), { code: 'ENOENT' })

  const retried = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId('web-manual-retry'),
    name: MARIVO_TEST_TOOL_NAME,
    arguments: { name: 'warehouse' },
  })
  assert.equal(retried.isError, false)
  const child = JSON.parse((await readFile(recordPath, 'utf8')).trim())
  assert.deepEqual(child, {
    key: 'web-secret', persistSecrets: '0', persistCredentials: '0',
  })
  assert.doesNotMatch(JSON.stringify(retried), /web-secret/)
})

test('partial credential writes retain failures and redact entered values', async () => {
  const client = await loadClient()
  const calls: string[] = []
  const controller = new client.CredentialDialogController({
    credentials: {
      async set({ ref, value }: { ref: string; value: string }) {
        calls.push(ref)
        if (ref === 'SECOND') {
          return { result: { ok: false, error: { message: `rejected ${value}` } } }
        }
        return { result: { ok: true, value: {} } }
      },
    },
  })
  const result = await controller.save({ FIRST: 'first-secret', SECOND: 'second-secret' })
  assert.deepEqual(calls, ['FIRST', 'SECOND'])
  assert.equal(result.ok, false)
  assert.deepEqual([...result.saved], ['FIRST'])
  assert.equal(result.errors.SECOND, 'rejected [REDACTED]')
  assert.doesNotMatch(JSON.stringify(result), /first-secret|second-secret/)
})
