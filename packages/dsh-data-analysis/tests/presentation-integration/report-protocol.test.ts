import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readdir, realpath, rename, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import type { MarivoCheckedRunner } from '../../src/environment/types.ts'
import { AnalysisViewError } from '../../src/presentation/contracts/analysis-document.ts'
import { parseReportRef, savedReportRef } from '../../src/presentation/contracts/report-ref.ts'
import { AnalysisDrafts } from '../../src/presentation/drafts.ts'
import { createMarivoReportListTool } from '../../src/presentation/report-list.ts'
import {
  deletePresentation,
  readAnalysisRecord,
  readReportHistory,
} from '../../src/presentation/reports.ts'
import {
  createMarivoPresentTool,
  createMarivoReportDeleteTool,
  createMarivoUiReadTool,
} from '../../src/presentation/tool.ts'
import { datasetSnapshot } from '../unified-analysis-ui/dataset-fixtures.ts'
import { reportListOutput } from './report-protocol-fixture.ts'

const output = z.object({
  stage: z.enum(['preview', 'save']),
  ref: z.string(),
  mode: z.enum(['edit', 'refresh-data']),
  changed: z.array(z.string()),
  reused: z.array(z.string()),
  unchangedAliases: z.array(z.string()),
  resultMetadata: z.record(z.string(), z.json()),
})
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'report-ref-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const session = {
    id: 'session',
    snapshotEvents: () => [{ type: 'tool/call', data: { callId: 'call', turn: 1 } }],
  } as unknown as Session
  const exec = {
    agent: { session },
    callId: 'call',
    signal: new AbortController().signal,
  } as unknown as ToolRunContext
  const source = () => ({ id: 'workspace', path: root })
  const drafts = new AnalysisDrafts()
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
      const ref = z.object({ result_id: z.string() }).parse(JSON.parse(request.stdin!))
      if (ref.result_id.endsWith('f')) throw new Error('fixture-result-failed')
      const rows = ref.result_id.includes('2')
        ? [['A', '2']]
        : [
            ['A', '1'],
            ['B', '2'],
          ]
      const snapshot = datasetSnapshot(
        rows.map((row) => [row[1]!]),
        [
          {
            id: 'value',
            label: 'Value',
            type: ref.result_id.includes('3') ? 'string' : 'decimal',
            nullable: false,
          },
        ],
      )
      return {
        exitCode: 0,
        signal: null,
        durationMs: 1,
        stdout: Buffer.from(JSON.stringify(snapshot)),
        stderr: Buffer.alloc(0),
      }
    },
  }
  const tool = createMarivoPresentTool(source, session, undefined, drafts, async () => runner)
  const resource = (char = '1') => ({
    kind: 'dataframe',
    ref: {
      schema: 'marivo.dataframe_ref/v2',
      project_root: root,
      result_id: `df_${char.repeat(32)}`,
    },
  })
  const write = async (args: Record<string, unknown>) =>
    output.parse(await tool.execute(args, exec))
  const read = async (ref: string) =>
    z
      .object({
        definition: z.object({
          ref: z.string(),
          reuseGroups: z.array(z.array(z.string())),
        }),
      })
      .parse(await createMarivoUiReadTool(source, drafts).execute({ ref }, exec)).definition
  const document = async (ref: string) => {
    const parsed = parseReportRef(ref)
    assert.equal(parsed.kind, 'saved')
    if (parsed.kind !== 'saved') throw new Error('expected saved ref')
    return readAnalysisRecord(root, 'workspace', parsed.reportId, parsed.buildId)
  }
  return {
    root,
    source,
    drafts,
    tool,
    exec,
    resource,
    write,
    read,
    document,
    get reads() {
      return reads
    },
  }
}

test('ReportRef is bounded, versioned, canonical, and Workspace scoped', () => {
  const ref = savedReportRef({ workspaceId: 'workspace', reportId: 'report', buildId: 'build' })
  assert.deepEqual(parseReportRef(ref), {
    kind: 'saved',
    workspaceId: 'workspace',
    reportId: 'report',
    buildId: 'build',
  })
  for (const value of [null, '', 'mr2:s:e30', 'mr1:s:e30', `${ref}=`, 'x'.repeat(4097)])
    assert.throws(() => parseReportRef(value), /report-ref-invalid/)
  assert.throws(() => parseReportRef('invalid'), /marivo_report_list/)
})

test('a damaged copied ref recovers through title search after saving clears the draft', async (t) => {
  const f = await fixture(t)
  const preview = await f.write({
    stage: 'preview',
    title: 'Recoverable report',
    program: 'root = TextContent("Saved evidence");',
  })
  const args = { stage: 'save', ref: preview.ref }
  const raw = z.record(z.string(), z.json()).parse(await f.tool.execute(args, f.exec))
  const saved = output.parse(raw)
  const content = f.tool.output.render(args, raw)
  const receiptText = content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('\n')
  assert.equal(receiptText.match(/^Ref: (.+)$/m)?.[1], saved.ref)
  const payload = Buffer.from(saved.ref.split(':')[2]!, 'base64url').toString('utf8')
  const damaged = `mr1:s:${Buffer.from(payload.replace('"reportId"', '"seportId"')).toString('base64url')}`
  assert.throws(
    () => f.tool.output.render(args, { ...raw, ref: damaged }),
    /report-receipt-ref-mismatch/,
  )
  await assert.rejects(f.read(damaged), /report-ref-invalid/)
  const reader = createMarivoUiReadTool(f.source, f.drafts)
  await assert.rejects(reader.execute({ draft: true }, f.exec), /analysis-draft-unavailable/)
  await assert.rejects(reader.execute({ version: 'current' }, f.exec), /report-read-input-invalid/)
  const found = reportListOutput.parse(
    await createMarivoReportListTool(f.source).execute({ query: 'Recoverable report' }, f.exec),
  )
  assert.equal(found.reports.length, 1)
  assert.equal(found.reports[0]!.ref, saved.ref)
  assert.equal((await f.read(found.reports[0]!.ref)).ref, saved.ref)
  assert.equal((await f.document(saved.ref)).title, 'Recoverable report')
})

test('Agent deletion rejects stale or draft refs and removes all published versions', async (t) => {
  const f = await fixture(t)
  const first = await f.write({ stage: 'save', program: 'root = TextContent("first");' })
  const second = await f.write({
    stage: 'save',
    ref: first.ref,
    program: 'root = TextContent("second");',
  })
  const draft = await f.write({
    stage: 'preview',
    ref: second.ref,
    program: 'root = TextContent("draft");',
  })
  const tool = createMarivoReportDeleteTool(f.source)
  await assert.rejects(tool.execute({ ref: first.ref }, f.exec), /report-delete-conflict/)
  await assert.rejects(tool.execute({ ref: draft.ref }, f.exec), /report-saved-ref-required/)
  const parsed = parseReportRef(second.ref)
  if (parsed.kind !== 'saved') throw new Error('expected saved ref')
  const deleted = await tool.execute({ ref: second.ref }, f.exec)
  assert.deepEqual(deleted, {
    deleted: true,
    workspaceId: 'workspace',
    reportId: parsed.reportId,
    cleanupPending: false,
  })
  await assert.rejects(f.read(first.ref))
  await assert.rejects(f.read(second.ref))
  await assert.rejects(f.write({ stage: 'save', ref: draft.ref }), /report-not-found/)
})

test('interrupted cleanup leaves the view unavailable and can be retried after a restart', async (t) => {
  const f = await fixture(t)
  const saved = await f.write({ stage: 'save', program: 'root = TextContent("first");' })
  const ref = parseReportRef(saved.ref)
  if (ref.kind !== 'saved') throw new Error('expected saved ref')
  const parent = path.join(f.root, '.dsh-data-analysis', 'presentations')
  const interrupted = await deletePresentation(
    f.root,
    'workspace',
    ref.reportId,
    ref.buildId,
    async () => {
      if (
        (await readdir(parent)).some(
          (name) => name.startsWith('.deleted-') && !name.endsWith('.json'),
        )
      )
        throw new Error('interrupted')
    },
  )
  assert.equal(interrupted.cleanupPending, true)
  await assert.rejects(f.read(saved.ref))
  const retried = await deletePresentation(
    f.root,
    'workspace',
    ref.reportId,
    ref.buildId,
    async () => {},
  )
  assert.deepEqual(retried, { cleanupPending: false })
  assert.equal((await readdir(parent)).filter((name) => name.startsWith('.deleted-')).length, 0)
})

test('interruption before the deletion marker is published leaves the view readable and deletable', async (t) => {
  const f = await fixture(t)
  const saved = await f.write({ stage: 'save', program: 'root = TextContent("first");' })
  const ref = parseReportRef(saved.ref)
  if (ref.kind !== 'saved') throw new Error('expected saved ref')
  const parent = path.join(f.root, '.dsh-data-analysis', 'presentations')
  await assert.rejects(
    deletePresentation(f.root, 'workspace', ref.reportId, ref.buildId, async () => {
      if ((await readdir(parent)).some((name) => name.startsWith('.pending-delete-marker-')))
        throw new Error('interrupted')
    }),
    /interrupted/,
  )
  assert.equal((await f.read(saved.ref)).ref, saved.ref)
  assert.deepEqual(
    await deletePresentation(f.root, 'workspace', ref.reportId, ref.buildId, async () => {}),
    { cleanupPending: false },
  )
})

test('a draft save racing a permanent deletion cannot recreate the deleted view', async (t) => {
  const f = await fixture(t)
  const saved = await f.write({ stage: 'save', program: 'root = TextContent("first");' })
  const draft = await f.write({
    stage: 'preview',
    ref: saved.ref,
    program: 'root = TextContent("draft");',
  })
  const ref = parseReportRef(saved.ref)
  if (ref.kind !== 'saved') throw new Error('expected saved ref')
  const lock = path.join(
    f.root,
    '.dsh-data-analysis',
    'presentations',
    `.report-lock-${ref.reportId}.lock`,
  )
  let enter!: () => void
  let release!: () => void
  const entered = new Promise<void>((resolve) => {
    enter = resolve
  })
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let held = false
  const deleting = deletePresentation(f.root, 'workspace', ref.reportId, ref.buildId, async () => {
    if (held) return
    try {
      await lstat(lock)
    } catch {
      return
    }
    held = true
    enter()
    await gate
  })
  await entered
  const saving = assert.rejects(f.write({ stage: 'save', ref: draft.ref }))
  await new Promise<void>((resolve) => setImmediate(resolve))
  release()
  assert.deepEqual(await deleting, { cleanupPending: false })
  await saving
  await assert.rejects(f.read(saved.ref))
})

test('deletion refuses a replaced ancestor instead of following its symlink', async (t) => {
  const f = await fixture(t)
  const saved = await f.write({ stage: 'save', program: 'root = TextContent("first");' })
  const ref = parseReportRef(saved.ref)
  if (ref.kind !== 'saved') throw new Error('expected saved ref')
  const base = path.join(f.root, '.dsh-data-analysis')
  const lock = path.join(base, 'presentations', `.report-lock-${ref.reportId}.lock`)
  const target = path.join(f.root, 'outside')
  await mkdir(target)
  let replaced = false
  await assert.rejects(
    deletePresentation(f.root, 'workspace', ref.reportId, ref.buildId, async () => {
      if (replaced) return
      try {
        await lstat(lock)
      } catch {
        return
      }
      replaced = true
      await rename(base, path.join(f.root, 'saved-state'))
      await symlink(target, base)
    }),
    /presentation-directory-changed/,
  )
  assert.equal(replaced, true)
  assert.deepEqual(await readdir(target), [])
})

test('stage and new input protocol are mandatory; refresh guards run before result reads', async (t) => {
  const f = await fixture(t)
  await assert.rejects(
    f.tool.execute({ program: 'root = TextContent("scope");' }, f.exec),
    /missing required property "stage"/,
  )
  await assert.rejects(
    f.write({ stage: 'save', basedOnRecordId: 'marivo-ui:report:build' }),
    /(unknown property|unrecognized)/,
  )
  await assert.rejects(
    f.write({
      stage: 'save',
      mode: 'refresh-data',
      resourcePatch: { put: { data: f.resource() } },
    }),
    /refresh-saved-ref-required/,
  )
  const base = await f.write({ stage: 'save', resourcePatch: { put: { data: f.resource() } } })
  const reads = f.reads
  for (const forbidden of [
    { program: 'root = TextContent("changed");' },
    { title: 'changed' },
    { locale: 'en-US' },
    { labels: {} },
    { resourcePatch: { remove: [] } },
    { resourcePatch: { put: { unknown: f.resource('2') } } },
  ])
    await assert.rejects(
      f.write({ stage: 'save', ref: base.ref, mode: 'refresh-data', ...forbidden }),
      /refresh-(field-forbidden|resource-unknown)/,
    )
  assert.equal(f.reads, reads)
  const foreign = savedReportRef({ workspaceId: 'foreign', reportId: 'report', buildId: 'build' })
  await assert.rejects(f.read(foreign), /workspace-mismatch/)
})

test('refresh-data atomically rejects a mixed batch and preserves revision, current and history', async (t) => {
  const f = await fixture(t)
  const base = await f.write({
    stage: 'save',
    resourcePatch: { put: { a: f.resource(), b: f.resource() } },
    program:
      'root = Stack([TextContent("Original conclusion"), DatasetView("a", {chart:"table"}), DatasetView("b", {chart:"table"})]);',
  })
  const preview = await f.write({ stage: 'preview', ref: base.ref, mode: 'refresh-data' })
  const prior = f.drafts.get('session')!
  const baseDoc = await f.document(base.ref)
  const history = await readReportHistory(f.root, 'workspace', baseDoc.reportId)
  await assert.rejects(
    f.write({
      stage: 'preview',
      ref: preview.ref,
      resourcePatch: { put: { a: f.resource('2'), b: f.resource('f') } },
    }),
    /fixture-result-failed/,
  )
  assert.equal(f.drafts.get('session'), prior)
  assert.deepEqual(await readReportHistory(f.root, 'workspace', baseDoc.reportId), history)
  await assert.rejects(
    f.write({
      stage: 'save',
      ref: preview.ref,
      resourcePatch: { put: { a: f.resource('2'), b: f.resource('f') } },
    }),
    /fixture-result-failed/,
  )
  assert.equal(f.drafts.get('session'), prior)
  assert.deepEqual(await readReportHistory(f.root, 'workspace', baseDoc.reportId), history)
  await assert.rejects(
    f.write({ stage: 'preview', ref: preview.ref, mode: 'edit' }),
    /mode-conflict/,
  )
  const subset = await f.write({
    stage: 'save',
    ref: preview.ref,
    resourcePatch: { put: { a: f.resource('2') } },
  })
  assert.deepEqual(subset.changed, ['a'])
  assert.deepEqual(subset.reused, ['b'])
  assert.deepEqual(subset.unchangedAliases, ['b'])
  const current = await f.document(subset.ref)
  assert.equal(current.schemaVersion, 'dsh.analysis-ui/v3')
  assert.equal(current.program, baseDoc.program)
  assert.deepEqual(current.resources.b, baseDoc.resources.b)
  await f.write({ stage: 'save', ref: subset.ref, title: 'Edited title' })
})

test('a failed draft revision returns the current ref and the valid column IDs', async (t) => {
  const f = await fixture(t)
  const preview = await f.write({
    stage: 'preview',
    resourcePatch: { put: { result: f.resource() } },
    program: 'root = DatasetView("result", {chart:"table",columns:["value"]});',
  })
  const prior = f.drafts.get('session')
  await assert.rejects(
    f.write({
      stage: 'preview',
      ref: preview.ref,
      program: 'root = DatasetView("result", {chart:"table",columns:["missing"]});',
    }),
    (error: Error) => {
      assert(error instanceof AnalysisViewError)
      assert.equal(error.code, 'analysis-columns-invalid')
      assert.equal(error.path, 'root/view/columns/0')
      assert.deepEqual(error.recovery, {
        applied: false,
        currentRef: preview.ref,
        nextAction: error.recovery.nextAction,
      })
      assert.deepEqual(error.details, {
        received: 'missing',
        expectedKind: 'column',
        candidates: ['value'],
        resultMetadata: preview.resultMetadata,
      })
      return true
    },
  )
  assert.equal(f.drafts.get('session'), prior)
})

test('auto shape changes are rejected while explicit table row changes remain valid', async (t) => {
  const f = await fixture(t)
  const base = await f.write({ stage: 'save', resourcePatch: { put: { data: f.resource() } } })
  await assert.rejects(
    f.write({
      stage: 'save',
      mode: 'refresh-data',
      ref: base.ref,
      resourcePatch: { put: { data: f.resource('2') } },
    }),
    /report-refresh-view-shape-changed.*table -> metric/,
  )
  const doc = await f.document(base.ref)
  assert.equal((await readReportHistory(f.root, 'workspace', doc.reportId)).versions.length, 1)
})

test('saved ref survives an actual cold process and old draft ref does not', async (t) => {
  const f = await fixture(t)
  const saved = await f.write({
    stage: 'save',
    resourcePatch: { put: { a: f.resource(), alias: f.resource() } },
    program: 'root = Stack([DatasetView("a"), DatasetView("alias")]);',
  })
  assert.deepEqual((await f.read(saved.ref)).reuseGroups, [['a', 'alias']])
  const draft = await f.write({ stage: 'preview', ref: saved.ref })
  const probe = fileURLToPath(new URL('./report-cold-host-probe.ts', import.meta.url))
  const created = await promisify(execFile)(process.execPath, [
    '--experimental-strip-types',
    probe,
    f.root,
  ])
  const identities = z
    .object({ savedRef: z.string(), draftRef: z.string() })
    .parse(JSON.parse(created.stdout.trim()))
  const result = await promisify(execFile)(process.execPath, [
    '--experimental-strip-types',
    probe,
    f.root,
    identities.savedRef,
    identities.draftRef,
  ])
  assert.match(result.stdout, /COLD_HARNESS_NATIVE_SAVED_REF_OK_DRAFT_EXPIRED/)
  await assert.rejects(
    createMarivoUiReadTool(f.source, new AnalysisDrafts()).execute({ ref: draft.ref }, f.exec),
    /analysis-draft-unavailable/,
  )
})

test('stale refs expose the exact currentRef and refresh rebase remains explicit and mode constrained', async (t) => {
  const f = await fixture(t)
  const base = await f.write({
    stage: 'save',
    resourcePatch: { put: { data: f.resource() } },
    program: 'root = Stack([TextContent("Conclusion"), DatasetView("data", {chart:"table"})]);',
  })
  const initial = await f.write({ stage: 'preview', ref: base.ref, mode: 'refresh-data' })
  const revised = await f.write({
    stage: 'preview',
    ref: initial.ref,
    resourcePatch: { put: { data: f.resource('2') } },
  })
  const lastDraft = f.drafts.get('session')!
  await assert.rejects(f.write({ stage: 'save', ref: initial.ref }), (error: Error) => {
    assert.match(error.message, /analysis-draft-conflict/)
    assert.match(error.message, /"phase":"report-write"/)
    assert(error.message.includes(revised.ref))
    return true
  })
  const concurrent = await f.write({ stage: 'save', ref: base.ref, title: 'Concurrent title' })
  const document = await f.document(concurrent.ref)
  const history = await readReportHistory(f.root, 'workspace', document.reportId)
  await assert.rejects(f.write({ stage: 'save', ref: revised.ref }), (error: Error) => {
    assert.match(error.message, /report-save-conflict/)
    assert(error.message.includes(`"currentRef":"${concurrent.ref}"`))
    return true
  })
  assert.equal(f.drafts.get('session'), lastDraft)
  assert.deepEqual(await readReportHistory(f.root, 'workspace', document.reportId), history)
  assert.equal(
    (
      (await createMarivoUiReadTool(f.source, f.drafts).execute(
        { ref: base.ref, version: 'current' },
        f.exec,
      )) as { definition: { ref: string } }
    ).definition.ref,
    concurrent.ref,
  )
  await assert.rejects(
    f.write({ stage: 'save', ref: revised.ref, onto: concurrent.ref }),
    /analysis-draft-invalid-request/,
  )
  const reads = f.reads
  await assert.rejects(
    f.write({
      stage: 'preview',
      ref: revised.ref,
      onto: concurrent.ref,
      program: 'root = TextContent("changed");',
    }),
    /refresh-field-forbidden/,
  )
  assert.equal(f.reads, reads)
  assert.equal(f.drafts.get('session'), lastDraft)
  const rebased = await f.write({
    stage: 'preview',
    ref: revised.ref,
    onto: concurrent.ref,
    resourcePatch: { put: { data: f.resource('2') } },
  })
  const saved = await f.write({ stage: 'save', ref: rebased.ref })
  assert.equal(saved.mode, 'refresh-data')
  assert.equal((await f.document(saved.ref)).title, 'Concurrent title')
  assert.equal(
    (await readReportHistory(f.root, 'workspace', document.reportId)).versions.length,
    history.versions.length + 1,
  )
})

test('public output schemas retain concrete definition and source fields without claiming typed Host maps', () => {
  const reader = createMarivoUiReadTool(() => ({ id: 'workspace', path: '/workspace' }))
  const definition = reader.output.schema.properties?.definition
  assert(definition)
  assert.equal(definition.type, 'object')
  assert.equal(definition?.additionalProperties, false)
  for (const field of ['ref', 'program', 'resources', 'reuseGroups', 'sources'])
    assert(definition?.properties?.[field], field)
  assert.equal(definition.properties?.ref?.type, 'string')
  assert.match(definition.properties?.resources?.description ?? '', /columns.*coverage/)
  const sources = definition.properties?.sources?.items?.oneOf
  assert.equal(sources?.length, 2)
  assert.equal(sources?.[1]?.properties?.code?.properties?.text?.type, 'string')
})

test('same fixed results report reuse across refresh', async (t) => {
  const f = await fixture(t)
  const base = await f.write({
    stage: 'save',
    resourcePatch: { put: { data: f.resource() } },
    program: 'root = DatasetView("data", {chart:"table"});',
  })
  const before = f.reads
  const preview = await f.write({
    stage: 'preview',
    ref: base.ref,
    mode: 'refresh-data',
    resourcePatch: { put: { data: f.resource() } },
  })
  assert.deepEqual(preview.changed, [])
  assert.deepEqual(preview.reused, ['data'])
  assert.equal(f.reads, before)
  const refreshed = await f.write({
    stage: 'save',
    ref: preview.ref,
    resourcePatch: { put: { data: f.resource('2') } },
  })
  assert.deepEqual(refreshed.changed, ['data'])
})

test('Dataset display survives save and reopen and refresh rejects a changed format column type', async (t) => {
  const f = await fixture(t)
  const program =
    'root = DatasetView("data", {chart:"table"}, {title:"Family share", subtitle:"Saved results", formats:[{value:"value",format:"percent",decimals:1}]})'
  const base = await f.write({
    stage: 'save',
    program,
    resourcePatch: { put: { data: f.resource() } },
  })
  const saved = await f.document(base.ref)
  assert.equal(saved.program, program)
  const history = await readReportHistory(f.root, 'workspace', saved.reportId)
  await assert.rejects(
    f.write({
      stage: 'save',
      ref: base.ref,
      mode: 'refresh-data',
      resourcePatch: { put: { data: f.resource('3') } },
    }),
    (error: unknown) => {
      assert(error instanceof AnalysisViewError)
      assert.equal(error.path, 'root/display/formats/0/value')
      return true
    },
  )
  assert.deepEqual(await readReportHistory(f.root, 'workspace', saved.reportId), history)
  assert.equal((await f.document(base.ref)).program, program)
})
