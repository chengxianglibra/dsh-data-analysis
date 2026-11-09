import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LlmRuntime, { ToolCallId } from '@deepseek-ai/dsh-llm'
import NodePtcRuntime from '@deepseek-ai/dsh-ptc-runtime-node'
import LocalSandbox from '@deepseek-ai/dsh-sandbox-local'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import SessionStore, { type Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolRunContext } from '@deepseek-ai/dsh-tools'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import { visibleReports } from '../../src/client/presentation/catalog-model.ts'
import { PresentationDeliveryModel } from '../../src/client/presentation/delivery-model.ts'
import {
  analysisRecordId,
  parseAnalysisDocument,
  parseSavedPresentation,
} from '../../src/presentation/contracts/analysis-document.ts'
import type { DatasetSnapshot } from '../../src/presentation/contracts/snapshot.ts'
import { datasetSnapshotRef, frameSnapshotRef } from '../../src/presentation/dataset-snapshot.ts'
import { AnalysisDrafts } from '../../src/presentation/drafts.ts'
import { presentationSha256 } from '../../src/presentation/files.ts'
import { draftDeliverySchema, parsePresentationDelivery } from '../../src/presentation/receipt.ts'
import {
  publishPresentation,
  readAnalysisRecord,
  readReceiptDocument,
  readReportHistory,
  resolvePresentation,
} from '../../src/presentation/reports.ts'
import { MarivoPresentationFileService } from '../../src/presentation/rpc.ts'
import { createMarivoPresentTool, createMarivoUiReadTool } from '../../src/presentation/tool.ts'
import { savePythonExecution } from '../../src/python-execution.ts'
import { TestShellEnv } from '../test-shell-env.ts'
import { datasetSnapshot } from '../unified-analysis-ui/dataset-fixtures.ts'
import { frameSnapshot } from '../unified-analysis-ui/fixtures.ts'

async function fixture(t: { after(fn: () => Promise<void>): void }, dataset?: DatasetSnapshot) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'analysis-ui-p2-')))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  t.after(async () => {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(root, { recursive: true, force: true })
  })
  const captureId = randomUUID(),
    captureDirectory = `.dsh-data-analysis/captures/${randomUUID()}`
  await mkdir(path.join(root, captureDirectory), { recursive: true })
  const snapshot = dataset ?? {
    schemaVersion: 1,
    kind: 'dataset',
    fetchedAt: '2026-10-28T00:00:00Z',
    source: { kind: 'dataframe', details: 'not-captured' },
    data: {
      schemaVersion: 1,
      columns: [
        { id: 'account', label: 'Account', type: 'int64', nullable: true },
        { id: 'amount', label: 'Amount', type: 'decimal', nullable: true },
      ],
      rows: [
        ['9007199254740993', '12345678901234.5678'],
        [null, null],
      ],
      rowCount: 2,
      limit: 5000,
      truncated: false,
    },
    coverage: {
      start: 0,
      totalRows: 2,
      capturedRows: 2,
      complete: true,
      columns: ['account', 'amount'],
      business: 'unknown',
    },
  }
  const capturePath = `${captureDirectory}/${captureId}.json`
  const bytes = Buffer.from(JSON.stringify(snapshot))
  await writeFile(path.join(root, capturePath), bytes)
  const frameId = randomUUID()
  const framePath = `${captureDirectory}/${frameId}.json`
  const frameBytes = Buffer.from(JSON.stringify(frameSnapshot()))
  await writeFile(path.join(root, framePath), frameBytes)
  const codeRef = await savePythonExecution(root, {
    text: 'capture_dataset(df)',
    startedAt: '2026-10-28T00:00:00.000Z',
    finishedAt: '2026-10-28T00:00:01.000Z',
    captures: {
      workspaceId: 'workspace',
      sessionId: 'session',
      callId: 'producer',
      rootCallId: 'producer',
      entries: [
        { captureId, path: capturePath, sha256: presentationSha256(bytes) },
        { captureId: frameId, path: framePath, sha256: presentationSha256(frameBytes) },
      ],
    },
  })
  const session = {
    id: 'session',
    snapshotEvents: () => [
      { type: 'tool/call', data: { callId: 'native', name: 'marivo_present', turn: 1 } },
      { type: 'tool/call', data: { callId: 'code', name: 'run_code', turn: 2 } },
    ],
  } as unknown as Session
  const source = () => ({ id: 'workspace', path: root })
  const drafts = new AnalysisDrafts()
  const tool = createMarivoPresentTool(source, session, undefined, drafts)
  const exec = {
    agent: { session },
    callId: 'native',
    signal: new AbortController().signal,
  } as unknown as ToolRunContext
  const service = new MarivoPresentationFileService(
    () => ({ id: 'workspace', path: root }),
    (id) => (id === 'workspace' ? { id, path: root } : undefined),
    drafts,
  )
  t.after(() => service.close())
  const resources = {
    data: { kind: 'dataset-snapshot', snapshotRef: datasetSnapshotRef(codeRef, captureId) },
    frame: { kind: 'frame-snapshot', snapshotRef: frameSnapshotRef(codeRef, frameId) },
  }
  const raw = async (args: Record<string, unknown>, code = false) =>
    (await tool.execute(
      args,
      code ? { ...exec, callId: ToolCallId('child'), rootCallId: ToolCallId('code') } : exec,
    )) as {
      stage: 'preview' | 'save'
      draftId?: string
      draftRevision?: string
      recordId?: string
      deliveryJson: string
    }
  const execute = async (args: Record<string, unknown>, code = false): Promise<unknown> =>
    JSON.parse((await raw(args, code)).deliveryJson)
  const present = async (args: Record<string, unknown>, code = false) =>
    parsePresentationDelivery(await execute(args, code))
  return {
    root,
    resources,
    present,
    execute,
    raw,
    drafts,
    service,
    source,
    exec,
    captureDirectory,
  }
}

test('preview revisions add data views without publishing until the draft is saved', async (t) => {
  const f = await fixture(t)
  const start = draftDeliverySchema.parse(
    await f.execute({
      stage: 'preview',
      program: 'root = Stack([DatasetView("data")]);',
      resources: { data: f.resources.data },
    }),
  )
  const first = await f.service.draft(start, f.exec.signal)
  assert.deepEqual(Object.keys(first.resources), ['data'])
  const catalog = await f.service.catalog('reports/list', { workspaceId: 'workspace' })
  assert.deepEqual('reports' in catalog && catalog.reports, [])
  const draft = (stage: 'preview' | 'save', revision = start.draftRevision) => ({
    stage,
    draftId: start.draftId,
    draftRevision: revision,
  })
  await assert.rejects(f.execute(draft('save'), true), /analysis-draft-unavailable/)
  await assert.rejects(
    f.service.draft({ ...start, workspaceId: 'elsewhere' }, f.exec.signal),
    /analysis-draft-unavailable/,
  )
  await assert.rejects(
    f.execute({ ...draft('preview'), program: 'root = Image("Missing", "missing");' }),
    /analysis-resource-missing/,
  )
  assert.deepEqual(await f.service.draft(start, f.exec.signal), first)
  const results = await Promise.allSettled(
    Array.from({ length: 2 }, () =>
      f.execute({
        ...draft('preview'),
        program: 'root = Stack([DatasetView("data"), trend]);\ntrend = AnalysisFrameView("frame");',
        resources: f.resources,
      }),
    ),
  )
  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1)
  const updated = draftDeliverySchema.parse(
    results.find((result) => result.status === 'fulfilled')?.value,
  )
  assert.equal(updated.draftId, start.draftId)
  assert.notEqual(updated.draftRevision, start.draftRevision)
  const preview = await f.service.draft(updated, f.exec.signal)
  assert.deepEqual(Object.keys(preview.resources).sort(), ['data', 'frame'])
  await assert.rejects(f.execute(draft('save')), /analysis-draft-conflict/)
  const saved = await f.present(draft('save', updated.draftRevision))
  assert.equal(saved.draftId, updated.draftId)
  assert.equal(saved.surface, 'tool')
  const final = await readAnalysisRecord(
    f.root,
    'workspace',
    saved.receipt.reportId,
    saved.receipt.buildId,
  )
  assert.equal(final.program, preview.program)
  assert.deepEqual(final.resources, preview.resources)
  assert.notEqual(final.buildId, updated.draftRevision)
  const history = await readReportHistory(f.root, 'workspace', saved.receipt.reportId)
  assert.deepEqual(
    history.versions.map(({ receipt }) => receipt.buildId),
    [saved.receipt.buildId],
  )
  await assert.rejects(f.service.draft(updated, f.exec.signal), /analysis-draft-unavailable/)
  await assert.rejects(
    f.execute(draft('save', updated.draftRevision)),
    /analysis-draft-unavailable/,
  )
})

for (const surface of ['tool', 'tab'] as const) {
  test(`drafts inherit ${surface}, can change surface, and publish exactly one version`, async (t) => {
    const f = await fixture(t)
    const first = draftDeliverySchema.parse(
      await f.execute({
        stage: 'preview',
        surface,
        program: 'root = TextContent("First");',
        resources: {},
      }),
    )
    assert.equal(first.surface, surface)
    const next = draftDeliverySchema.parse(
      await f.execute({
        stage: 'preview',
        draftId: first.draftId,
        draftRevision: first.draftRevision,
        program: 'root = TextContent("Second");',
      }),
    )
    assert.equal(next.surface, surface)
    const changedSurface = surface === 'tool' ? 'tab' : 'tool'
    const changed = draftDeliverySchema.parse(
      await f.execute({
        stage: 'preview',
        surface: changedSurface,
        draftId: next.draftId,
        draftRevision: next.draftRevision,
        program: 'root = TextContent("Complete");',
      }),
    )
    assert.equal(changed.surface, changedSurface)
    assert.equal(changed.draftId, first.draftId)
    const before = await f.service.catalog('reports/list', { workspaceId: 'workspace' })
    assert.deepEqual('reports' in before && before.reports, [])
    const saved = await f.present({
      stage: 'save',
      draftId: changed.draftId,
      draftRevision: changed.draftRevision,
    })
    assert.equal(saved.surface, changedSurface)
    const history = await readReportHistory(f.root, 'workspace', saved.receipt.reportId)
    assert.equal(history.versions.length, 1)
    assert.equal(history.versions[0]?.source.surface, changedSurface)
  })
}

test('real Harness PTC composes preview, recovery and save using public identifiers', async (t) => {
  const f = await fixture(t)
  const ctx = new Context()
  try {
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(TestShellEnv)
    await ctx.plugin(LocalFileSystem, { cwd: f.root })
    await ctx.plugin(SubprocessLocal)
    await ctx.plugin(LocalSandbox, {})
    await ctx.plugin(SandboxPolicy, { mode: 'danger-full-access', workspaceRoot: f.root })
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(WorkingDirectory, { defaultDirectory: f.root })
    await ctx.plugin(NodePtcRuntime, { timeoutMs: 10000 })
    await ctx.plugin(ToolRuntime, { mode: 'ptc' })
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    const agent = await ctx.agentLoop.create(SessionId('ptc-report'), {
      provider: 'unused',
      model: 'unused',
    })
    agent.ctx.tools.register(createMarivoPresentTool(f.source, agent.session, undefined, f.drafts))
    agent.ctx.tools.register(createMarivoUiReadTool(f.source, f.drafts))
    const callId = ToolCallId('ptc-report-edit')
    agent.session.append('tool/call', {
      turn: 0,
      step: 0,
      callId,
      name: 'run_code',
      arguments: '{}',
    })
    const result = await agent.ctx.tools.execute({
      agent,
      callId,
      signal: new AbortController().signal,
      name: 'run_code',
      arguments: {
        description: 'Compose and recover the report draft',
        code: `
          const first = await tools.marivo_present({stage:'preview', resources:${JSON.stringify({ data: f.resources.data })}});
          if (first.stage !== 'preview' || !first.draftId || !first.draftRevision || first.recordId) throw new Error('preview-identity');
          const recovered = JSON.parse((await tools.marivo_ui_read({draft:true})).definitionJson);
          if (recovered.draftId !== first.draftId || recovered.draftRevision !== first.draftRevision) throw new Error('draft-read-identity');
          const second = await tools.marivo_present({stage:'preview', draftId:first.draftId, draftRevision:first.draftRevision, title:'PTC reviewed'});
          if (second.draftRevision === first.draftRevision) throw new Error('revision-not-advanced');
          const saved = await tools.marivo_present({stage:'save', draftId:second.draftId, draftRevision:second.draftRevision});
          if (saved.stage !== 'save' || !saved.recordId) throw new Error('save-identity');
          const current = JSON.parse((await tools.marivo_ui_read({recordId:saved.recordId,current:true})).definitionJson);
          if (current.recordId !== saved.recordId || current.title !== 'PTC reviewed') throw new Error('saved-read-identity');
          console.log('PTC_PUBLIC_IDENTIFIERS_VERIFIED');
        `,
      },
    })
    assert.equal(result.isError, false, JSON.stringify(result))
    assert.match(JSON.stringify(result), /PTC_PUBLIC_IDENTIFIERS_VERIFIED/)
    assert.equal(f.drafts.get(String(agent.session.id)), undefined)
  } finally {
    await ctx.fiber.dispose()
  }
})

for (const code of [false, true]) {
  test(`${code ? 'Code' : 'Native'} callers compose previews and saves from public result identifiers`, async (t) => {
    const f = await fixture(t)
    const first = await f.raw({ stage: 'preview', resources: { data: f.resources.data } }, code)
    assert.equal(first.stage, 'preview')
    assert.equal(first.recordId, undefined)
    assert.ok(first.draftId)
    assert.ok(first.draftRevision)
    const second = await f.raw(
      {
        stage: 'preview',
        draftId: first.draftId,
        draftRevision: first.draftRevision,
        title: 'Reviewed',
      },
      code,
    )
    assert.equal(second.draftId, first.draftId)
    assert.notEqual(second.draftRevision, first.draftRevision)
    const saved = await f.raw(
      { stage: 'save', draftId: second.draftId, draftRevision: second.draftRevision },
      code,
    )
    assert.equal(saved.stage, 'save')
    assert.match(saved.recordId!, /^marivo-ui:/)
    const { reportId, buildId } = parseAnalysisDocument(
      await readReceiptDocument(
        f.root,
        parsePresentationDelivery(JSON.parse(saved.deliveryJson)).receipt,
      ),
    )
    assert.equal(saved.recordId, analysisRecordId(reportId, buildId))
    assert.equal((await readReportHistory(f.root, 'workspace', reportId)).versions.length, 1)
  })
}

test('conflict recovery reads current and draft context, then explicitly rebases retained resources', async (t) => {
  const f = await fixture(t)
  const base = await f.raw({ resources: { data: f.resources.data } })
  const otherReport = await f.raw({ resources: { data: f.resources.data } }, true)
  const draft = await f.raw({
    stage: 'preview',
    basedOnRecordId: base.recordId,
    program: 'root = Stack([DatasetView("data"), AnalysisFrameView("frame")]);',
    resources: f.resources,
  })
  const concurrent = await f.raw(
    { basedOnRecordId: base.recordId, title: 'Concurrent title' },
    true,
  )
  await assert.rejects(
    f.raw({ stage: 'save', draftId: draft.draftId, draftRevision: draft.draftRevision }),
    (error: Error) => {
      assert.match(error.message, /report-save-conflict/)
      assert.ok(error.message.includes(concurrent.recordId!))
      return true
    },
  )
  const reader = createMarivoUiReadTool(f.source, f.drafts)
  const read = async (args: Record<string, unknown>) =>
    JSON.parse(((await reader.execute(args, f.exec)) as { definitionJson: string }).definitionJson)
  assert.equal((await read({ recordId: base.recordId })).recordId, base.recordId)
  const latest = await read({ recordId: base.recordId, current: true })
  assert.equal(latest.recordId, concurrent.recordId)
  const working = await read({ draft: true })
  assert.equal(working.draftId, draft.draftId)
  assert.equal(working.recordId, undefined, 'an unsaved document has no published record identity')
  assert.equal(working.basedOnRecordId, base.recordId)
  assert.equal(working.resources.frame.rows, undefined)
  await rm(path.join(f.root, f.captureDirectory), { recursive: true })
  const request = {
    stage: 'preview',
    draftId: working.draftId,
    draftRevision: working.draftRevision,
    rebaseOnRecordId: latest.recordId,
    program: working.program,
    resources: {
      data: latest.resources.data.declaration,
      frame: working.resources.frame.declaration,
    },
  }
  await assert.rejects(
    f.raw({ ...request, rebaseOnRecordId: base.recordId }),
    /report-save-conflict/,
  )
  await assert.rejects(
    f.raw({ ...request, rebaseOnRecordId: otherReport.recordId }),
    /analysis-draft-invalid-request/,
  )
  const { resources: _resources, ...missingResources } = request
  await assert.rejects(f.raw(missingResources), /analysis-draft-invalid-request/)
  assert.equal((await read({ draft: true })).draftRevision, draft.draftRevision)
  const rebased = await f.raw(request)
  assert.equal((await read({ draft: true })).title, 'Concurrent title')
  const saved = await f.raw({
    stage: 'save',
    draftId: rebased.draftId,
    draftRevision: rebased.draftRevision,
  })
  const final = await read({ recordId: saved.recordId })
  assert.equal(final.title, 'Concurrent title')
  assert.deepEqual(Object.keys(final.resources).sort(), ['data', 'frame'])
  await assert.rejects(read({ draft: true }), /analysis-draft-unavailable/)
})

test('draft recovery is isolated by Session, Turn and Workspace and rejects expired drafts', async (t) => {
  const f = await fixture(t)
  await f.raw({ stage: 'preview', resources: { data: f.resources.data } })
  const reader = createMarivoUiReadTool(f.source, f.drafts)
  const otherSession = {
    ...f.exec,
    agent: { session: { ...f.exec.agent!.session, id: 'other-session' } },
  } as unknown as ToolRunContext
  for (const exec of [otherSession, { ...f.exec, callId: ToolCallId('code') }])
    await assert.rejects(reader.execute({ draft: true }, exec), /analysis-draft-unavailable/)
  const otherWorkspace = createMarivoUiReadTool(
    () => ({ id: 'other-workspace', path: f.root }),
    f.drafts,
  )
  await assert.rejects(
    otherWorkspace.execute({ draft: true }, f.exec),
    /analysis-draft-unavailable/,
  )
  f.drafts.clear('session')
  await assert.rejects(reader.execute({ draft: true }, f.exec), /analysis-draft-unavailable/)
})

test('recovered image declarations support adding resources after the image file is removed', async (t) => {
  const f = await fixture(t)
  const image = { kind: 'image-file', path: 'image.png' }
  await writeFile(path.join(f.root, image.path), Buffer.from('89504e470d0a1a0a', 'hex'))
  const base = await f.raw({ resources: { image } })
  const reader = createMarivoUiReadTool(f.source)
  const restored = JSON.parse(
    ((await reader.execute({ recordId: base.recordId }, f.exec)) as { definitionJson: string })
      .definitionJson,
  )
  assert.deepEqual(restored.resources.image.declaration, image)
  await rm(path.join(f.root, image.path))
  const saved = await f.raw({
    basedOnRecordId: base.recordId,
    resources: { image: restored.resources.image.declaration, data: f.resources.data },
    program: 'root = Stack([Image("Existing image", "image"), DatasetView("data")]);',
  })
  assert.ok(saved.recordId)
})

test('draft edits preserve the saved base and reject concurrent publication', async (t) => {
  const f = await fixture(t)
  const base = await f.present({ resources: { data: f.resources.data } })
  const recordId = analysisRecordId(base.receipt.reportId, base.receipt.buildId)
  const preview = draftDeliverySchema.parse(
    await f.execute({
      stage: 'preview',
      basedOnRecordId: recordId,
      title: 'Working title',
    }),
  )
  const history = () => readReportHistory(f.root, 'workspace', base.receipt.reportId)
  assert.equal((await history()).versions.length, 1)
  const concurrent = await f.present(
    { basedOnRecordId: recordId, title: 'Other publication' },
    true,
  )
  await assert.rejects(
    f.execute({ stage: 'save', draftId: preview.draftId, draftRevision: preview.draftRevision }),
    /report-save-conflict/,
  )
  assert.equal((await history()).currentBuildId, concurrent.receipt.buildId)
  assert.equal((await f.service.draft(preview, f.exec.signal)).title, 'Working title')
  f.drafts.clear('session', preview.turn)
  await assert.rejects(f.service.draft(preview, f.exec.signal), /analysis-draft-unavailable/)
})

test('reference-only results save exact resources and survive capture removal and cold service reopen', async (t) => {
  const f = await fixture(t)
  const data = await f.present({ resources: { data: f.resources.data } })
  const frame = await f.present({ resources: { frame: f.resources.frame }, surface: 'tab' }, true)
  assert.equal(data.surface, 'tool')
  assert.equal(frame.surface, 'tab')
  assert.equal(frame.turn, 2)
  const catalog = await f.service.catalog('reports/list', { workspaceId: 'workspace' })
  assert('reports' in catalog)
  const state = { open: true, workspaceId: 'workspace', query: '', loading: false, catalog }
  assert.deepEqual(
    visibleReports(state).map((v) => v.receipt.reportId),
    [frame.receipt.reportId],
  )
  assert.deepEqual(
    visibleReports({ ...state, surface: 'tool' }).map((v) => v.receipt.reportId),
    [data.receipt.reportId],
  )
  const saved = parseAnalysisDocument(await readReceiptDocument(f.root, data.receipt))
  assert.equal(saved.program, 'root = DatasetView("data");')
  assert.deepEqual(
    saved.resources.data?.kind === 'snapshot' && saved.resources.data.snapshot.data.rows,
    [
      ['9007199254740993', '12345678901234.5678'],
      [null, null],
    ],
  )
  await rm(path.join(f.root, f.captureDirectory), { recursive: true })
  await f.service.close()
  const cold = new MarivoPresentationFileService(
    () => ({ id: 'workspace', path: f.root }),
    () => ({ id: 'workspace', path: f.root }),
  )
  t.after(() => cold.close())
  for (const receipt of [data.receipt, frame.receipt]) {
    const model = new PresentationDeliveryModel({
      async call(_channel, endpoint, payload, signal) {
        return {
          ok: true,
          value:
            endpoint === 'files/read'
              ? await cold.read(payload, signal)
              : endpoint === 'reports/history'
                ? await cold.catalog(endpoint, payload, signal)
                : await cold.report(payload, signal),
        }
      },
    })
    t.after(() => model.dispose())
    await model.showBuild('workspace', receipt.reportId, receipt.buildId)
    assert.equal(model.getSnapshot().error, undefined)
    assert.equal(
      model.getSnapshot().analysisDocument?.recordId,
      analysisRecordId(receipt.reportId, receipt.buildId),
    )
    await assert.rejects(
      cold.read({ workspaceId: 'workspace', receipt, asset: 'index.html' }),
      /invalid-request/,
    )
  }
})

test('eight-component composition admits only saved image resources and exact compatible data views', async (t) => {
  const f = await fixture(t)
  const image = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'base64',
  )
  await writeFile(path.join(f.root, 'image.png'), image)
  const resources = { ...f.resources, picture: { kind: 'image-file', path: 'image.png' } }
  const program =
    'root = Stack([Card([TextContent("Saved data"), AnalysisFrameView("frame", {chart:"table"})]), Tabs([TabItem("data","Data",[DatasetView("data")]),TabItem("image","Image",[Image("Saved image","picture")])])]);'
  const delivery = await f.present({ resources, program })
  const document = parseAnalysisDocument(await readReceiptDocument(f.root, delivery.receipt))
  assert.equal(document.resources.picture?.kind, 'image')
  for (const bad of [
    program.replace('DatasetView("data")', 'DatasetView("frame")'),
    program.replace('DatasetView("data")', 'DatasetView("missing")'),
    program.replace(
      'DatasetView("data")',
      'DatasetView("data", {chart:"metric",encoding:{value:"amount"}})',
    ),
    program.replace(
      'DatasetView("data")',
      'DatasetView("data", {chart:"table",columns:["missing"]})',
    ),
    program.replace(
      'Image("Saved image","picture")',
      'Image("remote","https://example.com/picture.png")',
    ),
    program.replace('TextContent("Saved data")', 'Stack([Button("unsupported")])'),
  ])
    await assert.rejects(f.present({ resources, program: bad }))
  await assert.rejects(
    f.present({ resources: { image: { kind: 'image-file', path: '../outside.png' } } }),
    /image-path-invalid/,
  )
})

test('record reads omit rows; failed resource reads, cancellation and stale saves preserve published current', async (t) => {
  const f = await fixture(t)
  const original = await f.present({ resources: { data: f.resources.data } })
  const document = parseAnalysisDocument(await readReceiptDocument(f.root, original.receipt))
  const bytes = await readFile(original.receipt.files.document.path)
  const read = createMarivoUiReadTool(() => ({ id: 'workspace', path: f.root }))
  const response = (await read.execute({ recordId: document.recordId }, f.exec)) as {
    definitionJson: string
  }
  const definition = JSON.parse(response.definitionJson)
  assert.equal(definition.program, document.program)
  assert.deepEqual(
    definition.resources.data.columns,
    document.resources.data?.kind === 'snapshot' && document.resources.data.snapshot.data.columns,
  )
  assert.equal(definition.resources.data.rows, undefined)
  const nextId = randomUUID()
  const next = {
    ...document,
    buildId: nextId,
    recordId: analysisRecordId(document.reportId, nextId),
    title: 'New version',
  }
  const updated = await publishPresentation(
    f.root,
    next,
    document.buildId,
    async () => {},
    undefined,
    { kind: 'agent', sessionId: 'session', surface: 'tool' },
  )
  await assert.rejects(
    publishPresentation(
      f.root,
      { ...next, buildId: 'stale', recordId: analysisRecordId(document.reportId, 'stale') },
      document.buildId,
      async () => {},
      undefined,
      { kind: 'agent', sessionId: 'session', surface: 'tool' },
    ),
    /report-save-conflict/,
  )
  assert.equal(
    (await readAnalysisRecord(f.root, 'workspace', document.reportId, document.buildId)).title,
    document.title,
  )
  await assert.rejects(readAnalysisRecord(f.root, 'other', document.reportId, document.buildId))
  await assert.rejects(read.execute({ recordId: 'invalid' }, f.exec), /record-id/)
  await rm(path.join(f.root, f.captureDirectory), { recursive: true })
  await assert.rejects(f.present({ resources: { data: f.resources.data } }))
  const abort = new AbortController()
  abort.abort()
  await assert.rejects(
    publishPresentation(f.root, next, updated.buildId, async () => {}, abort.signal, {
      kind: 'agent',
      sessionId: 'session',
      surface: 'tool',
    }),
    /abort/i,
  )
  assert.equal(
    (await resolvePresentation(f.root, 'workspace', document.reportId)).buildId,
    updated.buildId,
  )
  assert.deepEqual(await readFile(original.receipt.files.document.path), bytes)
  assert.equal(parseSavedPresentation(document).schemaVersion, 'dsh.analysis-ui/v1')
})

test('statement updates reuse embedded snapshots without resolving Runtime and save independent versions', async (t) => {
  const f = await fixture(t)
  const original = await f.present({
    resources: f.resources,
    title: 'Original',
    locale: 'en-US',
    program:
      'heading = TextContent("Before");\nroot = Stack([heading, AnalysisFrameView("frame"), DatasetView("data")]);',
  })
  const base = parseAnalysisDocument(await readReceiptDocument(f.root, original.receipt))
  await rm(path.join(f.root, f.captureDirectory), { recursive: true })
  const tool = createMarivoPresentTool(f.source, f.exec.agent!.session)
  const update = async (args: Record<string, unknown>) =>
    parsePresentationDelivery(
      JSON.parse(((await tool.execute(args, f.exec)) as { deliveryJson: string }).deliveryJson),
    )
  const result = await update({
    basedOnRecordId: base.recordId,
    program: 'heading = TextContent("After");',
  })
  const next = parseAnalysisDocument(await readReceiptDocument(f.root, result.receipt))
  assert.equal(next.reportId, base.reportId)
  assert.notEqual(next.buildId, base.buildId)
  assert.equal(next.title, 'Original')
  assert.equal(next.locale, 'en-US')
  assert.match(next.program, /After/)
  assert.deepEqual(next.resources, base.resources)
  await assert.rejects(
    update({ basedOnRecordId: base.recordId, program: 'heading = TextContent("Stale");' }),
    /report-save-conflict/,
  )
  for (const program of [
    'heading = null;',
    'bad = TotallyMissing("bad")',
    'bad = TextContent(42)',
    'bad = TextContent("unreachable")',
    'garbage',
    'heading = TextContent("unterminated',
    'garbage\nheading = TextContent("valid");',
  ])
    await assert.rejects(update({ basedOnRecordId: next.recordId, program }))
  await assert.rejects(
    update({ basedOnRecordId: next.recordId, resources: {} }),
    /resource-missing/,
  )
  const retained = await update({
    basedOnRecordId: next.recordId,
    resources: f.resources,
    title: 'Retained',
  })
  const latest = parseAnalysisDocument(await readReceiptDocument(f.root, retained.receipt))
  assert.equal(latest.program, next.program)
  assert.deepEqual(latest.resources, base.resources)
  const removed = await update({
    basedOnRecordId: latest.recordId,
    resources: {},
    program: 'root = Stack([note]);\nnote = TextContent("Independent");\nheading = null;',
  })
  await rm(path.dirname(original.receipt.files.document.path), { recursive: true })
  const independent = await readReceiptDocument(f.root, removed.receipt)
  assert.deepEqual(independent.resources, {})
  assert.equal(
    (await resolvePresentation(f.root, 'workspace', base.reportId)).buildId,
    removed.receipt.buildId,
  )
})

test('Dataset chart programs save, reopen and update embedded data after capture removal', async (t) => {
  const snapshot = datasetSnapshot(
    [
      ['A', 'X', '9007199254740993'],
      ['B', 'X', null],
      ['A', 'Y', '-2.50'],
      ['B', 'Y', '0.00'],
    ],
    [
      { id: 'category', label: 'Category', type: 'string', nullable: false },
      { id: 'series', label: 'Series', type: 'string', nullable: false },
      { id: 'value', label: 'Value', type: 'decimal', nullable: true },
    ],
  )
  const f = await fixture(t, snapshot)
  const views = ['line', 'area', 'bar'].map(
    (chart) =>
      `DatasetView("data", {chart:"${chart}",encoding:{axis:"category",values:["value"],series:"series"}})`,
  )
  views.push(
    'DatasetView("data", {chart:"heatmap",encoding:{x:"category",y:"series",value:"value"}})',
  )
  const program = `root = Stack([${views.join(',')}]);`
  const delivery = await f.present({ resources: { data: f.resources.data }, program })
  const saved = parseAnalysisDocument(await readReceiptDocument(f.root, delivery.receipt))
  assert.deepEqual(
    saved.resources.data?.kind === 'snapshot' && saved.resources.data.snapshot.data.rows,
    snapshot.data.rows,
  )
  await assert.rejects(
    f.present({
      basedOnRecordId: saved.recordId,
      program:
        'root = DatasetView("data", {chart:"line",encoding:{axis:"category",values:["value"]}});',
    }),
    /analysis-view-target-ambiguous at root\/view\/encoding/,
  )
  assert.equal(
    (await resolvePresentation(f.root, 'workspace', saved.reportId)).buildId,
    saved.buildId,
  )
  await rm(path.join(f.root, f.captureDirectory), { recursive: true })
  await f.service.close()
  const cold = new MarivoPresentationFileService(
    () => ({ id: 'workspace', path: f.root }),
    () => ({ id: 'workspace', path: f.root }),
  )
  t.after(() => cold.close())
  const reopened = await readAnalysisRecord(f.root, 'workspace', saved.reportId, saved.buildId)
  assert.equal(reopened.program, saved.program)
  assert.deepEqual(reopened.resources, saved.resources)
  const model = new PresentationDeliveryModel({
    async call(_channel, endpoint, payload, signal) {
      return {
        ok: true,
        value:
          endpoint === 'files/read'
            ? await cold.read(payload, signal)
            : endpoint === 'reports/history'
              ? await cold.catalog(endpoint, payload, signal)
              : await cold.report(payload, signal),
      }
    },
  })
  t.after(() => model.dispose())
  await model.showBuild('workspace', saved.reportId, saved.buildId)
  assert.equal(model.getSnapshot().error, undefined)
  assert.equal(model.getSnapshot().analysisDocument?.program, saved.program)
  const updated = await f.present({
    basedOnRecordId: saved.recordId,
    program:
      'root = DatasetView("data", {chart:"bar",encoding:{axis:"category",values:["value"],series:"series"}});',
  })
  assert.deepEqual((await readReceiptDocument(f.root, updated.receipt)).resources, saved.resources)
})

test('only the current Catalog reads Frame and Dataset reports', async (t) => {
  const f = await fixture(t)
  const previous = '55bf072e4cc809433d3bc4c3436a7d4a917c2052cf27bfe6b4637d7aa03d0053'
  const predecessor = 'c42feb51cff7113f2de9d48dd61992672a4dc0b13b832b73aef72de7e0b56d0f'
  for (const resource of ['frame', 'data'] as const) {
    const delivery = await f.present({ resources: { [resource]: f.resources[resource] } })
    const saved = await readReceiptDocument(f.root, delivery.receipt)
    assert.equal(parseAnalysisDocument(saved).program, saved.program)
    for (const build of [predecessor, previous, 'unknown'])
      assert.throws(() => parseAnalysisDocument({ ...saved, catalog: { ...saved.catalog, build } }))
  }
})
