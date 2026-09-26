import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import {
  boot,
  initProfile,
  type ProfileContext,
  readProfilePatches,
} from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import Settings from '@deepseek-ai/dsh-settings'
import { Config } from '../../src/plugin.ts'
import {
  currentPythonOptions,
  installPythonSettings,
  PYTHON_SETTINGS_NAMESPACE,
} from '../../src/settings.ts'

test('Host profile form updates the live Python timeout and fences stale or invalid writes', async (t) => {
  const home = await mkdtemp(path.join(tmpdir(), 'marivo-settings-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const dir = path.join(home, 'profiles', 'test')
  initProfile(dir, ['test-bundle'])
  const bundle = path.join(dir, 'node_modules', 'test-bundle')
  await mkdir(bundle, { recursive: true })
  await writeFile(path.join(home, 'package.json'), '{"name":"test-installation"}\n')
  await writeFile(
    path.join(bundle, 'package.json'),
    JSON.stringify({
      name: 'test-bundle',
      version: '1.0.0',
      dsh: { bundle: { patch: 'cordis.patch.yml' } },
    }),
  )
  await writeFile(
    path.join(bundle, 'cordis.patch.yml'),
    JSON.stringify([
      {
        insert: [
          { id: 'config-editor', name: 'cordis:editor' },
          { id: 'settings', name: 'cordis:settings' },
          {
            id: PYTHON_SETTINGS_NAMESPACE,
            name: 'cordis:probe',
            config: { pythonTimeoutMs: 180_000 },
          },
        ],
      },
    ]),
  )
  await writeFile(path.join(dir, 'cordis.yml'), '[]\n')
  const profile: ProfileContext = {
    name: 'test',
    startedBundles: ['test-bundle'],
    dir,
    patchPath: path.join(dir, 'cordis.patch.yml'),
    installAnchor: path.join(home, 'package.json'),
    cwd: home,
    home,
    overlays: [],
    telemetryDisabledEnv: undefined,
  }
  let settings: ReturnType<typeof installPythonSettings> | undefined
  const Probe = {
    Config,
    apply(ctx: Context, config: Parameters<typeof installPythonSettings>[1]) {
      settings = installPythonSettings(ctx, config)
    },
  }
  const ctx = await boot(
    'test',
    path.join(dir, 'cordis.yml'),
    readProfilePatches('test', profile),
    (ctx) => {
      ctx.provide('profileContext', profile)
      ctx.provide('appReady', {
        onReady: (listener: () => void) => {
          listener()
          return () => {}
        },
      })
      Object.assign(ctx.loader.builtins, { editor: ConfigEditor, settings: Settings, probe: Probe })
    },
  )
  t.after(() => ctx.fiber.dispose())
  assert(settings)
  assert.deepEqual(settings.get(), { pythonTimeoutMs: 180_000 })
  const descriptor = () =>
    ctx.settings.describe().find((item) => item.ns === PYTHON_SETTINGS_NAMESPACE)!
  const original = descriptor()
  assert.equal(original.applies, 'live')
  await ctx.settings.mutate(
    PYTHON_SETTINGS_NAMESPACE,
    [{ op: 'set', path: ['pythonTimeoutMs'], value: 900_000 }],
    original.revision,
  )
  assert.equal(settings.get().pythonTimeoutMs, 900_000)
  assert.match(await readFile(profile.patchPath, 'utf8'), /900000/)
  await assert.rejects(
    ctx.settings.update(PYTHON_SETTINGS_NAMESPACE, { pythonTimeoutMs: 200_000 }, original.revision),
  )
  for (const value of [0, -1, 1.5, 2_147_483_648, 'invalid'])
    await assert.rejects(
      ctx.settings.update(PYTHON_SETTINGS_NAMESPACE, { pythonTimeoutMs: value }),
      /./,
      `accepted ${String(value)}`,
    )
  assert.equal(settings.get().pythonTimeoutMs, 900_000)
  await ctx.settings.mutate(PYTHON_SETTINGS_NAMESPACE, [{ op: 'unset', path: ['pythonTimeoutMs'] }])
  assert.equal(settings.get().pythonTimeoutMs, 180_000)
})

test('headless direct configuration remains readable', async (t) => {
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
  assert.equal(
    currentPythonOptions({ pythonTimeoutMs: { get: () => 600_000 } }).pythonTimeoutMs,
    600_000,
  )
})
