// @ts-nocheck -- execute checked-out DSH private input core as an integration fixture.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { build } from 'esbuild'
import { createSemanticReferenceSource } from '../../src/client/semantic-reference-source.ts'
import { envelopeJson, modelMarker } from '../../src/semantic-reference/contracts.ts'
import { candidate, envelope } from './fixtures.ts'

const tick = () => new Promise((resolve) => setImmediate(resolve))
const harness = fileURLToPath(new URL('../../../../../deepseek-harness/', import.meta.url))
const available = existsSync(
  `${harness}packages/client/ui-conversation/src/client/input/machine.ts`,
)
const integrationTest = (name, fn) =>
  test(name, { skip: available ? false : 'checked-out DSH input core unavailable' }, fn)
const result = available
  ? await build({
      stdin: {
        contents: `export { InputMachine, projectClipboard } from '${harness}packages/client/ui-conversation/src/client/input/machine.ts'; export { SessionInputShell } from '${harness}packages/client/ui-conversation/src/client/input/facade.ts'; export { InputTriggerController } from '${harness}packages/client/ui-input-trigger/src/client/controller.ts';`,
        resolveDir: process.cwd(),
      },
      bundle: true,
      format: 'cjs',
      platform: 'node',
      packages: 'external',
      write: false,
      alias: {
        '@deepseek-ai/dsh-client-runtime/client': `${harness}packages/client/runtime/src/client/contract/store.ts`,
      },
    })
  : undefined
const module = { exports: {} }
if (result)
  vm.runInNewContext(result.outputFiles[0].text, {
    module,
    exports: module.exports,
    require: createRequire(import.meta.url),
    AbortController,
    AbortSignal,
    console,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    process,
  })
const { InputMachine, projectClipboard, InputTriggerController, SessionInputShell } = module.exports

function setup() {
  const calls = [],
    delivered = []
  let failure = false
  const rpc = {
    async call(channel, endpoint, payload) {
      calls.push({ channel, endpoint, payload })
      if (endpoint.endsWith('/serialize'))
        return failure
          ? { ok: false, error: {} }
          : { ok: true, value: { text: modelMarker(payload.envelope) } }
      if (endpoint.endsWith('/selected')) return { ok: true, value: { selected: true } }
      return {
        ok: true,
        value: {
          environmentFingerprint: 'fp-a',
          items: [{ ...candidate('sales.revenue'), section: 'strict' }],
        },
      }
    },
  }
  const source = createSemanticReferenceSource(rpc)
  const files = {
    trigger: '@',
    name: 'reference',
    candidates: async () => [{ name: 'file.txt' }],
    onPick: () => ({ text: 'file.txt' }),
  }
  const sources = [source, files]
  let shell: any
  const actx = {
    bail(_ctx, name, request) {
      if (name === 'slash/input-insert-reference')
        return shell.insertReference(request.reference, request.span) || undefined
    },
  }
  const controller = new InputTriggerController({
    actx,
    sessionId: 'a',
    roster: { all: () => sources, sources: () => sources },
  })
  shell = new SessionInputShell({
    actx,
    inputTriggers: () => controller,
    defaultSink: async (text) => {
      delivered.push(text)
      return { kind: 'success' }
    },
    commandImages: {
      serialize: async () => [],
      release() {},
      unsupportedNotice: () => 'unsupported',
    },
  })
  return {
    source,
    shell,
    controller,
    calls,
    delivered,
    fail() {
      failure = true
    },
  }
}

integrationTest(
  'real DSH controller coexists with file source and routes one pick into an atomic occurrence',
  async () => {
    const f = setup()
    f.shell.setDraft('分析 @rev')
    f.controller.track(
      f.shell.snapshot.draft,
      f.shell.snapshot.draft.length,
      { tier: 'plain' },
      f.shell.snapshot.draftRev,
    )
    await tick()
    const groups = f.controller.menu.getSnapshot().groups
    assert.equal(groups.length, 2)
    assert.equal(groups[0].source, 'marivo-semantic')
    f.controller.pick('marivo-semantic', 0)
    assert.equal(f.shell.snapshot.occurrences.length, 1)
    assert.match(f.shell.snapshot.draft, /@metric:sales.revenue/)
    assert.equal(f.calls.filter((call) => call.endpoint.endsWith('/selected')).length, 1)
    f.shell.submit()
    await tick()
    assert.equal(f.delivered.length, 1)
    assert.match(f.delivered[0], /<marivo-semantic-ref>/)
    assert.ok(!f.delivered[0].includes('fp-a'))
    assert.equal(f.calls.filter((call) => call.endpoint.endsWith('/selected')).length, 1)
    f.controller.dispose()
    f.shell.dispose()
  },
)

integrationTest(
  'real input submit failure preserves all chips/draft and emits existing composer notice',
  async () => {
    const f = setup()
    const insert = f.source.onPick({
      session: { sessionId: 'a' },
      candidate: { value: envelopeJson(envelope()) },
    }).insert
    f.shell.setDraft('@')
    f.shell.insertReference(
      { ...insert, label: 'changed display', clipboardText: 'untrusted clipboard' },
      { start: 0, end: 1, draftRev: f.shell.snapshot.draftRev },
    )
    const draft = f.shell.snapshot.draft
    f.fail()
    f.shell.submit()
    await tick()
    assert.equal(f.shell.snapshot.draft, draft)
    assert.equal(f.shell.snapshot.occurrences.length, 1)
    assert.equal(f.delivered.length, 0)
    assert.equal(f.shell.notices.getSnapshot().level, 'error')
    assert.equal(
      f.calls.find((call) => call.endpoint.endsWith('/serialize')).payload.envelope.ref.path,
      'sales.revenue',
    )
    f.controller.dispose()
    f.shell.dispose()
  },
)

integrationTest(
  'real InputMachine copy, undo, deletion, same-path different kinds and plain paste',
  () => {
    const machine = new InputMachine()
    for (const kind of ['metric', 'entity']) {
      const start = machine.state.draft.length
      machine.dispatch({ type: 'draft-changed', draft: `${machine.state.draft}@` })
      const env = { ...envelope(), ref: { ...envelope().ref, kind } }
      machine.dispatch({
        type: 'insert-ref',
        reference: {
          source: 'marivo-semantic',
          ref: envelopeJson(env),
          label: `${kind}:sales.revenue`,
          clipboardText: `@${kind}:sales.revenue`,
        },
        span: { start, end: start + 1, draftRev: machine.state.draftRev },
      })
    }
    assert.equal(machine.state.occurrences.length, 2)
    assert.notEqual(
      machine.state.occurrences[0].occurrenceId,
      machine.state.occurrences[1].occurrenceId,
    )
    assert.match(projectClipboard(machine.state), /@entity:sales.revenue/)
    machine.dispatch({ type: 'undo' })
    assert.equal(machine.state.occurrences.length, 1)
    machine.dispatch({ type: 'redo' })
    assert.equal(machine.state.occurrences.length, 2)
    machine.dispatch({ type: 'draft-changed', draft: '' })
    assert.equal(machine.state.occurrences.length, 0)
    machine.dispatch({
      type: 'paste-begin',
      text: '@metric:sales.revenue',
      selection: { start: 0, end: 0 },
    })
    assert.equal(machine.state.occurrences.length, 0)
  },
)

integrationTest(
  'real controller cancels generation, drops late response, handles quoted query',
  async () => {
    const pending = []
    const source = createSemanticReferenceSource({
      call(_channel, endpoint, payload, signal) {
        assert.ok(endpoint.endsWith('/candidates'))
        return new Promise((resolve) => pending.push({ payload, signal, resolve }))
      },
    })
    const controller = new InputTriggerController({
      actx: {},
      sessionId: 'a',
      roster: { all: () => [source], sources: () => [source] },
    })
    controller.track('@old', 4, { tier: 'plain' }, 1)
    controller.track('@"monthly revenue', 17, { tier: 'plain' }, 2)
    assert.equal(pending.length, 2)
    assert.equal(pending[0].signal.aborted, true)
    assert.equal(pending[1].payload.quoted, true)
    assert.equal(pending[1].payload.query, 'monthly revenue')
    const response = (path) => ({
      ok: true,
      value: { environmentFingerprint: 'fp-a', items: [{ ...candidate(path), section: 'strict' }] },
    })
    pending[1].resolve(response('new'))
    await tick()
    pending[0].resolve(response('old'))
    await tick()
    assert.match(JSON.stringify(controller.menu.getSnapshot()), /new/)
    assert.ok(!JSON.stringify(controller.menu.getSnapshot()).includes('metric:old'))
    controller.dispose()
  },
)
