import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

interface ClientExports {
  parseMarivoFootnotes(text: string): { references: string[]; definitions: string[] }
  parseCitationRegistryMeta(value: unknown): unknown[] | null
  marivoCitationRegistryDefinition: any
  marivoAnswerCitationsDefinition: any
  selectMarivoCitations(owner: unknown): unknown[] | null
  apply(ctx: unknown): void
}

async function loadClient(): Promise<ClientExports> {
  const source = await readFile(new URL('../../lib/client.js', import.meta.url), 'utf8')
  let registration: { factory: (require: (id: string) => unknown) => ClientExports } | undefined
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load(value: typeof registration) { registration = value } } },
  })
  assert.ok(registration)
  return registration.factory((id) => {
    if (id === 'react/jsx-runtime') return { Fragment: Symbol('Fragment'), jsx() {}, jsxs() {} }
    if (id === 'react') return {
      useEffect() {}, useMemo: (factory: () => unknown) => factory(), useState() {},
    }
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return { Button() {}, Modal() {} }
    throw new Error(`unexpected client module request: ${id}`)
  })
}

function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function source(handle: string, findingId = `finding-${handle}`) {
  const marker = `[^mv-${handle.toLowerCase()}]`
  return {
    handle,
    marker,
    definition: `${marker}: Marivo Evidence ${handle}；Finding ${findingId}；Artifact artifact-${handle}；类型 metric_value；epistemic observed；quality ready；提交 2026-08-26T00:00:00+00:00。`,
    environmentFingerprint: 'a'.repeat(64),
    sessionId: 'mv-session',
    findingId,
    findingType: 'metric_value',
    epistemicKind: 'observed',
    artifactId: `artifact-${handle}`,
    canonicalItemKey: `item-${handle}`,
    qualityStatus: 'ready',
    committedAt: '2026-08-26T00:00:00+00:00',
    extractorVersion: 'v4',
    artifactSchemaVersion: 'v4',
  }
}

function meta(registry: unknown[], dshSessionId = 'dsh-session') {
  return { kind: 'marivo-evidence-citations', version: 1, dshSessionId, registry }
}

function assistant(seq: number, textBlocks: string[]) {
  return {
    seq,
    type: 'assistant/message',
    data: {
      turn: 3,
      step: 2,
      message: {
        id: `message-${seq}`,
        role: 'assistant',
        source: { kind: 'model', provider: 'mock', model: 'mock' },
        content: textBlocks.map(text => ({ type: 'text', text })),
      },
    },
  }
}

test('Markdown scanner finds ordered unique references and definitions', async () => {
  const client = await loadClient()
  const parsed = client.parseMarivoFootnotes([
    '收入增长 12%[^mv-f2]，利润增长 4%[^mv-f1]；再次引用[^mv-f2]。',
    '',
    '[^mv-f1]: first',
    '[^mv-f2]: second',
  ].join('\n'))
  assert.deepEqual(plain(parsed), {
    references: ['F2', 'F1'],
    definitions: ['F1', 'F2'],
  })
})

test('Markdown scanner ignores escaped tokens and inline or fenced code', async () => {
  const client = await loadClient()
  const parsed = client.parseMarivoFootnotes([
    String.raw`escaped \[^mv-f1] and inline ` + '`[^mv-f2]`',
    '```markdown',
    'inside fence [^mv-f3]',
    '[^mv-f3]: fenced definition',
    '```',
    'visible [^mv-f4]',
    '[^mv-f4]: visible definition',
  ].join('\n'))
  assert.deepEqual(plain(parsed), { references: ['F4'], definitions: ['F4'] })
  assert.deepEqual(
    plain(client.parseMarivoFootnotes('`multiline\n[^mv-f5] code` visible[^mv-f6]')),
    { references: ['F6'], definitions: [] },
  )
  assert.deepEqual(
    plain(client.parseMarivoFootnotes('unmatched ` then visible[^mv-f7]')),
    { references: ['F7'], definitions: [] },
  )
  assert.deepEqual(
    plain(client.parseMarivoFootnotes([
      '`multiline',
      '[^mv-f8]: definition inside code',
      '` visible[^mv-f8]',
    ].join('\n'))),
    { references: ['F8'], definitions: [] },
  )
})

test('registry metadata rejects malformed, duplicate, and out-of-range handles', async () => {
  const client = await loadClient()
  assert.deepEqual(plain(client.parseCitationRegistryMeta(meta([source('F1')]))), [source('F1')])
  assert.equal(client.parseCitationRegistryMeta(meta([source('F1'), source('F1')])), null)
  assert.equal(client.parseCitationRegistryMeta(meta([{ ...source('F1'), handle: 'F101' }])), null)
  assert.equal(client.parseCitationRegistryMeta({ ...meta([source('F1')]), dshSessionId: '' }), null)
  assert.equal(client.parseCitationRegistryMeta({ kind: 'other', version: 1, registry: [] }), null)
})

test('answer Definition resolves against the nearest complete registry and publishes Turn data', async () => {
  const client = await loadClient()
  const event = assistant(20, [
    '结论一[^mv-f1]，结论二[^mv-f2]。\n\n[^mv-f1]: first\n[^mv-f2]: second',
  ])
  assert.deepEqual(plain(client.marivoAnswerCitationsDefinition.match(event)), {
    id: 'message-20', role: 'start',
  })
  const state = client.marivoAnswerCitationsDefinition.start({}, { event }, {
    previous(kind: string) {
      assert.equal(kind, 'marivo-citation-registry')
      return { state: { registry: [source('F1'), source('F2')] } }
    },
  })
  assert.deepEqual(plain(state.citations), [
    { handle: 'F1', definitionPresent: true, source: source('F1') },
    { handle: 'F2', definitionPresent: true, source: source('F2') },
  ])
  const location = client.marivoAnswerCitationsDefinition.buildLocationData({ state }, 'turn')
  assert.equal(location.key, 'marivo-citations')
  assert.equal(location.key, client.marivoAnswerCitationsDefinition.kind)
  const owner = {
    seq: 20,
    turn: { data: { get: (key: string) => key === location.key ? location.value : undefined } },
  }
  assert.deepEqual(plain(client.selectMarivoCitations(owner)), plain(state.citations))
  assert.equal(client.selectMarivoCitations({ ...owner, seq: 21 }), null)
})

test('assistant Markdown is scanned per text block without cross-block definitions or fences', async () => {
  const client = await loadClient()
  const separateDefinition = assistant(25, [
    '结论[^mv-f1]',
    '[^mv-f1]: definition rendered in another Markdown document',
  ])
  const state = client.marivoAnswerCitationsDefinition.start({}, { event: separateDefinition }, {
    previous() { return { state: { registry: [source('F1')] } } },
  })
  assert.deepEqual(plain(state.citations), [
    { handle: 'F1', definitionPresent: false, source: source('F1') },
  ])

  const fencedThenVisible = assistant(26, [
    '```markdown\nunclosed code block',
    'visible[^mv-f1]\n\n[^mv-f1]: local definition',
  ])
  const fencedState = client.marivoAnswerCitationsDefinition.start({}, { event: fencedThenVisible }, {
    previous() { return { state: { registry: [source('F1')] } } },
  })
  assert.deepEqual(plain(fencedState.citations), [
    { handle: 'F1', definitionPresent: true, source: source('F1') },
  ])
})

test('unknown handles and missing definitions remain explicit warnings instead of guessed sources', async () => {
  const client = await loadClient()
  const event = assistant(30, ['known[^mv-f1] unknown[^mv-f9]\n[^mv-f9]: invented'])
  const state = client.marivoAnswerCitationsDefinition.start({}, { event }, {
    previous() { return { state: { registry: [source('F1')] } } },
  })
  assert.deepEqual(plain(state.citations), [
    { handle: 'F1', definitionPresent: false, source: source('F1') },
    { handle: 'F9', definitionPresent: true, source: null },
  ])
})

test('tool-calling assistant steps and answers without references produce no citation UI', async () => {
  const client = await loadClient()
  const toolCalling = assistant(40, ['draft[^mv-f1]'])
  toolCalling.data.message.content.push({ type: 'tool-call', id: 'call', name: 'x', arguments: '{}' } as never)
  assert.equal(client.marivoAnswerCitationsDefinition.match(toolCalling), null)
  assert.equal(client.marivoAnswerCitationsDefinition.match(assistant(41, ['plain answer'])), null)
  assert.equal(client.selectMarivoCitations({
    seq: 41,
    turn: { data: { get: () => undefined } },
  }), null)
})

test('client registers two replay Definitions and one selector-routed turn-tail entry', async () => {
  const client = await loadClient()
  const definitions: any[] = []
  const slots: any[] = []
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
  assert.deepEqual(definitions.map(item => item.kind), [
    'marivo-citation-registry', 'marivo-citations',
  ])
  assert.equal(slots.length, 2)
  assert.equal(slots[1].options.name, 'conversation.chat.turnTail')
  assert.equal(typeof slots[1].options.select, 'function')
})
