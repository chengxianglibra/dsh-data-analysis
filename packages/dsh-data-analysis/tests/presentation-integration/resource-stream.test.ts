import assert from 'node:assert/strict'
import test from 'node:test'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { parseResourceStream } from '../../src/presentation/contracts/resource-stream.ts'
import { resourceStreamFixture } from './resource-stream-fixture.ts'

const request = {
  sessionId: 'session',
  workspaceId: 'workspace',
  turn: 1,
  callId: 'present',
  after: 0,
}

test('Host resource stream delivers each resource sequentially before final admission, shares exact results, and commits once', async (t) => {
  const f = await resourceStreamFixture(t)
  const operation = f.tool.execute(
    {
      stage: 'preview',
      resourcePatch: {
        put: { fast: f.declaration('2'), reused: f.declaration('2'), slow: f.declaration('1') },
      },
      program: 'root = Stack([DatasetView("slow"), DatasetView("fast"), DatasetView("reused")]);',
    },
    f.exec,
  )
  let stream = parseResourceStream(await f.service.resourceStream(request, f.exec.signal))
  while (!stream.resources.fast)
    stream = parseResourceStream(
      await f.service.resourceStream({ ...request, after: stream.revision }, f.exec.signal),
    )
  assert.equal(stream.resources.slow, undefined)
  assert.equal(f.drafts.get('session'), undefined, 'resource readiness is not a successful draft')
  assert.ok(f.reads >= 1 && f.reads <= 2)
  assert.equal(f.peak, 1)
  f.release()
  const output = (await operation) as { draftRevision: string }
  assert.equal(f.drafts.get('session')?.document.buildId, output.draftRevision)
  assert.equal(Object.keys(f.drafts.get('session')!.document.resources).length, 3)
  assert.equal(f.reads, 2, 'final validation reuses the same admitted snapshots')
  const complete = parseResourceStream(await f.service.resourceStream(request, f.exec.signal))
  assert.equal(complete.status, 'complete')
  assert.equal(Object.keys(complete.resources).length, 3)
})

test('a failed resource does not block another resource and failed final admission preserves the last successful draft', async (t) => {
  const f = await resourceStreamFixture(t)
  const initial = (await f.tool.execute(
    { stage: 'preview', program: 'root = TextContent("Last successful revision");' },
    { ...f.exec, callId: 'initial' as ToolRunContext['callId'] },
  )) as { draftId: string; draftRevision: string }
  const operation = f.tool.execute(
    {
      stage: 'preview',
      draftId: initial.draftId,
      draftRevision: initial.draftRevision,
      resourcePatch: {
        put: { bad: f.declaration('3'), fast: f.declaration('2'), slow: f.declaration('1') },
      },
      program: 'root = Stack([DatasetView("slow"), DatasetView("bad"), DatasetView("fast")]);',
    },
    f.exec,
  )
  const rejection = assert.rejects(operation, /fixture-failed-result/)
  let stream = parseResourceStream(await f.service.resourceStream(request, f.exec.signal))
  while (!stream.resources.fast)
    stream = parseResourceStream(
      await f.service.resourceStream({ ...request, after: stream.revision }, f.exec.signal),
    )
  assert.equal(stream.resources.bad, undefined)
  f.release()
  await rejection
  assert.equal(f.drafts.get('session')?.document.buildId, initial.draftRevision)
  const failed = parseResourceStream(await f.service.resourceStream(request, f.exec.signal))
  assert.equal(failed.status, 'failed')
  assert.deepEqual(failed.resources, {})
})

test('resource stream reads reject changed Workspace and abort pending readers without minting a call', async (t) => {
  const f = await resourceStreamFixture(t)
  const abort = new AbortController()
  const pending = f.service.resourceStream(request, abort.signal)
  abort.abort(new Error('fixture-cancelled'))
  await assert.rejects(pending, /fixture-cancelled/)
  assert.equal(f.reads, 0)
  f.changeWorkspace()
  await assert.rejects(f.service.resourceStream(request, f.exec.signal), /workspace-unavailable/)
})
