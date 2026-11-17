import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { DSH_PEER_DEPENDENCIES, DSH_PEER_RANGE } from '../../src/compatibility.ts'

interface PackageManifest {
  readonly peerDependencies: Readonly<Record<string, string>>
  readonly peerDependenciesMeta?: Readonly<Record<string, unknown>>
}

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
