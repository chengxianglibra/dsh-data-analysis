import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { translator } from './../../src/client/i18n/copy.ts'
import { MarivoEnvironmentError } from '../../src/environment/errors.ts'
import type { MarivoCheckedRunRequest } from '../../src/environment/types.ts'
import { CATALOG_ERROR_SCHEMA, type CatalogFailure } from '../../src/semantic-browser/contracts.ts'
import {
  browserFailure,
  SemanticBrowserService,
  SemanticCatalogLoadError,
} from '../../src/semantic-browser/service.ts'
import { semanticEnvironmentFingerprint } from '../../src/semantic-reference/environment.ts'
import {
  registerSemanticReferenceRpc,
  type SemanticReferenceService,
} from '../../src/semantic-reference/rpc.ts'
import { fakeRunner, installConnectionFixture } from '../semantic-reference-input/fixtures.ts'
import { snapshot } from './fixtures.ts'

test('reads registered Workspace without an Agent; deletion, cancellation, overrides and closed input fail safely', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'semantic-service-')),
    root = await realpath(dir)
  t.after(() => rm(root, { recursive: true, force: true }))
  const fixture = fakeRunner(),
    requests: MarivoCheckedRunRequest[] = []
  const { fingerprint, kinds, objects } = snapshot()
  let present = true,
    removeDuringRead = false
  const service = new SemanticBrowserService({
    getWorkspace: (id) => (present && id === 'registered' ? { id, path: root } : undefined),
    projectRoot: (workspace) => workspace.path,
    resolve: async () => ({
      ...fixture.runner,
      binding: { ...fixture.runner.binding, projectRoot: root },
      async runChecked(request) {
        requests.push(request)
        if (removeDuringRead) present = false
        return {
          exitCode: 0,
          signal: null,
          durationMs: 0,
          stdout: Buffer.from(JSON.stringify({ fingerprint, kinds, objects })),
          stderr: Buffer.alloc(0),
        }
      },
    }),
  })
  const signal = new AbortController().signal
  const result = await service.read({ workspaceId: 'registered' }, signal)
  assert.equal(result.projectRoot, root)
  assert.equal(
    result.environmentFingerprint,
    semanticEnvironmentFingerprint('registered', fixture.runner.binding.fingerprint),
  )
  assert.equal(requests.length, 1)
  assert.deepEqual(requests[0]!.environmentOverlay, {
    MARIVO_TELEMETRY: 'off',
    PYTHONDONTWRITEBYTECODE: '1',
  })
  assert.equal(requests[0]!.limits!.stdoutMaxBytes, 32 * 1024 * 1024)
  await assert.rejects(service.read({ workspaceId: 'registered', projectRoot: '/other' }, signal))
  await assert.rejects(service.read({ workspaceId: '/arbitrary/path' }, signal))
  removeDuringRead = true
  await assert.rejects(service.read({ workspaceId: 'registered' }, signal), /workspace-changed/)
  service.dispose()
  await assert.rejects(service.read({ workspaceId: 'registered' }, signal))
  assert.equal(requests.length, 2)
})
test('only fixed error messages cross the browser boundary', () => {
  assert.doesNotMatch(browserFailure(new Error('token=PRIVATE')), /PRIVATE/)
  assert.match(
    translator('zh-CN')(
      browserFailure(new MarivoEnvironmentError('subprocess-timeout', 'PRIVATE')),
    ),
    /超时/,
  )
  assert.match(
    translator('zh-CN')(
      browserFailure(new MarivoEnvironmentError('subprocess-output-limit', 'PRIVATE')),
    ),
    /上限/,
  )
})

test('Marivo semantic load diagnostics cross the browser boundary without generic wrapping', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'semantic-diagnostic-')),
    root = await realpath(dir)
  t.after(() => rm(root, { recursive: true, force: true }))
  const diagnostic =
    "[missing_entity_ref] Entity 'trino.query' references unknown datasource 'trino_fixture'.\n" +
    '  refs: trino.query, trino_fixture\n' +
    '  hint: Reference the declared datasource name.'
  const fixture = fakeRunner()
  const service = new SemanticBrowserService({
    getWorkspace: (id) => ({ id, path: root }),
    projectRoot: () => root,
    resolve: async () => ({
      ...fixture.runner,
      binding: { ...fixture.runner.binding, projectRoot: root },
      async runChecked() {
        const failure: CatalogFailure = {
          schema: CATALOG_ERROR_SCHEMA,
          kind: 'semantic',
          message: diagnostic,
        }
        return {
          exitCode: 1,
          signal: null,
          durationMs: 0,
          stdout: Buffer.from(JSON.stringify(failure)),
          stderr: Buffer.from('traceback must not cross the browser boundary'),
        }
      },
    }),
  })
  t.after(() => service.dispose())
  await assert.rejects(
    service.read({ workspaceId: 'a' }, new AbortController().signal),
    (error) => {
      assert.ok(error instanceof SemanticCatalogLoadError)
      assert.equal(browserFailure(error), `语义层模型加载失败：\n${diagnostic}`)
      return true
    },
  )
})

test('one plugin API namespace dispatches browser and existing reference endpoints separately', async () => {
  const ctx = new Context()
  let stopped = false
  const channels = installConnectionFixture(ctx)
  const reference = {
    handle: async () => ({ reference: true }),
    stop() {
      stopped = true
    },
    close: async () => {},
  } as unknown as SemanticReferenceService
  const dispose = registerSemanticReferenceRpc(ctx.connection, reference, async () => ({
    ok: true,
    value: { browser: true },
  }))
  assert.deepEqual(
    await channels.get('/dsh-data-analysis')!(
      'semantic-browser/catalog',
      { workspaceId: 'a' },
      new AbortController().signal,
    ),
    { ok: true, value: { browser: true } },
  )
  assert.deepEqual(
    await channels.get('/dsh-data-analysis')!(
      'semantic-references/candidates',
      {},
      new AbortController().signal,
    ),
    { ok: true, value: { reference: true } },
  )
  await dispose()
  assert.equal(stopped, true)
  assert.equal(channels.has('/dsh-data-analysis'), false)
})

test('binding cancellation and Workspace deletion prevent Python admission', async () => {
  const fixture = fakeRunner()
  let finish!: (value: typeof fixture.runner) => void,
    present = true
  const service = new SemanticBrowserService({
    getWorkspace: (id) => (present ? { id, path: '/workspace' } : undefined),
    projectRoot: () => '/workspace',
    resolve: () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  })
  const controller = new AbortController()
  const cancelled = service.read({ workspaceId: 'a' }, controller.signal)
  controller.abort()
  await assert.rejects(cancelled)
  finish(fixture.runner)
  const removed = service.read({ workspaceId: 'a' }, new AbortController().signal)
  present = false
  finish(fixture.runner)
  await assert.rejects(removed, /workspace-changed/)
  assert.equal(fixture.requests.length, 0)
  service.dispose()
})
