import assert from 'node:assert/strict'
import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { cleanLocalState, validateLocalStateTargets } from './clean-local-state.mjs'

const temporaryRoots = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-plugin-clean-'))
  temporaryRoots.push(root)
  const workspaceRoot = join(root, 'workspace')
  const dshHome = join(root, '.dsh')
  mkdirSync(join(workspaceRoot, '.marivo', 'analysis'), { recursive: true })
  writeFileSync(join(workspaceRoot, '.marivo', 'analysis', 'session.db'), 'marivo')
  mkdirSync(join(dshHome, 'sessions', 'project', 'session'), { recursive: true })
  writeFileSync(join(dshHome, 'sessions', 'project', 'session', 'session.jsonl'), 'dsh')
  mkdirSync(join(dshHome, 'storages'), { recursive: true })
  writeFileSync(join(dshHome, 'storages', 'session_projcache.json'), '{}')
  writeFileSync(join(dshHome, 'storages', 'workspace.json'), 'keep')
  writeFileSync(join(dshHome, 'settings.yaml'), 'keep')
  return { root, workspaceRoot, dshHome }
}

test('cleans Marivo state and all persisted DSH workspace memory without removing configuration', () => {
  const { workspaceRoot, dshHome } = fixture()

  const result = cleanLocalState({ workspaceRoot, dshHome })

  assert.equal(result.marivoEntries, 1)
  assert.equal(result.dshSessionEntries, 1)
  assert.equal(result.workspaceRegistryRemoved, true)
  assert.equal(result.projectionCacheRemoved, true)
  assert.deepEqual(readDirectory(result.marivoStateDir), [])
  assert.deepEqual(readDirectory(result.dshSessionsDir), [])
  assert.equal(existsSync(result.dshWorkspaceRegistryPath), false)
  assert.equal(existsSync(result.dshProjectionCachePath), false)
  assert.equal(readFileSync(join(dshHome, 'settings.yaml'), 'utf8'), 'keep')
})

test('creates absent state directories and treats an absent projection cache as clean', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-plugin-clean-'))
  temporaryRoots.push(root)
  const workspaceRoot = join(root, 'workspace')
  const dshHome = join(root, '.dsh')
  mkdirSync(workspaceRoot, { recursive: true })
  mkdirSync(dshHome, { recursive: true })

  const result = cleanLocalState({ workspaceRoot, dshHome })

  assert.deepEqual(readDirectory(result.marivoStateDir), [])
  assert.deepEqual(readDirectory(result.dshSessionsDir), [])
  assert.equal(result.workspaceRegistryRemoved, false)
  assert.equal(result.projectionCacheRemoved, false)
})

test('rejects symlinked cleanup directories without touching their targets', () => {
  const { root, workspaceRoot, dshHome } = fixture()
  const external = join(root, 'external')
  mkdirSync(external)
  writeFileSync(join(external, 'keep'), 'safe')
  rmSync(join(workspaceRoot, '.marivo'), { recursive: true })
  symlinkSync(external, join(workspaceRoot, '.marivo'))

  assert.throws(
    () => cleanLocalState({ workspaceRoot, dshHome }),
    /cleanup directory must be a real directory/,
  )
  assert.equal(readFileSync(join(external, 'keep'), 'utf8'), 'safe')
})

test('rejects a filesystem root as DSH_HOME', () => {
  const { workspaceRoot } = fixture()
  assert.throws(
    () => validateLocalStateTargets({ workspaceRoot, dshHome: '/' }),
    /DSH_HOME must not be a filesystem root/,
  )
})

function readDirectory(directory) {
  return readdirSync(directory)
}
