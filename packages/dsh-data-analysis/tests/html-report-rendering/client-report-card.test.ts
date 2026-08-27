import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

interface ClientExports {
  parseReportPresentationMeta(value: unknown): unknown
  parseReportDurableContent(value: unknown): unknown
  marivoReportCardModel(block: unknown): unknown
  openMarivoReport(api: unknown, path: string): Promise<void>
  MarivoReportToolView(props: unknown): unknown
  apply(ctx: unknown): void
}

interface ClientRuntime {
  react?: unknown
  jsxRuntime?: unknown
  primitives?: unknown
}

async function loadClient(runtime: ClientRuntime = {}): Promise<ClientExports> {
  const source = await readFile(new URL('../../lib/client.js', import.meta.url), 'utf8')
  let registration: { factory: (require: (id: string) => unknown) => ClientExports } | undefined
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load(value: typeof registration) { registration = value } } },
  })
  assert.ok(registration)
  return registration.factory((id) => {
    if (id === 'react/jsx-runtime') return runtime.jsxRuntime ?? {
      Fragment: Symbol('Fragment'), jsx() {}, jsxs() {},
    }
    if (id === 'react') return runtime.react ?? {
      useEffect() {}, useMemo: (factory: () => unknown) => factory(), useState() {},
    }
    if (id === '@deepseek-ai/dsh-client-ui-primitives') {
      return runtime.primitives ?? { Button() {}, Modal() {} }
    }
    throw new Error(`unexpected client module request: ${id}`)
  })
}

interface TestElement {
  type: unknown
  props: Record<string, any>
}

class HookHarness {
  private readonly states: unknown[] = []
  private cursor = 0

  readonly react = {
    useEffect() {},
    useMemo: (factory: () => unknown) => factory(),
    useState: (initial: unknown) => {
      const index = this.cursor++
      if (index >= this.states.length) this.states[index] = initial
      const set = (value: unknown) => {
        this.states[index] = typeof value === 'function'
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
    return component(props) as TestElement
  }
}

function findElement(root: unknown, predicate: (element: TestElement) => boolean): TestElement | null {
  if (typeof root !== 'object' || root === null || Array.isArray(root)) {
    if (Array.isArray(root)) {
      for (const child of root) {
        const found = findElement(child, predicate)
        if (found !== null) return found
      }
    }
    return null
  }
  const element = root as TestElement
  if (predicate(element)) return element
  return findElement(element.props?.children, predicate)
}

function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

const reportMeta = {
  kind: 'marivo-html-report',
  version: 1,
  title: '支付分析报告',
  path: '/tmp/reports/report/index.html',
  reportDigest: 'a'.repeat(64),
  disclosures: ['Artifact admissible 不等于 datasource fresh。'],
}

function settled(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'tool-result',
    callId: 'report-call',
    call: { name: 'marivo_report_render', argsRaw: '{}' },
    content: [{ type: 'text', text: 'HTML report ready' }],
    isError: false,
    meta: reportMeta,
    ...overrides,
  }
}

test('report meta parser accepts only the closed replay contract and detaches disclosures', async () => {
  const client = await loadClient()
  const parsed = client.parseReportPresentationMeta(reportMeta) as typeof reportMeta
  assert.deepEqual(plain(parsed), reportMeta)
  assert.equal(Object.isFrozen(parsed), true)
  assert.equal(Object.isFrozen(parsed.disclosures), true)
  assert.notEqual(parsed.disclosures, reportMeta.disclosures)

  assert.equal(client.parseReportPresentationMeta(null), null)
  assert.equal(client.parseReportPresentationMeta({ ...reportMeta, version: 2 }), null)
  assert.equal(client.parseReportPresentationMeta({ ...reportMeta, reportDigest: 'not-a-digest' }), null)
  assert.equal(client.parseReportPresentationMeta({ ...reportMeta, extra: true }), null)
  assert.equal(client.parseReportPresentationMeta({ ...reportMeta, disclosures: [7] }), null)
})

test('card model is replay-pure and fails closed for blocked, malformed, and failed results', async () => {
  const client = await loadClient()
  assert.deepEqual(plain(client.marivoReportCardModel({ name: 'marivo_report_render' })), {
    state: 'running', summary: '正在生成 HTML 报告…', report: null,
  })

  const first = plain(client.marivoReportCardModel(settled()))
  const replay = plain(client.marivoReportCardModel(structuredClone(settled())))
  assert.deepEqual(first, {
    state: 'ready', summary: reportMeta.title, report: reportMeta,
  })
  assert.deepEqual(replay, first)

  const codeMode = settled({
    meta: undefined,
    content: [
      { type: 'text', text: 'HTML report ready' },
      { type: 'marivo-report-card', meta: reportMeta },
    ],
  })
  assert.deepEqual(plain(client.marivoReportCardModel(codeMode)), first)
  assert.deepEqual(plain(client.marivoReportCardModel(structuredClone(codeMode))), first)
  assert.equal(client.parseReportDurableContent([
    { type: 'marivo-report-card', meta: reportMeta, extra: true },
  ]), null)
  assert.equal(client.parseReportDurableContent([
    { type: 'marivo-report-card', meta: reportMeta },
    { type: 'marivo-report-card', meta: reportMeta },
  ]), null)

  assert.deepEqual(plain(client.marivoReportCardModel(settled({
    meta: null,
    content: [{ type: 'text', text: 'HTML report rendering is blocked at stage visual.' }],
  }))), {
    state: 'fallback', summary: 'HTML report rendering is blocked at stage visual.', report: null,
  })
  assert.equal((plain(client.marivoReportCardModel(settled({
    meta: { ...reportMeta, version: 9 },
  }))) as { state: string }).state, 'fallback')
  assert.equal((plain(client.marivoReportCardModel(settled({
    isError: true,
    content: [{ type: 'text', text: 'open failed' }],
  }))) as { state: string }).state, 'fallback')
})

test('open action sends the exact path and rejects RPC, malformed, and thrown failures locally', async () => {
  const client = await loadClient()
  const calls: unknown[] = []
  await client.openMarivoReport({
    host: {
      async openPath(payload: unknown) {
        calls.push(payload)
        return { result: { ok: true, value: { opened: true } } }
      },
    },
  }, reportMeta.path)
  assert.deepEqual(plain(calls), [{ path: reportMeta.path }])

  await assert.rejects(() => client.openMarivoReport({
    host: { async openPath() { return { result: { ok: false, error: { message: 'trust fence' } } } } },
  }, reportMeta.path), /trust fence/)
  await assert.rejects(() => client.openMarivoReport({
    host: { async openPath() { return { result: { ok: true, value: { opened: false } } } } },
  }, reportMeta.path), /无效/)
  await assert.rejects(() => client.openMarivoReport({
    host: { async openPath() { throw new Error('opener unavailable') } },
  }, reportMeta.path), /opener unavailable/)
  assert.deepEqual(reportMeta, {
    kind: 'marivo-html-report', version: 1, title: '支付分析报告',
    path: '/tmp/reports/report/index.html', reportDigest: 'a'.repeat(64),
    disclosures: ['Artifact admissible 不等于 datasource fresh。'],
  })
})

test('report Tool View disables the clicked action and renders Host rejection only in local state', async () => {
  const harness = new HookHarness()
  const client = await loadClient({
    react: harness.react,
    jsxRuntime: harness.jsxRuntime,
    primitives: { Button: 'Button', Modal: 'Modal' },
  })
  let settle: ((value: unknown) => void) | undefined
  const calls: unknown[] = []
  const connection = {
    api: {
      host: {
        openPath(payload: unknown) {
          calls.push(payload)
          return new Promise(resolve => { settle = resolve })
        },
      },
    },
  }
  const props = { callId: 'report-call', block: settled(), connection }
  let tree = harness.render(client.MarivoReportToolView, props)
  let button = findElement(tree, element => element.type === 'Button')
  assert.ok(button)
  assert.equal(button.props.disabled, false)
  button.props.onClick()

  tree = harness.render(client.MarivoReportToolView, props)
  button = findElement(tree, element => element.type === 'Button')
  assert.ok(button)
  assert.equal(button.props.disabled, true)
  assert.equal(button.props.children, '正在打开…')
  assert.deepEqual(plain(calls), [{ path: reportMeta.path }])

  assert.ok(settle)
  settle({ result: { ok: false, error: { message: 'trust fence rejected' } } })
  await new Promise(resolve => setImmediate(resolve))
  tree = harness.render(client.MarivoReportToolView, props)
  const alert = findElement(tree, element => element.props?.role === 'alert')
  assert.ok(alert)
  assert.equal(alert.props.children, 'trust fence rejected')
  assert.deepEqual((props.block as { meta: unknown }).meta, reportMeta)
})

test('client registers report and credential Tool Views beside citation replay UI', async () => {
  const client = await loadClient()
  const definitions: unknown[] = []
  const slots: Array<{ options: any; component: unknown }> = []
  const ctx = {
    get(name: string) {
      assert.equal(name, 'connection')
      return { api: {} }
    },
    conversationEvents: { register(value: unknown) { definitions.push(value) } },
    effect(install: () => unknown) { install() },
    locale: { register() { return () => {} } },
    slots: {
      inject(_name: string, install: () => unknown) { install() },
      register(options: unknown, component: unknown) {
        slots.push({ options, component })
        return () => {}
      },
    },
  }
  client.apply(ctx)
  assert.deepEqual(slots.map(item => item.options.key ?? item.options.name), [
    'marivo_test', 'marivo_report_render', 'conversation.chat.turnTail',
  ])
  assert.equal(definitions.length, 2)
})
