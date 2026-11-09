import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import type { MarivoCheckedRunner } from '../../src/environment/types.ts'
import { createAnalysisDocument } from '../../src/presentation/analysis.ts'
import { AnalysisDrafts } from '../../src/presentation/drafts.ts'
import { readReportHistory } from '../../src/presentation/reports.ts'
import { createMarivoPresentTool } from '../../src/presentation/tool.ts'
import { savePythonExecution } from '../../src/python-execution.ts'
import { datasetSnapshot } from '../unified-analysis-ui/dataset-fixtures.ts'

async function workspace(t: { after(fn: () => Promise<void>): void }) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'progressive-report-')))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  t.after(async () => {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(root, { recursive: true, force: true })
  })
  return root
}
const output = z.object({
  stage: z.enum(['preview', 'save']),
  draftId: z.string().optional(),
  draftRevision: z.string().optional(),
  recordId: z.string().optional(),
  resultMetadataJson: z.string(),
})

test('draft identity requires an explicit action before parsing defaults or accessing the Workspace', async () => {
  const tool = createMarivoPresentTool(() => {
    throw new Error('unexpected-workspace-read')
  }, {} as Session)
  for (const args of [
    { draftId: 'invalid' },
    { draftRevision: 'invalid' },
    { draftId: 'invalid', draftRevision: 'invalid' },
  ])
    await assert.rejects(tool.execute(args, {} as ToolRunContext), /analysis-draft-stage-required/)
})

test('empty-resource scope preview survives missing stage and saves once with the latest revision', async (t) => {
  const root = await workspace(t)
  const session = {
    id: 'session',
    snapshotEvents: () => [{ type: 'tool/call', data: { callId: 'call', turn: 1 } }],
  } as unknown as Session
  const exec = {
    agent: { session },
    callId: 'call',
    signal: new AbortController().signal,
  } as unknown as ToolRunContext
  const drafts = new AnalysisDrafts()
  const tool = createMarivoPresentTool(
    () => ({ id: 'workspace', path: root }),
    session,
    undefined,
    drafts,
  )
  const first = output.parse(
    await tool.execute(
      {
        stage: 'preview',
        resourcePatch: { put: {} },
        program: 'root = TextContent("Question and confirmed scope");',
      },
      exec,
    ),
  )
  const identity = { draftId: first.draftId, draftRevision: first.draftRevision }
  await assert.rejects(tool.execute(identity, exec), /analysis-draft-stage-required/)
  assert.equal(drafts.get('session')?.delivery.draftRevision, first.draftRevision)
  const next = output.parse(
    await tool.execute(
      {
        ...identity,
        stage: 'preview',
        program: 'root = TextContent("Confirmed evidence and scope");',
      },
      exec,
    ),
  )
  await assert.rejects(
    tool.execute({ ...identity, stage: 'save' }, exec),
    /analysis-draft-conflict/,
  )
  const saved = output.parse(
    await tool.execute(
      { stage: 'save', draftId: next.draftId, draftRevision: next.draftRevision },
      exec,
    ),
  )
  assert.equal(saved.stage, 'save')
  assert(saved.recordId)
  const reportId = saved.recordId.split(':')[1]!
  assert.equal((await readReportHistory(root, 'workspace', reportId)).versions.length, 1)
  assert.equal(drafts.get('session'), undefined)
  const standalone = output.parse(
    await tool.execute({ program: 'root = TextContent("Standalone result");' }, exec),
  )
  assert.equal(standalone.stage, 'save')
})

test('shared exact result is admitted once, preserves its producer and repairs views without replay', async (t) => {
  const root = await workspace(t)
  const ref = {
    schema: 'marivo.dataframe_ref/v2' as const,
    project_root: root,
    result_id: `df_${'1'.repeat(32)}`,
  }
  const codeRef = await savePythonExecution(root, {
    text: '# Original producer',
    startedAt: '2026-11-09T00:00:00.000Z',
    finishedAt: '2026-11-09T00:00:01.000Z',
    results: {
      sessionId: 'producer-session',
      callId: 'producer-call',
      rootCallId: 'producer-call',
      variables: { shared: 'result_ref' },
      references: [ref],
    },
  })
  let reads = 0
  const runner: MarivoCheckedRunner = {
    status: 'ready',
    binding: {
      projectRoot: root,
      pythonExecutable: '/python',
      packagePath: '/marivo',
      marivoVersion: '0.6.4',
      fingerprint: 'identity',
      subprocessPolicyId: 'policy',
    },
    async runChecked() {
      reads++
      return {
        exitCode: 0,
        signal: null,
        durationMs: 1,
        stdout: Buffer.from(JSON.stringify(datasetSnapshot())),
        stderr: Buffer.alloc(0),
      }
    },
  }
  const declaration = { kind: 'dataframe' as const, ref, codeRef }
  const identity = { workspaceId: 'workspace', reportId: 'report', buildId: 'first' }
  const signal = new AbortController().signal
  const first = await createAnalysisDocument(
    {
      surface: 'tab',
      resourcePatch: { put: { chart: declaration, table: declaration } },
      labels: { chart: { value: 'Chart label' }, table: { value: 'Table label' } },
      program:
        'root = Stack([DatasetView("chart", {chart:"bar", encoding:{axis:"category", values:["value"]}}), DatasetView("table", {chart:"table"})]);',
    },
    { projectRoot: root, runner: async () => runner },
    identity,
    signal,
  )
  assert.equal(reads, 1)
  const chart = first.resources.chart,
    table = first.resources.table
  assert(chart?.kind === 'snapshot' && table?.kind === 'snapshot')
  assert.deepEqual(chart.binding.codeRef, codeRef)
  assert.equal(chart.binding.callId, 'producer-call')
  assert.equal(chart.snapshot.data.columns[1]?.label, 'Chart label')
  assert.equal(table.snapshot.data.columns[1]?.label, 'Table label')
  await assert.rejects(
    createAnalysisDocument(
      {
        surface: 'tab',
        program: 'root = DatasetView("table", {chart:"table", columns:["missing"]});',
      },
      { projectRoot: root },
      { ...identity, buildId: 'invalid' },
      signal,
      first,
    ),
    (error: unknown) => {
      assert(error instanceof Error)
      assert.match(error.message, /analysis-columns-invalid/)
      assert.match(error.message, /Result metadata:.*category.*value.*coverage/)
      return true
    },
  )
  for (const program of [
    'root = Stack([DatasetView("chart"), DatasetView("table", {chart:"table", columns:["missing"]})]);',
    'root = Stack([chartView, tableView]); chartView = DatasetView("chart"); tableView = DatasetView("table", {chart:"table", columns:["missing"]});',
  ]) {
    await assert.rejects(
      createAnalysisDocument(
        { surface: 'tab', program },
        { projectRoot: root },
        { ...identity, buildId: 'invalid-nested' },
        signal,
        first,
      ),
      (error: unknown) => {
        assert(error instanceof Error)
        assert.match(error.message, /analysis-columns-invalid/)
        const metadata = JSON.parse(
          error.message.split('Result metadata: ')[1]!.split('. Correct')[0]!,
        )
        assert.deepEqual(Object.keys(metadata.resources), ['table'])
        assert.match(error.message, /category.*value.*coverage/)
        return true
      },
    )
  }
  const repaired = await createAnalysisDocument(
    {
      surface: 'tab',
      program:
        'root = Stack([DatasetView("table", {chart:"table", columns:["category", "value"]}), DatasetView("table", {chart:"bar", encoding:{axis:"category", values:["value"]}})]);',
    },
    { projectRoot: root },
    { ...identity, buildId: 'repaired' },
    signal,
    first,
  )
  assert.equal(reads, 1)
  assert.deepEqual(repaired.resources, first.resources)
  const refreshed = {
    ...declaration,
    ref: { ...ref, result_id: `df_${'2'.repeat(32)}` },
    codeRef: undefined,
  }
  const mixed = await createAnalysisDocument(
    { surface: 'tab', resourcePatch: { put: { chart: declaration, table: refreshed } } },
    { projectRoot: root, runner: async () => runner },
    { ...identity, buildId: 'mixed' },
    signal,
    first,
  )
  assert.equal(reads, 2)
  assert.deepEqual(mixed.resources.chart, first.resources.chart)
  assert.notDeepEqual(mixed.resources.table?.declaration, first.resources.table?.declaration)
})
