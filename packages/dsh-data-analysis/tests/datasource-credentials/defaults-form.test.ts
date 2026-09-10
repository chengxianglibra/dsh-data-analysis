import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'
import { build } from 'esbuild'
import type { ReactElement } from 'react'

const require = createRequire(import.meta.url)
const compiled = await build({
  entryPoints: ['packages/dsh-data-analysis/src/client/credentials/create-datasource.tsx'],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  external: ['react', 'react/jsx-runtime'],
  jsx: 'automatic',
})

/** Exercise the production form's effects and submit handler without a simulated serializer. */
async function form(edit: boolean, originalSource: string | undefined, defaults = true) {
  const saved: Record<string, unknown>[] = []
  const modes: string[] = []
  const schema = {
    generation: 'host',
    fingerprint: 'runtime',
    backends: [
      {
        name: 'trino',
        fields: ['name', 'host', 'source'].map((name) => ({ name, type: 'string' })),
      },
    ],
    ...(defaults ? { creationDefaults: { trino: { source: '' } } } : {}),
  }
  const state: unknown[] = []
  let index = 0
  let effect: (() => void) | undefined
  const hooks = {
    useId: () => 'form',
    useRef: () => ({ current: true }),
    useEffect: (callback: () => void) => {
      effect ??= callback
    },
    useState: (initial: unknown) => {
      const slot = index++
      if (!(slot in state)) state[slot] = initial
      return [
        state[slot],
        (value: unknown) => {
          state[slot] = value
        },
      ]
    },
  }
  const module = {
    exports: {} as {
      CreateDatasource: (
        props: unknown,
      ) => ReactElement<{ onSubmit: (event: unknown) => Promise<void> }>
    },
  }
  vm.runInNewContext(compiled.outputFiles[0]!.text, {
    module,
    exports: module.exports,
    crypto: globalThis.crypto,
    AbortController,
    require: (id: string) => (id === 'react' ? hooks : require(id)),
  })
  const props = {
    workspaceId: 'workspace',
    name: edit ? 'db' : undefined,
    close() {},
    model: {
      async authoring(_workspace: string, _signal: AbortSignal, mode: string) {
        modes.push(mode)
        return schema
      },
      async configuration() {
        return {
          name: 'db',
          backend: 'trino',
          fields: {
            name: 'db',
            host: 'old',
            ...(originalSource === undefined ? {} : { source: originalSource }),
          },
          version: 'v1',
        }
      },
      async saveConfiguration(
        _workspace: string,
        _schema: unknown,
        input: { fields: Record<string, unknown> },
      ) {
        saved.push(input.fields)
      },
    },
  }
  module.exports.CreateDatasource(props)
  effect!()
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(state[6], '')
  // Simulate changing host, keeping source untouched (or clearing a nonempty source).
  state[3] = { ...(state[3] as object), name: 'db', host: 'new', source: '' }
  index = 0
  const tree = module.exports.CreateDatasource(props)
  await tree.props.onSubmit({ preventDefault() {} })
  return { fields: saved[0]!, modes }
}

test('new empty defaults survive editing unrelated fields even after defaults are removed', async () => {
  const created = await form(false, undefined)
  assert.equal(created.fields.source, '')
  assert.deepEqual(created.modes, ['create'])
  const edited = await form(true, '', false)
  assert.equal(edited.fields.source, '')
  assert.equal(edited.fields.host, 'new')
  assert.deepEqual(edited.modes, ['edit'])
})

test('ordinary empty inputs retain omission semantics and edit never applies new defaults', async () => {
  for (const initial of [undefined, 'previous']) {
    const edited = await form(true, initial)
    assert.equal(Object.hasOwn(edited.fields, 'source'), false)
  }
  assert.equal(Object.hasOwn((await form(false, undefined, false)).fields, 'source'), false)
})
