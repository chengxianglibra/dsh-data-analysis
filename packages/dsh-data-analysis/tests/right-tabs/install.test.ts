// @ts-nocheck -- Run the packaged public client against the registry replay boundary.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TabPage } from '../../src/client/right-tabs/page.ts'
import { createHostChatFixture } from '../presentation-integration/host-client-fixture.ts'

// This registry replay fixture never mounts the global Session overlay.
const remote = {
  $mount: async () => () => {},
  $stream() {
    throw new Error('Unexpected stream')
  },
}

const store = (value) => {
  const listeners = new Set()
  return {
    getSnapshot: () => value,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(next) {
      value = next
      for (const listener of listeners) listener()
    },
    listenerCount: () => listeners.size,
  }
}

test('default client is a valid Cordis effect and registers native resources without enabling audit', async (t) => {
  const host = await createHostChatFixture(['native'])
  t.after(() => host.dispose())
  const definitions = []
  Object.assign(host.client, {
    remote,
    connection: {
      rpc: {
        call() {
          throw new Error('Installation must not read data')
        },
      },
      generation: store({}),
    },
    sessions: { list: store({ current: undefined }), binding: () => undefined },
    workspaces: { list: store({ phase: 'ready', state: 'idle', items: [] }) },
    sidebarRight: {},
    sidebarRightTabs: {
      register(definition) {
        definitions.push(definition)
        return () => {}
      },
    },
    inputTriggers: { registerSource: () => () => {} },
  })
  host.slots.register(
    {
      name: 'shell.overlay',
      id: 'locale-test',
      children: {
        'sidebar.right.pane.tab.title': { kind: 'keyed', scope: 'session' },
      },
    },
    () => null,
  )
  let controller: any
  const result = host.presentation.apply(host.client, {
    onInstalled(value) {
      controller = value
    },
  })
  assert.equal(result, undefined, 'Cordis rejects arbitrary object effect return values')
  const directoryTitles = [
    ['marivo-datasources', '数据源与凭证', 'Datasources and credentials'],
    ['marivo-semantic', '语义层', 'Semantic layer'],
    ['marivo-reports', '报告', 'Reports'],
  ]
  for (const [kind, zh, en] of directoryTitles) {
    const definition = definitions.find((entry) => entry.kind === kind)
    host.client.locale.setLocale('zh')
    const captured = definition.title()
    const entry = host.slots
      .entries('sidebar.right.pane.tab.title')
      .find((entry) => entry.options.key === definition.id)
    assert.ok(entry, 'Directory tabs need a title slot; Harness caches the opening title')
    assert.equal(renderToStaticMarkup(createElement(entry.component)), '<span>' + zh + '</span>')
    host.client.locale.setLocale('en')
    assert.equal(renderToStaticMarkup(createElement(entry.component)), '<span>' + en + '</span>')
    assert.equal(captured, zh, 'The original tab title remains unchanged in Harness state')
  }
  assert.equal(definitions.length, 5)
  assert.ok(definitions.some((d) => d.kind === 'marivo-reports'))
  const reports = definitions.find((d) => d.kind === 'marivo-report-resource')
  assert.equal(reports.canOpen('dsh-resource://file/workspace/file.txt'), false)
  assert.equal(reports.canOpen('dsh-resource://marivo-report/workspace/report/current'), true)
  assert.equal(reports.title('dsh-resource://marivo-report/workspace/report/current'), 'report · …')
  assert.equal(
    reports.title('dsh-resource://marivo-report/workspace/report/build/123456789'),
    'report · 12345678',
  )
  assert.equal(controller.pages.size, 0)
  assert.equal(controller.audit.opens.length, 0)
  assert.equal(controller.audit.changes.length, 0)
})

async function installed(t) {
  const host = await createHostChatFixture(['native'])
  t.after(() => host.dispose())
  const workspace = { workspaceId: 'w', path: '/w', sessionIds: ['a', 'b', 'cold'] }
  const workspaces = store({ phase: 'ready', state: 'idle', items: [workspace] })
  const sessions = store({ current: 'a' })
  const generation = store({})
  const bindings = Object.fromEntries(
    workspace.sessionIds.map((id) => [
      id,
      {
        session: store({
          openState: id === 'cold' ? 'cold' : 'open',
          running: false,
          removed: false,
        }),
        eventSource: store({ revision: 0, entries: [], change: { kind: 'replace', entries: [] } }),
      },
    ]),
  )
  const reads = [],
    opens = []
  const rpc = {
    async call(_channel, endpoint, payload) {
      reads.push({ endpoint, workspaceId: payload.workspaceId })
      return {
        ok: true,
        value: {
          generation: 'g',
          datasources: [
            {
              token: 'd',
              name: 'datasource',
              workspaceId: 'w',
              refs: [],
              credentials: {},
              fields: {},
              properties: {},
            },
          ],
        },
      }
    },
  }
  Object.assign(host.client, {
    remote,
    connection: { rpc, generation },
    sessions: { list: sessions, binding: (id) => bindings[id] },
    workspaces: { list: workspaces },
    sidebarRight: { openResource: (address) => opens.push(address) },
    sidebarRightTabs: { register: () => () => {} },
    inputTriggers: { registerSource: () => () => {} },
  })
  let controller: any
  host.presentation.apply(host.client, {
    onInstalled: (value) => {
      controller = value
    },
  })
  return {
    host,
    workspace,
    workspaces,
    sessions,
    bindings,
    rpc,
    reads,
    opens,
    controller,
    generation,
  }
}

test('credential requests open the owning native Tab; revoked pages cannot be refreshed', async (t) => {
  const f = await installed(t)
  const opened = []
  f.host.client.sidebarRight.openTab = (kind, options) => opened.push({ kind, options })
  const page = new TabPage('a', { kind: 'datasources', workspaceId: 'w' }, f.rpc)
  page.workspacePath = '/w'
  f.controller.pages.set('datasources', page)
  t.after(() => page.dispose())
  await page.navigate(1)
  const state = f.controller.credentials.getSnapshot()
  f.controller.credentials.syncRequests('a', {
    ...state,
    requests: [
      { id: 'request', sessionId: 'a', context: page.datasources.getSnapshot().datasources[0] },
    ],
  })
  f.controller.credentials.openRequest('request')
  assert.deepEqual(JSON.parse(JSON.stringify(opened)), [
    { kind: 'marivo-datasources', options: { params: { workspaceId: 'w', requestId: 'request' } } },
  ])
  assert.equal(f.controller.credentials.getSnapshot().open, false)
  assert.equal(page.datasources.getSnapshot().requests[0].id, 'request')
  f.workspaces.set({
    ...f.workspaces.getSnapshot(),
    items: [{ ...f.workspace, sessionIds: ['b'] }],
  })
  const error = page.getSnapshot().error
  assert.ok(error)
  const before = f.reads.length
  await page.refresh()
  assert.equal(f.reads.length, before)
  assert.equal(page.getSnapshot().error, error)
})

test('datasource refresh preserves in-flight operation queries; revocation aborts them', async (t) => {
  const f = await installed(t)
  let querySignal: AbortSignal | undefined
  let finish: (value: unknown) => void
  const page = new TabPage(
    'a',
    { kind: 'datasources', workspaceId: 'w' },
    {
      async call(channel, endpoint, payload, signal) {
        if (endpoint === 'start') return { ok: true, value: null }
        if (endpoint === 'operation') {
          querySignal = signal
          return new Promise((resolve) => {
            finish = resolve
          })
        }
        return f.rpc.call(channel, endpoint, payload, signal)
      },
    },
  )
  t.after(() => page.dispose())
  await page.navigate(1)
  const context = page.datasources.getSnapshot().datasources[0]
  const operation = page.datasources.start(context, 'test')
  await new Promise((resolve) => setImmediate(resolve))
  assert.ok(querySignal)
  await page.refresh()
  assert.equal(querySignal.aborted, false)
  assert.equal(page.datasources.getSnapshot().operations.length, 1)
  page.unavailable('revoked')
  assert.equal(querySignal.aborted, true)
  finish({ ok: true, value: null })
  await operation
  assert.equal(page.getSnapshot().error, 'revoked')
})

function deliveryEntries(id, buildId = 'build') {
  const receipt = {
    kind: 'marivo.presentation',
    schemaVersion: 2,
    workspaceId: 'w',
    reportId: 'report',
    buildId,
    title: 'Report',
    summary: 'saved',
    files: Object.fromEntries(
      [
        ['document', 'presentation.json'],
        ['html', 'index.html'],
      ].map(([key, asset]) => [
        key,
        {
          asset,
          path: `/w/.dsh-data-analysis/presentations/report/builds/${buildId}/${asset}`,
          bytes: 1,
          sha256: '0'.repeat(64),
        },
      ]),
    ),
  }
  return [
    { type: 'tool/call', seq: 1, data: { turn: 1, callId: 'call', name: 'marivo_present' } },
    {
      type: 'tool/result',
      seq: 2,
      surfaceOp: 'append',
      data: {
        turn: 1,
        meta: {
          kind: 'marivo.presentation.delivery',
          schemaVersion: 2,
          dshSessionId: id,
          turn: 1,
          receipt,
        },
        message: {
          source: { callId: 'call' },
          content: [{ type: 'tool-result', toolCallId: 'call', isError: false }],
        },
      },
    },
  ].map((event) => ({ type: 'event', event }))
}

test('background publication invalidates Workspace pages without opening and drains its subscriptions', async (t) => {
  const f = await installed(t),
    updates = []
  f.controller.pages.set('catalog', {
    target: { kind: 'reports', workspaceId: 'w' },
    sessionId: 'a',
    workspacePath: '/w',
    getSnapshot: () => ({}),
    publicationChanged: (...args) => updates.push(args),
    unavailable() {},
    dispose() {},
  })
  f.workspaces.set(f.workspaces.getSnapshot())
  const emit = (id, kind = 'append', build = 'build') => {
    const source = f.bindings[id].eventSource,
      entries = deliveryEntries(id, build)
    source.set({ revision: source.getSnapshot().revision + 1, entries, change: { kind, entries } })
  }
  emit('b')
  assert.equal(updates.length, 1)
  assert.equal(JSON.stringify(updates[0]), JSON.stringify(['w', 'report']))
  assert.equal(f.opens.length, 0)
  emit('b')
  emit('b', 'replace', 'history')
  emit('b', 'prepend', 'history')
  assert.equal(updates.length, 1, 'duplicates and replay cannot publish new delivery')
  f.sessions.set({ current: 'b' })
  assert.equal(f.opens.length, 0, 'selection does not queue a background open')
  emit('b', 'append', 'foreground')
  assert.equal(f.opens.length, 1)
  const beforeCold = updates.length
  const cold = f.bindings.cold.session
  cold.set({ ...cold.getSnapshot(), running: true })
  cold.set({ ...cold.getSnapshot(), running: false })
  assert.equal(updates.length, beforeCold + 1, 'cold run settlement checks Workspace publications')
  assert.equal(f.bindings.cold.session.getSnapshot().openState, 'cold')
  assert.equal(f.opens.length, 1)
  const catalog = f.controller.pages.get('catalog')
  f.controller.pages.delete('catalog')
  f.workspaces.set(f.workspaces.getSnapshot())
  assert.equal(f.bindings.a.eventSource.listenerCount(), 0)
  assert.equal(f.bindings.cold.eventSource.listenerCount(), 0)
  f.controller.pages.set('catalog', catalog)
  f.workspaces.set(f.workspaces.getSnapshot())
  f.bindings.b.session.set({ ...f.bindings.b.session.getSnapshot(), removed: true })
  assert.equal(f.bindings.b.eventSource.listenerCount(), 0)
  f.generation.set(undefined)
  for (const binding of Object.values(f.bindings))
    assert.equal(binding.eventSource.listenerCount(), 0)
  f.generation.set({})
  f.workspaces.set(f.workspaces.getSnapshot())
  assert.equal(f.opens.length, 1, 'reconnect only baselines existing windows')
  await f.host.dispose()
  for (const binding of Object.values(f.bindings)) {
    assert.equal(binding.eventSource.listenerCount(), 0)
    assert.equal(binding.session.listenerCount(), 0)
  }
})
