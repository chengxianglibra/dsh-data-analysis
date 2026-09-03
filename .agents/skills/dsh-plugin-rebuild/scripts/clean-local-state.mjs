import {
  lstatSync, mkdirSync, readdirSync, rmSync, unlinkSync,
} from 'node:fs'
import { dirname, join, parse, resolve } from 'node:path'

export function validateLocalStateTargets({ workspaceRoot, dshHome }) {
  const resolvedWorkspaceRoot = safeBaseDirectory(workspaceRoot, 'workspace root')
  const resolvedDshHome = safeBaseDirectory(dshHome, 'DSH_HOME')
  const marivoStateDir = join(resolvedWorkspaceRoot, '.marivo')
  const dshSessionsDir = join(resolvedDshHome, 'sessions')
  const dshWorkspaceRegistryPath = join(resolvedDshHome, 'storages', 'workspace.json')
  const dshProjectionCachePath = join(resolvedDshHome, 'storages', 'session_projcache.json')

  assertDirectChild(marivoStateDir, resolvedWorkspaceRoot, '.marivo')
  assertDirectChild(dshSessionsDir, resolvedDshHome, 'sessions')
  assertDirectoryOrAbsent(marivoStateDir)
  assertDirectoryOrAbsent(dshSessionsDir)
  assertFileOrAbsent(dshWorkspaceRegistryPath)
  assertFileOrAbsent(dshProjectionCachePath)

  return {
    workspaceRoot: resolvedWorkspaceRoot,
    dshHome: resolvedDshHome,
    marivoStateDir,
    dshSessionsDir,
    dshWorkspaceRegistryPath,
    dshProjectionCachePath,
  }
}

export function cleanLocalState(options) {
  const targets = validateLocalStateTargets(options)
  const marivoEntries = emptyDirectory(targets.marivoStateDir)
  const dshSessionEntries = emptyDirectory(targets.dshSessionsDir)
  const workspaceRegistryRemoved = unlinkIfPresent(targets.dshWorkspaceRegistryPath)
  const projectionCacheRemoved = unlinkIfPresent(targets.dshProjectionCachePath)

  return {
    ...targets,
    marivoEntries,
    dshSessionEntries,
    workspaceRegistryRemoved,
    projectionCacheRemoved,
  }
}

function safeBaseDirectory(rawPath, label) {
  if (typeof rawPath !== 'string' || rawPath.length === 0) {
    throw new Error(`${label} must be a non-empty path`)
  }
  const directory = resolve(rawPath)
  if (directory === parse(directory).root) {
    throw new Error(`${label} must not be a filesystem root`)
  }
  const stat = lstatIfPresent(directory)
  if (stat === null || !stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be an existing real directory: ${directory}`)
  }
  return directory
}

function assertDirectChild(target, parent, name) {
  if (dirname(target) !== parent || target !== join(parent, name)) {
    throw new Error(`unsafe cleanup target: ${target}`)
  }
}

function assertDirectoryOrAbsent(directory) {
  const stat = lstatIfPresent(directory)
  if (stat === null) return
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`cleanup directory must be a real directory: ${directory}`)
  }
}

function assertFileOrAbsent(filePath) {
  const stat = lstatIfPresent(filePath)
  if (stat === null) return
  if (!stat.isFile() && !stat.isSymbolicLink()) {
    throw new Error(`cleanup file must be a file or symbolic link: ${filePath}`)
  }
}

function emptyDirectory(directory) {
  mkdirSync(directory, { recursive: true })
  const entries = readdirSync(directory)
  for (const entry of entries) {
    rmSync(join(directory, entry), { recursive: true, force: true })
  }
  return entries.length
}

function unlinkIfPresent(filePath) {
  if (lstatIfPresent(filePath) === null) return false
  unlinkSync(filePath)
  return true
}

function lstatIfPresent(filePath) {
  try {
    return lstatSync(filePath)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}
