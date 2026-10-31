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
import type { Session } from '@deepseek-ai/dsh-session'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { type BuiltPresentation, commitPresentation } from '../../src/presentation/commit.ts'
import {
  analysisCatalogBuild,
  analysisCatalogId,
} from '../../src/presentation/contracts/analysis-catalog.ts'
import {
  ANALYSIS_UI_FORMAT,
  type AnalysisDocument,
  analysisRecordId,
} from '../../src/presentation/contracts/analysis-document.ts'
import { PRESENTATION_BUDGETS } from '../../src/presentation/contracts/index.ts'
import { presentationAssetPath, presentationSha256 } from '../../src/presentation/files.ts'
import {
  parsePresentationDelivery,
  presentationReceiptText,
} from '../../src/presentation/receipt.ts'
import {
  MarivoPresentationFileService,
  registerMarivoPresentationRpc,
} from '../../src/presentation/rpc.ts'
import { createMarivoPresentTool, registerMarivoPresentTool } from '../../src/presentation/tool.ts'
import { createConnectionFixture } from '../semantic-reference-input/fixtures.ts'

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'presentation-s4-test-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const document: AnalysisDocument = {
    schemaVersion: ANALYSIS_UI_FORMAT,
    workspaceId: 'workspace',
    reportId: 'report',
    buildId: 'build',
    recordId: analysisRecordId('report', 'build'),
    title: 'Snapshot',
    locale: 'zh-CN',
    generatedAt: '2026-09-07T00:00:00Z',
    catalog: { id: analysisCatalogId, build: analysisCatalogBuild },
    program: 'root = TextContent("Readable snapshot");',
    resources: {},
  }
  const built: BuiltPresentation = {
    document,
    documentBytes: Buffer.from(JSON.stringify(document)),
  }
  return {
    root,
    built,
    parent: path.join(root, '.dsh-data-analysis', 'presentations', 'report', 'builds'),
  }
}

test('commit publishes one complete document, preserves old builds and returns exact hashes', async (t) => {
  const f = await fixture(t)
  let checks = 0
  const receipt = await commitPresentation(f.root, f.built, async () => {
    checks++
  })
  assert(checks >= 4)
  assert.deepEqual(Object.keys(receipt.files), ['document'])
  assert.deepEqual(await readdir(path.dirname(receipt.files.document.path)), ['presentation.json'])
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
        await mkdir(path.join(f.parent, temporary!, 'presentation.json'))
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

test('RPC uses current Session Workspace authority and validates fixed paths, identities, digest and bounds', async (t) => {
  const f = await fixture(t)
  const receipt = await commitPresentation(f.root, f.built, async () => {})
  const service = new MarivoPresentationFileService((sessionId) =>
    sessionId === 'session' ? { id: 'workspace', path: f.root } : undefined,
  )
  const input = { sessionId: 'session', receipt, asset: 'presentation.json' }
  const value = await service.read(input)
  assert.equal(Buffer.from(value.bodyBase64, 'base64').equals(f.built.documentBytes), true)
  assert.equal(value.buildId, receipt.buildId)
  assert.equal(value.mimeType, 'application/json')
  assert.equal(value.sha256, receipt.files.document.sha256)
  for (const [payload, error] of [
    [{ ...input, path: '/etc/passwd' }, /invalid-request/],
    [{ ...input, asset: 'index.html' }, /invalid-request/],
    [{ ...input, asset: '../presentation.json' }, /invalid-request/],
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
  const document = receipt.files.document.path
  const original = await readFile(document)
  await writeFile(document, 'changed')
  await assert.rejects(service.read(input), /asset-digest-mismatch/)
  await truncate(document, PRESENTATION_BUDGETS.documentBytes + 1)
  await assert.rejects(service.read(input), /asset-too-large/)
  await rm(document)
  const outside = path.join(f.root, 'outside.json')
  await writeFile(outside, original)
  await symlink(outside, document)
  await assert.rejects(service.read(input), /asset-path-mismatch/)
  await rm(document)
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

test('production present saves independent Lang documents and returns complete headless text', async (t) => {
  const f = await fixture(t)
  const session = {
    id: 'session',
    snapshotEvents: () => [
      { type: 'tool/call', data: { callId: 'call', name: 'marivo_present', turn: 2 } },
    ],
  } as unknown as Session
  const tool = createMarivoPresentTool(() => ({ id: 'workspace', path: f.root }), session)
  const exec = {
    agent: { session },
    callId: 'call',
    signal: new AbortController().signal,
  } as unknown as ToolRunContext
  const input = { title: 'Saved view', program: 'root = TextContent("Exact saved content");' }
  const present = async () =>
    parsePresentationDelivery(
      JSON.parse(((await tool.execute(input, exec)) as { deliveryJson: string }).deliveryJson),
    )
  const first = await present(),
    second = await present()
  assert.equal(first.surface, 'tool')
  assert.equal(first.dshSessionId, 'session')
  assert.equal(first.turn, 2)
  assert.notEqual(first.receipt.buildId, second.receipt.buildId)
  assert.deepEqual(Object.keys(first.receipt.files), ['document'])
  assert.deepEqual(await readdir(path.dirname(first.receipt.files.document.path)), [
    'presentation.json',
  ])
  const text = presentationReceiptText(second.receipt, second.surface)
  assert(text.includes('Record: marivo-ui:'))
  assert(text.includes('Build: '))
  assert(text.includes('Surface: tool view'))
  // Workspace paths and digests stay on disk, out of the model-facing text.
  assert(!text.includes(second.receipt.files.document.sha256))
  assert(!text.includes(second.receipt.files.document.path))
  await assert.rejects(tool.execute({ draft_path: 'draft.json' }, exec), /Unrecognized key/)
  await assert.rejects(
    tool.execute(input, {
      ...exec,
      agent: { session: { ...session } },
    } as unknown as ToolRunContext),
    /presentation-session-mismatch/,
  )
})

test('internal file helpers reject traversal and commit rejects invalid or oversized bytes before creating output', async (t) => {
  const f = await fixture(t)
  assert.throws(
    () => presentationAssetPath(f.root, 'report', '../outside', 'presentation.json'),
    /safe build identifier/,
  )
  assert.throws(
    () => presentationAssetPath(f.root, 'report', 'build', '../outside' as 'presentation.json'),
    /invalid-asset/,
  )
  await assert.rejects(
    commitPresentation(f.root, { ...f.built, documentBytes: Buffer.from('{}') }, async () => {}),
    /presentation-build-document-mismatch/,
  )
  await assert.rejects(
    commitPresentation(
      f.root,
      { ...f.built, documentBytes: Buffer.alloc(PRESENTATION_BUDGETS.documentBytes + 1) },
      async () => {},
    ),
    /presentation-build-budget/,
  )
  assert.deepEqual(await readdir(f.root), [])
})

test('commit snapshots caller-owned data before asynchronous ownership checks', async (t) => {
  const f = await fixture(t)
  const expected = Buffer.from(f.built.documentBytes)
  const receipt = await commitPresentation(f.root, f.built, async () => {
    f.built.document.title = 'Late mutation'
    f.built.documentBytes.fill(0)
  })
  assert.equal(receipt.title, 'Snapshot')
  assert.deepEqual(await readFile(receipt.files.document.path), expected)
})

test('Tool disposal and Workspace replacement abort a pending commit without creating a success value', async (t) => {
  for (const failure of ['dispose', 'workspace'] as const) {
    const f = await fixture(t)
    const session = {
      id: 'session',
      snapshotEvents: () => [
        { type: 'tool/call', data: { callId: 'call', name: 'marivo_present', turn: 0 } },
      ],
    } as unknown as Session
    let currentRoot = f.root
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
        if (++lookups === 5) {
          if (failure === 'dispose') dispose()
          else currentRoot = path.join(f.root, 'other')
        }
        return { id: 'workspace', path: currentRoot }
      },
      session,
    )
    const exec = {
      agent: { session },
      callId: 'call',
      signal: new AbortController().signal,
    } as unknown as ToolRunContext
    await assert.rejects(
      tool!.execute({ program: 'root = TextContent("Pending");' }, exec),
      failure === 'dispose' ? /abort/i : /presentation-workspace-changed/,
    )
    const reportRoot = path.join(f.root, '.dsh-data-analysis', 'presentations')
    const entries = await readdir(reportRoot, { recursive: true }).catch((error) => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    assert(
      !entries.some(
        (entry) => entry.endsWith('current.json') || entry.endsWith('presentation.json'),
      ),
    )
    if (failure === 'dispose') assert.equal(unregistered, true)
    dispose()
  }
})

test('production RPC classifies missing files and unavailable Workspaces without exposing provider paths', async (t) => {
  const f = await fixture(t)
  const receipt = await commitPresentation(f.root, f.built, async () => {})
  const { connection, channels } = createConnectionFixture()
  const input = { sessionId: 'session', receipt, asset: 'presentation.json' }
  const service = new MarivoPresentationFileService(() => ({ id: 'workspace', path: f.root }))
  const stop = registerMarivoPresentationRpc(connection, service)
  await rm(receipt.files.document.path)
  const missing = await channels.get('/marivo-presentation')!(
    'files/read',
    input,
    new AbortController().signal,
  )
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
  const result = await channels.get('/marivo-presentation')!(
    'files/read',
    input,
    new AbortController().signal,
  )
  assert.deepEqual(result, {
    ok: false,
    error: { code: 'internal', message: 'workspace-unavailable', details: {} },
  })
  assert.equal(JSON.stringify(result).includes('provider-private'), false)
  await stopUnavailable()
})
