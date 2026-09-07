import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler, HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { BuiltPresentation } from '../../src/presentation/build/index.ts'
import { commitPresentation } from '../../src/presentation/commit.ts'
import {
  PRESENTATION_BUDGETS,
  type PresentationDocument,
} from '../../src/presentation/contracts/index.ts'
import { presentationAssetPath, presentationSha256 } from '../../src/presentation/files.ts'
import { MarivoPresentationProjection } from '../../src/presentation/projection/index.ts'
import {
  parsePresentationDelivery,
  presentationReceiptText,
} from '../../src/presentation/receipt.ts'
import {
  MarivoPresentationFileService,
  registerMarivoPresentationRpc,
} from '../../src/presentation/rpc.ts'
import { createMarivoPresentTool, registerMarivoPresentTool } from '../../src/presentation/tool.ts'

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'presentation-s4-test-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const document: PresentationDocument = {
    schemaVersion: 1,
    workspaceId: 'workspace',
    buildId: 'build',
    title: 'Snapshot',
    generatedAt: '2026-09-07T00:00:00Z',
    datasets: [],
    sources: [],
    blocks: [{ id: 'body', kind: 'markdown', text: 'Readable snapshot' }],
    diagnostics: [],
  }
  const built: BuiltPresentation = {
    document,
    documentBytes: Buffer.from(JSON.stringify(document)),
    htmlBytes: Buffer.from('<!doctype html><p>Readable snapshot</p>'),
  }
  return { root, built, parent: path.join(root, '.dsh-data-analysis', 'presentations') }
}

test('commit publishes exactly two complete files, preserves old builds and returns exact hashes', async (t) => {
  const f = await fixture(t)
  let checks = 0
  const receipt = await commitPresentation(f.root, f.built, async () => {
    checks++
  })
  assert(checks >= 4)
  assert.deepEqual((await readdir(path.dirname(receipt.files.document.path))).sort(), [
    'index.html',
    'presentation.json',
  ])
  for (const file of Object.values(receipt.files)) {
    const bytes = await readFile(file.path)
    assert.equal(bytes.length, file.bytes)
    assert.equal(presentationSha256(bytes), file.sha256)
  }
  await assert.rejects(
    commitPresentation(f.root, f.built, async () => {}),
    /presentation-build-exists/,
  )
  assert.deepEqual(await readdir(f.parent), ['build'])
  assert.equal((await readFile(receipt.files.document.path)).equals(f.built.documentBytes), true)
})

test('cancellation after writing and ownership failure after rename leave no successful or partial build', async (t) => {
  for (const failAt of [3, 4]) {
    const f = await fixture(t)
    const controller = new AbortController()
    let calls = 0
    await assert.rejects(
      commitPresentation(
        f.root,
        f.built,
        async () => {
          if (++calls === failAt) controller.abort(new Error('cancel-original-present'))
        },
        controller.signal,
      ),
      /cancel-original-present/,
    )
    assert.deepEqual(await readdir(f.parent), [])
  }
})

test('partial file write failure cleans up only its owned temporary directory', async (t) => {
  const f = await fixture(t)
  let checks = 0
  await assert.rejects(
    commitPresentation(f.root, f.built, async () => {
      if (++checks === 2) {
        const [temporary] = await readdir(f.parent)
        await mkdir(path.join(f.parent, temporary!, 'index.html'))
      }
    }),
    /EEXIST/,
  )
  assert.deepEqual(await readdir(f.parent), [])
})

test('commit refuses a symbolic output parent without changing its destination', async (t) => {
  const f = await fixture(t)
  const outside = path.join(f.root, 'outside')
  await mkdir(outside)
  await symlink(outside, path.join(f.root, '.dsh-data-analysis'))
  await assert.rejects(
    commitPresentation(f.root, f.built, async () => {}),
    /presentation-directory-mismatch/,
  )
  assert.deepEqual(await readdir(outside), [])
})

test('RPC uses current Session Workspace authority and validates fixed paths, identities, both digests and bounds', async (t) => {
  const f = await fixture(t)
  const receipt = await commitPresentation(f.root, f.built, async () => {})
  const service = new MarivoPresentationFileService((sessionId) =>
    sessionId === 'session' ? { id: 'workspace', path: f.root } : undefined,
  )
  const input = { sessionId: 'session', receipt, asset: 'index.html' }
  const value = await service.read(input)
  assert.equal(Buffer.from(value.bodyBase64, 'base64').equals(f.built.htmlBytes), true)
  assert.equal(value.buildId, receipt.buildId)
  assert.equal(value.sha256, receipt.files.html.sha256)
  for (const [payload, error] of [
    [{ ...input, path: '/etc/passwd' }, /invalid-request/],
    [{ ...input, asset: '../index.html' }, /invalid-request/],
    [{ ...input, sessionId: 'other' }, /workspace-unavailable/],
    [{ ...input, receipt: { ...receipt, workspaceId: 'other' } }, /workspace-unavailable/],
    [{ ...input, receipt: { ...receipt, title: 'other' } }, /asset-owner-mismatch/],
    [
      {
        ...input,
        receipt: {
          ...receipt,
          files: {
            ...receipt.files,
            document: { ...receipt.files.document, sha256: '0'.repeat(64) },
          },
        },
      },
      /asset-digest-mismatch/,
    ],
  ] as const)
    await assert.rejects(service.read(payload), error)
  await writeFile(receipt.files.html.path, 'changed')
  await assert.rejects(service.read(input), /asset-digest-mismatch/)
  await truncate(receipt.files.html.path, PRESENTATION_BUDGETS.htmlBytes + 1)
  await assert.rejects(service.read(input), /asset-too-large/)
  await rm(receipt.files.html.path)
  await symlink(receipt.files.document.path, receipt.files.html.path)
  await assert.rejects(service.read(input), /asset-path-mismatch/)
  await rm(receipt.files.html.path)
  await assert.rejects(service.read(input), /ENOENT/)
})

test('RPC rejects Workspace changes while reading and cancelled or disposed reads', async (t) => {
  const f = await fixture(t)
  const receipt = await commitPresentation(f.root, f.built, async () => {})
  let lookups = 0
  const service = new MarivoPresentationFileService(() => ({
    id: 'workspace',
    path: ++lookups === 1 ? f.root : path.join(f.root, 'other'),
  }))
  const input = { sessionId: 'session', receipt, asset: 'presentation.json' }
  await assert.rejects(service.read(input), /workspace-changed/)
  const controller = new AbortController()
  controller.abort(new Error('cancel-rpc'))
  await assert.rejects(service.read(input, controller.signal), /cancel-rpc/)
  service.close()
  await assert.rejects(service.read(input), /abort/i)
})

test('production present accepts computed and source-only drafts, uses independent builds and returns complete headless text', async (t) => {
  const f = await fixture(t)
  const session = {
    id: 'session',
    events: [{ type: 'tool/call', data: { callId: 'call', name: 'marivo_present', turn: 2 } }],
  } as unknown as Session
  let reads = 0
  const runner = {
    status: 'ready' as const,
    binding: {
      projectRoot: f.root,
      pythonExecutable: '/bound/python',
      marivoVersion: '0.5.4',
      packagePath: '/bound/marivo',
      subprocessPolicyId: 'policy',
      fingerprint: 'fingerprint',
      presentationKit: { version: '1.0.0', packagePath: '/bound/presentation' },
    },
    async runChecked() {
      reads++
      return {
        exitCode: 0,
        signal: null,
        durationMs: 0,
        stderr: Buffer.alloc(0),
        stdout: Buffer.from(
          JSON.stringify({
            ok: true,
            sources: [
              {
                id: 'source',
                ref: { sessionId: 'analysis', artifactRef: 'artifact' },
                status: 'unavailable',
                reason: 'Artifact unavailable',
              },
            ],
            datasets: [],
            diagnostics: [],
          }),
        ),
      }
    },
  }
  const projection = new MarivoPresentationProjection(runner)
  const tool = createMarivoPresentTool(() => ({ workspaceId: 'workspace', projection }), session)
  const exec = {
    agent: { session },
    callId: 'call',
    signal: new AbortController().signal,
  } as unknown as ToolRunContext
  const draft = {
    schemaVersion: 1,
    title: 'Source only',
    datasets: [],
    sources: [{ id: 'source', ref: { sessionId: 'analysis', artifactRef: 'artifact' } }],
    blocks: [{ id: 'sources', kind: 'source', sourceIds: ['source'] }],
  }
  await writeFile(path.join(f.root, 'draft.json'), JSON.stringify(draft))
  const first = parsePresentationDelivery(
    JSON.parse(
      ((await tool.execute({ draft_path: 'draft.json' }, exec)) as { deliveryJson: string })
        .deliveryJson,
    ),
  )
  assert.equal(first.dshSessionId, 'session')
  assert.equal(first.turn, 2)
  assert.equal(reads, 1)
  assert.equal(
    (await readFile(first.receipt.files.html.path)).length,
    first.receipt.files.html.bytes,
  )
  const dataset = {
    schemaVersion: 1,
    columns: [{ id: 'value', label: 'Value', type: 'int64', nullable: false }],
    rows: [['9007199254740993']],
    rowCount: 1,
    limit: 1,
    truncated: false,
  }
  await writeFile(path.join(f.root, 'data.json'), JSON.stringify(dataset))
  await writeFile(
    path.join(f.root, 'draft.json'),
    JSON.stringify({
      schemaVersion: 1,
      title: 'Computed',
      sources: [],
      datasets: [{ id: 'data', kind: 'computed', path: 'data.json', sourceIds: [] }],
      blocks: [{ id: 'table', kind: 'table', datasetId: 'data' }],
    }),
  )
  const second = parsePresentationDelivery(
    JSON.parse(
      ((await tool.execute({ draft_path: 'draft.json' }, exec)) as { deliveryJson: string })
        .deliveryJson,
    ),
  )
  assert.notEqual(first.receipt.buildId, second.receipt.buildId)
  assert.equal(reads, 1)
  const text = presentationReceiptText(second.receipt)
  for (const file of Object.values(second.receipt.files)) {
    assert(text.includes(file.path))
    assert(text.includes(file.sha256))
  }
  assert(text.includes('Workspace: workspace'))
  assert.equal((await readdir(f.parent)).length, 2)
  await assert.rejects(tool.execute({ draft_path: '../outside.json' }, exec), /Workspace/)
  const otherSession = {
    ...exec,
    agent: { session: { ...session } },
  } as unknown as ToolRunContext
  await assert.rejects(
    tool.execute({ draft_path: 'draft.json' }, otherSession),
    /presentation-session-mismatch/,
  )
})

test('internal file helpers reject traversal and commit rejects invalid or oversized bytes before creating output', async (t) => {
  const f = await fixture(t)
  assert.throws(
    () => presentationAssetPath(f.root, '../outside', 'index.html'),
    /safe build identifier/,
  )
  assert.throws(
    () => presentationAssetPath(f.root, 'build', '../outside' as 'index.html'),
    /invalid-asset/,
  )
  await assert.rejects(
    commitPresentation(f.root, { ...f.built, documentBytes: Buffer.from('{}') }, async () => {}),
    /presentation-build-document-mismatch/,
  )
  await assert.rejects(
    commitPresentation(
      f.root,
      { ...f.built, htmlBytes: Buffer.alloc(PRESENTATION_BUDGETS.htmlBytes + 1) },
      async () => {},
    ),
    /presentation-build-budget/,
  )
  assert.deepEqual(await readdir(f.root), [])
})

test('commit snapshots caller-owned data before asynchronous ownership checks', async (t) => {
  const f = await fixture(t)
  const expected = Buffer.from(f.built.documentBytes)
  const expectedHtml = Buffer.from(f.built.htmlBytes)
  const receipt = await commitPresentation(f.root, f.built, async () => {
    f.built.document.title = 'Late mutation'
    f.built.documentBytes.fill(0)
    f.built.htmlBytes.fill(0)
  })
  assert.equal(receipt.title, 'Snapshot')
  assert.deepEqual(await readFile(receipt.files.document.path), expected)
  assert.deepEqual(await readFile(receipt.files.html.path), expectedHtml)
})

test('Tool disposal and Runtime failure abort a pending commit without creating a success value', async (t) => {
  for (const failure of ['dispose', 'runtime'] as const) {
    const f = await fixture(t)
    await writeFile(
      path.join(f.root, 'draft.json'),
      JSON.stringify({
        schemaVersion: 1,
        title: 'Pending',
        datasets: [],
        sources: [],
        blocks: [{ id: 'body', kind: 'markdown', text: 'Body' }],
      }),
    )
    const session = {
      id: 'session',
      events: [{ type: 'tool/call', data: { callId: 'call', name: 'marivo_present', turn: 0 } }],
    } as unknown as Session
    const runner = {
      status: 'ready' as 'ready' | 'failed',
      binding: {
        projectRoot: f.root,
        pythonExecutable: '/bound/python',
        marivoVersion: '0.5.4',
        packagePath: '/bound/marivo',
        subprocessPolicyId: 'policy',
        fingerprint: 'fingerprint',
        presentationKit: { version: '1.0.0', packagePath: '/bound/presentation' },
      },
      async runChecked(): Promise<never> {
        throw new Error('No source execution expected')
      },
    }
    const projection = new MarivoPresentationProjection(runner)
    let tool: ToolDefinition | undefined
    let unregistered = false
    const ctx = {
      tools: {
        register(value: ToolDefinition) {
          tool = value
          return () => {
            unregistered = true
          }
        },
      },
    } as unknown as Context
    let lookups = 0
    const dispose = registerMarivoPresentTool(
      ctx,
      () => {
        if (++lookups === 7) {
          if (failure === 'dispose') dispose()
          else runner.status = 'failed'
        }
        return { workspaceId: 'workspace', projection }
      },
      session,
    )
    const exec = {
      agent: { session },
      callId: 'call',
      signal: new AbortController().signal,
    } as unknown as ToolRunContext
    await assert.rejects(
      tool!.execute({ draft_path: 'draft.json' }, exec),
      failure === 'dispose' ? /abort/i : /presentation-workspace-changed/,
    )
    assert.deepEqual(await readdir(f.parent), [])
    if (failure === 'dispose') assert.equal(unregistered, true)
    dispose()
  }
})

test('production RPC classifies missing files and unavailable Workspaces without exposing provider paths', async (t) => {
  const f = await fixture(t)
  const receipt = await commitPresentation(f.root, f.built, async () => {})
  let handler: ConnectionRpcHandler | undefined
  const connection = {
    rpc: {
      handle(_channel: string, value: ConnectionRpcHandler) {
        handler = value
        return async () => {}
      },
    },
  } as unknown as HostConnectionHandle
  const input = { sessionId: 'session', receipt, asset: 'index.html' }
  const service = new MarivoPresentationFileService(() => ({ id: 'workspace', path: f.root }))
  const stop = registerMarivoPresentationRpc(connection, service)
  await rm(receipt.files.html.path)
  const missing = await handler!('files/read', input, new AbortController().signal)
  assert.deepEqual(missing, {
    ok: false,
    error: { code: 'internal', message: 'asset-missing', details: {} },
  })
  assert.equal(JSON.stringify(missing).includes(f.root), false)
  await stop()
  const unavailable = new MarivoPresentationFileService(() => {
    throw new Error(`Workspace resolver failed: ${f.root}/provider-private`)
  })
  const stopUnavailable = registerMarivoPresentationRpc(connection, unavailable)
  const result = await handler!('files/read', input, new AbortController().signal)
  assert.deepEqual(result, {
    ok: false,
    error: { code: 'internal', message: 'workspace-unavailable', details: {} },
  })
  assert.equal(JSON.stringify(result).includes('provider-private'), false)
  await stopUnavailable()
})
