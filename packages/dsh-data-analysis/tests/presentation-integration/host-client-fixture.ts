// @ts-nocheck -- Browser bundles expose their public exports through the Host module table.
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'

const require = createRequire(import.meta.url)

/** Load unchanged installed Host bundles; no private exports or source rewriting. */
export async function createHostChatFixture(order = ['native', 'presentation']) {
  const modules = new Map()
  for (const name of [
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-client-ui-slots',
    'react',
    'react/jsx-runtime',
    'react-dom',
    'react-dom/client',
    '@deepseek-ai/dsh-client-store',
  ])
    modules.set(name, await import(require.resolve(name)))
  modules.set(
    '@deepseek-ai/dsh-client-ui-primitives',
    new Proxy(
      {},
      {
        get(_target, key) {
          throw new Error(`UI primitive is outside the registry replay fixture: ${String(key)}`)
        },
      },
    ),
  )
  const context = vm.createContext({
    window: {
      __ModuleLoader__: {
        load(entry) {
          const exports = entry.factory((name) => {
            if (!modules.has(name)) throw new Error(`Missing Host module: ${name}`)
            return modules.get(name)
          })
          modules.set(entry.id, exports)
          modules.set(`${entry.id}/client`, exports)
        },
      },
    },
    console,
    navigator: { languages: ['zh-CN'], language: 'zh-CN' },
    Map,
    Set,
    JSON,
    Object,
    Array,
    Number,
    Date,
    performance,
    TextEncoder,
    TextDecoder,
    AbortController,
    AbortSignal,
    setTimeout,
    clearTimeout,
    queueMicrotask,
  })
  for (const name of [
    'ui-renderer',
    'locale',
    'ui-conversation',
    'ui-chat',
    'ui-deliverables',
    'ui-input-trigger',
  ]) {
    const packageJson = require.resolve(`@deepseek-ai/dsh-client-${name}/package.json`)
    const filename = new URL('./lib/client.js', pathToFileURL(packageJson))
    vm.runInContext(await readFile(filename, 'utf8'), context, { filename: filename.pathname })
  }
  const filename = new URL('../../lib/client.js', import.meta.url)
  vm.runInContext(await readFile(filename, 'utf8'), context, { filename: filename.pathname })

  const { Context } = modules.get('@deepseek-ai/cordis')
  const runtime = modules.get('@deepseek-ai/dsh-client-ui-conversation/client')
  const owner = new Context()
  const events = new runtime.ConversationEventRegistry(owner)
  const views = new runtime.ConversationViewRegistry(owner)
  const slots = new (modules.get('@deepseek-ai/dsh-client-ui-renderer/client').SlotRegistry)(owner)
  slots.register(
    {
      name: 'root',
      children: {
        conversation: { kind: 'single', scope: 'session-maybe' },
        'conversation.view': { kind: 'single', scope: 'session' },
        'shell.overlay': { kind: 'list', scope: 'global' },
      },
    },
    () => null,
  )
  const connection = {
    rpc: {
      call() {
        throw new Error('Replay must not call RPC')
      },
    },
  }
  const locale = new (modules.get('@deepseek-ai/dsh-client-locale/client').LocaleRuntime)(owner)
  locale.setLocale('zh')
  const client = {
    inputTriggers: { registerSource: () => () => {} },
    uiConversation: { events, views },
    uiSession: { provide: () => () => {} },
    slots,
    sessions: { provide: () => () => {} },
    workspaces: {},
    layout: {},
    locale,
    settingsScope: {
      bind: () => ({ subscribe: () => () => {}, getSnapshot: () => ({ value: undefined }) }),
    },
    effect: owner.effect.bind(owner),
    on: owner.on.bind(owner),
    get: (key) => (key === 'connection' ? connection : undefined),
    // Input services and prose mentions are not used by registry replay.
    plugin() {},
    provide() {},
  }
  const presentation = modules.get('@chengxianglibra/dsh-data-analysis')
  // Install both extensions before their Host seats exist to cover deferred injection.
  for (const name of order) {
    if (name === 'native')
      modules.get('@deepseek-ai/dsh-client-ui-deliverables/client').apply(client)
    else presentation.installPresentation(client, connection.rpc)
  }
  modules.get('@deepseek-ai/dsh-client-ui-chat/client').apply(client)
  return {
    client,
    slots,
    InputTriggerController: modules.get('@deepseek-ai/dsh-client-ui-input-trigger/client')
      .InputTriggerController,
    events,
    presentation,
    createAssembler: () => {
      const assembler = new runtime.ConversationNodeAssembler(events, views)
      assembler.activateTarget('chat')
      return assembler
    },
    dispose: () => owner.fiber.dispose(),
  }
}
