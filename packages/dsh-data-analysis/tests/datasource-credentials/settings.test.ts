import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { FileSettingsProvider } from '@deepseek-ai/dsh-settings-file'
import { installPythonSettings, PYTHON_SETTINGS_NAMESPACE } from '../../src/settings.ts'

test('Host settings persist, validate, fence stale writes, reset and dispose the plugin namespace', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'marivo-settings-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const filename = path.join(directory, 'settings.json')
  const ctx = new Context()
  const provider = await ctx.plugin(FileSettingsProvider, { path: filename, watch: false })
  t.after(() => provider.dispose())
  let settings!: ReturnType<typeof installPythonSettings>
  const owner = await ctx.plugin({
    name: 'settings-owner',
    apply(owner: Context) {
      settings = installPythonSettings(owner, { pythonTimeoutMs: 180_000 })
    },
  })
  t.after(() => owner.dispose())
  assert.deepEqual(settings.get(), { pythonTimeoutMs: 180_000 })
  const original = ctx.settings.describe().find((item) => item.ns === PYTHON_SETTINGS_NAMESPACE)!
  assert.equal(original.applies, 'live')
  await ctx.settings.update(
    PYTHON_SETTINGS_NAMESPACE,
    { pythonTimeoutMs: 900_000 },
    original.revision,
  )
  assert.deepEqual(settings.get(), { pythonTimeoutMs: 900_000 })
  assert.deepEqual(JSON.parse(await readFile(filename, 'utf8')), {
    [PYTHON_SETTINGS_NAMESPACE]: { pythonTimeoutMs: 900_000 },
  })
  await assert.rejects(
    ctx.settings.update(PYTHON_SETTINGS_NAMESPACE, { pythonTimeoutMs: 200_000 }, original.revision),
  )
  for (const value of [0, -1, 1.5, 2_147_483_648, 'invalid', null])
    await assert.rejects(ctx.settings.update(PYTHON_SETTINGS_NAMESPACE, { pythonTimeoutMs: value }))
  assert.equal(settings.get().pythonTimeoutMs, 900_000)
  await settings.dispose()
  assert.equal(ctx.settings.get(PYTHON_SETTINGS_NAMESPACE), undefined)
  await owner.dispose()

  const reloaded = await ctx.plugin({
    name: 'settings-owner-reloaded',
    apply(owner: Context) {
      settings = installPythonSettings(owner, { pythonTimeoutMs: 180_000 })
    },
  })
  t.after(() => reloaded.dispose())
  assert.equal(settings.get().pythonTimeoutMs, 900_000)
  await ctx.settings.mutate(PYTHON_SETTINGS_NAMESPACE, [{ op: 'unset', path: ['pythonTimeoutMs'] }])
  assert.equal(settings.get().pythonTimeoutMs, 180_000)
  assert.deepEqual(JSON.parse(await readFile(filename, 'utf8'))[PYTHON_SETTINGS_NAMESPACE], {})
})

test('headless entry configuration works without a settings provider', async (t) => {
  const ctx = new Context()
  let settings!: ReturnType<typeof installPythonSettings>
  const owner = await ctx.plugin({
    name: 'headless-settings-owner',
    apply(owner: Context) {
      settings = installPythonSettings(owner, { pythonTimeoutMs: 900_000 })
    },
  })
  t.after(() => owner.dispose())
  assert.equal(settings.get().pythonTimeoutMs, 900_000)
})
