import assert from 'node:assert/strict'
import test from 'node:test'
import { selectManagedProcessGroup, selectTakeoverProcessGroup } from './process-targeting.mjs'

const expected = {
  version: 1,
  profile: 'web',
  url: 'http://127.0.0.1:3080/',
  repoRoot: '/work/dsh-data-analysis',
  dshHome: '/home/test/.dsh',
}
const state = { ...expected, pid: 200, pgid: 200 }
const target = { pid: 200, ppid: 1, pgid: 200, command: 'npx @deepseek-ai/dsh web' }

function select(overrides = {}) {
  return selectManagedProcessGroup({
    state,
    expected,
    processes: [target],
    listeningPids: new Set([200]),
    cwdByPid: new Map([[200, expected.repoRoot]]),
    currentPid: 900,
    currentPgid: 900,
    isTargetCommand: command => command.includes('@deepseek-ai/dsh web'),
    ...overrides,
  })
}

test('selects only the persisted group that owns the target listener from the repository cwd', () => {
  assert.equal(select(), 200)
})

test('does not select a similarly named DSH process without persisted identity', () => {
  assert.throws(() => select({
    state: { ...state, dshHome: '/home/other/.dsh' },
  }), /dshHome does not match/)
})

test('does not select the persisted group when another process owns the target port', () => {
  assert.throws(() => select({ listeningPids: new Set([300]) }), /does not own/)
})

test('does not select a group containing a process from another cwd', () => {
  assert.throws(() => select({
    processes: [target, { pid: 201, ppid: 200, pgid: 200, command: 'node worker.js' }],
    cwdByPid: new Map([[200, expected.repoRoot], [201, '/work/unrelated']]),
  }), /outside the repository cwd/)
})

test('treats an exited persisted group as stale instead of selecting a replacement PID', () => {
  assert.equal(select({
    processes: [{ ...target, pid: 300, pgid: 300 }],
    listeningPids: new Set([300]),
    cwdByPid: new Map([[300, expected.repoRoot]]),
  }), null)
})

function selectTakeover(overrides = {}) {
  return selectTakeoverProcessGroup({
    processes: [target],
    listeningPids: new Set([200]),
    cwdByPid: new Map([[200, expected.repoRoot]]),
    currentPid: 900,
    currentPgid: 900,
    repoRoot: expected.repoRoot,
    isTargetCommand: command => command.includes('@deepseek-ai/dsh web'),
    ...overrides,
  })
}

test('takes over an unmanaged target listener from the repository cwd', () => {
  assert.equal(selectTakeover(), 200)
})

test('does not take over an unrelated listener even from the repository cwd', () => {
  assert.equal(selectTakeover({
    processes: [{ ...target, command: 'node unrelated-server.js' }],
  }), null)
})

test('does not take over when only a non-listening process matches the target command', () => {
  assert.equal(selectTakeover({
    processes: [
      { ...target, command: 'npx @deepseek-ai/dsh web' },
      { pid: 201, ppid: 200, pgid: 200, command: 'node unrelated-server.js' },
    ],
    listeningPids: new Set([201]),
    cwdByPid: new Map([[200, expected.repoRoot], [201, expected.repoRoot]]),
  }), null)
})

test('does not take over a group containing a process from another cwd', () => {
  assert.throws(() => selectTakeover({
    processes: [
      target,
      { pid: 201, ppid: 200, pgid: 200, command: 'node worker.js' },
    ],
    cwdByPid: new Map([[200, expected.repoRoot], [201, '/work/unrelated']]),
  }), /outside the repository cwd/)
})

test('does not take over the current process group', () => {
  assert.throws(() => selectTakeover({ currentPgid: 200 }), /current process group/)
})

test('does not take over listeners split across process groups', () => {
  assert.throws(() => selectTakeover({
    processes: [target, { ...target, pid: 300, pgid: 300 }],
    listeningPids: new Set([200, 300]),
    cwdByPid: new Map([[200, expected.repoRoot], [300, expected.repoRoot]]),
  }), /multiple process groups/)
})
