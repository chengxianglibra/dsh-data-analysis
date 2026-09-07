// @ts-nocheck -- Execute browser-only JSX installers against the public slot prop boundary.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { build } from 'esbuild'
import { Children, isValidElement } from 'react'
import { snapshot } from './fixtures.ts'

const result = await build({
  stdin: {
    contents: `export { installSemanticBrowser } from './semantic-browser/install.tsx';
export { installCredentials } from './credentials/install.tsx';`,
    resolveDir: fileURLToPath(new URL('../../src/client/', import.meta.url)),
  },
  bundle: true,
  format: 'cjs',
  platform: 'node',
  packages: 'external',
  jsx: 'automatic',
  write: false,
})
const module = { exports: {} }
vm.runInNewContext(result.outputFiles[0].text, {
  module,
  exports: module.exports,
  require: createRequire(import.meta.url),
  AbortController,
  setTimeout,
  clearTimeout,
})

function setup(t) {
  const seats = [],
    calls = [],
    disposers = []
  const ctx = {
    effect(install) {
      disposers.push(install())
    },
    on() {},
    slots: {
      inject(_name, install) {
        install()
      },
      register(options, component) {
        seats.push({ ...options, component })
        return () => {}
      },
    },
  }
  const rpc = {
    async call(channel, endpoint, payload, signal) {
      calls.push({ channel, endpoint, payload, signal })
      return {
        ok: true,
        value:
          endpoint === 'overview'
            ? { generation: 'fixture', datasources: [] }
            : snapshot(payload.workspaceId),
      }
    },
  }
  module.exports.installSemanticBrowser(ctx, rpc)
  module.exports.installCredentials(ctx, rpc)
  t.after(() => {
    for (const dispose of disposers) dispose?.()
  })
  const workspaces = [
    { workspaceId: 'workspace-a', sessionIds: ['session-a'] },
    { workspaceId: 'workspace-b', sessionIds: ['session-b'] },
  ]
  function render(id, sessionId, items = workspaces) {
    const seat = seats.find((entry) => entry.id === id && entry.name.endsWith('.actions'))
    const props = {
      sessionId,
      useWorkspaces: (selector) => selector({ items, state: 'idle', phase: 'ready' }),
      useSessions: (selector) => selector({ current: 'session-a' }),
    }
    return findButton(seat.component(props))
  }
  return { seats, calls, render }
}
function findButton(node) {
  for (const child of Children.toArray(node)) {
    if (!isValidElement(child)) continue
    if (child.type === 'button') return child
    const found = findButton(
      typeof child.type === 'function' ? child.type(child.props) : child.props.children,
    )
    if (found) return found
  }
  return undefined
}

test('management entries only occupy the session header and address its Workspace, not global selection', async (t) => {
  const f = setup(t)
  assert.equal(f.seats.filter((entry) => entry.name === 'sidebar.footer.action').length, 0)
  const header = f.seats.filter((entry) => entry.name === 'conversation.session.header.actions')
  assert.deepEqual(
    header.sort((a, b) => a.order - b.order).map((entry) => entry.id),
    ['marivo-semantic-browser', 'marivo-credentials', 'marivo-credential-requests'],
  )
  for (const id of ['marivo-semantic-browser', 'marivo-credentials']) {
    const button = f.render(id, 'session-b')
    assert.equal(button.props.disabled, false)
    button.props.onClick()
    assert.equal(f.calls.at(-1).payload.workspaceId, 'workspace-b')
    f.render(id, 'session-a').props.onClick()
    assert.equal(f.calls.at(-1).payload.workspaceId, 'workspace-a')
  }
  await new Promise((resolve) => setImmediate(resolve))
})

test('unbound and removed session Workspaces disable both entries without reading a different project', (t) => {
  const f = setup(t)
  for (const id of ['marivo-semantic-browser', 'marivo-credentials']) {
    for (const button of [f.render(id, 'unbound'), f.render(id, 'session-b', [])]) {
      assert.equal(button.props.disabled, true)
      assert.match(button.props.title, /Workspace|工作区/)
      assert.match(button.props['aria-label'], /^打开/)
      button.props.onClick()
    }
  }
  assert.equal(f.calls.length, 0)
})
