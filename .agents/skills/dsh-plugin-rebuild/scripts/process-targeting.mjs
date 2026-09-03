/**
 * Validate one process group previously started by this skill.
 * Command text is only one signal: the persisted launch identity, target
 * listener, and repository cwd must all agree before the caller may stop it.
 */
export function selectManagedProcessGroup({
  state,
  expected,
  processes,
  listeningPids,
  cwdByPid,
  currentPid,
  currentPgid,
  isTargetCommand,
}) {
  for (const [key, value] of Object.entries(expected)) {
    if (state[key] !== value) {
      throw new Error(`managed DSH state ${key} does not match this launch (${String(state[key])})`)
    }
  }
  if (!Number.isSafeInteger(state.pgid) || state.pgid <= 1) {
    throw new Error(`managed DSH state has unsafe process group ${String(state.pgid)}`)
  }
  if (state.pgid === currentPgid) {
    throw new Error(`refusing to stop the current process group ${state.pgid}`)
  }
  const group = processes.filter(entry => entry.pgid === state.pgid && entry.pid !== currentPid)
  if (group.length === 0) return null
  if (!group.some(entry => isTargetCommand(entry.command))) {
    throw new Error(`managed process group ${state.pgid} no longer contains the expected DSH command`)
  }
  if (!group.some(entry => listeningPids.has(entry.pid))) {
    throw new Error(`managed process group ${state.pgid} does not own the configured DSH listener`)
  }
  const foreignCwd = group.find(entry => cwdByPid.get(entry.pid) !== expected.repoRoot)
  if (foreignCwd !== undefined) {
    throw new Error(
      `managed process group ${state.pgid} contains PID ${foreignCwd.pid} outside the repository cwd`,
    )
  }
  return state.pgid
}

/**
 * Select an already-running DSH process group that predates this skill's
 * persisted state. The configured listener itself must be the expected DSH
 * command, and every process in the group must belong to the repository cwd.
 */
export function selectTakeoverProcessGroup({
  processes,
  listeningPids,
  cwdByPid,
  currentPid,
  currentPgid,
  repoRoot,
  isTargetCommand,
}) {
  const processByPid = new Map(processes.map(entry => [entry.pid, entry]))
  const listeners = [...listeningPids].map((pid) => {
    const entry = processByPid.get(pid)
    if (entry === undefined) {
      throw new Error(`configured DSH listener PID ${pid} is missing from the process table`)
    }
    return entry
  })
  if (listeners.length === 0) return null

  const groups = new Set(listeners.map(entry => entry.pgid))
  if (groups.size !== 1) {
    throw new Error('configured DSH listener is owned by multiple process groups')
  }
  const [pgid] = groups
  if (!Number.isSafeInteger(pgid) || pgid <= 1) {
    throw new Error(`configured DSH listener has unsafe process group ${String(pgid)}`)
  }
  if (pgid === currentPgid) {
    throw new Error(`refusing to stop the current process group ${pgid}`)
  }
  if (!listeners.some(entry => entry.pid !== currentPid && isTargetCommand(entry.command))) {
    return null
  }

  const group = processes.filter(entry => entry.pgid === pgid && entry.pid !== currentPid)
  const foreignCwd = group.find(entry => cwdByPid.get(entry.pid) !== repoRoot)
  if (foreignCwd !== undefined) {
    throw new Error(
      `takeover process group ${pgid} contains PID ${foreignCwd.pid} outside the repository cwd`,
    )
  }
  return pgid
}
