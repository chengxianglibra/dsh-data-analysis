import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { MarivoEnvironment } from '../../src/environment/binding.ts'
import {
  type CompiledReport,
  canonicalJson,
  compileReportVisuals,
  createMarivoReportRenderTool,
  installMarivoReportCodeDelivery,
  MARIVO_REPORT_RENDER_TOOL_NAME,
  parseReportDocument,
  parseReportProjection,
  publishReport,
  REPORT_DIGEST_VERSION,
  REPORT_MANIFEST_VERSION,
  REPORT_RENDERER_VERSION,
  type ReportArtifactProjection,
  type ReportDagArtifactProjection,
  type ReportDagJobProjection,
  type ReportDocumentV2,
  type ReportProjectionBundle,
  type ReportRenderValueV2,
  registerMarivoReportRenderTool,
  renderReportHtml,
  renderReportToolValue,
  reportDocumentDigest,
  reportPresentationMeta,
} from '../../src/report/index.ts'

const document: ReportDocumentV2 = {
  version: 'dsh-data-analysis-report/v2',
  title: '支付趋势 <unsafe>',
  locale: 'zh-CN',
  sections: [
    {
      id: 'summary',
      title: '摘要',
      blocks: [
        { kind: 'text', id: 'summary-text', text: '结论 & 建议' },
        {
          kind: 'chart',
          id: 'trend-line',
          title: '趋势',
          subtitle: '业务说明',
          artifact_ref: 'artifact-trend',
          view: 'auto',
        },
        {
          kind: 'table',
          id: 'trend-table',
          title: '明细',
          artifact_ref: 'artifact-trend',
          columns: ['bucket_start', 'value'],
          max_rows: 3,
        },
      ],
    },
  ],
}

const artifact: ReportArtifactProjection = {
  ref: 'artifact-trend',
  family: 'MetricFrame',
  shape: [8, 2],
  columns: [
    { name: 'bucket_start', dtype: 'datetime64[ns]', nullable: false, role: 'time', unit: null },
    { name: 'value', dtype: 'float64', nullable: false, role: 'value', unit: 'count' },
  ],
  contentHash: 'c'.repeat(64),
  artifactSchemaVersion: 'analysis-artifact/v10',
  createdAt: '2026-08-27T00:00:00+00:00',
  contract: { kind: 'MetricFrame', ref: 'artifact-trend' },
  revalidation: {
    status: 'admissible',
    artifact_ref: 'artifact-trend',
    content_hash: 'c'.repeat(64),
    artifact_schema_version: 'analysis-artifact/v10',
  },
  lineage: { steps: [] },
  rows: [
    ['2026-08-18T00:00:00+00:00', 90],
    ['2026-08-19T00:00:00+00:00', 93],
    ['2026-08-20T00:00:00+00:00', 90],
    ['2026-08-21T00:00:00+00:00', 91],
    ['2026-08-22T00:00:00+00:00', 92],
    ['2026-08-23T00:00:00+00:00', 89],
    ['2026-08-24T00:00:00+00:00', 94],
    ['2026-08-25T00:00:00+00:00', 95],
  ],
}

const barArtifact: ReportArtifactProjection = {
  ...artifact,
  ref: 'artifact-platform',
  shape: [4, 2],
  columns: [
    { name: 'platform', dtype: 'string', nullable: false, role: 'dimension', unit: null },
    { name: 'value', dtype: 'float64', nullable: false, role: 'value', unit: 'count' },
  ],
  contentHash: 'b'.repeat(64),
  contract: { kind: 'MetricFrame', ref: 'artifact-platform' },
  revalidation: {
    status: 'admissible',
    artifact_ref: 'artifact-platform',
    content_hash: 'b'.repeat(64),
    artifact_schema_version: 'analysis-artifact/v10',
  },
  rows: [
    ['android', -2],
    ['ios', 4],
    ['web', 3],
    ['desktop', 1],
  ],
}

function dagArtifact(value: ReportArtifactProjection): ReportDagArtifactProjection {
  const previewRows = value.rows.slice(0, 10)
  return {
    ref: value.ref,
    status: 'ready',
    family: value.family,
    shape: value.shape,
    columns: value.columns,
    contentHash: value.contentHash,
    artifactSchemaVersion: value.artifactSchemaVersion,
    createdAt: value.createdAt,
    contract: value.contract,
    revalidation: value.revalidation,
    lineage: value.lineage,
    previewRows,
    totalRows: value.shape[0],
    omittedRows: value.shape[0] - previewRows.length,
    issues: [],
  }
}

function projectionFor(
  values: readonly ReportArtifactProjection[] = [artifact],
): ReportProjectionBundle {
  return {
    sessionId: 'session-report',
    artifacts: values,
    sessionDag: { jobs: [], artifacts: values.map(dagArtifact) },
  }
}

function compiledReport(
  reportDocument: ReportDocumentV2 = document,
  values: readonly ReportArtifactProjection[] = [artifact],
): CompiledReport {
  const result = compileReportVisuals(reportDocument, projectionFor(values))
  assert.equal(result.ok, true, JSON.stringify(result))
  if (!result.ok) throw new Error('unreachable')
  return result.value
}

function wireArtifact(value: ReportArtifactProjection) {
  return {
    ref: value.ref,
    family: value.family,
    shape: [...value.shape],
    columns: value.columns,
    content_hash: value.contentHash,
    artifact_schema_version: value.artifactSchemaVersion,
    created_at: value.createdAt,
    contract: value.contract,
    revalidation: value.revalidation,
    lineage: value.lineage,
    rows: value.rows,
  }
}

function wireDagArtifact(value: ReportDagArtifactProjection) {
  return {
    ref: value.ref,
    status: value.status,
    family: value.family,
    shape: value.shape,
    columns: value.columns,
    content_hash: value.contentHash,
    artifact_schema_version: value.artifactSchemaVersion,
    created_at: value.createdAt,
    contract: value.contract,
    revalidation: value.revalidation,
    lineage: value.lineage,
    preview_rows: value.previewRows,
    total_rows: value.totalRows,
    omitted_rows: value.omittedRows,
    issues: value.issues,
  }
}

function checkedPayload(
  values: readonly ReportArtifactProjection[],
  outcomes: readonly Record<string, unknown>[] = values.map((value) => ({
    status: 'ready',
    value: wireArtifact(value),
  })),
  sessionDag: Record<string, unknown> = {
    jobs: [],
    artifacts: values.map((value) => wireDagArtifact(dagArtifact(value))),
  },
) {
  return {
    status: 'checked',
    session_id: 'session-report',
    artifact_outcomes: outcomes,
    session_dag: sessionDag,
  }
}

function blockedArtifact(ref: string, location: string) {
  return {
    status: 'blocked',
    ref,
    omitted_issue_count: 0,
    issues: [
      {
        code: 'artifact-not-admissible',
        location,
        message: 'The explicit Artifact is stale.',
        repair: 'Regenerate the Artifact.',
      },
    ],
  }
}

function barDocument(): ReportDocumentV2 {
  return {
    version: 'dsh-data-analysis-report/v2',
    title: '平台分布',
    locale: 'en-US',
    sections: [
      {
        id: 'breakdown',
        title: 'Breakdown',
        blocks: [
          { kind: 'text', id: 'bar-summary', text: '<script>alert(1)</script>' },
          {
            kind: 'chart',
            id: 'platform-bar',
            title: 'Platform',
            artifact_ref: 'artifact-platform',
            view: 'auto',
          },
          {
            kind: 'table',
            id: 'platform-table',
            title: 'Rows',
            artifact_ref: 'artifact-platform',
            max_rows: 3,
          },
        ],
      },
    ],
  }
}

test('ReportDocument parser accepts the v2 minimum and exposes only explicit Artifact refs', () => {
  const parsed = parseReportDocument({
    version: 'dsh-data-analysis-report/v2',
    title: 'Minimum',
    locale: 'en-US',
    sections: [
      {
        id: 'summary',
        title: 'Summary',
        blocks: [{ kind: 'text', id: 'summary-text', text: 'Report summary' }],
      },
    ],
  })
  assert.equal(parsed.ok, true, JSON.stringify(parsed))
  if (!parsed.ok) return
  assert.deepEqual(parsed.value.artifactRefs, [])
  assert.deepEqual(Object.keys(parsed.value).sort(), ['artifactRefs', 'document'])
  assert.deepEqual(parsed.inspection.visualCandidates, [])
})

test('ReportDocument parser rejects v1, finding_ids, and evidence blocks', () => {
  const minimum = {
    version: 'dsh-data-analysis-report/v2',
    title: 'Legacy inputs',
    locale: 'en-US',
    sections: [
      {
        id: 'summary',
        title: 'Summary',
        blocks: [{ kind: 'text', id: 'summary-text', text: 'Summary' }],
      },
    ],
  }
  const oldVersion = parseReportDocument({ ...minimum, version: 'dsh-data-analysis-report/v1' })
  assert.equal(oldVersion.ok, false)
  if (!oldVersion.ok) {
    assert.ok(oldVersion.issues.some((item) => item.code === 'unsupported-version'))
    assert.match(oldVersion.issues[0]?.repair ?? '', /dsh-data-analysis-report\/v2/)
  }

  const withFindingIds = structuredClone(minimum) as Record<string, any>
  withFindingIds.sections[0].blocks[0].finding_ids = ['finding-1']
  const findingIds = parseReportDocument(withFindingIds)
  assert.equal(findingIds.ok, false)
  if (!findingIds.ok) {
    assert.ok(
      findingIds.issues.some(
        (item) =>
          item.code === 'unknown-field' &&
          item.location === 'document.sections[0].blocks[0].finding_ids',
      ),
    )
  }

  const evidence = parseReportDocument({
    ...minimum,
    sections: [
      {
        id: 'sources',
        title: 'Sources',
        blocks: [{ kind: 'evidence', id: 'evidence-list', title: 'Sources', finding_ids: ['f'] }],
      },
    ],
  })
  assert.equal(evidence.ok, false)
  if (!evidence.ok) {
    assert.ok(evidence.issues.some((item) => item.code === 'invalid-block-kind'))
    assert.ok(evidence.issues.some((item) => item.location.endsWith('.kind')))
  }
})

test('ReportDocument parser keeps the closed v2 shape and Artifact bounds', () => {
  const source = structuredClone(document) as Record<string, any>
  source.unknown = true
  source.sections[0].blocks[1].id = 'summary-text'
  source.sections[0].blocks[1].x = 'bucket_start'
  const rejected = parseReportDocument(source)
  assert.equal(rejected.ok, false)
  if (!rejected.ok) {
    assert.ok(rejected.issues.some((item) => item.code === 'unknown-field'))
    assert.ok(rejected.issues.some((item) => item.code === 'duplicate-block-id'))
    assert.ok(rejected.issues.some((item) => item.code === 'auto-with-fields'))
  }

  const manyArtifacts = {
    version: 'dsh-data-analysis-report/v2',
    title: 'Many Artifacts',
    locale: 'en-US',
    sections: [
      {
        id: 'summary',
        title: 'Summary',
        blocks: Array.from({ length: 21 }, (_, index) => ({
          kind: 'table',
          id: 'table-' + String(index),
          title: 'Table',
          artifact_ref: 'artifact-' + String(index),
          max_rows: 1,
        })),
      },
    ],
  }
  const tooMany = parseReportDocument(manyArtifacts)
  assert.equal(tooMany.ok, false)
  if (!tooMany.ok) assert.ok(tooMany.issues.some((item) => item.code === 'too-many-artifacts'))
})

test('report Tool schema is v2 and has no Finding or evidence block contract', () => {
  const environment = {
    binding: { fingerprint: 'a'.repeat(64), marivoVersion: '0.5.test' },
    async runCheckedReportProjection() {
      throw new Error('not called')
    },
  } as unknown as MarivoEnvironment
  const tool = createMarivoReportRenderTool(environment) as any
  const schema = tool.parameters.properties.document
  assert.match(schema.description, /ReportDocument v2/)
  assert.doesNotMatch(schema.description, /compatibility/)
  assert.doesNotMatch(schema.description, /Finding references/)
  assert.equal(schema.properties.version.const, 'dsh-data-analysis-report/v2')
  const blockSchemas = schema.properties.sections.items.properties.blocks.items.oneOf
  assert.equal(blockSchemas.length, 3)
  assert.deepEqual(
    blockSchemas.map((item: any) => item.properties.kind.const),
    ['text', 'chart', 'table'],
  )
  for (const blockSchema of blockSchemas) {
    assert.equal('finding_ids' in blockSchema.properties, false)
  }
  assert.equal('finding_ids' in tool.output.schema.oneOf[0].properties, false)
})

test('projection parser accepts only Artifact outcomes and the Session DAG', () => {
  const raw = checkedPayload([artifact])
  const parsed = parseReportProjection(Buffer.from(JSON.stringify(raw)), {
    sessionId: 'session-report',
    artifactRefs: ['artifact-trend'],
  })
  assert.equal(parsed.ok, true, JSON.stringify(parsed))
  assert.deepEqual(Object.keys(parsed.value).sort(), ['artifacts', 'sessionDag', 'sessionId'])
  assert.deepEqual(parsed.checkedArtifactRefs, ['artifact-trend'])

  const legacy = structuredClone(raw) as Record<string, unknown>
  legacy.finding_outcomes = []
  assert.throws(
    () =>
      parseReportProjection(Buffer.from(JSON.stringify(legacy)), {
        sessionId: 'session-report',
        artifactRefs: ['artifact-trend'],
      }),
    /finding_outcomes is unknown/,
  )

  const legacyArtifactField = structuredClone(raw) as any
  legacyArtifactField.artifact_outcomes[0].value.rows_projected = true
  assert.throws(
    () =>
      parseReportProjection(Buffer.from(JSON.stringify(legacyArtifactField)), {
        sessionId: 'session-report',
        artifactRefs: ['artifact-trend'],
      }),
    /rows_projected is unknown/,
  )

  const legacyDagField = structuredClone(raw) as any
  legacyDagField.session_dag.artifacts[0].evidence_status = null
  assert.throws(
    () =>
      parseReportProjection(Buffer.from(JSON.stringify(legacyDagField)), {
        sessionId: 'session-report',
        artifactRefs: ['artifact-trend'],
      }),
    /evidence_status is unknown/,
  )
})

test('projection parser checks each explicit Artifact independently and preserves partial outcomes', () => {
  const outcomes = [
    { status: 'ready', value: wireArtifact(artifact) },
    blockedArtifact('artifact-platform', 'artifact_refs[1]'),
  ]
  const raw = checkedPayload([artifact, barArtifact], outcomes)
  const parsed = parseReportProjection(Buffer.from(JSON.stringify(raw)), {
    sessionId: 'session-report',
    artifactRefs: ['artifact-trend', 'artifact-platform'],
  })
  assert.equal(parsed.ok, false)
  assert.equal(parsed.complete, false)
  assert.deepEqual(parsed.checkedArtifactRefs, ['artifact-trend', 'artifact-platform'])
  assert.deepEqual(
    parsed.value.artifacts.map((item) => item.ref),
    ['artifact-trend'],
  )
  assert.deepEqual(
    parsed.issues.map((item) => item.code),
    ['artifact-not-admissible'],
  )

  const missing = structuredClone(raw) as any
  missing.artifact_outcomes.pop()
  assert.throws(
    () =>
      parseReportProjection(Buffer.from(JSON.stringify(missing)), {
        sessionId: 'session-report',
        artifactRefs: ['artifact-trend', 'artifact-platform'],
      }),
    /outcome count/,
  )
  const wrongSession = structuredClone(raw) as any
  wrongSession.session_id = 'other-session'
  assert.throws(
    () =>
      parseReportProjection(Buffer.from(JSON.stringify(wrongSession)), {
        sessionId: 'session-report',
        artifactRefs: ['artifact-trend', 'artifact-platform'],
      }),
    /session_id does not match/,
  )
})

test('report Tool sends only session and explicit Artifact refs and returns no Finding fields', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-report-v2-bridge-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const calls: Array<{ sessionId: string; artifactRefs: string[] }> = []
  const environment = {
    binding: { fingerprint: 'd'.repeat(64), marivoVersion: '0.5.test' },
    async runCheckedReportProjection(sessionId: string, artifactRefs: readonly string[]) {
      calls.push({ sessionId, artifactRefs: [...artifactRefs] })
      return {
        exitCode: 0,
        stdout: Buffer.from(JSON.stringify(checkedPayload([artifact]))),
        stderr: Buffer.alloc(0),
      }
    },
  } as unknown as MarivoEnvironment
  const tool = createMarivoReportRenderTool(environment, {
    reportsRoot: path.join(root, 'reports'),
    now: () => new Date('2026-08-27T01:02:03.000Z'),
  })
  const value = (await tool.execute({ session_id: 'session-report', document }, {
    signal: new AbortController().signal,
  } as Parameters<typeof tool.execute>[1])) as ReportRenderValueV2
  assert.equal(value.status, 'ready', JSON.stringify(value))
  assert.deepEqual(calls, [{ sessionId: 'session-report', artifactRefs: ['artifact-trend'] }])
  assert.equal('finding_ids' in value, false)
  if (value.status !== 'ready') return
  const manifest = JSON.parse(
    await readFile(path.join(path.dirname(value.path), 'manifest.json'), 'utf8'),
  ) as Record<string, unknown>
  assert.equal(manifest.version, REPORT_MANIFEST_VERSION)
  assert.equal(manifest.renderer_version, REPORT_RENDERER_VERSION)
  assert.equal('finding_ids' in manifest, false)
  assert.equal('finding_outcomes' in manifest, false)
  assert.match(renderReportToolValue(value), /HTML report ready/)
})

test('multiple unrelated explicit Artifacts do not cause a global compatibility block', async (t) => {
  const reportsRoot = await mkdtemp(path.join(tmpdir(), 'dsh-report-v2-independent-'))
  t.after(() => rm(reportsRoot, { recursive: true, force: true }))
  const source: ReportDocumentV2 = {
    version: 'dsh-data-analysis-report/v2',
    title: 'Two artifacts',
    locale: 'en-US',
    sections: [
      {
        id: 'summary',
        title: 'Summary',
        blocks: [
          {
            kind: 'table',
            id: 'trend-table',
            title: 'Trend',
            artifact_ref: artifact.ref,
            max_rows: 2,
          },
          {
            kind: 'table',
            id: 'platform-table',
            title: 'Platform',
            artifact_ref: barArtifact.ref,
            max_rows: 2,
          },
        ],
      },
    ],
  }
  const calls: string[][] = []
  const environment = {
    binding: { fingerprint: 'e'.repeat(64), marivoVersion: '0.5.test' },
    async runCheckedReportProjection(sessionId: string, artifactRefs: readonly string[]) {
      assert.equal(sessionId, 'session-report')
      calls.push([...artifactRefs])
      return {
        exitCode: 0,
        stdout: Buffer.from(JSON.stringify(checkedPayload([artifact, barArtifact]))),
        stderr: Buffer.alloc(0),
      }
    },
  } as unknown as MarivoEnvironment
  const tool = createMarivoReportRenderTool(environment, {
    reportsRoot,
  })
  const value = (await tool.execute({ session_id: 'session-report', document: source }, {
    signal: new AbortController().signal,
  } as Parameters<typeof tool.execute>[1])) as ReportRenderValueV2
  assert.equal(value.status, 'ready', JSON.stringify(value))
  assert.deepEqual(calls, [['artifact-trend', 'artifact-platform']])
  if (value.status === 'ready')
    assert.deepEqual(value.artifact_refs, ['artifact-trend', 'artifact-platform'])
})

test('best-effort Artifact failures are attributed to every explicit Artifact occurrence', async () => {
  const source: ReportDocumentV2 = {
    version: 'dsh-data-analysis-report/v2',
    title: 'Repeated Artifact',
    locale: 'en-US',
    sections: [
      {
        id: 'summary',
        title: 'Summary',
        blocks: [
          { kind: 'table', id: 'one', title: 'One', artifact_ref: artifact.ref, max_rows: 2 },
          { kind: 'table', id: 'two', title: 'Two', artifact_ref: artifact.ref, max_rows: 2 },
        ],
      },
    ],
  }
  const environment = {
    binding: { fingerprint: 'f'.repeat(64), marivoVersion: '0.5.test' },
    async runCheckedReportProjection() {
      return {
        exitCode: 0,
        stdout: Buffer.from(
          JSON.stringify(
            checkedPayload([artifact], [blockedArtifact(artifact.ref, 'artifact_refs[0]')]),
          ),
        ),
        stderr: Buffer.alloc(0),
      }
    },
  } as unknown as MarivoEnvironment
  const tool = createMarivoReportRenderTool(environment)
  const value = (await tool.execute({ session_id: 'session-report', document: source }, {
    signal: new AbortController().signal,
  } as Parameters<typeof tool.execute>[1])) as ReportRenderValueV2
  assert.equal(value.status, 'blocked', JSON.stringify(value))
  if (value.status !== 'blocked') return
  assert.deepEqual(
    value.checks[1].issues.map((item) => item.location),
    ['document.sections[0].blocks[0].artifact_ref', 'document.sections[0].blocks[1].artifact_ref'],
  )
  assert.doesNotMatch(renderReportToolValue(value), /Finding|compatib/)
})

test('visual compiler preserves Artifact rows, table truncation, and line ordering', () => {
  const result = compileReportVisuals(document, projectionFor())
  assert.equal(result.ok, true, JSON.stringify(result))
  if (!result.ok) return
  assert.equal(result.value.charts.get('trend-line')?.view, 'line')
  assert.equal(result.value.charts.get('trend-line')?.points.length, 8)
  assert.equal(result.value.tables.get('trend-table')?.rows.length, 3)
  assert.equal(result.value.tables.get('trend-table')?.omittedRows, 5)
  assert.ok(result.value.disclosures.some((item) => item.includes('omits 5')))

  const reversed = { ...artifact, rows: [...artifact.rows].reverse() }
  const sorted = compileReportVisuals(document, projectionFor([reversed]))
  assert.equal(sorted.ok, true, JSON.stringify(sorted))
  if (sorted.ok) {
    const points = sorted.value.charts.get('trend-line')?.points ?? []
    const epochs = points.map((point) => Date.parse(String(point.x)))
    assert.deepEqual(
      epochs,
      [...epochs].sort((left, right) => left - right),
    )
  }
})

test('visual compiler does not impose advisory point-count gates', () => {
  const shortLine = { ...artifact, shape: [7, 2] as const, rows: artifact.rows.slice(0, 7) }
  const lineResult = compileReportVisuals(document, projectionFor([shortLine]))
  assert.equal(lineResult.ok, true, JSON.stringify(lineResult))

  const sparseBarDocument: ReportDocumentV2 = {
    version: 'dsh-data-analysis-report/v2',
    title: 'Sparse bar',
    locale: 'en-US',
    sections: [
      {
        id: 'summary',
        title: 'Summary',
        blocks: [
          {
            kind: 'chart',
            id: 'sparse-bar',
            title: 'Sparse categories',
            artifact_ref: 'artifact-sparse',
            view: 'bar',
            x: 'category',
            y: 'value',
          },
        ],
      },
    ],
  }
  const sparseBar: ReportArtifactProjection = {
    ...artifact,
    ref: 'artifact-sparse',
    shape: [3, 2],
    columns: [
      { name: 'category', dtype: 'string', nullable: false, role: 'dimension', unit: null },
      { name: 'value', dtype: 'float64', nullable: false, role: 'value', unit: 'count' },
    ],
    revalidation: {
      status: 'admissible',
      artifact_ref: 'artifact-sparse',
      content_hash: artifact.contentHash,
      artifact_schema_version: artifact.artifactSchemaVersion,
    },
    rows: [
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ],
  }
  const barResult = compileReportVisuals(sparseBarDocument, projectionFor([sparseBar]))
  assert.equal(barResult.ok, true, JSON.stringify(barResult))

  const denseBar = {
    ...sparseBar,
    shape: [31, 2] as const,
    rows: Array.from({ length: 31 }, (_, index) => [`category-${String(index)}`, index]),
  }
  const denseResult = compileReportVisuals(sparseBarDocument, projectionFor([denseBar]))
  assert.equal(denseResult.ok, true, JSON.stringify(denseResult))

  const emptyBar = { ...sparseBar, shape: [0, 2] as const, rows: [] }
  const emptyResult = compileReportVisuals(sparseBarDocument, projectionFor([emptyBar]))
  assert.equal(emptyResult.ok, false)
  if (!emptyResult.ok) assert.ok(emptyResult.issues.some((item) => item.code === 'chart-empty'))
})

test('time lines sort and deduplicate by one timezone-independent instant', () => {
  const dstArtifact: ReportArtifactProjection = {
    ...artifact,
    shape: [8, 2],
    rows: [
      ['2026-11-01T01:00:00-04:00', 1],
      ['2026-11-01T01:30:00-04:00', 2],
      ['2026-11-01T01:15:00-05:00', 3],
      ['2026-11-01T02:00:00-05:00', 4],
      ['2026-11-01T03:00:00-05:00', 5],
      ['2026-11-01T04:00:00-05:00', 6],
      ['2026-11-01T05:00:00-05:00', 7],
      ['2026-11-01T06:00:00-05:00', 8],
    ],
  }
  const result = compileReportVisuals(document, projectionFor([dstArtifact]))
  assert.equal(result.ok, true, JSON.stringify(result))
  if (!result.ok) return
  const points = result.value.charts.get('trend-line')?.points ?? []
  const epochs = points.map((point) => Date.parse(String(point.x)))
  assert.deepEqual(
    epochs,
    [...epochs].sort((left, right) => left - right),
  )

  const duplicateInstant: ReportArtifactProjection = {
    ...dstArtifact,
    rows: [
      ['2026-11-01T01:00:00-04:00', 1],
      ['2026-11-01T01:30:00-04:00', 2],
      ['2026-11-01T00:30:00-05:00', 3],
      ['2026-11-01T02:00:00-05:00', 4],
      ['2026-11-01T03:00:00-05:00', 5],
      ['2026-11-01T04:00:00-05:00', 6],
      ['2026-11-01T05:00:00-05:00', 7],
      ['2026-11-01T06:00:00-05:00', 8],
    ],
  }
  const rejected = compileReportVisuals(document, projectionFor([duplicateInstant]))
  assert.equal(rejected.ok, false)
  if (!rejected.ok) assert.ok(rejected.issues.some((item) => item.code === 'duplicate-chart-x'))
})

test('visual compiler keeps bars valid and rejects mixed chart grain', () => {
  const bar = compileReportVisuals(barDocument(), projectionFor([barArtifact]))
  assert.equal(bar.ok, true, JSON.stringify(bar))
  if (bar.ok) assert.equal(bar.value.charts.get('platform-bar')?.view, 'bar')

  const mixed = {
    ...artifact,
    shape: [8, 3] as const,
    columns: [
      ...artifact.columns,
      { name: 'platform', dtype: 'string', nullable: false, role: 'dimension', unit: null },
    ],
    rows: artifact.rows.map((row, index) => [...row, index % 2 === 0 ? 'ios' : 'android']),
  } as ReportArtifactProjection
  const rejected = compileReportVisuals(document, projectionFor([mixed]))
  assert.equal(rejected.ok, false)
  if (!rejected.ok) {
    assert.ok(
      rejected.issues.some(
        (item) => item.code === 'mixed-chart-grain' || item.code === 'auto-chart-ambiguous',
      ),
    )
  }
})

test('renderer renders Artifact and Job DAGs while removing Finding and evidence markup', () => {
  const job: ReportDagJobProjection = {
    id: 'job-observe',
    intent: 'observe',
    status: 'succeeded',
    startedAt: '2026-08-27T00:00:00Z',
    finishedAt: '2026-08-27T00:00:01Z',
    durationMs: 100,
    analysisPurpose: 'Observe revenue.',
    params: { sql: '<unsafe>' },
    inputArtifactRefs: [],
    outputArtifactRef: artifact.ref,
    reusedArtifact: false,
    queries: [
      {
        queryId: 'query-1',
        datasource: 'warehouse',
        dialect: 'trino',
        sql: "SELECT '<script>alert(1)</script>'",
        sqlDigest: 'd'.repeat(64),
        rowCount: 8,
        durationMs: 80,
        startedAt: '2026-08-27T00:00:00Z',
        finishedAt: '2026-08-27T00:00:01Z',
        status: 'succeeded',
        outputRef: artifact.ref,
      },
    ],
    queryIssues: [],
  }
  const compiled = compileReportVisuals(document, {
    ...projectionFor(),
    sessionDag: { jobs: [job], artifacts: [dagArtifact(artifact)] },
  })
  assert.equal(compiled.ok, true, JSON.stringify(compiled))
  if (!compiled.ok) return
  const html = renderReportHtml(compiled.value, '2026-08-27T01:02:03.000Z')
  assert.match(html, /<svg class="chart"/)
  assert.match(html, /<table/)
  assert.match(html, /data-dag-component/)
  assert.match(html, /dag-node-job/)
  assert.match(html, /dag-node-artifact/)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(html, /&lt;unsafe&gt;/)
  assert.match(html, /raw-sql/)
  assert.doesNotMatch(html, /evidence|dag-findings|finding_ids|Finding/i)
  assert.equal(html.match(/<script\b/g)?.length, 1)
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]
  const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1]
  assert.ok(script)
  assert.ok(style)
  assert.ok(
    html.includes(
      "script-src 'sha256-" + createHash('sha256').update(script).digest('base64') + "'",
    ),
  )
  assert.ok(
    html.includes("style-src 'sha256-" + createHash('sha256').update(style).digest('base64') + "'"),
  )
  assert.doesNotMatch(html, /unsafe-inline|unsafe-eval|<iframe\b|https?:\/\//)
})

test('renderer supports bar zero baseline and nullable table cells', () => {
  const bar = compileReportVisuals(barDocument(), projectionFor([barArtifact]))
  assert.equal(bar.ok, true, JSON.stringify(bar))
  if (!bar.ok) return
  const barHtml = renderReportHtml(bar.value, '2026-08-27T01:02:03.000Z')
  assert.match(barHtml, /bar-series/)
  assert.match(barHtml, /value axis includes zero/)

  const nullable = {
    ...barArtifact,
    columns: [barArtifact.columns[0]!, { ...barArtifact.columns[1]!, nullable: true }],
    rows: barArtifact.rows.map((row, index) => (index === 2 ? [row[0]!, null] : row)),
  } as ReportArtifactProjection
  const nullableDocument: ReportDocumentV2 = {
    version: 'dsh-data-analysis-report/v2',
    title: 'Nullable table',
    locale: 'en-US',
    sections: [
      {
        id: 'detail',
        title: 'Detail',
        blocks: [
          { kind: 'table', id: 'rows', title: 'Rows', artifact_ref: nullable.ref, max_rows: 4 },
        ],
      },
    ],
  }
  const compiled = compileReportVisuals(nullableDocument, projectionFor([nullable]))
  assert.equal(compiled.ok, true, JSON.stringify(compiled))
  if (!compiled.ok) return
  const html = renderReportHtml(compiled.value, '2026-08-27T01:02:03.000Z')
  assert.match(html, /<td>—<\/td>/)
})

test('canonical digests include v2 document identity and ignore object key order', () => {
  assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }))
  assert.match(REPORT_DIGEST_VERSION, /\/v4$/)
  assert.match(REPORT_MANIFEST_VERSION, /\/v4$/)
  assert.equal(REPORT_RENDERER_VERSION, 'dsh-data-analysis-html/v9')
  const twoSections: ReportDocumentV2 = {
    ...document,
    sections: [
      ...document.sections,
      {
        id: 'appendix',
        title: '附录',
        blocks: [{ kind: 'text', id: 'appendix-text', text: '附录内容' }],
      },
    ],
  }
  const reordered: ReportDocumentV2 = {
    ...twoSections,
    sections: [...twoSections.sections].reverse(),
  }
  assert.notEqual(reportDocumentDigest(twoSections), reportDocumentDigest(reordered))
  const changed = { ...document, title: '另一份报告' }
  assert.notEqual(reportDocumentDigest(document), reportDocumentDigest(changed))
  assert.equal(
    reportDocumentDigest(document),
    reportDocumentDigest(JSON.parse(canonicalJson(document)) as ReportDocumentV2),
  )
})

test('projection identity ignores volatile revalidation check times', () => {
  const raw = checkedPayload([artifact])
  const withCheckTimes = structuredClone(raw) as any
  withCheckTimes.artifact_outcomes[0].value.revalidation.checked_at = '2026-08-27T01:02:03.000Z'
  withCheckTimes.session_dag.artifacts[0].revalidation.checked_at = '2026-08-28T01:02:03.000Z'
  const expected = { sessionId: 'session-report', artifactRefs: ['artifact-trend'] }
  const first = parseReportProjection(Buffer.from(JSON.stringify(raw)), expected)
  const second = parseReportProjection(Buffer.from(JSON.stringify(withCheckTimes)), expected)
  assert.equal(first.ok, true, JSON.stringify(first))
  assert.equal(second.ok, true, JSON.stringify(second))
  assert.deepEqual(second.value, first.value)
  assert.equal(canonicalJson(second.value), canonicalJson(first.value))
})

test('publisher creates private v4 artifacts and reuses an identical digest', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-report-v4-publish-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const options = {
    environmentFingerprint: '1'.repeat(64),
    marivoVersion: '0.5.test',
    reportsRoot: path.join(root, 'reports'),
    now: () => new Date('2026-08-27T01:02:03.000Z'),
  }
  const first = await publishReport(compiledReport(), options)
  assert.equal(first.ok, true, JSON.stringify(first))
  if (!first.ok) return
  const second = await publishReport(compiledReport(), {
    ...options,
    now: () => new Date('2026-08-28T00:00:00.000Z'),
  })
  assert.equal(second.ok, true, JSON.stringify(second))
  if (!second.ok) return
  assert.equal(second.reused, true)
  assert.equal(second.path, first.path)
  assert.equal(second.generatedAt, first.generatedAt)

  const changedArtifact: ReportArtifactProjection = {
    ...artifact,
    contract: { kind: 'MetricFrame', ref: artifact.ref, semantic_revision: 2 },
  }
  const changed = await publishReport(compiledReport(document, [changedArtifact]), options)
  assert.equal(changed.ok, true, JSON.stringify(changed))
  if (!changed.ok) return
  assert.notEqual(changed.reportDigest, first.reportDigest)
  assert.notEqual(changed.path, first.path)

  const directory = path.dirname(first.path)
  assert.deepEqual((await readdir(directory)).sort(), [
    'index.html',
    'manifest.json',
    'report-document.json',
  ])
  const manifest = JSON.parse(
    await readFile(path.join(directory, 'manifest.json'), 'utf8'),
  ) as Record<string, unknown>
  assert.equal(manifest.version, REPORT_MANIFEST_VERSION)
  assert.equal('finding_ids' in manifest, false)
  for (const filename of await readdir(directory)) {
    const mode = (await stat(path.join(directory, filename))).mode & 0o777
    if (process.platform !== 'win32') assert.equal(mode, 0o600)
  }
  const oldDirectory = path.join(path.dirname(directory), 'legacy-v3')
  await mkdir(oldDirectory, { recursive: true, mode: 0o700 })
  await writeFile(
    path.join(oldDirectory, 'manifest.json'),
    '{"version":"dsh-data-analysis-report-manifest/v3"}\n',
  )
  assert.equal((await stat(path.join(oldDirectory, 'manifest.json'))).isFile(), true)
})

test('publisher refuses a forged immutable v4 directory instead of reusing it', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-report-v4-forged-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const report = compiledReport()
  const options = {
    environmentFingerprint: '2'.repeat(64),
    marivoVersion: '0.5.test',
    reportsRoot: path.join(root, 'reports'),
  }
  const first = await publishReport(report, options)
  assert.equal(first.ok, true, JSON.stringify(first))
  if (!first.ok) return
  await writeFile(first.path, '<script>forged</script>\n')
  await assert.rejects(() => publishReport(report, options), /immutable report|manifest/)
})

test('report Tool stops before publication when cancellation arrives after projection', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-report-v2-cancel-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const controller = new AbortController()
  const environment = {
    binding: { fingerprint: 'a'.repeat(64), marivoVersion: '0.5.test' },
    async runCheckedReportProjection() {
      controller.abort(new Error('cancel report'))
      return {
        exitCode: 0,
        stdout: Buffer.from(JSON.stringify(checkedPayload([]))),
        stderr: Buffer.alloc(0),
      }
    },
  } as unknown as MarivoEnvironment
  const tool = createMarivoReportRenderTool(environment, {
    reportsRoot: path.join(root, 'reports'),
  })
  const textDocument: ReportDocumentV2 = {
    version: 'dsh-data-analysis-report/v2',
    title: 'Cancelled',
    locale: 'en-US',
    sections: [
      {
        id: 'section',
        title: 'Section',
        blocks: [{ kind: 'text', id: 'text', text: 'body' }],
      },
    ],
  }
  await assert.rejects(
    () =>
      tool.execute({ session_id: 'session-report', document: textDocument }, {
        signal: controller.signal,
      } as Parameters<typeof tool.execute>[1]),
    /cancel report/,
  )
  await assert.rejects(() => stat(path.join(root, 'reports')), { code: 'ENOENT' })
})

test('Code Mode delivery adds one v2 ready card and preserves nested Tool text', async () => {
  const ctx = new Context()
  const dispose = installMarivoReportCodeDelivery(ctx)
  const ready: ReportRenderValueV2 = {
    status: 'ready',
    title: 'Code report',
    path: '/reports/code/index.html',
    report_digest: 'a'.repeat(64),
    document_digest: 'b'.repeat(64),
    artifact_refs: [],
    disclosures: ['bounded'],
  }
  const agent = {
    session: {
      events: [{ type: 'tool/call', data: { turn: 7, callId: 'outer' } }],
    },
  }
  const exec = {
    callId: 'outer:code:1',
    name: MARIVO_REPORT_RENDER_TOOL_NAME,
    rootCallId: 'outer',
    parent: Symbol('outer'),
    agent,
    arguments: {},
    signal: new AbortController().signal,
  }
  ctx.emit(
    'tools/result',
    exec as never,
    { isError: false, value: ready, content: [{ type: 'text', text: 'original text' }] } as never,
  )
  const original = [{ type: 'text', text: 'original text' }] as const
  const logged = await ctx.waterfall(
    'tools/code-dispatch-log',
    {
      exec: { rootCallId: 'outer' } as never,
      agent: agent as never,
      subCallId: 'outer:code:1',
      name: MARIVO_REPORT_RENDER_TOOL_NAME,
      isError: false,
      content: [...original],
    } as never,
    () => Promise.resolve([...original]),
  )
  assert.deepEqual(logged, [
    ...original,
    {
      type: 'marivo-report-card',
      turn: 7,
      meta: {
        kind: 'marivo-html-report',
        version: 1,
        title: ready.title,
        path: ready.path,
        reportDigest: ready.report_digest,
        disclosures: ready.disclosures,
      },
    },
  ])
  dispose()
})

test('report presentation metadata remains v1 and omits analytical source fields', () => {
  const ready: ReportRenderValueV2 = {
    status: 'ready',
    title: 'Ready',
    path: '/tmp/report.html',
    report_digest: 'c'.repeat(64),
    document_digest: 'd'.repeat(64),
    artifact_refs: ['artifact-trend'],
    disclosures: [],
  }
  assert.deepEqual(reportPresentationMeta(ready), {
    kind: 'marivo-html-report',
    version: 1,
    title: 'Ready',
    path: '/tmp/report.html',
    reportDigest: 'c'.repeat(64),
    disclosures: [],
  })
  assert.equal(reportPresentationMeta({ status: 'blocked', checks: [] as any }), null)
})

test('registered v2 Tool returns a ready result with no Finding fields', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-report-v2-registered-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const context = new Context()
  await context.plugin(SystemPrompt)
  await context.plugin(ToolRuntime)
  const environment = {
    binding: { fingerprint: '3'.repeat(64), marivoVersion: '0.5.test' },
    async runCheckedReportProjection() {
      return {
        exitCode: 0,
        stdout: Buffer.from(JSON.stringify(checkedPayload([artifact]))),
        stderr: Buffer.alloc(0),
      }
    },
  } as unknown as MarivoEnvironment
  registerMarivoReportRenderTool(context, environment, {
    reportsRoot: path.join(root, 'reports'),
    now: () => new Date('2026-08-27T01:02:03.000Z'),
  })
  const result = await context.tools.execute({
    signal: new AbortController().signal,
    callId: CallId('report-v2'),
    name: MARIVO_REPORT_RENDER_TOOL_NAME,
    arguments: { session_id: 'session-report', document },
  })
  assert.equal(result.isError, false, JSON.stringify(result))
  if (result.isError) return
  assert.equal((result.value as unknown as ReportRenderValueV2).status, 'ready')
  assert.equal('finding_ids' in (result.value as unknown as object), false)
  assert.match(
    result.content[0]?.type === 'text' ? result.content[0].text : '',
    /HTML report ready/,
  )
})
