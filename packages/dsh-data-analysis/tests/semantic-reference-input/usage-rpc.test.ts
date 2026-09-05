import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import {
  registerSemanticReferenceRpc,
  SemanticReferenceService,
} from '../../src/semantic-reference/rpc.ts'
import {
  increment,
  localDay,
  SemanticReferenceUsage,
  usageSchema,
  usageSpec,
  windowDays,
  workspaceKey,
} from '../../src/semantic-reference/usage.ts'
import {
  candidate,
  envelope,
  fakeRunner,
  installConnectionFixture,
  installStorage,
} from './fixtures.ts'

test('seven local calendar days, pruning, DST-safe rollover, saturation and strict persistence schema', () => {
  const now = new Date(2026, 8, 5, 23, 59).getTime(),
    ref = candidate('a').ref
  const days = windowDays(now)
  assert.equal(days.length, 7)
  assert.equal(days[6], '2026-09-05')
  assert.equal(windowDays(new Date(2026, 8, 6, 0, 1).getTime())[0], '2026-08-31')
  const row = increment({ entries: {} }, ref, now)
  assert.equal(row.entries['metric:a']!.days[0]!.count, 1)
  row.entries['metric:a']!.days[0]!.count = Number.MAX_SAFE_INTEGER
  assert.equal(
    increment(row, ref, now).entries['metric:a']!.days[0]!.count,
    Number.MAX_SAFE_INTEGER,
  )
  const later = increment(row, candidate('b').ref, new Date(2026, 8, 12).getTime())
  assert.deepEqual(Object.keys(later.entries), ['metric:b'])
  assert.equal(localDay(new Date(now)), days[6])
  assert.ok(usageSchema.safeParse(later).success)
  assert.ok(!usageSchema.safeParse({ entries: { wrong: row.entries['metric:a'] } }).success)
})

test('real storageDomain concurrent first selections, Workspace isolation, persisted reload and drain', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'semantic-usage-')),
    ctx = new Context()
  t.after(async () => {
    await ctx.storageDomain.closeAll()
    await rm(root, { recursive: true, force: true })
  })
  await installStorage(ctx, root)
  const now = new Date(2026, 8, 5).getTime(),
    key = workspaceKey('/private/workspace-a'),
    other = workspaceKey('/private/workspace-b')
  const usage = new SemanticReferenceUsage(ctx.storageDomain, () => now),
    signal = new AbortController().signal
  await Promise.all(
    Array.from({ length: 30 }, () => usage.selected(key, candidate('sales.revenue').ref, signal)),
  )
  assert.equal((await usage.scores(key)).get('metric:sales.revenue')?.count, 30)
  assert.equal((await usage.scores(other)).size, 0)
  await usage.close()
  const raw = await readFile(path.join(root, `${usageSpec.name}.json`), 'utf8')
  assert.ok(!raw.includes('/private/workspace'))
  const reloaded = new SemanticReferenceUsage(ctx.storageDomain, () => now)
  assert.equal((await reloaded.scores(key)).get('metric:sales.revenue')?.count, 30)
  await reloaded.close()
})

test('selected and serialize work without Catalog cache; ownership, authority and errors fail closed', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'semantic-rpc-')),
    ctx = new Context()
  t.after(async () => {
    await ctx.storageDomain.closeAll()
    await rm(root, { recursive: true, force: true })
  })
  await installStorage(ctx, root)
  const channels = installConnectionFixture(ctx),
    usage = new SemanticReferenceUsage(ctx.storageDomain),
    fixture = fakeRunner()
  let unknown = false
  const service = new SemanticReferenceService(async (id) => {
    if (unknown || id !== 'a') throw new Error('/secret/path')
    return fixture.runner
  }, usage)
  const signal = new AbortController().signal
  fixture.fail()
  const selected = { envelope: envelope() }
  assert.deepEqual(await service.handle('semantic-references/selected', selected, signal), {
    selected: true,
  })
  const serialized = await service.handle('semantic-references/serialize', selected, signal)
  assert.match(JSON.stringify(serialized), /marivo-semantic-ref/)
  assert.equal(fixture.requests.length, 0)
  await assert.rejects(
    service.handle(
      'semantic-references/candidates',
      { version: 1, sessionId: 'a', query: '', quoted: false, limit: 40 },
      signal,
    ),
  )
  assert.deepEqual(
    await service.handle('semantic-references/serialize', selected, signal),
    serialized,
  )
  await assert.rejects(
    service.handle('semantic-references/serialize', { envelope: envelope('a', 'other') }, signal),
  )
  const cancelled = AbortSignal.abort()
  await assert.rejects(service.handle('semantic-references/serialize', selected, cancelled))
  let authority = ''
  const original = ctx.connection.rpc.handle
  ctx.connection.rpc.handle = (channel, handler, options) => {
    authority = options.authority
    return original(channel, handler, options)
  }
  const dispose = registerSemanticReferenceRpc(ctx.connection, service)
  assert.equal(authority, 'trusted-host')
  unknown = true
  const failed = await channels.get('/dsh-data-analysis')!(
    'semantic-references/serialize',
    selected,
    signal,
  )
  assert.equal(failed.ok, false)
  assert.ok(!JSON.stringify(failed).includes('/secret'))
  unknown = false
  Object.defineProperty(fixture.runner, 'status', { value: 'failed' })
  await assert.rejects(
    service.handle('semantic-references/serialize', selected, signal),
    /environment-failed/,
  )
  await dispose()
  assert.equal(channels.size, 0)
  await assert.rejects(
    service.handle('semantic-references/serialize', selected, signal),
    /disposed/,
  )
})

test('storage unavailable only degrades heat, and lifecycle aborts unresolved Environment waits', async () => {
  let diagnostics = 0
  const usage = new SemanticReferenceUsage(
    {
      open: async () => {
        throw new Error('storage fault')
      },
    },
    Date.now,
    () => {
      diagnostics++
    },
  )
  const fixture = fakeRunner(),
    service = new SemanticReferenceService(async () => fixture.runner, usage),
    signal = new AbortController().signal
  const result = await service.handle(
    'semantic-references/candidates',
    { version: 1, sessionId: 'a', query: '', quoted: false, limit: 40 },
    signal,
  )
  assert.match(JSON.stringify(result), /sales.revenue/)
  await service.handle('semantic-references/selected', { envelope: envelope() }, signal)
  assert.equal(diagnostics, 1)
  await service.close()
  const waiting = new SemanticReferenceService(() => new Promise(() => {}), usage)
  const pending = waiting.handle('semantic-references/serialize', { envelope: envelope() }, signal)
  await waiting.close()
  await assert.rejects(pending, /cancelled/)
})
