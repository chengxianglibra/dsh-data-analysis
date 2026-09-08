import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import test, { type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { build } from 'esbuild'
import * as React from 'react'
import { MarivoDatasourceBridge } from '../../src/datasource/bridge.ts'
import {
  MARIVO_DATASOURCE_DESCRIBE_PROGRAM,
  MARIVO_DATASOURCE_INVENTORY_PROGRAM,
} from '../../src/datasource/bridge-programs.ts'
import type { CredentialContextView } from '../../src/datasource/service.ts'
import type { MarivoCheckedRunner } from '../../src/environment/types.ts'
import { context, fixture } from './fixtures.ts'

const properties: Record<string, JsonValue> = {
  host: 'warehouse.example',
  port: 80,
  database: 'analytics',
  secure: false,
  settings: { max_threads: 2, tags: ['daily', null, true], comment: '<script>alert(1)</script>' },
  empty: '',
  optional: null,
  long_field_name_that_must_wrap_on_a_narrow_screen: 'long-value-'.repeat(32),
}
const description = {
  name: 'warehouse',
  backend: 'clickhouse',
  properties,
  refs: ['DB_PASSWORD'],
  fields: { password: 'DB_PASSWORD' },
  definition: 'd'.repeat(64),
}

function bridge(stdout: unknown) {
  const f = fixture()
  return new MarivoDatasourceBridge({
    binding: f.bridge.binding,
    status: 'ready',
    async runChecked() {
      return {
        exitCode: 0,
        signal: null,
        stdout: Buffer.from(typeof stdout === 'string' ? stdout : JSON.stringify(stdout)),
        stderr: Buffer.alloc(0),
        durationMs: 1,
      }
    },
  } satisfies MarivoCheckedRunner)
}

test('describe and inventory programs project the public literal fields independently of credential references', async () => {
  const setup = String.raw`
import json, sys, types
payload = json.load(sys.stdin)
marivo = types.ModuleType("marivo")
marivo.__path__ = []
md = types.ModuleType("marivo.datasource")
description = types.SimpleNamespace(name=payload["name"], backend_type=payload["backend"],
    literal_fields=payload["properties"], env_refs=payload["fields"])
md.describe = lambda name: description
md.list = lambda: [description]
sys.modules["marivo"] = marivo
sys.modules["marivo.datasource"] = md
sys.argv = ["fixture", description.name]
`
  for (const program of [MARIVO_DATASOURCE_DESCRIBE_PROGRAM, MARIVO_DATASOURCE_INVENTORY_PROGRAM]) {
    const result = spawnSync('python3', ['-I', '-c', `${setup}\n${program}`], {
      input: JSON.stringify(description),
      encoding: 'utf8',
      env: { ...process.env, DB_PASSWORD: 'environment-secret-canary' },
    })
    assert.equal(result.status, 0, result.stderr)
    assert.doesNotMatch(result.stdout, /environment-secret-canary/)
    const projected =
      program === MARIVO_DATASOURCE_DESCRIBE_PROGRAM
        ? await bridge(result.stdout).describe('warehouse')
        : (await bridge(result.stdout).inventory())[0]!
    assert.deepEqual(projected.properties, properties)
    assert.equal(projected.backend, 'clickhouse')
    assert.deepEqual(projected.fields, { password: 'DB_PASSWORD' })
    assert.deepEqual(projected.refs, ['DB_PASSWORD'])
    assert.match(projected.definition, /^[a-f0-9]{64}$/)
  }
})

test('description parsing requires complete backend and JSON object properties', async () => {
  assert.deepEqual(await bridge(description).describe('warehouse'), description)
  for (const invalid of [
    { ...description, backend: '' },
    { ...description, backend: false },
    { ...description, properties: null },
    { ...description, properties: [] },
    { ...description, properties: 'unsafe shape' },
    { ...description, additional: true },
    Object.fromEntries(Object.entries(description).filter(([key]) => key !== 'properties')),
    Object.fromEntries(Object.entries(description).filter(([key]) => key !== 'backend')),
    JSON.stringify(description).replace('"port":80', '"port":1e999'),
  ]) {
    await assert.rejects(bridge(invalid).describe('warehouse'), /returned invalid fields|shape/)
  }
})

test('overview exposes datasource configuration without resolving Harness credential values', async (t) => {
  const f = fixture()
  t.after(() => f.service.close())
  Object.assign(f.description, description)
  f.store.put('DB_PASSWORD', 'harness-private-canary')
  const view = await context(f)
  assert.equal(view.backend, 'clickhouse')
  assert.deepEqual(view.properties, properties)
  assert.deepEqual(view.fields, { password: 'DB_PASSWORD' })
  assert.equal(view.credentials.DB_PASSWORD?.configured, true)
  assert.deepEqual(f.store.calls, { resolve: 0, set: 0, unset: 0 })
  assert.equal(f.tests, 0)
  assert.doesNotMatch(JSON.stringify(view), /harness-private-canary/)
})

const require = createRequire(import.meta.url)
const { renderToStaticMarkup } = require('react-dom/server') as {
  renderToStaticMarkup(node: React.ReactNode): string
}
const bundle = await build({
  entryPoints: [
    fileURLToPath(new URL('../../src/client/credentials/install.tsx', import.meta.url)),
  ],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  packages: 'external',
  jsx: 'automatic',
  write: false,
})
const module = { exports: {} as { installCredentials: (ctx: any, rpc: any) => void } }
vm.runInNewContext(bundle.outputFiles[0]!.text, {
  module,
  exports: module.exports,
  require: (name: string) =>
    name === 'react'
      ? {
          ...React,
          useSyncExternalStore: (subscribe: any, getSnapshot: () => unknown) =>
            React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot),
        }
      : require(name),
  AbortController,
  setTimeout,
  clearTimeout,
})

async function renderManagement(t: TestContext, view: CredentialContextView) {
  const seats: { name: string; id: string; component: (props: any) => React.ReactElement<any> }[] =
    []
  module.exports.installCredentials(
    {
      effect: (install: () => () => void) => t.after(install()),
      on() {},
      slots: {
        inject: (_name: string, install: () => void) => install(),
        register: (options: any, component: any) => {
          seats.push({ ...options, component })
          return () => {}
        },
      },
    },
    {
      async call(_channel: string, endpoint: string) {
        assert.equal(endpoint, 'overview')
        return { ok: true, value: { generation: 'fixture', datasources: [view] } }
      },
    },
  )
  const props = {
    sessionId: 'session',
    useSessions: (select: any) => select({ current: 'session' }),
    useWorkspaces: (select: any) =>
      select({ items: [{ workspaceId: 'workspace', sessionIds: ['session'] }] }),
  }
  const entry = seats.find(
    (seat) => seat.id === 'marivo-credentials' && seat.name.endsWith('.actions'),
  )!
  entry.component(props).props.onClick()
  await new Promise<void>((resolve) => setImmediate(resolve))
  const overlay = seats.find((seat) => seat.name === 'shell.overlay')!
  return renderToStaticMarkup(React.createElement(overlay.component, props))
}

test('installed management UI renders typed properties as read-only text beside credential controls', async (t) => {
  const f = fixture()
  t.after(() => f.service.close())
  Object.assign(f.description, description)
  f.store.put('DB_PASSWORD', 'harness-private-canary')
  const html = await renderManagement(t, await context(f))
  const attributes = html.match(/<section class="mc-properties".*?<\/dl><\/section>/s)?.[0]
  assert(attributes)
  assert.match(attributes, /aria-label="数据源属性"/)
  for (const text of [
    'clickhouse',
    'warehouse.example',
    'analytics',
    'false',
    'null',
    '&quot;&quot;',
  ])
    assert(attributes.includes(text), `configuration must display ${text}`)
  assert.match(attributes, /<dt>port<\/dt><dd><span>80<\/span>/)
  assert.match(attributes, /&quot;max_threads&quot;: 2/)
  assert.match(attributes, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert(
    attributes.includes(properties.long_field_name_that_must_wrap_on_a_narrow_screen as string),
  )
  assert.doesNotMatch(attributes, /<input|<button|DB_PASSWORD|<script>/)
  assert.match(html, />凭证<\/h4>/)
  assert.match(html, /DB_PASSWORD/)
  assert.match(html, />更换<\/button>/)
  assert.doesNotMatch(html, /harness-private-canary/)
})

test('credential-free datasources retain properties and connection testing', async (t) => {
  const f = fixture()
  t.after(() => f.service.close())
  Object.assign(f.description, {
    backend: 'duckdb',
    properties: { path: ':memory:' },
    refs: [],
    fields: {},
  })
  const html = await renderManagement(t, await context(f))
  assert.match(html, /<dd>duckdb<\/dd>/)
  assert.match(html, /:memory:/)
  assert.match(html, /该数据源没有凭证引用，可直接测试连接/)
  assert.match(html, />测试连接<\/button>/)
  assert.deepEqual(f.store.calls, { resolve: 0, set: 0, unset: 0 })
})
