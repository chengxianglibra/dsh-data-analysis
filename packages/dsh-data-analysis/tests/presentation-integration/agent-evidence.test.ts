import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assessLifecycle,
  type RuntimeObservation,
  verifyLifecycle,
} from '../../scripts/presentation-agent-real/verify.ts'

// These records exercise acceptance of observer evidence. The isolated real-Agent
// runner produces the actual Python calls; generated source text is not evidence.
// Strict cleanup conformance does not determine analysis/report validity.
function closedSession(pid = 41, objectId = 7): RuntimeObservation[] {
  const context = { pid, cwd: '/isolated/workspace', agentCode: true }
  const session = { sessionId: `session-${pid}`, objectId }
  return [
    { ...context, timeMs: 10, operation: 'process-start', agentCode: false },
    { ...context, timeMs: 20, operation: 'agent-code-start' },
    { ...context, ...session, timeMs: 28, operation: '__init__' },
    { ...context, ...session, timeMs: 30, operation: 'acquire' },
    { ...context, ...session, timeMs: 40, operation: 'close-call' },
    { ...context, ...session, timeMs: 50, operation: 'close' },
    { ...context, timeMs: 60, operation: 'process-exit', unclosedObjectIds: [] },
  ]
}

test('internal construction does not require caller close, but acquiring that Session does', () => {
  const observations = closedSession()
  const acquired = observations.find((item) => item.operation === 'acquire')!
  const internal = { ...acquired, timeMs: 25, operation: '__init__', objectId: 6 }
  observations.splice(2, 0, internal)
  assert.deepEqual(verifyLifecycle(observations), verifyLifecycle(closedSession()))

  // The same object now crosses the public factory boundary. Closing the other
  // returned handle cannot discharge the newly acquired handle's obligation.
  const forgotten = [...observations]
  forgotten.splice(3, 0, { ...internal, timeMs: 26, operation: 'acquire' })
  assert.throws(() => verifyLifecycle(forgotten), assert.AssertionError)
})

test('strict cleanup conformance requires a recorded normal exit for every actual execution process', () => {
  const completed = closedSession()
  const withoutExit = closedSession(42).filter((item) => item.operation !== 'process-exit')
  assert.throws(() => verifyLifecycle(withoutExit), assert.AssertionError)
  assert.throws(() => verifyLifecycle([...completed, ...withoutExit]), assert.AssertionError)
  const exit = completed.find((item) => item.operation === 'process-exit')!
  assert.throws(() => verifyLifecycle([...completed, exit]), assert.AssertionError)
})

test('entering close or observing another process close cannot substitute for a Session returning from close', () => {
  const attempted = closedSession().filter((item) => item.operation !== 'close')
  attempted.find((item) => item.operation === 'process-exit')!.unclosedObjectIds = [7]
  assert.throws(() => verifyLifecycle(attempted), assert.AssertionError)
  // Python object IDs are only meaningful within their own process.
  assert.throws(
    () => verifyLifecycle([...attempted, ...closedSession(42, 7)]),
    assert.AssertionError,
  )
})

test('an exception from close violates cleanup guidance even after an earlier successful close', () => {
  const observations = closedSession()
  const entry = observations.find((item) => item.operation === 'close-call')!
  const exit = observations.pop()!
  observations.push(
    { ...entry, timeMs: 52 },
    { ...entry, timeMs: 53, operation: 'close-unwound' },
    exit,
  )
  assert.throws(() => verifyLifecycle(observations), assert.AssertionError)
})

test('a Session used after close needs another successful close to satisfy cleanup guidance', () => {
  const observations = closedSession()
  const acquired = observations.find((item) => item.operation === 'acquire')!
  const exit = observations.pop()!
  observations.push({ ...acquired, timeMs: 52, operation: 'observe', artifactRef: 'artifact-1' })
  assert.throws(() => verifyLifecycle([...observations, exit]), assert.AssertionError)
  observations.push({ ...acquired, timeMs: 55, operation: 'close' }, exit)
  assert.equal(verifyLifecycle(observations).closures[0]!.closedAt, 55)
})

test('a successful close return and clean observed exit preserve the exact Session lifecycle evidence', () => {
  const result = verifyLifecycle([...closedSession(), ...closedSession(42, 7)])
  assert.equal(result.processCount, 2)
  assert.deepEqual(result.closures, [
    { pid: 41, sessionId: 'session-41', objectId: 7, openedAt: 30, closedAt: 50 },
    { pid: 42, sessionId: 'session-42', objectId: 7, openedAt: 30, closedAt: 50 },
  ])
})

test('cleanup assessment records an unclosed public handle without throwing or discarding its process boundary', () => {
  const observations = closedSession().filter(
    (item) => item.operation !== 'close-call' && item.operation !== 'close',
  )
  observations.find((item) => item.operation === 'process-exit')!.unclosedObjectIds = [7]
  const assessment = assessLifecycle(observations)
  assert.equal(assessment.status, 'nonconformant')
  assert.deepEqual(
    assessment.processes.map((process) => ({
      pid: process.pid,
      exitCount: process.exitCount,
      handles: process.acquired.map((item) => [item.sessionId, item.objectId]),
      closeCount: process.explicitCloseReturns.length,
    })),
    [{ pid: 41, exitCount: 1, handles: [['session-41', 7]], closeCount: 0 }],
  )
})

test('constructor-only or missing-exit observations remain incomplete evidence', () => {
  const constructorOnly = assessLifecycle(
    closedSession().filter((item) => item.operation !== 'acquire'),
  )
  assert.equal(constructorOnly.status, 'evidence-incomplete')
  assert.equal(constructorOnly.processes[0]!.constructorOnlyObserver, true)
  assert.equal(constructorOnly.processes[0]!.exitCount, 1)
  assert.deepEqual(constructorOnly.processes[0]!.acquired, [])

  const missingExit = assessLifecycle(
    closedSession().filter((item) => item.operation !== 'process-exit'),
  )
  assert.equal(missingExit.status, 'evidence-incomplete')
  assert.equal(missingExit.processes[0]!.exitCount, 0)
})

test('cleanup assessment retains conformant public acquisition and close evidence', () => {
  const assessment = assessLifecycle(closedSession())
  assert.equal(assessment.status, 'conformant')
  assert.deepEqual(assessment.conformance?.closures, [
    { pid: 41, sessionId: 'session-41', objectId: 7, openedAt: 30, closedAt: 50 },
  ])
  assert.equal(assessment.processes[0]!.exitCount, 1)
})
