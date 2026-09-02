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
import {
  MARIVO_DATASOURCE_TEST_TOOL_NAME,
  MarivoDatasourceBridge,
  registerMarivoDatasourceTestTool,
} from '../../src/datasource/index.ts'
import { FixedSubprocessPolicy, MarivoEnvironment } from '../../src/environment/index.ts'

interface ClientExports {
  parseNeedsCredentials(text: string): { name: string; refs: string[] } | null
  shouldAutoOpen(sessionId: string, callId: string, result: unknown): boolean
  blankCredentialValues(refs: readonly string[]): Record<string, string>
  CredentialDialogController: new (
    api: unknown,
  ) => {
    describe(refs: readonly string[]): Promise<Record<string, { configured: boolean }>>
    inspect(refs: readonly string[]): Promise<{
      configured: Record<string, boolean>
      missing: string[]
      shouldOpen: boolean
    }>
    save(values: Readonly<Record<string, string>>): Promise<{
      ok: boolean
      saved: string[]
      errors: Record<string, string>
    }>
  }
  MarivoDatasourceTestToolView(props: unknown): unknown
}

interface ClientRuntime {
  react?: unknown
  jsxRuntime?: unknown
  primitives?: unknown
}

async function loadClient(runtime: ClientRuntime = {}): Promise<ClientExports> {
  const source = await readFile(new URL('../../lib/client.js', import.meta.url), 'utf8')
  let registration: { factory: (require: (id: string) => unknown) => ClientExports } | undefined
  const context = {
    window: {
      __ModuleLoader__: {
        load(value: typeof registration) {
          registration = value
        },
      },
    },
  }
  vm.runInNewContext(source, context)
  assert.ok(registration)
  return registration.factory((id) => {
    if (id === 'react/jsx-runtime')
      return runtime.jsxRuntime ?? { Fragment: Symbol('Fragment'), jsx() {}, jsxs() {} }
    if (id === 'react')
      return (
        runtime.react ?? {
          useCallback: (callback: unknown) => callback,
          useEffect() {},
          useMemo: (factory: () => unknown) => factory(),
          useRef: (initial: unknown) => ({ current: initial }),
          useState() {},
        }
      )
    if (id === '@deepseek-ai/dsh-client-ui-primitives')
      return runtime.primitives ?? { Button() {}, Modal() {} }
    throw new Error(`unexpected client module request: ${id}`)
  })
}

interface TestElement {
  type: unknown
  props: Record<string, any>
}

class HookHarness {
  private readonly states: unknown[] = []
  private effects: Array<() => unknown> = []
  private cursor = 0

  readonly react = {
    useCallback: (callback: unknown) => callback,
    useEffect: (effect: () => unknown) => {
      this.effects.push(effect)
    },
    useMemo: (factory: () => unknown) => factory(),
    useRef: (initial: unknown) => {
      const index = this.cursor++
      if (index >= this.states.length) this.states[index] = { current: initial }
      return this.states[index]
    },
    useState: (initial: unknown) => {
      const index = this.cursor++
      if (index >= this.states.length) this.states[index] = initial
      const set = (value: unknown) => {
        this.states[index] =
          typeof value === 'function'
            ? (value as (current: unknown) => unknown)(this.states[index])
            : value
      }
      return [this.states[index], set]
    },
  }

  readonly jsxRuntime = {
    Fragment: 'Fragment',
    jsx: (type: unknown, props: Record<string, unknown>) => ({ type, props }),
    jsxs: (type: unknown, props: Record<string, unknown>) => ({ type, props }),
  }

  render(component: (props: unknown) => unknown, props: unknown): TestElement {
    this.cursor = 0
    this.effects = []
    return component(props) as TestElement
  }

  flushEffects(): void {
    const effects = this.effects
    this.effects = []
    for (const effect of effects) effect()
  }
}

function findElement(
  root: unknown,
  predicate: (element: TestElement) => boolean,
): TestElement | null {
  if (Array.isArray(root)) {
    for (const child of root) {
      const found = findElement(child, predicate)
      if (found !== null) return found
    }
    return null
  }
  if (typeof root !== 'object' || root === null) return null
  const element = root as TestElement
  if (predicate(element)) return element
  return findElement(element.props?.children, predicate)
}

async function settleAsyncState(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

function credentialResponse(configured: boolean) {
  return {
    result: {
      ok: true,
      value: {
        credentials: {
          DSH_DB_PASSWORD: { configured, writable: true },
        },
      },
    },
  }
}

function needsCredentialsBlock(callId: string) {
  return {
    kind: 'tool-result',
    callId,
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          status: 'needs-credentials',
          name: 'warehouse',
          refs: ['DSH_DB_PASSWORD'],
        }),
      },
    ],
    isError: false,
  }
}

const FAKE_PYTHON = String.raw`#!/usr/bin/env node
import { appendFileSync } from 'node:fs'
import process from 'node:process'
const args = process.argv.slice(2)
const script = args[1] ?? ''
const name = args[5]
if (script.includes('result = md.test')) {
  appendFileSync(process.env.RECORD_PATH, JSON.stringify({
    key: process.env.DSH_WEB_API_KEY,
    persistCredentials: process.env.MARIVO_PERSIST_CREDENTIALS,
  }) + '\n')
  process.stdout.write(JSON.stringify({
    name, ok: true, latency_ms: 3, failure: null, repair: null,
  }))
  process.exit(0)
}
if (script.includes('md.describe')) {
  process.stdout.write(JSON.stringify({ name, refs: ['DSH_WEB_API_KEY'] }))
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
  const environment = new MarivoEnvironment(
    {
      projectRoot: root,
      pythonExecutable: executable,
      marivoVersion: '0.0.web-test',
      packagePath: path.join(root, 'fake-marivo', '__init__.py'),
      subprocessPolicyId: policy.id,
      fingerprint: 'e'.repeat(64),
    },
    policy,
  )
  const credentials = new MapCredentials()
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  registerMarivoDatasourceTestTool(ctx, new MarivoDatasourceBridge(environment), credentials, {
    issueShellGrant() {
      return {
        token: 'g'.repeat(43),
        expires_in_ms: 60_000,
        usage: 'one-foreground-shell',
      }
    },
  })

  const first = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId('web-missing'),
    name: MARIVO_DATASOURCE_TEST_TOOL_NAME,
    arguments: { name: 'warehouse' },
  })
  assert.equal(first.isError, false)
  const text = first.content[0]?.type === 'text' ? first.content[0].text : ''
  const missing = client.parseNeedsCredentials(text)
  assert.deepEqual(JSON.parse(JSON.stringify(missing)), {
    status: 'needs-credentials',
    name: 'warehouse',
    refs: ['DSH_WEB_API_KEY'],
  })
  assert.equal(client.shouldAutoOpen('session-a', 'web-missing', missing), true)
  assert.equal(client.shouldAutoOpen('session-a', 'web-missing', missing), false)
  assert.equal(client.shouldAutoOpen('session-b', 'web-missing', missing), true)
  assert.deepEqual(JSON.parse(JSON.stringify(client.blankCredentialValues(missing?.refs ?? []))), {
    DSH_WEB_API_KEY: '',
  })
  await assert.rejects(() => stat(recordPath), { code: 'ENOENT' })

  const sets: Array<{ ref: string; value: string }> = []
  const controller = new client.CredentialDialogController({
    credentials: {
      async describe({ refs }: { refs: string[] }) {
        return {
          result: {
            ok: true,
            value: {
              credentials: Object.fromEntries(refs.map((ref) => [ref, { configured: false }])),
            },
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
  assert.deepEqual(JSON.parse(JSON.stringify(await controller.describe(['DSH_WEB_API_KEY']))), {
    DSH_WEB_API_KEY: { configured: false },
  })
  assert.deepEqual(
    JSON.parse(JSON.stringify(await controller.save({ DSH_WEB_API_KEY: 'web-secret' }))),
    {
      ok: true,
      saved: ['DSH_WEB_API_KEY'],
      errors: {},
    },
  )
  assert.deepEqual(JSON.parse(JSON.stringify(sets)), [
    { ref: 'DSH_WEB_API_KEY', value: 'web-secret' },
  ])
  assert.deepEqual(JSON.parse(JSON.stringify(client.parseNeedsCredentials(text))), {
    status: 'needs-credentials',
    name: 'warehouse',
    refs: ['DSH_WEB_API_KEY'],
  })
  // Saving never resumes the Tool; the fake Python has still not been called.
  await assert.rejects(() => stat(recordPath), { code: 'ENOENT' })

  const retried = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId('web-manual-retry'),
    name: MARIVO_DATASOURCE_TEST_TOOL_NAME,
    arguments: { name: 'warehouse' },
  })
  assert.equal(retried.isError, false)
  const child = JSON.parse((await readFile(recordPath, 'utf8')).trim())
  assert.deepEqual(child, {
    key: 'web-secret',
    persistCredentials: '0',
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

test('replayed needs-credentials result stays closed when every ref is now configured', async () => {
  const harness = new HookHarness()
  const client = await loadClient({
    react: harness.react,
    jsxRuntime: harness.jsxRuntime,
    primitives: { Button() {}, Modal() {} },
  })
  const props = {
    sessionId: 'replay-session',
    callId: 'replay-configured',
    block: needsCredentialsBlock('replay-configured'),
    connection: {
      api: {
        credentials: {
          async describe() {
            return credentialResponse(true)
          },
        },
      },
    },
  }

  const initial = harness.render(client.MarivoDatasourceTestToolView, props)
  assert.equal(
    findElement(initial, (element) => element.props?.open !== undefined)?.props.open,
    false,
  )
  harness.flushEffects()
  await settleAsyncState()

  const reconciled = harness.render(client.MarivoDatasourceTestToolView, props)
  assert.equal(
    findElement(reconciled, (element) => element.props?.open !== undefined)?.props.open,
    false,
  )
  assert.match(JSON.stringify(reconciled), /凭证已配置，请重试 marivo_datasource_test/)
  assert.equal(
    findElement(reconciled, (element) => element.props?.children === '配置凭证'),
    null,
  )
})

test('a stale credential inspection cannot reopen a dialog closed by a newer result', async () => {
  const harness = new HookHarness()
  const pending: Array<(value: unknown) => void> = []
  const client = await loadClient({
    react: harness.react,
    jsxRuntime: harness.jsxRuntime,
    primitives: { Button() {}, Modal() {} },
  })
  const props = {
    sessionId: 'race-session',
    callId: 'race-call',
    block: needsCredentialsBlock('race-call'),
    connection: {
      api: {
        credentials: {
          describe() {
            return new Promise((resolve) => pending.push(resolve))
          },
        },
      },
    },
  }

  const initial = harness.render(client.MarivoDatasourceTestToolView, props)
  const configure = findElement(initial, (element) => element.props?.children === '配置凭证')
  assert.ok(configure)
  harness.flushEffects()
  configure.props.onClick()
  assert.equal(pending.length, 2)

  pending[1]?.(credentialResponse(true))
  await settleAsyncState()
  pending[0]?.(credentialResponse(false))
  await settleAsyncState()

  const reconciled = harness.render(client.MarivoDatasourceTestToolView, props)
  assert.equal(
    findElement(reconciled, (element) => element.props?.open !== undefined)?.props.open,
    false,
  )
  assert.match(JSON.stringify(reconciled), /凭证已配置，请重试 marivo_datasource_test/)
})

test('an inspection result from replaced Tool View props cannot update the current dialog', async () => {
  const harness = new HookHarness()
  const pending: Array<(value: unknown) => void> = []
  const client = await loadClient({
    react: harness.react,
    jsxRuntime: harness.jsxRuntime,
    primitives: { Button() {}, Modal() {} },
  })
  const connection = {
    api: {
      credentials: {
        describe() {
          return new Promise((resolve) => pending.push(resolve))
        },
      },
    },
  }
  const firstProps = {
    sessionId: 'identity-session',
    callId: 'identity-old',
    block: needsCredentialsBlock('identity-old'),
    connection,
  }
  const currentProps = {
    sessionId: 'identity-session',
    callId: 'identity-current',
    block: needsCredentialsBlock('identity-current'),
    connection,
  }

  harness.render(client.MarivoDatasourceTestToolView, firstProps)
  harness.flushEffects()
  assert.equal(pending.length, 1)

  harness.render(client.MarivoDatasourceTestToolView, currentProps)
  pending[0]?.(credentialResponse(false))
  await settleAsyncState()

  const current = harness.render(client.MarivoDatasourceTestToolView, currentProps)
  assert.equal(
    findElement(current, (element) => element.props?.open !== undefined)?.props.open,
    false,
  )
})

test('credential inspection keeps only currently unconfigured refs editable', async () => {
  const client = await loadClient()
  const controller = new client.CredentialDialogController({
    credentials: {
      async describe() {
        return {
          result: {
            ok: true,
            value: {
              credentials: {
                DSH_DB_USER: { configured: true, writable: true },
                DSH_DB_PASSWORD: { configured: false, writable: true },
              },
            },
          },
        }
      },
    },
  })

  assert.deepEqual(
    JSON.parse(JSON.stringify(await controller.inspect(['DSH_DB_USER', 'DSH_DB_PASSWORD']))),
    {
      configured: { DSH_DB_USER: true, DSH_DB_PASSWORD: false },
      missing: ['DSH_DB_PASSWORD'],
      shouldOpen: true,
    },
  )
})
