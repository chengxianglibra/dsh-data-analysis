import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  presentationAssetPath,
  S0FileService,
  sha256,
} from '../../scripts/presentation-s0/files.ts'
import { validateS0Host } from '../../scripts/presentation-s0/host.ts'
import {
  PRESENTATION_BUDGETS,
  type PresentationReceipt,
} from '../../src/presentation/contracts/types.ts'

async function fixture(t: { after: (cleanup: () => Promise<void>) => void }) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'presentation-s0-host-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = path.join(root, 'workspace')
  const files = {
    document: {
      asset: 'presentation.json' as const,
      path: presentationAssetPath(workspace, 's0-build', 'presentation.json'),
      content: '{"schemaVersion":1}\n',
    },
    html: {
      asset: 'index.html' as const,
      path: presentationAssetPath(workspace, 's0-build', 'index.html'),
      content: '<!doctype html><html><body>S0</body></html>\n',
    },
  }
  await mkdir(path.dirname(files.document.path), { recursive: true })
  for (const file of Object.values(files)) await writeFile(file.path, file.content)
  const receipt: PresentationReceipt = {
    schemaVersion: 2,
    kind: 'marivo.presentation',
    workspaceId: 's0-workspace',
    reportId: 'report',
    buildId: 's0-build',
    title: 'S0 Host 接缝',
    summary: '固定文件和 receipt。',
    files: {
      document: {
        asset: files.document.asset,
        path: files.document.path,
        sha256: sha256(Buffer.from(files.document.content)),
        bytes: Buffer.byteLength(files.document.content),
      },
      html: {
        asset: files.html.asset,
        path: files.html.path,
        sha256: sha256(Buffer.from(files.html.content)),
        bytes: Buffer.byteLength(files.html.content),
      },
    },
  }
  const input = {
    workspaceId: receipt.workspaceId,
    reportId: 'report',
    buildId: receipt.buildId,
    asset: files.document.asset,
    sha256: receipt.files.document.sha256,
  }
  const service = new S0FileService((id) =>
    id === receipt.workspaceId ? { id, path: workspace } : undefined,
  )
  return { root, workspace, files, receipt, input, service }
}

test('actual Harness Native/both/worker Code dispatch persists the same receipt in the correct two turns', async (t) => {
  const f = await fixture(t)
  const result = await validateS0Host(f.receipt, f.workspace, f.root)
  assert.equal(result.status, 'passed')
  assert.deepEqual(
    result.modes.map((mode) => mode.receipts),
    [2, 2, 2],
  )
})

test('fixed asset read verifies bytes and rejects caller paths, traversal, unknown Workspace/build and digest changes', async (t) => {
  const f = await fixture(t)
  const result = await f.service.read(f.input)
  assert.equal(Buffer.from(result.bodyBase64, 'base64').toString(), f.files.document.content)
  assert.equal(result.sha256, f.receipt.files.document.sha256)
  for (const [input, error] of [
    [{ ...f.input, path: '/etc/passwd' }, /invalid-request/],
    [{ ...f.input, buildId: '../s0-build' }, /invalid-build/],
    [{ ...f.input, workspaceId: 'unknown' }, /workspace-unavailable/],
    [{ ...f.input, asset: '../index.html' }, /invalid-asset/],
    [{ ...f.input, sha256: '0'.repeat(64) }, /asset-digest-mismatch/],
    [{ ...f.input, buildId: 'missing' }, /ENOENT/],
  ] as const)
    await assert.rejects(f.service.read(input), error)
  await writeFile(f.files.document.path, 'changed')
  await assert.rejects(f.service.read(f.input), /asset-digest-mismatch/)
  await rm(f.files.document.path)
  await assert.rejects(f.service.read(f.input), /ENOENT/)
})

test('fixed asset read rejects out-of-Workspace and same-Workspace symlinks and oversized files', async (t) => {
  const f = await fixture(t)
  const outside = path.join(f.root, 'outside.json')
  await writeFile(outside, f.files.document.content)
  await rm(f.files.document.path)
  await symlink(outside, f.files.document.path)
  await assert.rejects(f.service.read(f.input), /asset-path-mismatch/)
  await rm(f.files.document.path)
  await symlink(f.files.html.path, f.files.document.path)
  await assert.rejects(f.service.read(f.input), /asset-path-mismatch/)
  await rm(f.files.document.path)
  await writeFile(f.files.document.path, '')
  await truncate(f.files.document.path, PRESENTATION_BUDGETS.documentBytes + 1)
  await assert.rejects(f.service.read(f.input), /asset-too-large/)
  await rm(path.dirname(f.files.document.path), { recursive: true })
  const externalBuild = path.join(f.root, 'external-build')
  await mkdir(externalBuild)
  await writeFile(path.join(externalBuild, 'presentation.json'), f.files.document.content)
  await symlink(externalBuild, path.dirname(f.files.document.path))
  await assert.rejects(f.service.read(f.input), /asset-path-mismatch/)
})

test('Workspace replacement during a read and caller cancellation fail explicitly', async (t) => {
  const f = await fixture(t)
  let lookup = 0
  const service = new S0FileService((id) => ({ id, path: ++lookup === 1 ? f.workspace : f.root }))
  await assert.rejects(service.read(f.input), /workspace-changed/)
  const controller = new AbortController()
  controller.abort(new Error('cancel-s0-read'))
  await assert.rejects(f.service.read(f.input, controller.signal), /cancel-s0-read/)
})
