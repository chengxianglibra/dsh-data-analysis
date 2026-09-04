import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  COMPATIBILITY_SCHEMA,
  DSH_DATA_ANALYSIS_COMPATIBILITY,
  DSH_PEER_DEPENDENCIES,
  DSH_PEER_RANGE,
  MARIVO_PACKAGE_SPEC,
  MARIVO_VERSION,
  PLUGIN_VERSION,
  RUNTIME_INSTALLATION_VERSION,
  SUBPROCESS_POLICY_VERSION,
} from '../../src/compatibility.ts'

interface PackageManifest {
  readonly version: string
  readonly peerDependencies: Readonly<Record<string, string>>
  readonly peerDependenciesMeta?: Readonly<Record<string, unknown>>
}

test('v2 compatibility manifest binds plugin, DSH, Marivo, and project contracts', () => {
  assert.equal(PLUGIN_VERSION, '0.1.1')
  assert.equal(COMPATIBILITY_SCHEMA, 'dsh-data-analysis-compatibility/v2')
  assert.equal(DSH_DATA_ANALYSIS_COMPATIBILITY.dsh.distribution, '@deepseek-ai/dsh')
  assert.equal(DSH_PEER_RANGE, '0.1.1-rc.2')
  assert.equal(MARIVO_VERSION, '0.5.3')
  assert.equal(MARIVO_PACKAGE_SPEC, 'marivo[duckdb,trino,clickhouse]==0.5.3')
  assert.equal(RUNTIME_INSTALLATION_VERSION, 'dsh-data-analysis-runtime/v2')
  assert.equal(SUBPROCESS_POLICY_VERSION, 'direct-argv-inherited-env-snapshot-overlay-v2')
})

test('every DSH peer is required and uses the one declared supported range', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as PackageManifest
  const dshPeers = Object.fromEntries(
    Object.entries(manifest.peerDependencies).filter(([name]) =>
      name.startsWith('@deepseek-ai/dsh-'),
    ),
  )
  assert.deepEqual(dshPeers, DSH_PEER_DEPENDENCIES)
  assert.ok(Object.keys(dshPeers).length > 0)
  assert.ok(Object.values(dshPeers).every((range) => range === DSH_PEER_RANGE))
  assert.ok(
    Object.keys(manifest.peerDependenciesMeta ?? {}).every(
      (name) => !name.startsWith('@deepseek-ai/dsh-'),
    ),
  )
})
