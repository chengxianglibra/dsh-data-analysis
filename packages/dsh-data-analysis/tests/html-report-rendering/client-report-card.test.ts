import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

interface ClientExports {
  parseReportPresentationMeta(value: unknown): unknown
  parseReportDurableContent(value: unknown): unknown
  reportDeliveryFromEvent(event: unknown, calls?: ReadonlyMap<string, string>): unknown
  reportsForClosing(owner: unknown): unknown
  selectMarivoReports(owner: unknown): unknown
  marivoReportDeliveryDefinition: any
  marivoReportCardModel(block: unknown): unknown
  openMarivoReport(api: unknown, path: string): Promise<void>
  MarivoReportTurnDelivery(props: unknown): unknown
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
    window: {
      __ModuleLoader__: {
        load(value: typeof registration) {
          registration = value
        },
      },
    },
  })
  assert.ok(registration)
  return registration.factory((id) => {
    if (id === 'react/jsx-runtime')
      return (
        runtime.jsxRuntime ?? {
          Fragment: Symbol('Fragment'),
          jsx() {},
          jsxs() {},
        }
      )
    if (id === 'react')
      return (
        runtime.react ?? {
          useEffect() {},
          useMemo: (factory: () => unknown) => factory(),
          useState() {},
        }
      )
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
    return component(props) as TestElement
  }
}

function findElement(
  root: unknown,
  predicate: (element: TestElement) => boolean,
): TestElement | null {
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

function nativeReportEvent(overrides: Record<string, unknown> = {}) {
  return {
    seq: 20,
    type: 'tool/result',
    surfaceOp: 'append',
    data: {
      turn: 3,
      step: 4,
      meta: reportMeta,
      message: {
        source: { kind: 'tool', callId: 'report-call' },
        content: [
          {
            type: 'tool-result',
            toolCallId: 'report-call',
            isError: false,
            content: [{ type: 'text', text: 'HTML report ready' }],
          },
        ],
      },
    },
    ...overrides,
  }
}

function nestedReportEvent(overrides: Record<string, unknown> = {}) {
  return {
    seq: 21,
    type: 'tool/code-dispatch',
    data: {
      rootCallId: 'code-call',
      parentCallId: 'code-call',
      subCallId: 'code-call:report',
      name: 'marivo_report_render',
      arguments: {},
      isError: false,
      content: [
        { type: 'text', text: 'HTML report ready' },
        { type: 'marivo-report-card', turn: 3, meta: reportMeta },
      ],
    },
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
  assert.equal(
    client.parseReportPresentationMeta({ ...reportMeta, reportDigest: 'not-a-digest' }),
    null,
  )
  assert.equal(client.parseReportPresentationMeta({ ...reportMeta, extra: true }), null)
  assert.equal(client.parseReportPresentationMeta({ ...reportMeta, disclosures: [7] }), null)
})

test('card model is replay-pure and fails closed for blocked, malformed, and failed results', async () => {
  const client = await loadClient()
  assert.deepEqual(plain(client.marivoReportCardModel({ name: 'marivo_report_render' })), {
    state: 'running',
    summary: '正在生成 HTML 报告…',
    report: null,
  })

  const first = plain(client.marivoReportCardModel(settled()))
  const replay = plain(client.marivoReportCardModel(structuredClone(settled())))
  assert.deepEqual(first, {
    state: 'ready',
    summary: reportMeta.title,
    report: reportMeta,
  })
  assert.deepEqual(replay, first)

  const codeMode = settled({
    meta: undefined,
    content: [
      { type: 'text', text: 'HTML report ready' },
      { type: 'marivo-report-card', turn: 3, meta: reportMeta },
    ],
  })
  assert.deepEqual(plain(client.marivoReportCardModel(codeMode)), first)
  assert.deepEqual(plain(client.marivoReportCardModel(structuredClone(codeMode))), first)
  assert.equal(
    client.parseReportDurableContent([
      { type: 'marivo-report-card', turn: 3, meta: reportMeta, extra: true },
    ]),
    null,
  )
  assert.equal(
    client.parseReportDurableContent([
      { type: 'marivo-report-card', turn: 3, meta: reportMeta },
      { type: 'marivo-report-card', turn: 3, meta: reportMeta },
    ]),
    null,
  )
  assert.equal(
    client.parseReportDurableContent([{ type: 'marivo-report-card', turn: -1, meta: reportMeta }]),
    null,
  )

  assert.deepEqual(
    plain(
      client.marivoReportCardModel(
        settled({
          meta: null,
          content: [{ type: 'text', text: 'HTML report rendering is blocked at stage visual.' }],
        }),
      ),
    ),
    {
      state: 'fallback',
      summary: 'HTML report rendering is blocked at stage visual.',
      report: null,
    },
  )
  assert.equal(
    (
      plain(
        client.marivoReportCardModel(
          settled({
            meta: { ...reportMeta, version: 9 },
          }),
        ),
      ) as { state: string }
    ).state,
    'fallback',
  )
  assert.equal(
    (
      plain(
        client.marivoReportCardModel(
          settled({
            isError: true,
            content: [{ type: 'text', text: 'open failed' }],
          }),
        ),
      ) as { state: string }
    ).state,
    'fallback',
  )
})

test('turn delivery accepts native and Code Mode ready events and rejects unsafe variants', async () => {
  const client = await loadClient()
  const reportCalls = new Map([['report-call', 'marivo_report_render']])
  assert.deepEqual(plain(client.reportDeliveryFromEvent(nativeReportEvent(), reportCalls)), {
    seq: 20,
    report: reportMeta,
  })
  assert.deepEqual(plain(client.reportDeliveryFromEvent(nestedReportEvent())), {
    seq: 21,
    report: reportMeta,
  })
  assert.equal(client.reportDeliveryFromEvent(nativeReportEvent()), null)
  assert.equal(
    client.reportDeliveryFromEvent(
      nativeReportEvent(),
      new Map([['report-call', 'unrelated_tool']]),
    ),
    null,
  )
  assert.equal(
    client.reportDeliveryFromEvent(nativeReportEvent({ surfaceOp: 'replace' }), reportCalls),
    null,
  )
  assert.equal(
    client.reportDeliveryFromEvent(
      nativeReportEvent({
        data: { ...nativeReportEvent().data, meta: null },
      }),
      reportCalls,
    ),
    null,
  )
  assert.equal(
    client.reportDeliveryFromEvent(
      nativeReportEvent({
        data: {
          ...nativeReportEvent().data,
          message: {
            ...nativeReportEvent().data.message,
            content: [
              {
                ...nativeReportEvent().data.message.content[0],
                isError: true,
              },
            ],
          },
        },
      }),
      reportCalls,
    ),
    null,
  )
  assert.equal(
    client.reportDeliveryFromEvent(
      nestedReportEvent({
        data: { ...nestedReportEvent().data, isError: true },
      }),
    ),
    null,
  )
  assert.equal(
    client.reportDeliveryFromEvent(
      nestedReportEvent({
        data: { ...nestedReportEvent().data, name: 'other_tool' },
      }),
    ),
    null,
  )
  assert.equal(
    client.reportDeliveryFromEvent(
      nestedReportEvent({
        data: {
          ...nestedReportEvent().data,
          content: [
            { type: 'marivo-report-card', turn: 3, meta: reportMeta },
            { type: 'marivo-report-card', turn: 3, meta: reportMeta },
          ],
        },
      }),
    ),
    null,
  )
  assert.equal(
    client.reportDeliveryFromEvent(
      nestedReportEvent({
        data: {
          ...nestedReportEvent().data,
          content: [{ type: 'marivo-report-card', turn: '3', meta: reportMeta }],
        },
      }),
    ),
    null,
  )
})

test('turn delivery uses one fixed Harness key and the public get-only store contract', async () => {
  const client = await loadClient()
  const startEvent = { seq: 1, type: 'turn/start', data: { turn: 3 } }
  const callEvent = {
    seq: 10,
    type: 'tool/call',
    data: { turn: 3, step: 4, callId: 'report-call', name: 'marivo_report_render' },
  }
  assert.deepEqual(plain(client.marivoReportDeliveryDefinition.match(startEvent)), {
    id: '3',
    role: 'start',
  })
  assert.deepEqual(plain(client.marivoReportDeliveryDefinition.match(nativeReportEvent())), {
    id: '3',
    role: 'update',
  })
  assert.deepEqual(plain(client.marivoReportDeliveryDefinition.match(nestedReportEvent())), {
    id: '3',
    role: 'update',
  })
  const startMatch = {
    event: startEvent,
    location: { kind: 'step', turn: { turn: 3 } },
  }
  let state = client.marivoReportDeliveryDefinition.start({}, startMatch)
  state = client.marivoReportDeliveryDefinition.update(
    { state },
    { event: callEvent, location: startMatch.location },
  )
  state = client.marivoReportDeliveryDefinition.update(
    { state },
    { event: nativeReportEvent(), location: startMatch.location },
  )
  state = client.marivoReportDeliveryDefinition.update(
    { state },
    { event: nestedReportEvent(), location: startMatch.location },
  )
  const locationData = client.marivoReportDeliveryDefinition.buildLocationData(
    {
      state,
      start: startMatch,
      matches: [startMatch],
    },
    'turn',
  ) as any
  assert.deepEqual(plain(locationData), {
    kind: 'turn',
    turn: 3,
    key: 'marivo-report-delivery',
    value: {
      deliveries: [
        { seq: 20, report: reportMeta },
        { seq: 21, report: reportMeta },
      ],
    },
  })

  const second = {
    ...reportMeta,
    title: '修订报告',
    path: '/tmp/reports/revised/index.html',
    reportDigest: 'b'.repeat(64),
  }
  const published = {
    deliveries: [
      ...locationData.value.deliveries,
      { seq: 40, report: second },
      { seq: 'bad', report: second },
    ],
  }
  const reads: string[] = []
  const owner = {
    seq: 30,
    turn: {
      data: {
        // Harness currently has a private Map field with this name. Consumers
        // must use public get(); calling entries?.() would throw on the real store.
        entries: new Map([[locationData.key, published]]),
        get(key: string) {
          reads.push(key)
          return key === locationData.key ? published : undefined
        },
      },
    },
  }
  assert.deepEqual(plain(client.reportsForClosing(owner)), [reportMeta])
  assert.deepEqual(plain(client.selectMarivoReports(owner)), [reportMeta])
  assert.deepEqual(plain(client.reportsForClosing({ ...owner, seq: 50 })), [reportMeta, second])
  assert.equal(client.selectMarivoReports({ seq: 10, turn: owner.turn }), null)
  assert.deepEqual(reads, [
    'marivo-report-delivery',
    'marivo-report-delivery',
    'marivo-report-delivery',
    'marivo-report-delivery',
  ])
})

test('open action sends the exact path and rejects RPC, malformed, and thrown failures locally', async () => {
  const client = await loadClient()
  const calls: unknown[] = []
  await client.openMarivoReport(
    {
      host: {
        async openPath(payload: unknown) {
          calls.push(payload)
          return { result: { ok: true, value: { opened: true } } }
        },
      },
    },
    reportMeta.path,
  )
  assert.deepEqual(plain(calls), [{ path: reportMeta.path }])

  await assert.rejects(
    () =>
      client.openMarivoReport(
        {
          host: {
            async openPath() {
              return { result: { ok: false, error: { message: 'trust fence' } } }
            },
          },
        },
        reportMeta.path,
      ),
    /trust fence/,
  )
  await assert.rejects(
    () =>
      client.openMarivoReport(
        {
          host: {
            async openPath() {
              return { result: { ok: true, value: { opened: false } } }
            },
          },
        },
        reportMeta.path,
      ),
    /无效/,
  )
  await assert.rejects(
    () =>
      client.openMarivoReport(
        {
          host: {
            async openPath() {
              throw new Error('opener unavailable')
            },
          },
        },
        reportMeta.path,
      ),
    /opener unavailable/,
  )
  assert.deepEqual(reportMeta, {
    kind: 'marivo-html-report',
    version: 1,
    title: '支付分析报告',
    path: '/tmp/reports/report/index.html',
    reportDigest: 'a'.repeat(64),
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
          return new Promise((resolve) => {
            settle = resolve
          })
        },
      },
    },
  }
  const props = { callId: 'report-call', block: settled(), connection }
  let tree = harness.render(client.MarivoReportToolView, props)
  let button = findElement(tree, (element) => element.type === 'Button')
  assert.ok(button)
  assert.equal(button.props.disabled, false)
  button.props.onClick()

  tree = harness.render(client.MarivoReportToolView, props)
  button = findElement(tree, (element) => element.type === 'Button')
  assert.ok(button)
  assert.equal(button.props.disabled, true)
  assert.equal(button.props.children, '正在打开…')
  assert.deepEqual(plain(calls), [{ path: reportMeta.path }])

  assert.ok(settle)
  settle({ result: { ok: false, error: { message: 'trust fence rejected' } } })
  await new Promise((resolve) => setImmediate(resolve))
  tree = harness.render(client.MarivoReportToolView, props)
  const alert = findElement(tree, (element) => element.props?.role === 'alert')
  assert.ok(alert)
  assert.equal(alert.props.children, 'trust fence rejected')
  assert.deepEqual((props.block as { meta: unknown }).meta, reportMeta)
})

test('blocked report result is a collapsed diagnostic rather than an available report card', async () => {
  const harness = new HookHarness()
  const client = await loadClient({
    react: harness.react,
    jsxRuntime: harness.jsxRuntime,
    primitives: { Button: 'Button', Modal: 'Modal' },
  })
  const message = 'HTML report rendering is blocked after best-effort preflight.'
  const tree = harness.render(client.MarivoReportToolView, {
    callId: 'blocked-report-call',
    block: settled({
      meta: null,
      content: [{ type: 'text', text: message }],
    }),
    connection: { api: {} },
  })

  assert.equal(tree.type, 'details')
  assert.equal(tree.props['data-marivo-report-diagnostic'], 'blocked-report-call')
  assert.equal(tree.props.open, undefined)
  const summary = findElement(tree, (element) => element.type === 'summary')
  assert.ok(summary)
  assert.equal(summary.props.children, '报告未生成')
  const diagnostic = findElement(tree, (element) => element.type === 'pre')
  assert.ok(diagnostic)
  assert.equal(diagnostic.props.children, message)
  assert.equal(
    findElement(tree, (element) => element.type === 'Button'),
    null,
  )
  assert.equal(
    findElement(tree, (element) => element.props?.['data-marivo-report-call'] !== undefined),
    null,
  )
})

test('turn-tail report delivery shows the full path and opens that exact Host target', async () => {
  const client = await loadClient({
    primitives: { Button: 'Button', Modal: 'Modal' },
    jsxRuntime: {
      Fragment: 'Fragment',
      jsx: (type: unknown, props: Record<string, unknown>) => ({ type, props }),
      jsxs: (type: unknown, props: Record<string, unknown>) => ({ type, props }),
    },
  })
  const opened: string[] = []
  const tree = client.MarivoReportTurnDelivery({
    matched: [reportMeta],
    openFile: (path: string) => {
      opened.push(path)
    },
  })
  const button = findElement(tree, (element) => element.type === 'Button')
  assert.ok(button)
  assert.equal(button.props.children, '打开报告')
  button.props.onClick()
  assert.deepEqual(opened, [reportMeta.path])
  const path = findElement(tree, (element) => element.type === 'p')
  assert.ok(path)
  assert.equal(path.props.children, reportMeta.path)
})

test('client registers report and credential Tool Views beside on-demand source UI', async () => {
  const client = await loadClient()
  const definitions: unknown[] = []
  const slots: Array<{ options: any; component: unknown }> = []
  const ctx = {
    get(name: string) {
      assert.equal(name, 'connection')
      return { api: {} }
    },
    conversationEvents: {
      register(value: unknown) {
        definitions.push(value)
      },
    },
    effect(install: () => unknown) {
      install()
    },
    locale: {
      register() {
        return () => {}
      },
    },
    slots: {
      inject(_name: string, install: () => unknown) {
        install()
      },
      register(options: unknown, component: unknown) {
        slots.push({ options, component })
        return () => {}
      },
    },
  }
  client.apply(ctx)
  assert.deepEqual(
    slots.map((item) => item.options.key ?? item.options.name),
    [
      'marivo_test',
      'marivo_report_render',
      'conversation.chat.turnTail',
      'conversation.chat.turnTail',
    ],
  )
  assert.equal(definitions.length, 2)
})
