import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

interface ClientExports {
  parseEvidenceSourcesMeta(value: unknown): unknown
  parseEvidenceSourcesDurableContent(value: unknown): unknown
  evidenceSourcesDeliveryFromEvent(event: unknown, calls?: ReadonlyMap<string, string>): unknown
  marivoEvidenceSourcesDeliveryDefinition: any
  evidenceSourcesForClosing(owner: unknown): unknown[]
  selectMarivoEvidenceSources(owner: unknown): unknown[] | null
  groupMarivoEvidenceSources(sources: unknown[]): unknown[]
  MarivoEvidenceSourcesPanel(props: {
    matched: unknown[]
    t: (key: string, values?: Record<string, string>) => string
  }): ElementNode
  apply(ctx: unknown): void
}

interface ElementNode {
  type: unknown
  props: Record<string, unknown> & { children?: unknown }
}

async function loadClient(): Promise<ClientExports> {
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
    if (id === 'react/jsx-runtime') {
      const render = (type: unknown, props: ElementNode['props']): ElementNode => ({ type, props })
      return { Fragment: Symbol('Fragment'), jsx: render, jsxs: render }
    }
    if (id === 'react')
      return {
        useEffect() {},
        useMemo: (factory: () => unknown) => factory(),
        useState() {},
      }
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return { Button() {}, Modal() {} }
    throw new Error(`unexpected client module request: ${id}`)
  })
}

function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function textContent(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(textContent).join(' ')
  if (typeof value !== 'object' || value === null) return ''
  return textContent((value as ElementNode).props?.children)
}

function elements(value: unknown, type: unknown): ElementNode[] {
  if (Array.isArray(value)) return value.flatMap((item) => elements(item, type))
  if (typeof value !== 'object' || value === null) return []
  const element = value as ElementNode
  return [...(element.type === type ? [element] : []), ...elements(element.props?.children, type)]
}

function source(
  findingId: string,
  artifactRef = 'artifact-a',
  overrides: Record<string, unknown> = {},
) {
  return {
    status: 'available',
    title: `metric_value Finding: item-${findingId}`,
    locator: `marivo://session/mv-session/artifact/${artifactRef}/finding/${findingId}`,
    excerpt: `Metric ${findingId}: observed 12.`,
    truncated: false,
    environmentFingerprint: 'a'.repeat(64),
    sessionId: 'mv-session',
    findingId,
    findingType: 'metric_value',
    epistemicKind: 'observed',
    artifactRef,
    canonicalItemKey: `item-${findingId}`,
    committedAt: '2026-08-26T00:00:00+00:00',
    sourceRefs: [`${artifactRef}#row=0`],
    revalidation: {
      status: 'admissible',
      semanticStatus: 'current',
      evidenceStatus: 'complete',
      dependencyStatus: 'admissible',
    },
    ...overrides,
  }
}

function meta(sources: unknown[], dshSessionId = 'dsh-session') {
  return { kind: 'marivo-evidence-sources', version: 2, dshSessionId, sources }
}

function nativeEvent(sources: unknown[], seq = 20) {
  return {
    seq,
    type: 'tool/result',
    surfaceOp: 'append',
    data: {
      turn: 3,
      step: 4,
      meta: meta(sources),
      message: {
        source: { kind: 'tool', callId: 'sources-call' },
        content: [
          {
            type: 'tool-result',
            toolCallId: 'sources-call',
            isError: false,
            content: [{ type: 'text', text: 'sources attached' }],
          },
        ],
      },
    },
  }
}

function nestedEvent(sources: unknown[], seq = 21) {
  return {
    seq,
    type: 'tool/code-dispatch',
    data: {
      name: 'marivo_evidence_sources',
      isError: false,
      content: [
        { type: 'text', text: 'sources attached' },
        { type: 'marivo-evidence-sources-card', turn: 3, meta: meta(sources) },
      ],
    },
  }
}

test('source metadata is closed, bounded, detached, and rejects unsupported versions', async () => {
  const client = await loadClient()
  const value = meta([source('finding-a')])
  const parsed = client.parseEvidenceSourcesMeta(value)
  assert.deepEqual(plain(parsed), value)
  assert.equal(Object.isFrozen(parsed), true)
  assert.equal(Object.isFrozen((parsed as any).sources), true)
  assert.notEqual((parsed as any).sources, value.sources)

  assert.equal(client.parseEvidenceSourcesMeta({ ...value, extra: true }), null)
  assert.equal(client.parseEvidenceSourcesMeta({ ...value, version: 999 }), null)
  assert.equal(client.parseEvidenceSourcesMeta(meta([])), null)
  assert.equal(client.parseEvidenceSourcesMeta(meta([source('a'), source('a')])), null)
  assert.equal(
    client.parseEvidenceSourcesMeta(meta([{ ...source('a'), marker: '[^mv-f1]' }])),
    null,
  )
  assert.equal(
    client.parseEvidenceSourcesMeta({
      kind: 'unsupported-source-attachment',
      version: 999,
      dshSessionId: 'dsh-session',
      registry: [],
    }),
    null,
  )
})

test('native and Code Mode source deliveries require exact successful contracts', async () => {
  const client = await loadClient()
  const calls = new Map([['sources-call', 'marivo_evidence_sources']])
  assert.deepEqual(
    plain(client.evidenceSourcesDeliveryFromEvent(nativeEvent([source('a')]), calls)),
    {
      seq: 20,
      sources: [source('a')],
    },
  )
  assert.deepEqual(plain(client.evidenceSourcesDeliveryFromEvent(nestedEvent([source('b')]))), {
    seq: 21,
    sources: [source('b')],
  })
  assert.equal(client.evidenceSourcesDeliveryFromEvent(nativeEvent([source('a')])), null)
  assert.equal(
    client.evidenceSourcesDeliveryFromEvent(
      { ...nativeEvent([source('a')]), surfaceOp: { op: 'replace' } },
      calls,
    ),
    null,
  )
  assert.equal(
    client.evidenceSourcesDeliveryFromEvent({
      ...nestedEvent([source('b')]),
      data: { ...nestedEvent([source('b')]).data, isError: true },
    }),
    null,
  )
})

test('Turn projection deduplicates identities and respects closing sequence', async () => {
  const client = await loadClient()
  const start = { seq: 1, type: 'turn/start', data: { turn: 3 } }
  const call = {
    seq: 10,
    type: 'tool/call',
    data: { turn: 3, callId: 'sources-call', name: 'marivo_evidence_sources' },
  }
  let state = client.marivoEvidenceSourcesDeliveryDefinition.start({}, { event: start })
  state = client.marivoEvidenceSourcesDeliveryDefinition.update({ state }, { event: call })
  state = client.marivoEvidenceSourcesDeliveryDefinition.update(
    { state },
    { event: nativeEvent([source('a'), source('b')], 20) },
  )
  state = client.marivoEvidenceSourcesDeliveryDefinition.update(
    { state },
    { event: nestedEvent([source('b'), source('c', 'artifact-b')], 30) },
  )
  const location = client.marivoEvidenceSourcesDeliveryDefinition.buildLocationData(
    { state },
    'turn',
  )
  const turn = {
    data: { get: (key: string) => (key === location.key ? location.value : undefined) },
  }
  assert.deepEqual(plain(client.evidenceSourcesForClosing({ seq: 25, turn })), [
    source('a'),
    source('b'),
  ])
  assert.deepEqual(plain(client.selectMarivoEvidenceSources({ seq: 40, turn })), [
    source('a'),
    source('b'),
    source('c', 'artifact-b'),
  ])
  assert.equal(client.selectMarivoEvidenceSources({ seq: 19, turn }), null)
  assert.equal(
    client.selectMarivoEvidenceSources({ seq: 40, turn: { data: { get: () => undefined } } }),
    null,
  )
})

test('panel is collapsed, groups by Artifact identity, and nests facts and machine metadata', async () => {
  const client = await loadClient()
  const sources = [
    source('a'),
    source('b', 'artifact-a', { status: 'unsupported', excerpt: null }),
    source('c', 'artifact-b', { committedAt: '2026-08-27T00:00:00+00:00' }),
  ]
  assert.equal(client.groupMarivoEvidenceSources(sources).length, 2)
  const dictionary: Record<string, string> = {
    'source.language': 'zh',
    'source.title': '数据来源',
    'source.summary': '{artifacts} 个分析结果 · {findings} 条 Evidence',
    'source.artifact': '分析结果 {index}',
    'source.findings': '{count} 条 Evidence',
    'source.status': '状态：{value}',
    'source.revalidation': '重新验证：{value}',
    'source.excerptState': '摘录：{value}',
    'source.complete': '完整',
    'source.truncated': '已截断',
    'source.unavailable': '不可用',
    'source.finding': 'Finding {id}',
    'source.artifactRef': 'Artifact {id}',
    'source.session': 'Marivo Session {id}',
    'source.committed': '提交 {committedAt}',
    'source.audit': '审计详情',
    'source.item': 'canonical item: {id}',
    'source.locator': '定位：{value}',
    'source.refs': '来源引用：{value}',
    'source.environment': 'Environment {fingerprint}',
    'source.disclaimer': '身份说明',
  }
  const tree = client.MarivoEvidenceSourcesPanel({
    matched: sources,
    t(key, values) {
      let result = dictionary[key] ?? key
      for (const [name, value] of Object.entries(values ?? {})) {
        result = result.replace(`{${name}}`, value)
      }
      return result
    },
  })
  assert.equal(tree.type, 'details')
  assert.equal(Object.hasOwn(tree.props, 'open'), false)
  const details = elements(tree, 'details')
  assert.equal(details.length, 3, 'one panel plus one nested audit per Artifact')
  const text = textContent(tree)
  assert.match(text, /数据来源.*2 个分析结果 · 3 条 Evidence/)
  assert.match(text, /状态：available/)
  assert.match(text, /状态：unsupported/)
  assert.match(text, /Metric a: observed 12./)
  assert.match(text, /Artifact artifact-a/)
  assert.match(text, /Finding a/)
})

test('client registers only source delivery projection with one source turn tail', async () => {
  const client = await loadClient()
  const definitions: any[] = []
  const slots: any[] = []
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
    definitions.map((item) => item.kind),
    ['marivo-evidence-sources-delivery'],
  )
  assert.equal(slots.length, 2)
  assert.equal(slots[1].options.name, 'conversation.chat.turnTail')
  assert.equal(typeof slots[1].options.select, 'function')
})
