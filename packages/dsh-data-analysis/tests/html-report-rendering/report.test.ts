import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { CodeRuntime, type CodeRunRequest, type CodeRunResult } from '@deepseek-ai/dsh-code-runtime'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { RUN_CODE_NAME, defineTool } from '@deepseek-ai/dsh-tools'
import { MarivoEnvironment } from '../../src/environment/binding.ts'
import { FixedSubprocessPolicy } from '../../src/environment/subprocess.ts'
import {
  canonicalJson,
  compileReportVisuals,
  createMarivoReportRenderTool,
  installMarivoReportCodeDelivery,
  MARIVO_REPORT_RENDER_TOOL_NAME,
  parseReportDocument,
  parseReportProjection,
  publishReport,
  registerMarivoReportRenderTool,
  renderReportHtml,
  reportDocumentDigest,
  type ReportDocumentV1,
  type ReportArtifactProjection,
  type ReportProjectionBundle,
} from '../../src/report/index.ts'

const document: ReportDocumentV1 = {
  version: 'dsh-data-analysis-report/v1',
  title: '支付趋势 <unsafe>',
  locale: 'zh-CN',
  sections: [{
    id: 'summary', title: '摘要', blocks: [
      { kind: 'text', id: 'summary-text', text: '结论 & 建议' },
      { kind: 'chart', id: 'trend-line', title: '趋势', subtitle: '业务说明', artifact_ref: 'artifact-trend', view: 'auto' },
      { kind: 'table', id: 'trend-table', title: '明细', artifact_ref: 'artifact-trend', columns: ['bucket_start', 'value'], max_rows: 3 },
    ],
  }],
}

const artifact: ReportArtifactProjection = {
  ref: 'artifact-trend', family: 'MetricFrame', shape: [5, 2] as const,
  columns: [
    { name: 'bucket_start', dtype: 'datetime64[ns]', nullable: false, role: 'time', unit: null },
    { name: 'value', dtype: 'float64', nullable: false, role: 'value', unit: 'count' },
  ],
  contentHash: 'c'.repeat(64), artifactSchemaVersion: 'analysis-artifact/v10',
  createdAt: '2026-08-27T00:00:00+00:00',
  contract: { kind: 'MetricFrame', ref: 'artifact-trend' },
  revalidation: { status: 'admissible', artifact_ref: 'artifact-trend', content_hash: 'c'.repeat(64), artifact_schema_version: 'analysis-artifact/v10' },
  lineage: { steps: [] },
  rowsProjected: true,
  rows: [
    ['2026-08-21T00:00:00+00:00', 91], ['2026-08-22T00:00:00+00:00', 92],
    ['2026-08-23T00:00:00+00:00', 89], ['2026-08-24T00:00:00+00:00', 94],
    ['2026-08-25T00:00:00+00:00', 95],
  ],
}

const projection: ReportProjectionBundle = {
  sessionId: 'session-report', artifacts: [artifact], findings: [], compatibilities: [],
}

class ReportCodeRuntime extends CodeRuntime {
  readonly language = 'typescript'
  readonly isolation = 'report-test'
  behavior: (request: CodeRunRequest) => Promise<CodeRunResult> = () => Promise.resolve({ logs: [] })

  run(request: CodeRunRequest): Promise<CodeRunResult> {
    return this.behavior(request)
  }
}

function compiled() {
  const result = compileReportVisuals(document, projection)
  assert.equal(result.ok, true, JSON.stringify(result))
  if (!result.ok) throw new Error('unreachable')
  return result.value
}

function parsedCompiledProjection(checkedAt: string, contract: unknown = artifact.contract) {
  const raw = {
    status: 'ready', session_id: 'session-report',
    artifacts: [{
      ref: artifact.ref, family: artifact.family, shape: artifact.shape, columns: artifact.columns,
      content_hash: artifact.contentHash, artifact_schema_version: artifact.artifactSchemaVersion,
      created_at: artifact.createdAt, contract,
      revalidation: { ...artifact.revalidation as Record<string, unknown>, checked_at: checkedAt },
      lineage: artifact.lineage, rows_projected: true, rows: artifact.rows,
    }],
    findings: [], compatibilities: [],
  }
  const parsed = parseReportProjection(Buffer.from(JSON.stringify(raw)), {
    sessionId: 'session-report', artifactRefs: [artifact.ref], findingIds: [], findingGroups: [],
  })
  assert.equal(parsed.ok, true, JSON.stringify(parsed))
  if (!parsed.ok) throw new Error('unreachable')
  const result = compileReportVisuals(document, parsed.value)
  assert.equal(result.ok, true, JSON.stringify(result))
  if (!result.ok) throw new Error('unreachable')
  return result.value
}

test('ReportDocument parser enforces the closed v1 shape and document-wide bounds', () => {
  const parsed = parseReportDocument(document)
  assert.equal(parsed.ok, true, JSON.stringify(parsed))
  if (!parsed.ok) return
  assert.deepEqual(parsed.value.artifactRefs, ['artifact-trend'])
  assert.deepEqual(parsed.value.findingIds, [])

  const invalid = structuredClone(document) as unknown as Record<string, unknown>
  invalid.unknown = true
  const sections = invalid.sections as Array<Record<string, unknown>>
  const blocks = sections[0]?.blocks as Array<Record<string, unknown>>
  blocks[1]!.id = 'summary-text'
  blocks[1]!.x = 'bucket_start'
  const rejected = parseReportDocument(invalid)
  assert.equal(rejected.ok, false)
  if (!rejected.ok) {
    assert.ok(rejected.issues.some(item => item.code === 'unknown-field'))
    assert.ok(rejected.issues.some(item => item.code === 'duplicate-block-id'))
    assert.ok(rejected.issues.some(item => item.code === 'auto-with-fields'))
  }
})

test('visual compiler selects one line mapping, preserves rows, and discloses truncation', () => {
  const result = compiled()
  const chart = result.charts.get('trend-line')
  assert.equal(chart?.view, 'line')
  assert.equal(chart?.x, 'bucket_start')
  assert.equal(chart?.y, 'value')
  assert.equal(chart?.points.length, 5)
  const table = result.tables.get('trend-table')
  assert.equal(table?.rows.length, 3)
  assert.equal(table?.omittedRows, 2)
  assert.ok(result.disclosures.some(item => item.includes('only 5 points')))
  assert.ok(result.disclosures.some(item => item.includes('omits 2')))

  const mixedProjection: ReportProjectionBundle = {
    ...projection,
    artifacts: [{
      ...artifact,
      shape: [5, 3],
      columns: [...artifact.columns, { name: 'platform', dtype: 'string', nullable: false, role: 'dimension', unit: null }],
      rows: artifact.rows.map((row, index) => [...row, index % 2 ? 'ios' : 'android']),
    }],
  }
  const rejected = compileReportVisuals(document, mixedProjection)
  assert.equal(rejected.ok, false)
  if (!rejected.ok) assert.ok(rejected.issues.some(item => item.code === 'mixed-chart-grain' || item.code === 'auto-chart-ambiguous'))
})

test('time lines sort and deduplicate by one timezone-independent instant', () => {
  const dstArtifact: ReportArtifactProjection = {
    ...artifact,
    shape: [4, 2],
    rows: [
      ['2026-11-01T01:00:00-04:00', 1],
      ['2026-11-01T01:30:00-04:00', 2],
      ['2026-11-01T01:15:00-05:00', 3],
      ['2026-11-01T02:00:00-05:00', 4],
    ],
  }
  const result = compileReportVisuals(document, { ...projection, artifacts: [dstArtifact] })
  assert.equal(result.ok, true, JSON.stringify(result))
  if (!result.ok) return
  const points = result.value.charts.get('trend-line')?.points ?? []
  const epochs = points.map(point => Date.parse(String(point.x)))
  assert.deepEqual(epochs, [...epochs].sort((left, right) => left - right))

  const duplicateInstant: ReportArtifactProjection = {
    ...dstArtifact,
    rows: [
      ['2026-11-01T01:00:00-04:00', 1],
      ['2026-11-01T01:30:00-04:00', 2],
      ['2026-11-01T00:30:00-05:00', 3],
      ['2026-11-01T02:00:00-05:00', 4],
    ],
  }
  const rejected = compileReportVisuals(document, { ...projection, artifacts: [duplicateInstant] })
  assert.equal(rejected.ok, false)
  if (!rejected.ok) assert.ok(rejected.issues.some(item => item.code === 'duplicate-chart-x'))
})

test('bar and Evidence blocks retain category zero-baseline and exact Finding source details', () => {
  const barDocument: ReportDocumentV1 = {
    version: 'dsh-data-analysis-report/v1', title: '分平台', locale: 'en-US',
    sections: [{ id: 'breakdown', title: 'Breakdown', blocks: [
      { kind: 'chart', id: 'platform-bar', title: 'Platform', artifact_ref: 'artifact-platform', view: 'auto', finding_ids: ['finding-platform'] },
      { kind: 'evidence', id: 'platform-evidence', title: 'Evidence', finding_ids: ['finding-platform'] },
    ] }],
  }
  const barArtifact: ReportArtifactProjection = {
    ...artifact, ref: 'artifact-platform', family: 'MetricFrame', shape: [3, 2],
    columns: [
      { name: 'platform', dtype: 'string', nullable: false, role: 'dimension', unit: null },
      { name: 'value', dtype: 'float64', nullable: false, role: 'value', unit: 'count' },
    ],
    contract: { kind: 'MetricFrame', ref: 'artifact-platform' },
    revalidation: { status: 'admissible', artifact_ref: 'artifact-platform', content_hash: artifact.contentHash, artifact_schema_version: artifact.artifactSchemaVersion },
    rows: [['android', -2], ['ios', 4], ['web', 3]],
  }
  const barProjection: ReportProjectionBundle = {
    sessionId: 'session-report', artifacts: [barArtifact],
    findings: [{
      findingId: 'finding-platform', findingType: 'observation', epistemicKind: 'observed',
      artifactId: 'artifact-platform', sessionId: 'session-report', qualityStatus: 'ready',
      committedAt: '2026-08-27T00:05:00+00:00', value: { kind: 'observation', row_count: 3 },
      subject: { kind: 'metric', metric_id: 'payments.success' }, derivation: { rule_id: 'observation/v1' },
      rendered: {
        en: 'payments.success: observed 3 platform rows.',
        zh: 'payments.success：观测到 3 行平台数据。',
      },
    }],
    compatibilities: [{ groupIndex: 0, status: 'compatible', findingIds: ['finding-platform'], value: { status: 'compatible' } }, { groupIndex: 1, status: 'compatible', findingIds: ['finding-platform'], value: { status: 'compatible' } }],
  }
  const result = compileReportVisuals(barDocument, barProjection)
  assert.equal(result.ok, true, JSON.stringify(result))
  if (!result.ok) return
  assert.equal(result.value.charts.get('platform-bar')?.view, 'bar')
  const html = renderReportHtml(result.value, '2026-08-27T01:02:03.000Z')
  assert.match(html, /bar-series/)
  assert.match(html, /value axis includes zero/)
  assert.match(html, /finding-platform/)
  assert.match(html, /payments.success/)
  assert.match(html, /payments\.success: observed 3 platform rows\./)
  assert.match(html, /href="#provenance-artifact-1"/)
  assert.match(html, /Complete provenance index/)
  assert.ok(html.indexOf('payments.success: observed 3 platform rows.') < html.indexOf('<details class="audit">'))
  assert.match(html, /<dt>session<\/dt><dd>session-report<\/dd>/)
})

test('Finding statements cannot inject HTML, links, or new report markup', () => {
  const unsafeDocument: ReportDocumentV1 = {
    version: 'dsh-data-analysis-report/v1', title: 'Unsafe Finding', locale: 'en-US',
    sections: [{ id: 'evidence', title: 'Evidence', blocks: [{
      kind: 'evidence', id: 'unsafe-evidence', title: 'Observed fact', finding_ids: ['finding-unsafe'],
    }] }],
  }
  const unsafeProjection: ReportProjectionBundle = {
    sessionId: 'session-report',
    artifacts: [{ ...artifact, rowsProjected: false, rows: [] }],
    findings: [{
      findingId: 'finding-unsafe', findingType: 'observation', epistemicKind: 'observed',
      artifactId: artifact.ref, sessionId: 'session-report', qualityStatus: 'ready',
      committedAt: '2026-08-27T00:05:00+00:00', value: { value: 12 },
      subject: { metric_id: 'payments.success' }, derivation: { rule_id: 'observation/v1' },
      rendered: {
        en: 'Fact <img src=x onerror=alert(1)> [link](https://example.invalid) [^mv-f99].',
        zh: '事实 <img src=x onerror=alert(1)>。',
      },
    }],
    compatibilities: [{
      groupIndex: 0, status: 'compatible', findingIds: ['finding-unsafe'], value: { status: 'compatible' },
    }],
  }
  const result = compileReportVisuals(unsafeDocument, unsafeProjection)
  assert.equal(result.ok, true, JSON.stringify(result))
  if (!result.ok) return
  const html = renderReportHtml(result.value, '2026-08-27T01:02:03.000Z')
  assert.match(html, /Fact &lt;img src=x onerror=alert\(1\)&gt;/)
  assert.match(html, /\[link\]\(https:\/\/example\.invalid\)/)
  assert.doesNotMatch(html, /<img\b|href="https:\/\/example\.invalid"|id="mv-f99"/)
})

test('renderer escapes content and emits offline SVG, source tables, CSP, and print rules', () => {
  const html = renderReportHtml(compiled(), '2026-08-27T01:02:03.000Z')
  assert.match(html, /支付趋势 &lt;unsafe&gt;/)
  assert.match(html, /结论 &amp; 建议/)
  assert.match(html, /Content-Security-Policy/)
  assert.match(html, /script-src 'none'/)
  assert.match(html, /<svg class="chart"/)
  assert.match(html, /查看同源数据表/)
  assert.match(html, /显示: 3 \/ 总计: 5 \/ 省略: 2/)
  assert.match(html, /业务说明 · artifact-trend · 5 行/)
  assert.match(html, /范围 value: 89 – 95 · 单位: count/)
  assert.match(html, /@media print/)
  assert.doesNotMatch(html, /<script\b|<iframe\b|https?:\/\/|data\.parquet|\.marivo\//)
})

test('canonical digests ignore object key order while document order remains semantic', () => {
  assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }))
  const twoSections: ReportDocumentV1 = {
    ...document,
    sections: [...document.sections, { id: 'appendix', title: '附录', blocks: [{ kind: 'text', id: 'appendix-text', text: '附录内容' }] }],
  }
  const reordered: ReportDocumentV1 = { ...twoSections, sections: [...twoSections.sections].reverse() }
  assert.notEqual(reportDocumentDigest(twoSections), reportDocumentDigest(reordered))
  const changed: ReportDocumentV1 = { ...document, title: '另一份报告' }
  assert.notEqual(reportDocumentDigest(document), reportDocumentDigest(changed))
})

test('publisher atomically creates private immutable files and reuses the same digest', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-report-publish-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const options = {
    environmentFingerprint: 'f'.repeat(64), marivoVersion: '0.4.test', reportsRoot: path.join(root, 'reports'),
    now: () => new Date('2026-08-27T01:02:03.000Z'),
  }
  const first = await publishReport(compiled(), options)
  assert.equal(first.ok, true, JSON.stringify(first))
  if (!first.ok) return
  const second = await publishReport(compiled(), { ...options, now: () => new Date('2026-08-28T00:00:00.000Z') })
  assert.equal(second.ok, true, JSON.stringify(second))
  if (!second.ok) return
  assert.equal(second.reused, true)
  assert.equal(second.path, first.path)
  assert.equal(second.generatedAt, first.generatedAt)
  const directory = path.dirname(first.path)
  assert.deepEqual((await readdir(directory)).sort(), ['index.html', 'manifest.json', 'report-document.json'])
  for (const filename of await readdir(directory)) {
    const mode = (await stat(path.join(directory, filename))).mode & 0o777
    if (process.platform !== 'win32') assert.equal(mode, 0o600)
  }
  assert.equal((await readdir(path.dirname(directory))).some(name => name.startsWith('.staging-')), false)
  assert.doesNotMatch((await readFile(first.path, 'utf8')), /<script\b/)
  const forged = '<script>globalThis.compromised=true</script>\n'
  await writeFile(first.path, forged, { mode: 0o600 })
  const manifestPath = path.join(directory, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    files: { index_html: { sha256: string; bytes: number } }
  }
  manifest.files.index_html = {
    sha256: createHash('sha256').update(forged).digest('hex'),
    bytes: Buffer.byteLength(forged),
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, { mode: 0o600 })
  await assert.rejects(() => publishReport(compiled(), options), /does not match its expected manifest/)
})

test('publisher ignores volatile revalidation time but identities stable provenance changes', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-report-provenance-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const options = {
    environmentFingerprint: '9'.repeat(64), marivoVersion: '0.4.test', reportsRoot: path.join(root, 'reports'),
    now: () => new Date('2026-08-27T01:02:03.000Z'),
  }
  const firstReport = parsedCompiledProjection('2026-08-27T01:00:00.000Z')
  const secondReport = parsedCompiledProjection('2026-08-28T01:00:00.000Z')
  assert.equal('checked_at' in (firstReport.projection.artifacts[0]!.revalidation as Record<string, unknown>), false)
  const first = await publishReport(firstReport, options)
  const second = await publishReport(secondReport, options)
  assert.equal(first.ok, true, JSON.stringify(first))
  assert.equal(second.ok, true, JSON.stringify(second))
  if (!first.ok || !second.ok) return
  assert.equal(second.reused, true)
  assert.equal(second.path, first.path)
  assert.equal(second.reportDigest, first.reportDigest)

  const changedReport = parsedCompiledProjection('2026-08-28T01:00:00.000Z', {
    kind: 'MetricFrame', ref: artifact.ref, semantic_revision: 2,
  })
  const changed = await publishReport(changedReport, options)
  assert.equal(changed.ok, true, JSON.stringify(changed))
  if (!changed.ok) return
  assert.notEqual(changed.reportDigest, first.reportDigest)
  assert.notEqual(changed.path, first.path)
})

test('Finding-only reports include the backing Artifact identity in the immutable manifest without copying rows', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-report-finding-only-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const evidenceDocument: ReportDocumentV1 = {
    version: 'dsh-data-analysis-report/v1', title: '仅 Finding 报告', locale: 'zh-CN',
    sections: [{ id: 'evidence', title: '事实', blocks: [{
      kind: 'evidence', id: 'finding-only', title: '关键事实', finding_ids: ['finding-only'],
    }] }],
  }
  const backingArtifact: ReportArtifactProjection = {
    ...artifact,
    ref: 'artifact-backing',
    shape: [5_000, 2],
    contract: { kind: 'MetricFrame', ref: 'artifact-backing' },
    revalidation: {
      status: 'admissible', artifact_ref: 'artifact-backing', content_hash: artifact.contentHash,
      artifact_schema_version: artifact.artifactSchemaVersion,
    },
    rowsProjected: false,
    rows: [],
  }
  const evidenceProjection: ReportProjectionBundle = {
    sessionId: 'session-report', artifacts: [backingArtifact],
    findings: [{
      findingId: 'finding-only', findingType: 'metric_value', epistemicKind: 'observed',
      artifactId: 'artifact-backing', sessionId: 'session-report', qualityStatus: null,
      committedAt: '2026-08-27T00:05:00+00:00', value: { value: 12 },
      subject: { metric_id: 'payments.success' }, derivation: { rule_id: 'metric/v1' },
      rendered: { en: 'payments.success: observed 12.', zh: 'payments.success：观测值为 12。' },
    }],
    compatibilities: [{
      groupIndex: 0, status: 'compatible', findingIds: ['finding-only'], value: { status: 'compatible' },
    }],
  }
  const compiledEvidence = compileReportVisuals(evidenceDocument, evidenceProjection)
  assert.equal(compiledEvidence.ok, true, JSON.stringify(compiledEvidence))
  if (!compiledEvidence.ok) return
  const published = await publishReport(compiledEvidence.value, {
    environmentFingerprint: 'e'.repeat(64), marivoVersion: '0.4.test',
    reportsRoot: path.join(root, 'reports'), now: () => new Date('2026-08-27T01:02:03.000Z'),
  })
  assert.equal(published.ok, true, JSON.stringify(published))
  if (!published.ok) return
  const manifest = JSON.parse(await readFile(path.join(path.dirname(published.path), 'manifest.json'), 'utf8')) as {
    version: string
    renderer_version: string
    provenance_digest: string
    artifacts: Array<{ ref: string; content_hash: string }>
    finding_ids: string[]
  }
  assert.equal(manifest.version, 'dsh-data-analysis-report-manifest/v2')
  assert.equal(manifest.renderer_version, 'dsh-data-analysis-html/v2')
  assert.match(manifest.provenance_digest, /^[a-f0-9]{64}$/)
  assert.deepEqual(manifest.artifacts, [{ ref: 'artifact-backing', content_hash: artifact.contentHash }])
  assert.deepEqual(manifest.finding_ids, ['finding-only'])
  const html = await readFile(published.path, 'utf8')
  assert.match(html, /payments\.success：观测值为 12。/)
  assert.match(html, /href="#provenance-artifact-1"/)
  assert.doesNotMatch(html, /data\.parquet|\.marivo\//)
})

test('publisher stops before publication when cancellation arrives after projection', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-report-cancel-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const controller = new AbortController()
  const environment = {
    binding: { fingerprint: 'a'.repeat(64), marivoVersion: '0.4.test' },
    async runCheckedReportProjection() {
      controller.abort(new Error('cancel report'))
      return {
        exitCode: 0,
        stdout: Buffer.from(JSON.stringify({
          status: 'ready', session_id: 'session-report', artifacts: [], findings: [], compatibilities: [],
        })),
        stderr: Buffer.alloc(0),
      }
    },
  } as unknown as MarivoEnvironment
  const tool = createMarivoReportRenderTool(environment, { reportsRoot: path.join(root, 'reports') })
  const textDocument: ReportDocumentV1 = {
    version: 'dsh-data-analysis-report/v1', title: 'Cancelled', locale: 'en-US',
    sections: [{ id: 'section', title: 'Section', blocks: [{ kind: 'text', id: 'text', text: 'body' }] }],
  }
  await assert.rejects(
    () => tool.execute(
      { session_id: 'session-report', document: textDocument },
      { signal: controller.signal } as Parameters<typeof tool.execute>[1],
    ),
    /cancel report/,
  )
  await assert.rejects(() => stat(path.join(root, 'reports')), { code: 'ENOENT' })
})

test('projection parser accepts one exact atomic bundle and rejects identity drift', () => {
  const raw: any = {
    status: 'ready', session_id: 'session-report',
    artifacts: [{
      ref: artifact.ref, family: artifact.family, shape: artifact.shape, columns: artifact.columns,
      content_hash: artifact.contentHash, artifact_schema_version: artifact.artifactSchemaVersion,
      created_at: artifact.createdAt, contract: artifact.contract, revalidation: artifact.revalidation,
      lineage: artifact.lineage, rows_projected: true, rows: artifact.rows,
    }],
    findings: [], compatibilities: [],
  }
  const accepted = parseReportProjection(Buffer.from(JSON.stringify(raw)), {
    sessionId: 'session-report', artifactRefs: ['artifact-trend'], findingIds: [], findingGroups: [],
  })
  assert.equal(accepted.ok, true)
  raw.artifacts[0]!.ref = 'drifted'
  assert.throws(() => parseReportProjection(Buffer.from(JSON.stringify(raw)), {
    sessionId: 'session-report', artifactRefs: ['artifact-trend'], findingIds: [], findingGroups: [],
  }), /revalidation identity|requested identities/)
})

test('Finding-only provenance accepts an admissible backing Artifact without projecting its rows', () => {
  const backingHash = 'b'.repeat(64)
  const raw = {
    status: 'ready', session_id: 'session-report',
    artifacts: [{
      ref: 'artifact-backing', family: 'MetricFrame', shape: [5000, 2], columns: artifact.columns,
      content_hash: backingHash, artifact_schema_version: artifact.artifactSchemaVersion,
      created_at: artifact.createdAt, contract: { kind: 'MetricFrame', ref: 'artifact-backing' },
      revalidation: {
        status: 'admissible', artifact_ref: 'artifact-backing', content_hash: backingHash,
        artifact_schema_version: artifact.artifactSchemaVersion,
      },
      lineage: { steps: [] }, rows_projected: false, rows: [],
    }],
    findings: [{
      finding_id: 'finding-only', finding_type: 'metric_value', epistemic_kind: 'observed',
      artifact_id: 'artifact-backing', session_id: 'session-report', quality_status: null,
      committed_at: '2026-08-27T00:05:00+00:00', value: { kind: 'metric_value', value: 12 },
      subject: { kind: 'metric', metric_id: 'payments.success' }, derivation: { rule_id: 'metric/v1' },
      rendered: { en: 'payments.success: observed 12.', zh: 'payments.success：观测值为 12。' },
    }],
    compatibilities: [{
      group_index: 0, status: 'compatible', finding_ids: ['finding-only'], value: { status: 'compatible' },
    }],
  }
  const accepted = parseReportProjection(Buffer.from(JSON.stringify(raw)), {
    sessionId: 'session-report', artifactRefs: [], findingIds: ['finding-only'], findingGroups: [['finding-only']],
  })
  assert.equal(accepted.ok, true, JSON.stringify(accepted))
  if (!accepted.ok) return
  assert.equal(accepted.value.artifacts[0]?.rowsProjected, false)
  assert.deepEqual(accepted.value.artifacts[0]?.rows, [])

  assert.throws(() => parseReportProjection(Buffer.from(JSON.stringify(raw)), {
    sessionId: 'session-report', artifactRefs: ['artifact-backing'], findingIds: ['finding-only'], findingGroups: [['finding-only']],
  }), /row projection status/)
})

test('nullable numeric projection cells remain null for table rendering', () => {
  const nullableArtifact: ReportArtifactProjection = {
    ...artifact,
    columns: [artifact.columns[0]!, { ...artifact.columns[1]!, nullable: true }],
    rows: artifact.rows.map((row, index) => index === 2 ? [row[0]!, null] : row),
  }
  const tableDocument: ReportDocumentV1 = {
    version: 'dsh-data-analysis-report/v1', title: 'Nullable table', locale: 'en-US',
    sections: [{ id: 'detail', title: 'Detail', blocks: [{
      kind: 'table', id: 'detail-table', title: 'Rows', artifact_ref: artifact.ref,
      columns: ['bucket_start', 'value'], max_rows: 5,
    }] }],
  }
  const result = compileReportVisuals(tableDocument, { ...projection, artifacts: [nullableArtifact] })
  assert.equal(result.ok, true, JSON.stringify(result))
  if (!result.ok) return
  assert.match(renderReportHtml(result.value, '2026-08-27T01:02:03.000Z'), /<td>—<\/td>/)
})

test('Code Mode logs one durable ready card block without changing nested Tool text', async () => {
  const ctx = new Context()
  const dispose = installMarivoReportCodeDelivery(ctx)
  const ready = {
    status: 'ready', title: 'Code report', path: '/reports/code/index.html',
    report_digest: 'a'.repeat(64), document_digest: 'b'.repeat(64),
    artifact_refs: [], finding_ids: [], disclosures: ['bounded'],
  }
  const sessionEvents = [{
    type: 'tool/call', data: { turn: 7, callId: 'outer', name: RUN_CODE_NAME },
  }]
  const agent = { session: { events: sessionEvents } }
  const exec = {
    callId: 'outer:code:1', name: MARIVO_REPORT_RENDER_TOOL_NAME,
    rootCallId: 'outer', parent: Symbol('outer'), agent,
    arguments: {}, signal: new AbortController().signal,
  }
  ctx.emit('tools/result', exec as never, {
    isError: false, value: ready, content: [{ type: 'text', text: 'original text' }],
  } as never)
  const original = [{ type: 'text', text: 'original text' }] as const
  const logged = await ctx.waterfall('tools/code-dispatch-log', {
    exec: { rootCallId: 'outer' } as never, agent: agent as never,
    subCallId: 'outer:code:1', name: MARIVO_REPORT_RENDER_TOOL_NAME,
    isError: false, content: [...original],
  } as never, () => Promise.resolve([...original]))
  assert.deepEqual(logged, [
    ...original,
    {
      type: 'marivo-report-card',
      turn: 7,
      meta: {
        kind: 'marivo-html-report', version: 1, title: ready.title, path: ready.path,
        reportDigest: ready.report_digest, disclosures: ready.disclosures,
      },
    },
  ])
  assert.deepEqual(original, [{ type: 'text', text: 'original text' }])

  const replayed = await ctx.waterfall('tools/code-dispatch-log', {
    exec: { rootCallId: 'outer' } as never, agent: agent as never,
    subCallId: 'outer:code:1', name: MARIVO_REPORT_RENDER_TOOL_NAME,
    isError: false, content: [...original],
  } as never, () => Promise.resolve([...original]))
  assert.deepEqual(replayed, original, 'one tools/result observation must mint only one block')

  ctx.emit('tools/result', { ...exec, callId: 'outer:code:unowned' } as never, {
    isError: false, value: ready, content: [{ type: 'text', text: 'unowned' }],
  } as never)
  const unowned = await ctx.waterfall('tools/code-dispatch-log', {
    exec: { rootCallId: 'unrelated-root' } as never, agent: agent as never,
    subCallId: 'outer:code:unowned', name: MARIVO_REPORT_RENDER_TOOL_NAME,
    isError: false, content: [{ type: 'text', text: 'unowned' }],
  } as never, () => Promise.resolve([{ type: 'text', text: 'unowned' }]))
  assert.deepEqual(unowned, [{ type: 'text', text: 'unowned' }])

  ctx.emit('tools/result', { ...exec, callId: 'outer:code:2' } as never, {
    isError: false,
    value: { status: 'blocked', stage: 'document', issues: [] },
    content: [{ type: 'text', text: 'blocked' }],
  } as never)
  const blocked = await ctx.waterfall('tools/code-dispatch-log', {
    exec: { rootCallId: 'outer' } as never, agent: agent as never,
    subCallId: 'outer:code:2', name: MARIVO_REPORT_RENDER_TOOL_NAME,
    isError: false, content: [{ type: 'text', text: 'blocked' }],
  } as never, () => Promise.resolve([{ type: 'text', text: 'blocked' }]))
  assert.deepEqual(blocked, [{ type: 'text', text: 'blocked' }])

  dispose()
  ctx.emit('tools/result', { ...exec, callId: 'outer:code:3' } as never, {
    isError: false, value: ready, content: [{ type: 'text', text: 'after dispose' }],
  } as never)
  const disposed = await ctx.waterfall('tools/code-dispatch-log', {
    exec: { rootCallId: 'outer' } as never, agent: agent as never,
    subCallId: 'outer:code:3', name: MARIVO_REPORT_RENDER_TOOL_NAME,
    isError: false, content: [{ type: 'text', text: 'after dispose' }],
  } as never, () => Promise.resolve([{ type: 'text', text: 'after dispose' }]))
  assert.deepEqual(disposed, [{ type: 'text', text: 'after dispose' }])
})

test('real run_code sub-dispatch replays the report card block through the standard event', async () => {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime, { mode: 'code' })
  await ctx.plugin(ReportCodeRuntime)
  const ready = {
    status: 'ready', title: 'Nested report', path: '/reports/nested/index.html',
    report_digest: 'c'.repeat(64), document_digest: 'd'.repeat(64),
    artifact_refs: [], finding_ids: [], disclosures: ['nested delivery'],
  }
  ctx.tools.register(defineTool({
    name: MARIVO_REPORT_RENDER_TOOL_NAME,
    description: 'Fixture report renderer',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: () => [{ type: 'text', text: 'nested original text' }],
    },
    execute: () => Promise.resolve(ready),
  }))
  const dispose = installMarivoReportCodeDelivery(ctx)
  const runtime = ctx.codeRuntime as ReportCodeRuntime
  runtime.behavior = async (request) => {
    const value = await request.bindings[0]!.functions[MARIVO_REPORT_RENDER_TOOL_NAME]!({})
    return { logs: [], value: JSON.stringify(value) }
  }
  const events: Array<{ type: string; data: any }> = [{
    type: 'tool/call',
    data: { turn: 5, callId: 'report-code-parent', name: RUN_CODE_NAME },
  }]
  const agent = {
    session: {
      events,
      append(type: string, data: unknown) { events.push({ type, data }) },
    },
  }
  const result = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId('report-code-parent'),
    name: RUN_CODE_NAME,
    arguments: { code: 'report()', description: 'Render one report' },
    agent: agent as never,
  })
  assert.equal(result.isError, false, JSON.stringify(result))
  const dispatch = events.find(event => event.type === 'tool/code-dispatch')
  assert.ok(dispatch)
  assert.equal(dispatch.data.name, MARIVO_REPORT_RENDER_TOOL_NAME)
  assert.deepEqual(dispatch.data.content, [
    { type: 'text', text: 'nested original text' },
    {
      type: 'marivo-report-card',
      turn: 5,
      meta: {
        kind: 'marivo-html-report', version: 1, title: ready.title, path: ready.path,
        reportDigest: ready.report_digest, disclosures: ready.disclosures,
      },
    },
  ])
  dispose()
})

test('registered Tool persists a closed ready card summary and null for blocked results', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-report-tool-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const executable = path.join(root, 'fixture-python')
  const payload = {
    status: 'ready', session_id: 'session-report',
    artifacts: [{
      ref: artifact.ref, family: artifact.family, shape: artifact.shape, columns: artifact.columns,
      content_hash: artifact.contentHash, artifact_schema_version: artifact.artifactSchemaVersion,
      created_at: artifact.createdAt, contract: artifact.contract, revalidation: artifact.revalidation,
      lineage: artifact.lineage, rows_projected: true, rows: artifact.rows,
    }], findings: [], compatibilities: [],
  }
  await writeFile(executable, `#!/usr/bin/env node\nprocess.stdout.write(process.env.REPORT_PAYLOAD ?? '')\n`)
  await chmod(executable, 0o755)
  const policy = new FixedSubprocessPolicy(root, { PATH: process.env.PATH, REPORT_PAYLOAD: JSON.stringify(payload) })
  const environment = new MarivoEnvironment({
    projectRoot: root, pythonExecutable: executable, marivoVersion: '0.4.test',
    packagePath: path.join(root, 'marivo', '__init__.py'), subprocessPolicyId: policy.id,
    fingerprint: 'f'.repeat(64),
  }, policy)
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  registerMarivoReportRenderTool(ctx, environment, {
    reportsRoot: path.join(root, 'reports'), now: () => new Date('2026-08-27T01:02:03.000Z'),
  })
  const result = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId('report-1'), name: MARIVO_REPORT_RENDER_TOOL_NAME,
    arguments: { session_id: 'session-report', document },
  })
  assert.equal(result.isError, false, JSON.stringify(result))
  if (result.isError) return
  const value = result.value as {
    status: string; title: string; path: string; report_digest: string; disclosures: string[]
  }
  assert.equal(value.status, 'ready')
  assert.deepEqual(result.meta, {
    kind: 'marivo-html-report', version: 1, title: value.title, path: value.path,
    reportDigest: value.report_digest, disclosures: value.disclosures,
  })
  assert.deepEqual(Object.keys(result.meta as object).sort(), [
    'disclosures', 'kind', 'path', 'reportDigest', 'title', 'version',
  ])
  assert.match(result.content[0]?.type === 'text' ? result.content[0].text : '', /HTML report ready/)

  const blocked = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId('report-blocked'), name: MARIVO_REPORT_RENDER_TOOL_NAME,
    arguments: {
      session_id: 'session-report',
      document: { ...document, sections: [] },
    },
  })
  assert.equal(blocked.isError, false, JSON.stringify(blocked))
  assert.equal((blocked.value as { status: string }).status, 'blocked')
  assert.equal(blocked.meta, null)
  assert.match(
    blocked.content[0]?.type === 'text' ? blocked.content[0].text : '',
    /HTML report rendering is blocked at stage document/,
  )
})
