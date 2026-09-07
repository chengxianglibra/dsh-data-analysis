import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { MarivoEnvironmentError } from '../../src/environment/errors.ts'
import type { MarivoCheckedRunner, MarivoCheckedRunRequest } from '../../src/environment/types.ts'
import {
  PRESENTATION_BUDGETS,
  PresentationContractError,
  type PresentationDraft,
} from '../../src/presentation/contracts/index.ts'
import {
  MarivoPresentationProjection,
  readWorkspaceJson,
} from '../../src/presentation/projection/index.ts'
import { MARIVO_PRESENTATION_READ_PROGRAM } from '../../src/presentation/projection/program.ts'

const fixtures = new URL('../presentation-s0/fixtures/', import.meta.url)
const options = { workspaceId: 'workspace', buildId: 'build', generatedAt: '2026-09-07T00:00:00Z' }
const declared = {
  id: 'sales',
  ref: { sessionId: 'session', artifactRef: 'artifact', findingId: 'finding' },
}
const available = {
  ...declared,
  status: 'available',
  label: 'Public Artifact',
  facts: [{ label: 'Evidence status', value: 'complete' }],
}
const smallData = {
  schemaVersion: 1,
  columns: [{ id: 'value', label: 'value', type: 'int64', nullable: false }],
  rows: [['9007199254740993']],
  rowCount: 1,
  limit: 1,
  truncated: false,
}
function artifactDraft(): PresentationDraft {
  return {
    schemaVersion: 1,
    title: 'Artifact',
    sources: [structuredClone(declared)],
    datasets: [
      { id: 'data', kind: 'artifact', sourceId: 'sales', rowLimit: 1, columns: ['value'] },
    ],
    blocks: [{ id: 'table', kind: 'table', datasetId: 'data' }],
  }
}
function computedDraft(sourceIds: string[] = []): PresentationDraft {
  return {
    schemaVersion: 1,
    title: 'computed',
    sources: [],
    datasets: [{ id: 'data', kind: 'computed', path: 'computed.json', sourceIds }],
    blocks: [{ id: 'table', kind: 'table', datasetId: 'data' }],
  }
}
function success() {
  return {
    ok: true,
    sources: [structuredClone(available)],
    datasets: [{ id: 'data', data: structuredClone(smallData) }],
    diagnostics: [],
  }
}
async function fixture(payload: unknown = success()) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-presentation-projection-')))
  const requests: MarivoCheckedRunRequest[] = []
  const runner = {
    status: 'ready' as const,
    binding: {
      projectRoot: root,
      pythonExecutable: '/selected/python',
      marivoVersion: '0.5.4',
      packagePath: '/selected/marivo/__init__.py',
      subprocessPolicyId: 'policy',
      fingerprint: 'f'.repeat(64),
      presentationKit: {
        version: '0.1.1',
        packagePath: '/selected/dsh_data_analysis_presentation/__init__.py',
      },
    },
    async runChecked(request: MarivoCheckedRunRequest) {
      requests.push(request)
      return {
        exitCode: 0,
        signal: null,
        stdout: Buffer.from(JSON.stringify(payload)),
        stderr: Buffer.alloc(0),
        durationMs: 1,
      }
    },
  } satisfies MarivoCheckedRunner
  return {
    root,
    requests,
    runner,
    bridge: new MarivoPresentationProjection(runner),
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}
function errorAt(code: string, location: string) {
  return (error: unknown) =>
    error instanceof PresentationContractError && error.code === code && error.path === location
}

test('projects exact Artifact values, selections and identities through the fixed checked reader', async (t) => {
  const f = await fixture()
  t.after(f.cleanup)
  const document = await f.bridge.project(artifactDraft(), options)
  assert.deepEqual(document.datasets[0]?.data, smallData)
  assert.deepEqual(document.datasets[0]?.sourceIds, ['sales'])
  assert.deepEqual(document.sources[0], available)
  assert.equal(f.requests.length, 1)
  assert.equal(f.requests[0]?.program, MARIVO_PRESENTATION_READ_PROGRAM)
  assert.deepEqual(JSON.parse(f.requests[0]!.args![0]!), {
    sources: [declared],
    datasets: [{ ...artifactDraft().datasets[0], index: 0 }],
  })
  assert.equal(f.requests[0]?.stdin, undefined)
  assert.equal(f.requests[0]?.secretValues, undefined)
  assert.equal(f.requests[0]?.environmentOverlay, undefined)
})

test('computed exact fixture remains unchanged with multiple declared and unavailable sources', async (t) => {
  const raw = await readFile(new URL('computed.dataset.json', fixtures), 'utf8')
  const data = JSON.parse(raw)
  const sources = [
    available,
    {
      ...available,
      id: 'second',
      ref: { sessionId: 'second-session', artifactRef: 'other-artifact' },
    },
    {
      id: 'missing',
      ref: { sessionId: 'session', artifactRef: 'gone' },
      status: 'unavailable',
      reason: 'Artifact is unavailable.',
    },
  ]
  const f = await fixture({ ok: true, sources, datasets: [], diagnostics: [] })
  t.after(f.cleanup)
  await writeFile(path.join(f.root, 'computed.json'), raw)
  const draft = computedDraft(sources.map((source) => source.id))
  draft.sources = sources.map(({ id, ref }) => ({ id, ref }))
  const document = await f.bridge.project(draft, options)
  assert.deepEqual(document.datasets[0]?.data, data)
  assert.deepEqual(document.sources, sources)
  assert.deepEqual(
    document.diagnostics.map((item) => item.code),
    ['truncated', 'source_unavailable'],
  )
  assert.deepEqual(JSON.parse(f.requests[0]!.args![0]!).datasets, [])
})

test('source-only has no fabricated dataset, and no computed source declaration is required', async (t) => {
  const missing = { ...declared, status: 'unavailable', reason: 'Unavailable.' }
  const f = await fixture({ ok: true, sources: [missing], datasets: [], diagnostics: [] })
  t.after(f.cleanup)
  const sourceOnly = await f.bridge.project(
    {
      schemaVersion: 1,
      title: 'Sources',
      sources: [declared],
      datasets: [],
      blocks: [{ id: 'sources', kind: 'source', sourceIds: ['sales'] }],
    },
    options,
  )
  assert.deepEqual(sourceOnly.datasets, [])
  assert.deepEqual(sourceOnly.sources, [missing])
  await writeFile(path.join(f.root, 'computed.json'), JSON.stringify(smallData))
  assert.deepEqual((await f.bridge.project(computedDraft(), options)).sources, [])
  assert.equal(f.requests.length, 1)
})

test('direct Artifact fails for unavailable data and cannot accept an unavailable source', async (t) => {
  const f = await fixture({
    ok: false,
    error: {
      code: 'artifact_data_unavailable',
      path: '/datasets/0/data',
      message: 'Artifact data unavailable.',
    },
  })
  t.after(f.cleanup)
  await assert.rejects(
    f.bridge.project(artifactDraft(), options),
    errorAt('artifact_data_unavailable', '/datasets/0/data'),
  )
  const payload = success()
  payload.sources = [{ ...declared, status: 'unavailable', reason: 'Unavailable.' }] as never
  const g = await fixture(payload)
  t.after(g.cleanup)
  await assert.rejects(
    g.bridge.project(artifactDraft(), options),
    errorAt('invalid_reference', '/datasets/0/sourceIds'),
  )
})

test('rejects replaced Session, Artifact, Finding, source and dataset identities', async (t) => {
  for (const mutation of [
    (value: ReturnType<typeof success>) => {
      value.sources[0]!.ref.sessionId = 'other'
    },
    (value: ReturnType<typeof success>) => {
      value.sources[0]!.ref.artifactRef = 'other'
    },
    (value: ReturnType<typeof success>) => {
      value.sources[0]!.ref.findingId = 'other'
    },
    (value: ReturnType<typeof success>) => {
      value.sources[0]!.id = 'other'
    },
    (value: ReturnType<typeof success>) => {
      value.datasets[0]!.id = 'other'
    },
    (value: ReturnType<typeof success>) => {
      value.sources.reverse()
      value.sources.push(value.sources[0]!)
    },
  ]) {
    const payload = success()
    mutation(payload)
    const f = await fixture(payload)
    t.after(f.cleanup)
    await assert.rejects(
      f.bridge.project(artifactDraft(), options),
      (error: unknown) =>
        error instanceof MarivoEnvironmentError && error.code === 'subprocess-output-invalid',
    )
  }
})

test('returns precise typed-data location for computed numeric precision failure', async (t) => {
  const f = await fixture()
  t.after(f.cleanup)
  const bad = structuredClone(smallData)
  bad.columns[0]!.type = 'float64'
  bad.rows = [[9007199254740992]] as never
  await writeFile(path.join(f.root, 'computed.json'), JSON.stringify(bad))
  await assert.rejects(
    f.bridge.project(computedDraft(), options),
    errorAt('numeric_precision', '/datasets/0/data/rows/0/0'),
  )
})

test('computed files reject traversal, links, directories, malformed JSON and raw byte overflow', async (t) => {
  const f = await fixture()
  const outside = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-presentation-outside-')))
  t.after(f.cleanup)
  t.after(() => rm(outside, { recursive: true, force: true }))
  await writeFile(path.join(outside, 'data.json'), JSON.stringify(smallData))
  await symlink(path.join(outside, 'data.json'), path.join(f.root, 'computed.json'))
  await assert.rejects(
    f.bridge.project(computedDraft(), options),
    errorAt('file_boundary', '/datasets/0/path'),
  )
  await symlink(outside, path.join(f.root, 'linked'))
  await assert.rejects(
    readWorkspaceJson(f.root, 'linked/data.json', 1024, '/path'),
    errorAt('file_boundary', '/path'),
  )
  await assert.rejects(
    readWorkspaceJson(f.root, '../data.json', 1024, '/path'),
    errorAt('file_boundary', '/path'),
  )
  await mkdir(path.join(f.root, 'directory'))
  await assert.rejects(
    readWorkspaceJson(f.root, 'directory', 1024, '/path'),
    errorAt('file_boundary', '/path'),
  )
  await writeFile(path.join(f.root, 'invalid.json'), Buffer.from([0xff]))
  await assert.rejects(
    readWorkspaceJson(f.root, 'invalid.json', 1024, '/path'),
    errorAt('invalid_json', '/path'),
  )
  await writeFile(
    path.join(f.root, 'large.json'),
    ' '.repeat(PRESENTATION_BUDGETS.datasetBytes + 1),
  )
  await assert.rejects(
    readWorkspaceJson(f.root, 'large.json', PRESENTATION_BUDGETS.datasetBytes, '/path'),
    errorAt('budget', '/path'),
  )
})

test('draft file uses its own byte budget and rejects invented computed conversion fields', async (t) => {
  const f = await fixture()
  t.after(f.cleanup)
  const draft = computedDraft()
  await writeFile(path.join(f.root, 'draft.json'), JSON.stringify(draft))
  assert.deepEqual(await f.bridge.readDraft('draft.json'), draft)
  await assert.rejects(
    f.bridge.project({ ...draft, transformations: [] }, options),
    errorAt('unknown_field', '/transformations'),
  )
  await writeFile(path.join(f.root, 'draft.json'), ' '.repeat(PRESENTATION_BUDGETS.draftBytes + 1))
  await assert.rejects(f.bridge.readDraft('draft.json'), errorAt('budget', '/draft_path'))
})

test('cancellation stops before reads and failed subprocess stderr never leaks', async (t) => {
  const f = await fixture()
  t.after(f.cleanup)
  const controller = new AbortController()
  controller.abort(new Error('cancelled'))
  await assert.rejects(
    f.bridge.project(artifactDraft(), { ...options, signal: controller.signal }),
    /cancelled/,
  )
  assert.equal(f.requests.length, 0)
  f.runner.runChecked = async () => ({
    exitCode: 70,
    signal: null,
    stdout: Buffer.alloc(0),
    stderr: Buffer.from('secret-canary'),
    durationMs: 1,
  })
  await assert.rejects(f.bridge.project(artifactDraft(), options), (error: unknown) => {
    assert.ok(error instanceof MarivoEnvironmentError)
    assert.equal(error.code, 'subprocess-failed')
    assert.doesNotMatch(JSON.stringify(error), /secret-canary/)
    return true
  })
})

test('rejects unavailable checked helper identity and failed bindings before any read', async (t) => {
  const f = await fixture()
  t.after(f.cleanup)
  const { presentationKit: _kit, ...binding } = f.runner.binding
  const standalone = new MarivoPresentationProjection({ ...f.runner, binding })
  await assert.rejects(
    standalone.project(artifactDraft(), options),
    (error: unknown) =>
      error instanceof MarivoEnvironmentError && error.code === 'binding-identity-mismatch',
  )
  const failed = new MarivoPresentationProjection({ ...f.runner, status: 'failed' })
  await assert.rejects(
    failed.project(artifactDraft(), options),
    (error: unknown) => error instanceof MarivoEnvironmentError && error.code === 'binding-failed',
  )
  assert.equal(f.requests.length, 0)
})

test('FIFO inputs reject immediately instead of blocking the reader open', {
  skip: process.platform === 'win32',
}, async (t) => {
  const f = await fixture()
  t.after(f.cleanup)
  const created = spawnSync('mkfifo', [path.join(f.root, 'computed.json')])
  assert.equal(created.status, 0, created.stderr?.toString())
  await assert.rejects(
    f.bridge.project(computedDraft(), options),
    errorAt('file_boundary', '/datasets/0/path'),
  )
})

test('reader output must preserve selected Artifact columns and requested row budget', async (t) => {
  for (const mutation of [
    (value: ReturnType<typeof success>) => {
      value.datasets[0]!.data.columns[0]!.id = 'other'
    },
    (value: ReturnType<typeof success>) => {
      value.datasets[0]!.data.limit = 2
    },
  ]) {
    const payload = success()
    mutation(payload)
    const f = await fixture(payload)
    t.after(f.cleanup)
    await assert.rejects(
      f.bridge.project(artifactDraft(), options),
      (error: unknown) =>
        error instanceof MarivoEnvironmentError && error.code === 'subprocess-output-invalid',
    )
  }
})

test('source snapshots reject extra fields and preserve multiple declared source order', async (t) => {
  const extra = success()
  Object.assign(extra.sources[0]!, { privateDetail: 'private-canary' })
  const f = await fixture(extra)
  t.after(f.cleanup)
  await assert.rejects(f.bridge.project(artifactDraft(), options), (error: unknown) => {
    assert.ok(error instanceof PresentationContractError)
    assert.equal(error.code, 'unknown_field')
    assert.doesNotMatch(JSON.stringify(error), /private-canary/)
    return true
  })
  const second = { ...structuredClone(available), id: 'other' }
  const g = await fixture({
    ok: true,
    sources: [second, available],
    datasets: [],
    diagnostics: [],
  })
  t.after(g.cleanup)
  await assert.rejects(
    g.bridge.project(
      {
        schemaVersion: 1,
        title: 'Ordered sources',
        sources: [declared, { id: second.id, ref: second.ref }],
        datasets: [],
        blocks: [{ id: 'sources', kind: 'source', sourceIds: [declared.id, second.id] }],
      },
      options,
    ),
    (error: unknown) =>
      error instanceof MarivoEnvironmentError && error.code === 'subprocess-output-invalid',
  )
})
