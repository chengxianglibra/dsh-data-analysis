#!/usr/bin/env node

import {
  closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createConnection } from 'node:net'
import { cleanLocalState, validateLocalStateTargets } from './clean-local-state.mjs'
import { selectManagedProcessGroup, selectTakeoverProcessGroup } from './process-targeting.mjs'

const PLUGIN_NAME = '@deepseek-ai/dsh-data-analysis'
const PLUGIN_TARBALL_PREFIX = 'deepseek-ai-dsh-data-analysis'
const DEFAULT_DSH_PACKAGE = '@deepseek-ai/dsh'
const DEFAULT_PROFILE = 'web'
const DEFAULT_URL = 'http://127.0.0.1:3080'
const DEFAULT_TIMEOUT_MS = 30_000

const repoRoot = findRepoRoot(process.env.DSH_REPO_ROOT ?? process.cwd())
const profile = process.env.DSH_PROFILE ?? DEFAULT_PROFILE
const dshPackage = process.env.DSH_PACKAGE ?? DEFAULT_DSH_PACKAGE
const dshHome = resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh'))
const cleanWorkspaceRoot = resolve(
  process.env.DSH_CLEAN_WORKSPACE ?? join(homedir(), 'source', 'silin', 'dsh-test'),
)
const dshUrl = parseLocalUrl(process.env.DSH_URL ?? DEFAULT_URL)
if (!/^[a-z0-9][a-z0-9_-]*$/i.test(profile)) {
  throw new Error('DSH_PROFILE must be a simple profile name')
}
const startTimeoutMs = parsePositiveInteger(
  process.env.DSH_START_TIMEOUT_MS,
  DEFAULT_TIMEOUT_MS,
  'DSH_START_TIMEOUT_MS',
)
const childEnv = { ...process.env, DSH_HOME: dshHome }
const managedStatePath = join(dshHome, 'dsh-data-analysis', `web-${profile}.json`)

main().catch((error) => {
  console.error(`dsh-plugin-rebuild failed: ${error.message}`)
  process.exitCode = 1
})

async function main() {
  const cleanupTargets = validateLocalStateTargets({
    workspaceRoot: cleanWorkspaceRoot,
    dshHome,
  })
  console.log(`Repository: ${repoRoot}`)
  console.log(`Profile: ${profile}`)
  console.log(`Clean workspace: ${cleanupTargets.workspaceRoot}`)

  run('npm', ['run', 'pack:plugin'])

  const packageJsonPath = join(repoRoot, 'packages', 'dsh-data-analysis', 'package.json')
  const packageJson = readJson(packageJsonPath)
  const version = packageJson.version
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error(`missing package version in ${packageJsonPath}`)
  }

  const tarballPath = join(
    repoRoot,
    'artifacts',
    'npm',
    `${PLUGIN_TARBALL_PREFIX}-${version}.tgz`,
  )
  if (!existsSync(tarballPath)) {
    throw new Error(`expected package tarball was not generated: ${tarballPath}`)
  }
  console.log(`Tarball: ${tarballPath}`)

  const profileDir = join(dshHome, 'profiles', profile)
  if (profileHasPlugin(profileDir)) {
    console.log(`Removing existing ${PLUGIN_NAME} from profile ${profile}`)
    runDsh(['plugin', '--profile', profile, 'remove', PLUGIN_NAME])
  } else {
    console.log(`No existing ${PLUGIN_NAME} dependency found in profile ${profile}`)
  }

  console.log(`Installing ${PLUGIN_NAME} into profile ${profile}`)
  runDsh(['plugin', '--profile', profile, 'add', tarballPath])

  const groups = findTargetProcessGroups()
  if (groups.length > 1) {
    throw new Error(
      `found multiple DSH ${profile} process groups (${groups.join(', ')}); stop manually or set up one local instance before retrying`,
    )
  }

  if (groups.length === 1) {
    console.log(`Stopping existing DSH process group ${groups[0]}`)
    await stopProcessGroup(groups[0])
    clearManagedProcessState()
  } else {
    console.log(`No existing DSH ${profile} process found`)
  }

  if (await isPortOpen()) {
    throw new Error(
      `local URL ${dshUrl.href} is still occupied by an unknown process; refusing to start DSH`,
    )
  }

  const cleanup = cleanLocalState({ workspaceRoot: cleanWorkspaceRoot, dshHome })
  console.log(
    `Cleaned Marivo state: ${cleanup.marivoStateDir} (${cleanup.marivoEntries} entries)`,
  )
  console.log(
    `Cleaned DSH sessions: ${cleanup.dshSessionsDir} (${cleanup.dshSessionEntries} entries)`,
  )
  console.log(
    `Cleared DSH workspace registry: ${cleanup.workspaceRegistryRemoved ? cleanup.dshWorkspaceRegistryPath : 'already absent'}`,
  )
  console.log(
    `Cleared DSH projection cache: ${cleanup.projectionCacheRemoved ? cleanup.dshProjectionCachePath : 'already absent'}`,
  )

  const logPath = resolve(
    process.env.DSH_LOG_PATH ?? join(tmpdir(), `dsh-data-analysis-${profile}.log`),
  )
  mkdirSync(dirname(logPath), { recursive: true })
  const logFd = openSync(logPath, 'a')
  let child
  try {
    child = startDsh(logFd)
  } finally {
    closeSync(logFd)
  }

  console.log(`Started DSH ${profile} with PID ${child.pid ?? 'unknown'}`)
  console.log(`DSH log: ${logPath}`)

  if (!(await waitForHttp(startTimeoutMs))) {
    if (typeof child.pid === 'number') terminateProcessGroup(child.pid)
    throw new Error(
      `DSH did not become reachable at ${dshUrl.href} within ${startTimeoutMs} ms; inspect ${logPath}`,
    )
  }

  writeManagedProcessState(child.pid)
  console.log(`DSH is ready at ${dshUrl.href}`)
}

function findRepoRoot(startPath) {
  let current = resolve(startPath)
  while (true) {
    const rootPackagePath = join(current, 'package.json')
    const pluginPackagePath = join(current, 'packages', 'dsh-data-analysis', 'package.json')
    if (existsSync(rootPackagePath) && existsSync(pluginPackagePath)) {
      const rootPackage = readJson(rootPackagePath)
      if (rootPackage.private === true && Array.isArray(rootPackage.workspaces)) return current
    }
    const parent = dirname(current)
    if (parent === current) {
      throw new Error('run this skill from the dsh-data-analysis repository root')
    }
    current = parent
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch (error) {
    throw new Error(`cannot read JSON ${filePath}: ${error.message}`)
  }
}

function profileHasPlugin(profileDir) {
  const packagePath = join(profileDir, 'package.json')
  if (existsSync(packagePath)) {
    const packageJson = readJson(packagePath)
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      if (packageJson[field]?.[PLUGIN_NAME] !== undefined) return true
    }
  }
  return existsSync(join(profileDir, 'node_modules', '@deepseek-ai', 'dsh-data-analysis'))
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: childEnv,
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with status ${result.status ?? 'unknown'}`)
  }
}

function runDsh(args) {
  const launcher = process.env.DSH_LAUNCHER ?? 'npx'
  const invocation = launcher === 'npx'
    ? [launcher, ['--no-install', dshPackage, ...args]]
    : [launcher, args]
  run(invocation[0], invocation[1])
}

function startDsh(logFd) {
  const launcher = process.env.DSH_LAUNCHER ?? 'npx'
  const args = profile === 'web'
    ? ['web']
    : ['--profile', profile]
  const invocation = launcher === 'npx'
    ? [launcher, ['--no-install', dshPackage, ...args]]
    : [launcher, args]
  const child = spawn(invocation[0], invocation[1], {
    cwd: repoRoot,
    env: childEnv,
    detached: true,
    stdio: ['ignore', logFd, logFd],
  })
  child.unref()
  return child
}

function parseLocalUrl(rawUrl) {
  let parsed
  try {
    parsed = new URL(rawUrl)
  } catch (error) {
    throw new Error(`invalid DSH_URL: ${error.message}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('DSH_URL must use http or https')
  }
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(parsed.hostname)) {
    throw new Error('DSH_URL must point to a loopback host')
  }
  return parsed
}

function parsePositiveInteger(rawValue, fallback, name) {
  if (rawValue === undefined) return fallback
  const value = Number(rawValue)
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
  return value
}

function listProcesses() {
  const result = spawnSync('ps', ['-axo', 'pid=,ppid=,pgid=,command='], { encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`ps exited with status ${result.status ?? 'unknown'}`)

  return result.stdout
    .split('\n')
    .map((line) => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/)
      if (match === null) return null
      return {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        pgid: Number(match[3]),
        command: match[4].trim(),
      }
    })
    .filter((process) => process !== null)
}

function isTargetCommand(command) {
  const normalized = command.replace(/\s+/g, ' ').trim()
  if (profile === 'web') {
    return normalized.includes(`${dshPackage} web`) || /(?:^|[\/\s])dsh\s+web(?:\s|$)/.test(normalized)
  }
  return normalized.includes(`${dshPackage} --profile ${profile}`)
    || new RegExp(`(?:^|[\\/\\s])dsh\\s+--profile\\s+${escapeRegExp(profile)}(?:\\s|$)`).test(normalized)
}

function listListeningPids() {
  const port = Number(dshUrl.port || (dshUrl.protocol === 'https:' ? 443 : 80))
  const result = spawnSync('lsof', [
    '-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp',
  ], { encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`lsof exited with status ${result.status ?? 'unknown'}`)
  }
  return new Set(result.stdout.split('\n').flatMap(line => {
    const match = /^p(\d+)$/.exec(line.trim())
    return match === null ? [] : [Number(match[1])]
  }))
}

function processCwd(pid) {
  const result = spawnSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) return null
  return result.stdout.split('\n').find(line => line.startsWith('n'))?.slice(1) ?? null
}

function managedExpectation() {
  return {
    version: 1,
    profile,
    url: dshUrl.href,
    repoRoot,
    dshHome,
  }
}

function readManagedProcessState() {
  if (!existsSync(managedStatePath)) return null
  const value = readJson(managedStatePath)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`invalid managed DSH state: ${managedStatePath}`)
  }
  return value
}

function selectStateGroup(state, processes = listProcesses()) {
  const currentPid = process.pid
  const own = processes.find((entry) => entry.pid === currentPid)
  const cwdByPid = new Map(
    processes.filter(entry => entry.pgid === state.pgid).map(entry => [entry.pid, processCwd(entry.pid)]),
  )
  return selectManagedProcessGroup({
    state,
    expected: managedExpectation(),
    processes,
    listeningPids: listListeningPids(),
    cwdByPid,
    currentPid,
    currentPgid: own?.pgid,
    isTargetCommand,
  })
}

function findTargetProcessGroups() {
  const processes = listProcesses()
  const state = readManagedProcessState()
  if (state !== null) {
    const group = selectStateGroup(state, processes)
    if (group !== null) return [group]
  }

  const currentPid = process.pid
  const own = processes.find(entry => entry.pid === currentPid)
  const listeningPids = listListeningPids()
  const listeningGroups = new Set(
    processes.filter(entry => listeningPids.has(entry.pid)).map(entry => entry.pgid),
  )
  const cwdByPid = new Map(
    processes.filter(entry => listeningGroups.has(entry.pgid)).map(entry => [entry.pid, processCwd(entry.pid)]),
  )
  const takeoverGroup = selectTakeoverProcessGroup({
    processes,
    listeningPids,
    cwdByPid,
    currentPid,
    currentPgid: own?.pgid,
    repoRoot,
    isTargetCommand,
  })
  return takeoverGroup === null ? [] : [takeoverGroup]
}

function writeManagedProcessState(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error('DSH launcher returned an unsafe PID')
  const state = { ...managedExpectation(), pid, pgid: pid }
  const selected = selectStateGroup(state)
  if (selected !== pid) throw new Error('started DSH process group could not be verified')
  mkdirSync(dirname(managedStatePath), { recursive: true })
  const temporaryPath = `${managedStatePath}.${pid}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporaryPath, managedStatePath)
}

function clearManagedProcessState() {
  try {
    unlinkSync(managedStatePath)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

async function stopProcessGroup(pgid) {
  terminateProcessGroup(pgid, 'SIGTERM')
  if (await waitForProcessGroupExit(pgid, 10_000)) return
  terminateProcessGroup(pgid, 'SIGKILL')
  if (!(await waitForProcessGroupExit(pgid, 5_000))) {
    throw new Error(`DSH process group ${pgid} did not stop`)
  }
}

function terminateProcessGroup(pgid, signal = 'SIGTERM') {
  try {
    process.kill(-pgid, signal)
  } catch (error) {
    if (error.code !== 'ESRCH') throw new Error(`cannot send ${signal} to process group ${pgid}: ${error.message}`)
  }
}

function processGroupExists(pgid) {
  return listProcesses().some((process) => process.pgid === pgid)
}

async function waitForProcessGroupExit(pgid, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!processGroupExists(pgid)) return true
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250))
  }
  return !processGroupExists(pgid)
}

function isPortOpen() {
  return new Promise((resolvePromise) => {
    const socket = createConnection({
      host: dshUrl.hostname.replace(/^\[|\]$/g, ''),
      port: Number(dshUrl.port || (dshUrl.protocol === 'https:' ? 443 : 80)),
    })
    let settled = false
    const finish = (open) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolvePromise(open)
    }
    socket.setTimeout(750, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

async function waitForHttp(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(dshUrl, { signal: AbortSignal.timeout(1_500) })
      if (response.status >= 100 && response.status < 600) return true
    } catch {
      // DSH is still starting or the listener has not accepted connections yet.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500))
  }
  return false
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
