import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { MarivoCheckedRunner } from '../../src/environment/types.ts'
import { parseAnalysisDocument } from '../../src/presentation/contracts/analysis-document.ts'
import { parseAnalysisProgram } from '../../src/presentation/contracts/analysis-program.ts'
import { frameDisplaySchema, frameViewSchema } from '../../src/presentation/contracts/frame-view.ts'
import {
  type ResultReference,
  resultReference,
} from '../../src/presentation/contracts/result-reference.ts'
import { parseAnalysisSnapshot } from '../../src/presentation/contracts/snapshot.ts'
import { AnalysisDrafts } from '../../src/presentation/drafts.ts'
import { parsePresentationDelivery } from '../../src/presentation/receipt.ts'
import {
  readReceiptDocument,
  readReportHistory,
  resolvePresentation,
} from '../../src/presentation/reports.ts'
import { MarivoPresentationFileService } from '../../src/presentation/rpc.ts'
import { createMarivoPresentTool, createMarivoUiReadTool } from '../../src/presentation/tool.ts'
import { type PythonCodeRef, savePythonExecution } from '../../src/python-execution.ts'
import { skipBrowserTest } from '../browser-test.ts'
import { datasetSnapshot } from '../unified-analysis-ui/dataset-fixtures.ts'
import { bundleRenderer, comparedScalar } from '../unified-analysis-ui/frame-render-fixtures.ts'
import { frameSnapshotV2 } from './frame-v2-fixture.ts'
import { reportReadInput, reportReadOutput, reportWriteInput } from './report-protocol-fixture.ts'

async function fixture(
  t: { after(fn: () => Promise<void>): void },
  frameOverride?: ReturnType<typeof comparedScalar>,
) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'report-data-update-')))
  const priorHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  t.after(async () => {
    if (priorHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = priorHome
    await rm(root, { recursive: true, force: true })
  })
  const workspace = () => ({ id: 'workspace', path: root })
  const session = {
    id: 'session',
    snapshotEvents: () => [{ type: 'tool/call', data: { callId: 'present', turn: 1 } }],
  } as unknown as Session
  const exec = {
    agent: { session },
    callId: 'present',
    signal: new AbortController().signal,
  } as unknown as ToolRunContext
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
    async runChecked(request) {
      reads++
      const ref = resultReference.parse(JSON.parse(request.stdin!))
      const raw =
        ref.schema === 'marivo.frame_ref/v2'
          ? structuredClone(frameOverride ?? frameSnapshotV2())
          : datasetSnapshot()
      if (ref.schema === 'marivo.frame_ref/v2')
        Object.assign(raw.source, { sessionId: ref.session_id, artifactId: ref.artifact_id })
      const snapshot = parseAnalysisSnapshot(raw)
      if (ref.schema === 'marivo.dataframe_ref/v2' && ref.result_id.endsWith('3'))
        snapshot.data.rows = snapshot.data.rows.map((row) =>
          row.map((cell) => (cell === 'A' ? 'changed' : cell)),
        )
      if ((ref.schema === 'marivo.frame_ref/v2' ? ref.artifact_id : ref.result_id).endsWith('2')) {
        snapshot.data.rows = snapshot.data.rows.map((row) =>
          row.map((cell, index) =>
            snapshot.data.columns[index]?.type === 'decimal'
              ? '42.5000'
              : typeof cell === 'number'
                ? cell + 10
                : cell,
          ),
        )
      }
      return {
        exitCode: 0,
        signal: null,
        durationMs: 1,
        stdout: Buffer.from(JSON.stringify(snapshot)),
        stderr: Buffer.alloc(0),
      }
    },
  }
  const declarations = (codeRef?: PythonCodeRef, suffix = '1') => ({
    frame: {
      kind: 'analysis-frame' as const,
      ref: {
        schema: 'marivo.frame_ref/v2' as const,
        store_id: 'store',
        session_id: 'marivo-session',
        artifact_id: `artifact-${suffix}`,
      },
      ...(codeRef ? { codeRef } : {}),
    },
    data: {
      kind: 'dataframe' as const,
      ref: {
        schema: 'marivo.dataframe_ref/v2' as const,
        project_root: root,
        result_id: `df_${suffix.repeat(32)}`,
      },
      ...(codeRef ? { codeRef } : {}),
    },
  })
  const saveCode = (suffix = '1', references?: ResultReference[], workspaceRoot = root) =>
    savePythonExecution(workspaceRoot, {
      text: `# producer ${suffix}\nprint("results")`,
      startedAt: '2026-11-09T00:00:00.000Z',
      finishedAt: '2026-11-09T00:00:01.000Z',
      datasources: [{ name: 'warehouse', backend: 'duckdb' }],
      results: {
        sessionId: 'producer-session',
        callId: `producer-${suffix}`,
        rootCallId: 'code-root',
        variables: { frame: 'frame_ref', data: 'data_ref' },
        references:
          references ??
          Object.values(declarations(undefined, suffix)).map((resource) => resource.ref),
      },
    })
  const drafts = new AnalysisDrafts()
  const tool = createMarivoPresentTool(workspace, session, undefined, drafts, async () => runner)
  const present = async (args: Record<string, unknown>) =>
    parsePresentationDelivery(
      JSON.parse(
        ((await tool.execute(reportWriteInput(args), exec)) as { deliveryJson: string })
          .deliveryJson,
      ),
    )
  const read = async (args: Record<string, unknown>) =>
    reportReadOutput(
      await createMarivoUiReadTool(workspace, drafts).execute(reportReadInput(args), exec),
    )

  const service = new MarivoPresentationFileService(
    workspace,
    (id) => (id === 'workspace' ? workspace() : undefined),
    drafts,
  )
  t.after(() => service.close())
  return {
    root,
    workspace,
    exec,
    tool,
    drafts,
    present,
    read,
    saveCode,
    declarations,
    service,
    get reads() {
      return reads
    },
  }
}

test('saved anonymous comparison labels survive OpenUI admission and render after reload', async (t) => {
  if (skipBrowserTest(t)) return
  const snapshot = comparedScalar({ current: 120, baseline: 100, absolute: 20, relative: 0.2 })
  const facts = snapshot.frame.sections.interpretation
  if (facts.status !== 'captured') throw new Error('expected interpretation')
  facts.comparisons[0]!.alias = null
  const f = await fixture(t, snapshot)
  const delivery = await f.present({
    resourcePatch: { put: { frame: f.declarations().frame } },
    program:
      'root = AnalysisFrameView("frame", {chart:"comparison"}, {comparisonLabels:[{current:"本期 11-10",baseline:"基期 11-09"}]});',
  })
  const document = await readReceiptDocument(f.root, delivery.receipt)
  const resource = document.resources.frame
  assert(resource?.kind === 'snapshot')
  const node = parseAnalysisProgram(document.program)
  const renderer = await bundleRenderer()
  try {
    const html = await renderer.render(resource.snapshot, {
      view: frameViewSchema.parse(node.props.view),
      display: frameDisplaySchema.parse(node.props.display),
    })
    assert.match(html, /本期 11-10/)
    assert.match(html, /基期 11-09/)
    assert.match(html, /120\.00/)
    assert.match(html, /100\.00/)
  } finally {
    await renderer.dispose()
  }
})

test('new Frame and DataFrame resources expose verified scripts to the reader and Harness', async (t) => {
  const f = await fixture(t)
  const codeRef = await f.saveCode()
  const delivery = await f.present({
    resourcePatch: { put: f.declarations(codeRef) },
    program: 'root = Stack([AnalysisFrameView("frame"), DatasetView("data")]);',
  })
  const document = await readReceiptDocument(f.root, delivery.receipt)
  for (const resource of Object.values(document.resources)) {
    assert(resource.kind === 'snapshot')
    assert.deepEqual(resource.binding, {
      workspaceId: 'workspace',
      codeRef,
      sessionId: 'producer-session',
      callId: 'producer-1',
    })
  }
  const ordinary = await f.read({ recordId: document.recordId })
  assert.equal(ordinary.sources, undefined)
  assert.deepEqual(ordinary.resources.frame.codeRef, codeRef)
  assert.equal(ordinary.resources.data.rows, undefined)
  const definition = await f.read({ recordId: document.recordId, includeCode: true })
  assert.equal(definition.sources.length, 1)
  assert.equal(definition.sources[0].status, 'available')
  assert.equal(definition.sources[0].code.text, '# producer 1\nprint("results")')
  assert.deepEqual(definition.sources[0].code.datasources, [
    { name: 'warehouse', backend: 'duckdb' },
  ])
  assert.equal(
    (await f.service.code({ workspaceId: 'workspace', receipt: delivery.receipt, codeRef })).text,
    definition.sources[0].code.text,
  )
  assert.equal(f.reads, 2)
})

test('documented report examples preview independent components and refresh only resources', async (t) => {
  const f = await fixture(t)
  const events: string[] = []
  const previews: string[][] = []
  let executions = 0
  const tools = {
    async marivo_python(args: {
      code: string
      datasources: string[]
      resultVariables: Record<string, string>
    }) {
      events.push('python')
      assert.deepEqual(Array.from(args.datasources), [])
      const names = Object.keys(args.resultVariables)
      assert.equal(names.length, 1)
      const name = names[0]!
      const ref = f.declarations(undefined, String(++executions)).data.ref
      // Model execution receipts; the presentation tools and persistence are real.
      const codeRef = await savePythonExecution(f.root, {
        text: args.code,
        startedAt: '2026-11-09T00:00:00.000Z',
        finishedAt: '2026-11-09T00:00:01.000Z',
        results: {
          sessionId: 'producer-session',
          callId: `component-${executions}`,
          rootCallId: 'example',
          variables: args.resultVariables,
          references: [ref],
        },
      })
      return {
        execution: { reason: 'succeeded' },
        results: {
          [name]: { resource: { kind: 'dataframe', ref, codeRef }, sourceStatus: 'recorded' },
        },
      }
    },
    async marivo_report_write(args: Record<string, unknown>) {
      events.push(String(args.stage))
      const result = await f.tool.execute(args, f.exec)
      if (args.stage === 'preview') {
        const definition = await f.read({ draft: true })
        previews.push(Object.keys(definition.resources).sort())
      }
      return result
    },
    async marivo_report_read(args: Record<string, unknown>) {
      events.push('read')
      return { definition: await f.read(args) }
    },
  }
  const example = async (name: string, context: Record<string, unknown> = {}) => {
    const markdown = await readFile(
      new URL(`../../skills/dsh-data-analysis-presentation/references/${name}.md`, import.meta.url),
      'utf8',
    )
    const section =
      name === 'examples'
        ? markdown.split('## 纯文件结果的增量交付\n')[1]?.split('\n## ')[0]
        : markdown
    assert.ok(section)
    const rawCode = /```javascript\n([\s\S]*?)\n```/.exec(section)?.[1]
    const code =
      name === 'data-update'
        ? rawCode
            ?.replaceAll('{ result:', '{ by_category:')
            .replaceAll('results.result', 'results.by_category')
            .replaceAll('results?.result', 'results?.by_category')
        : rawCode
    assert.ok(code)
    const result: unknown = await runInNewContext(`(async () => { ${code}\nreturn saved; })()`, {
      tools,
      ...context,
    })
    assert.ok(result && typeof result === 'object')
    return parsePresentationDelivery(JSON.parse(String(Reflect.get(result, 'deliveryJson'))))
  }
  const created = await example('examples')
  assert.deepEqual(events, ['preview', 'python', 'preview', 'python', 'preview', 'save'])
  assert.deepEqual(previews, [[], ['detail'], ['by_category', 'detail']])
  const original = await readReceiptDocument(f.root, created.receipt)
  const definition = await f.read({ recordId: original.recordId, includeCode: true })
  assert.equal(definition.sources.length, 2)
  const category = original.resources.by_category
  assert.ok(category?.kind === 'snapshot')
  const producer = definition.sources.find(
    (source: { codeRef: PythonCodeRef }) =>
      source.codeRef.executionId === category.binding.codeRef?.executionId,
  )
  assert.ok(producer)
  events.length = 0
  previews.length = 0
  const refreshed = await example('data-update', {
    savedRef: (await f.read({ recordId: original.recordId })).ref,
    reviewedCompleteScript: producer.code.text,
    datasourceNames: [],
  })
  assert.deepEqual(events, ['read', 'preview', 'python', 'preview', 'save'])
  assert.deepEqual(previews, [
    ['by_category', 'detail'],
    ['by_category', 'detail'],
  ])
  const updated = await readReceiptDocument(f.root, refreshed.receipt)
  assert.equal(updated.program, original.program)
  assert.equal(updated.title, original.title)
  assert.equal(updated.locale, original.locale)
  assert.deepEqual(updated.resources.detail, original.resources.detail)
  assert.notDeepEqual(updated.resources.by_category, original.resources.by_category)
  assert.equal((await readReportHistory(f.root, 'workspace', updated.reportId)).versions.length, 2)
})

test('data-only saves replace snapshots and scripts while preserving page text, layout and column labels', async (t) => {
  const f = await fixture(t)
  const codeRef = await f.saveCode()
  const resources = f.declarations(codeRef)
  const delivery = await f.present({
    resourcePatch: { put: resources },
    title: 'Keep title',
    locale: 'en-US',
    labels: { data: { value: 'Revenue' } },
    program:
      'heading = TextContent("Keep this exact body: 100");\nroot = Stack([heading, AnalysisFrameView("frame"), DatasetView("data")]);',
  })
  const base = await readReceiptDocument(f.root, delivery.receipt)
  const refreshedCode = await f.saveCode('2')
  const updated = await f.present({
    basedOnRecordId: base.recordId,
    resourcePatch: { put: f.declarations(refreshedCode, '2') },
  })
  const next = await readReceiptDocument(f.root, updated.receipt)
  assert.equal(next.reportId, base.reportId)
  assert.notEqual(next.buildId, base.buildId)
  assert.equal(next.program, base.program)
  assert.equal(next.title, base.title)
  assert.equal(next.locale, base.locale)
  assert.equal(
    next.resources.data?.kind === 'snapshot' &&
      next.resources.data.snapshot.data.columns.find((column) => column.id === 'value')?.label,
    'Revenue',
  )
  assert.notDeepEqual(next.resources.data, base.resources.data)
  assert.notDeepEqual(next.resources.frame, base.resources.frame)
  for (const name of ['frame', 'data']) {
    const previous = base.resources[name]
    const current = next.resources[name]
    assert(previous?.kind === 'snapshot' && current?.kind === 'snapshot')
    assert.notDeepEqual(current.snapshot.data.rows, previous.snapshot.data.rows)
  }
  assert.deepEqual(
    (await f.read({ recordId: next.recordId, includeCode: true })).sources[0].codeRef,
    refreshedCode,
  )
  assert.equal((await readReportHistory(f.root, 'workspace', next.reportId)).versions.length, 2)
  await assert.rejects(
    f.present({ basedOnRecordId: base.recordId, resourcePatch: { put: resources } }),
    /report-save-conflict/,
  )
  assert.equal(
    (await resolvePresentation(f.root, 'workspace', next.reportId)).buildId,
    next.buildId,
  )
  const noRuntime = createMarivoPresentTool(f.workspace, f.exec.agent!.session)
  await noRuntime.execute(
    reportWriteInput({ basedOnRecordId: next.recordId, title: 'Keep data' }),
    f.exec,
  )
  assert.equal(f.reads, 4)
})

test('unrelated, foreign and mismatched script bindings are rejected before result reads', async (t) => {
  const f = await fixture(t)
  const codeRef = await f.saveCode('2')
  await assert.rejects(
    f.present({ resourcePatch: { put: { data: f.declarations(codeRef).data } } }),
    /code-not-bound/,
  )
  assert.equal(f.reads, 0)
  const foreign = await realpath(await mkdtemp(path.join(os.tmpdir(), 'foreign-execution-')))
  t.after(() => rm(foreign, { recursive: true, force: true }))
  const foreignCode = await f.saveCode('1', undefined, foreign)
  await assert.rejects(
    f.present({ resourcePatch: { put: { data: f.declarations(foreignCode).data } } }),
    /unavailable/,
  )
  assert.equal(f.reads, 0)
  const valid = await f.saveCode()
  const delivery = await f.present({ resourcePatch: { put: { data: f.declarations(valid).data } } })
  const original = await readReceiptDocument(f.root, delivery.receipt)
  await assert.rejects(
    f.present({
      basedOnRecordId: original.recordId,
      resourcePatch: { put: { data: f.declarations(codeRef).data } },
    }),
    /code-not-bound/,
  )
  const document = structuredClone(await readReceiptDocument(f.root, delivery.receipt))
  const data = document.resources.data
  assert(data?.kind === 'snapshot')
  data.binding.codeRef = codeRef
  assert.throws(() => parseAnalysisDocument(document), /code-binding-invalid/)
})

test('readable code without exported results has a distinct actionable error before result reads', async (t) => {
  const f = await fixture(t)
  const codeRef = await savePythonExecution(f.root, {
    text: '# completed analysis without declared resultVariables',
    startedAt: '2026-11-09T00:00:00.000Z',
    finishedAt: '2026-11-09T00:00:01.000Z',
  })
  await assert.rejects(
    f.present({ resourcePatch: { put: { data: f.declarations(codeRef).data } } }),
    /python-result-exports-missing:.*source is readable.*without codeRef.*Do not rerun/,
  )
  assert.equal(f.reads, 0)
  const valid = await f.saveCode()
  await assert.rejects(
    f.present({
      resourcePatch: {
        put: {
          data: f.declarations({ ...valid, sha256: '0'.repeat(64) }).data,
        },
      },
    }),
    /python-execution-source-unavailable:.*without codeRef.*Do not rerun/,
  )
  assert.equal(f.reads, 0)
  const delivery = await f.present({ resourcePatch: { put: { data: f.declarations().data } } })
  const saved = await readReceiptDocument(f.root, delivery.receipt)
  assert(saved.resources.data?.kind === 'snapshot')
  assert.equal(saved.resources.data.binding.codeRef, undefined)
  assert.equal(f.reads, 1)
})

test('missing scripts remain explicit while saved resources stay readable and reusable', async (t) => {
  const f = await fixture(t)
  const codeRef = await f.saveCode()
  const delivery = await f.present({
    resourcePatch: { put: { data: f.declarations(codeRef).data } },
  })
  const filename = path.join(
    f.root,
    'dsh-data-analysis',
    'python-executions',
    createHash('sha256').update(f.root).digest('hex'),
    `${codeRef.executionId}.json`,
  )
  await rm(filename)
  const definition = await f.read({
    recordId: `marivo-ui:${delivery.receipt.reportId}:${delivery.receipt.buildId}`,
    includeCode: true,
  })
  assert.deepEqual(definition.sources, [{ codeRef, status: 'unavailable' }])
  const noRuntime = createMarivoPresentTool(f.workspace, f.exec.agent!.session)
  await noRuntime.execute(
    reportWriteInput({ basedOnRecordId: definition.recordId, title: 'Retained' }),
    f.exec,
  )
  assert.equal(f.reads, 1)
})

test('refresh with a missing default member leaves the last draft, current build and history intact', async (t) => {
  const f = await fixture(t)
  const delivery = await f.present({
    resourcePatch: { put: { data: f.declarations().data } },
    program:
      'root = Stack([f, DatasetView("data", {chart: "table"}, {}, ["region"])]);\nf = SnapshotFilter("region", "data", {kind: "column", name: "category"}, "Region", "single", ["A"]);',
  })
  const base = await readReceiptDocument(f.root, delivery.receipt)
  const preview = await f.tool.execute(
    {
      stage: 'preview',
      ref: (await f.read({ recordId: base.recordId })).ref,
      mode: 'refresh-data',
    },
    f.exec,
  )
  assert(
    preview && typeof preview === 'object' && 'ref' in preview && typeof preview.ref === 'string',
  )
  const priorDraft = f.drafts.get('session')
  const priorHistory = await readReportHistory(f.root, 'workspace', base.reportId)
  const changed = f.declarations(undefined, '3').data
  for (const stage of ['preview', 'save'] as const) {
    await assert.rejects(
      f.tool.execute(
        { stage, ref: preview.ref, resourcePatch: { put: { data: changed } } },
        f.exec,
      ),
      (error: unknown) =>
        error instanceof Error && /analysis-filter-default-invalid/.test(error.message),
    )
    assert.equal(f.drafts.get('session'), priorDraft)
    assert.deepEqual(await readReportHistory(f.root, 'workspace', base.reportId), priorHistory)
    assert.equal(
      (await resolvePresentation(f.root, 'workspace', base.reportId)).buildId,
      base.buildId,
    )
  }
})
