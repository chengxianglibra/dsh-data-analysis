import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { commitPresentation } from '../../src/presentation/commit.ts'
import {
  PRESENTATION_BUDGETS,
  type PresentationDocument,
} from '../../src/presentation/contracts/index.ts'
import {
  createMarivoExportHtmlTool,
  parseHtmlOutputPath,
  registerMarivoExportHtmlTool,
} from '../../src/presentation/export-html.ts'
import { presentationSha256 } from '../../src/presentation/files.ts'
import { publishPresentation } from '../../src/presentation/reports.ts'
import { MarivoPresentationFileService } from '../../src/presentation/rpc.ts'

async function fixture(t: { after(fn: () => Promise<void>): void }, legacy = false) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'export-html-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const document: PresentationDocument = {
    schemaVersion: 3,
    locale: 'zh-CN',
    workspaceId: 'workspace',
    reportId: 'report',
    buildId: 'first',
    title: '导出报告',
    generatedAt: '2026-09-07T00:00:00Z',
    datasets: [],
    sources: [],
    blocks: [{ id: 'body', kind: 'markdown', text: '离线正文' }],
    diagnostics: [],
  }
  const receipt = legacy
    ? await commitPresentation(
        root,
        {
          document,
          documentBytes: Buffer.from(JSON.stringify(document)),
          htmlBytes: Buffer.from('<!doctype html><p>legacy bytes</p>'),
        },
        async () => {},
      )
    : await publishPresentation(root, document, null, async () => {})
  const current = path.join(root, '.dsh-data-analysis/presentations/report/current.json')
  if (legacy)
    await writeFile(
      current,
      JSON.stringify({ schemaVersion: 2, workspaceId: 'workspace', reportId: 'report', receipt }),
    )
  const session = { id: 'session' } as Session
  const exec = { agent: { session }, signal: new AbortController().signal } as ToolRunContext
  const source = () => ({ id: 'workspace', path: root })
  const tool = createMarivoExportHtmlTool(source, session)
  return { root, document, receipt, current, session, exec, source, tool }
}

test('current and legacy exports are byte-identical to reader download and do not modify history', async (t) => {
  for (const legacy of [false, true]) {
    const f = await fixture(t, legacy)
    const before = await readFile(f.current)
    const result = await executeValue(
      f.tool,
      { report_id: 'report', output_path: 'reports/offline.html' },
      f.exec,
    )
    const bytes = await readFile(result.path)
    const service = new MarivoPresentationFileService(f.source)
    t.after(() => service.close())
    const reader = await service.read({
      sessionId: 'session',
      receipt: f.receipt,
      asset: 'index.html',
    })
    assert.equal(bytes.toString('base64'), reader.bodyBase64)
    assert.equal(result.sha256, presentationSha256(bytes))
    assert.equal(result.bytes, bytes.length)
    assert.equal(result.build_id, 'first')
    assert.deepEqual(await readFile(f.current), before)
    assert.deepEqual(await readdir(path.dirname(result.path)), ['offline.html'])
    const callView = f.tool.presentCall?.({
      report_id: 'report',
      output_path: 'reports/offline.html',
    })
    assert(callView && 'locations' in callView)
    assert.deepEqual(callView.locations, [{ path: 'reports/offline.html' }])
    await assert.rejects(
      f.tool.execute({ report_id: 'report', output_path: 'reports/offline.html' }, f.exec),
      /EEXIST/,
    )
    assert.deepEqual(await readFile(result.path), bytes)
  }
})

test('fixed historical build and current frozen before a concurrent save', async (t) => {
  const f = await fixture(t)
  let checks = 0
  const tool = createMarivoExportHtmlTool(async () => {
    if (++checks === 3)
      await publishPresentation(
        f.root,
        { ...f.document, buildId: 'second', title: '新版' },
        'first',
        async () => {},
      )
    return f.source()
  }, f.session)
  const frozen = await executeValue(
    tool,
    { report_id: 'report', output_path: 'frozen.html' },
    f.exec,
  )
  assert.equal(frozen.build_id, 'first')
  const latest = await executeValue(
    f.tool,
    { report_id: 'report', output_path: 'latest.html' },
    f.exec,
  )
  assert.equal(latest.build_id, 'second')
  const historical = await executeValue(
    f.tool,
    { report_id: 'report', build_id: 'first', output_path: 'old.html' },
    f.exec,
  )
  assert.equal(historical.sha256, frozen.sha256)
  await assert.rejects(
    f.tool.execute(
      { report_id: 'report', build_id: 'missing', output_path: 'missing.html' },
      f.exec,
    ),
    /build-unavailable/,
  )
})

test('reject unsafe destinations, wrong owners and corrupted snapshots', async (t) => {
  const f = await fixture(t, true)
  for (const filename of [
    '../escape.html',
    '/tmp/escape.html',
    'x/../escape.html',
    '.dsh-data-analysis/export.html',
    'x\\a.html',
    'x.txt',
    './x.html',
  ])
    assert.throws(() => parseHtmlOutputPath(filename), /invalid-html-output-path/)
  await symlink(tmpdir(), path.join(f.root, 'outside'))
  await assert.rejects(
    f.tool.execute({ report_id: 'report', output_path: 'outside/out.html' }, f.exec),
    /directory-mismatch/,
  )
  await assert.rejects(
    f.tool.execute({ report_id: 'report', output_path: 'out.html' }, {
      ...f.exec,
      agent: { session: {} },
    } as ToolRunContext),
    /session-mismatch/,
  )
  await writeFile(f.receipt.files.html!.path, 'corrupted')
  await assert.rejects(
    f.tool.execute({ report_id: 'report', output_path: 'out.html' }, f.exec),
    /digest-mismatch/,
  )
  await writeFile(f.receipt.files.document.path, '{}')
  await assert.rejects(
    f.tool.execute({ report_id: 'report', output_path: 'out.html' }, f.exec),
    /digest-mismatch/,
  )
})

test('cancellation and Workspace changes clean owned temporary files and published targets', async (t) => {
  for (const at of [3, 6, 7, 8, 9]) {
    const f = await fixture(t, true)
    let checks = 0
    const tool = createMarivoExportHtmlTool(
      () => ({ id: ++checks >= at ? 'other' : 'workspace', path: f.root }),
      f.session,
    )
    await assert.rejects(
      tool.execute({ report_id: 'report', output_path: 'out.html' }, f.exec),
      /workspace-changed/,
    )
    assert.deepEqual(
      (await readdir(f.root)).filter((name) => name !== '.dsh-data-analysis'),
      [],
    )
  }
  const f = await fixture(t)
  const abort = new AbortController()
  abort.abort()
  await assert.rejects(
    f.tool.execute(
      { report_id: 'report', output_path: 'out.html' },
      { ...f.exec, signal: abort.signal },
    ),
    /abort/i,
  )
})

test('legacy HTML size budget is enforced', async (t) => {
  const f = await fixture(t, true)
  const { truncate } = await import('node:fs/promises')
  await truncate(f.receipt.files.html!.path, PRESENTATION_BUDGETS.htmlBytes + 1)
  await assert.rejects(
    f.tool.execute({ report_id: 'report', output_path: 'out.html' }, f.exec),
    /too-large/,
  )
})

test('tool disposal aborts and drains an in-flight export before writing', async (t) => {
  const f = await fixture(t, true)
  let registered: import('@deepseek-ai/dsh-tools').ToolDefinition | undefined
  let release!: () => void
  let entered!: () => void
  const waiting = new Promise<void>((resolve) => {
    entered = resolve
  })
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const ctx = {
    tools: {
      register(tool: import('@deepseek-ai/dsh-tools').ToolDefinition) {
        registered = tool
        return () => {
          registered = undefined
        }
      },
    },
  } as unknown as import('@deepseek-ai/cordis').Context
  const close = registerMarivoExportHtmlTool(
    ctx,
    async () => {
      entered()
      await gate
      return f.source()
    },
    f.session,
  )
  const pending = registered!.execute({ report_id: 'report', output_path: 'out.html' }, f.exec)
  const rejected = assert.rejects(pending, /abort/i)
  await waiting
  const closing = close()
  assert.equal(registered, undefined)
  release()
  await closing
  await rejected
  assert.deepEqual(
    (await readdir(f.root)).filter((name) => name !== '.dsh-data-analysis'),
    [],
  )
})

async function executeValue(
  tool: ReturnType<typeof createMarivoExportHtmlTool>,
  args: unknown,
  exec: ToolRunContext,
) {
  const value = await tool.execute(args, exec)
  assert(
    value &&
      typeof value === 'object' &&
      'path' in value &&
      'sha256' in value &&
      'bytes' in value &&
      'build_id' in value,
  )
  assert.equal(typeof value.path, 'string')
  return value as { path: string; sha256: string; bytes: number; build_id: string }
}

test('moving an output directory cannot retain a failed report snapshot', async (t) => {
  for (const phase of ['staged', 'published'] as const) {
    for (const replace of [false, true]) {
      const f = await fixture(t, true)
      const destination = path.join(f.root, 'exports')
      const moved = path.join(f.root, 'moved')
      let renamed = false
      const tool = createMarivoExportHtmlTool(async () => {
        if (!renamed) {
          const candidates = await readdir(f.root)
          const temporary = candidates.find((name) => name.startsWith('.html-export-'))
          const published = await stat(path.join(destination, 'out.html')).catch(() => undefined)
          if (
            temporary &&
            (await stat(path.join(f.root, temporary))).size > 0 &&
            (phase === 'staged' || published)
          ) {
            await rename(destination, moved)
            // A replacement directory/file belongs to someone else and must survive cleanup.
            if (replace) {
              await mkdir(destination)
              await writeFile(path.join(destination, 'out.html'), 'replacement-owner')
            }
            renamed = true
          }
        }
        return f.source()
      }, f.session)
      await assert.rejects(
        tool.execute({ report_id: 'report', output_path: 'exports/out.html' }, f.exec),
        /directory-changed|ENOENT/,
      )
      assert(renamed)
      if (replace)
        assert.equal(
          await readFile(path.join(destination, 'out.html'), 'utf8'),
          'replacement-owner',
        )
      else await assert.rejects(stat(destination), { code: 'ENOENT' })
      assert.deepEqual(
        (await readdir(f.root)).filter((name) => name.startsWith('.html-export-')),
        [],
      )
      assert.deepEqual(await readdir(moved), phase === 'staged' ? [] : ['out.html'])
      if (phase === 'published') assert.equal((await stat(path.join(moved, 'out.html'))).size, 0)
    }
  }
})
