import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  compileReportVisuals,
  compileSessionDag,
  parseReportProjection,
  publishReport,
  type ReportDagArtifactProjection,
  type ReportDagJobProjection,
  type ReportDocument,
  type ReportProjectionBundle,
  renderReportHtml,
} from '../../src/report/index.ts'

const document: ReportDocument = {
  version: 'dsh-data-analysis-report/v1',
  title: 'Session DAG',
  locale: 'en-US',
  sections: [
    {
      id: 'summary',
      title: 'Summary',
      blocks: [{ kind: 'text', id: 'summary-text', text: 'Checked analysis.' }],
    },
  ],
}

const columns = [
  { name: 'id', dtype: 'int64', nullable: false, role: 'dimension', unit: null },
  { name: 'value', dtype: 'string', nullable: false, role: 'value', unit: null },
] as const

function artifact(
  ref: string,
  status: ReportDagArtifactProjection['status'] = 'ready',
): ReportDagArtifactProjection {
  if (status !== 'ready') {
    return {
      ref,
      status,
      family: status === 'boundary' ? null : 'MetricFrame',
      shape: null,
      columns: [],
      contentHash: null,
      artifactSchemaVersion: null,
      createdAt: null,
      contract: null,
      revalidation: null,
      lineage: null,
      previewRows: [],
      totalRows: null,
      omittedRows: null,
      issues:
        status === 'unavailable'
          ? [
              {
                code: 'dag-artifact-unavailable',
                location: 'marivo.session_dag',
                message: 'Preview unavailable.',
                repair: 'Repair the Artifact.',
              },
            ]
          : [],
    }
  }
  const previewRows = Array.from({ length: 10 }, (_, index) => [index, `row-${index}`] as const)
  return {
    ref,
    status,
    family: 'MetricFrame',
    shape: [12, 2],
    columns,
    contentHash: ref.padEnd(64, 'a').slice(0, 64),
    artifactSchemaVersion: 'analysis-artifact/v10',
    createdAt: '2026-08-28T00:00:00+00:00',
    contract: { kind: 'MetricFrame', ref },
    revalidation: {
      status: 'admissible',
      artifact_ref: ref,
      content_hash: ref.padEnd(64, 'a').slice(0, 64),
    },
    lineage: { steps: [] },
    previewRows,
    totalRows: 12,
    omittedRows: 2,
    issues: [],
  }
}

function job(
  id: string,
  intent: string,
  inputs: readonly string[],
  output: string,
  startedAt: string,
  reusedArtifact = false,
): ReportDagJobProjection {
  return {
    id,
    intent,
    status: 'succeeded',
    startedAt,
    finishedAt: '2026-08-28T00:00:01+00:00',
    durationMs: 100,
    analysisPurpose: `${intent} purpose`,
    params: { segment: '<vip>', limit: 10 },
    inputArtifactRefs: inputs,
    outputArtifactRef: output,
    reusedArtifact,
    queries:
      intent === 'observe'
        ? [
            {
              queryId: 'query-1',
              datasource: 'warehouse',
              dialect: 'trino',
              sql: "SELECT '<script>alert(1)</script>' AS value",
              sqlDigest: 'd'.repeat(64),
              rowCount: 12,
              durationMs: 80,
              startedAt,
              finishedAt: '2026-08-28T00:00:01+00:00',
              status: 'succeeded',
              outputRef: output,
            },
          ]
        : [],
    queryIssues: [],
  }
}

function projection(): ReportProjectionBundle {
  return {
    sessionId: 'session-dag',
    artifacts: [],
    computed: [],
    sessionDag: {
      jobs: [
        job('job-observe', 'observe', ['artifact-boundary'], 'artifact-a', '2026-08-28T00:00:00Z'),
        job('job-compare', 'compare', ['artifact-a'], 'artifact-b', '2026-08-28T00:01:00Z'),
        job('job-attribute', 'attribute', ['artifact-b'], 'artifact-c', '2026-08-28T00:02:00Z'),
        job('job-reuse', 'attribute', ['artifact-b'], 'artifact-c', '2026-08-28T00:03:00Z', true),
        job('job-other', 'observe', [], 'artifact-other', '2026-08-28T00:04:00Z'),
      ],
      artifacts: [
        artifact('artifact-boundary', 'boundary'),
        artifact('artifact-a'),
        artifact('artifact-b'),
        artifact('artifact-c'),
        artifact('artifact-other', 'unavailable'),
        artifact('artifact-isolated'),
      ],
    },
  }
}

test('Session DAG compiler is deterministic, splits weak components, and preserves reuse edges', () => {
  const source = projection().sessionDag
  const first = compileSessionDag(source)
  const second = compileSessionDag(structuredClone(source))
  assert.equal(first.ok, true, JSON.stringify(first))
  assert.equal(second.ok, true, JSON.stringify(second))
  if (!first.ok || !second.ok) return
  assert.deepEqual(first.value.components, second.value.components)
  assert.equal(first.value.components.length, 3)
  assert.ok(first.value.components[0]?.edges.some((edge) => edge.kind === 'reuses'))
  assert.equal(
    first.value.components[0]?.nodes.some((node) => node.artifact?.status === 'boundary'),
    true,
  )
  assert.equal(
    first.value.components[1]?.nodes.some((node) => node.artifact?.status === 'unavailable'),
    true,
  )
  assert.equal(first.value.components[2]?.nodes[0]?.artifact?.ref, 'artifact-isolated')
})

test('Session DAG compiler blocks cycles instead of deleting an edge', () => {
  const result = compileSessionDag({
    jobs: [
      job('job-cycle', 'compare', ['artifact-cycle'], 'artifact-cycle', '2026-08-28T00:00:00Z'),
    ],
    artifacts: [artifact('artifact-cycle')],
  })
  assert.equal(result.ok, false)
  if (!result.ok)
    assert.deepEqual(
      result.issues.map((issue) => issue.code),
      ['dag-cycle'],
    )
})

test('Session DAG compiler blocks non-main outputs and Artifact identity drift', () => {
  const nonMain = compileSessionDag({
    jobs: [job('job-internal', 'observe', [], 'artifact-internal', '2026-08-28T00:00:00Z')],
    artifacts: [artifact('artifact-internal', 'boundary')],
  })
  assert.equal(nonMain.ok, false)
  if (!nonMain.ok)
    assert.deepEqual(
      nonMain.issues.map((issue) => issue.code),
      ['dag-job-output-not-main'],
    )

  const unavailable = artifact('artifact-drift', 'unavailable')
  const drift = compileSessionDag({
    jobs: [],
    artifacts: [
      {
        ...unavailable,
        issues: [
          {
            code: 'dag-artifact-identity-drift',
            location: 'session_dag.artifacts[0]',
            message: 'Artifact identity changed.',
            repair: 'Repair the persisted Artifact identity.',
          },
        ],
      },
    ],
  })
  assert.equal(drift.ok, false)
  if (!drift.ok)
    assert.deepEqual(
      drift.issues.map((issue) => issue.code),
      ['dag-artifact-identity-drift'],
    )
})

test('Session DAG compiler traverses a large isolated inventory without recursive or repeated-set work', {
  timeout: 5_000,
}, () => {
  const artifacts = Array.from({ length: 4_000 }, (_item, index) =>
    artifact(`artifact-isolated-${String(index).padStart(4, '0')}`, 'boundary'),
  )
  const result = compileSessionDag({ jobs: [], artifacts })
  assert.equal(result.ok, true, JSON.stringify(result).slice(0, 1_000))
  if (!result.ok) return
  assert.equal(result.value.components.length, artifacts.length)
  assert.equal(result.value.components[0]?.nodes[0]?.artifact?.ref, 'artifact-isolated-0000')
  assert.equal(result.value.components.at(-1)?.nodes[0]?.artifact?.ref, 'artifact-isolated-3999')
})

test('Session DAG renderer escapes raw SQL and params and exposes preview and interaction controls', () => {
  const compiled = compileReportVisuals(document, projection())
  assert.equal(compiled.ok, true, JSON.stringify(compiled))
  if (!compiled.ok) return
  const html = renderReportHtml(compiled.value, '2026-08-28T01:00:00.000Z')
  assert.match(html, /dag-edge-reuses/)
  assert.match(html, /data-dag-node/)
  assert.match(html, /data-dag-action="zoom-in"/)
  assert.match(html, /data-dag-viewport/)
  assert.match(html, /SELECT &#39;&lt;script&gt;alert\(1\)&lt;\/script&gt;&#39; AS value/)
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/)
  assert.match(html, /&lt;vip&gt;/)
  assert.match(html, /Displayed: 10 \/ total: 12 \/ omitted: 2 rows/)
  assert.match(html, /row-9/)
  assert.doesNotMatch(html, /row-10|bind_params|normalized_sql|semantic_project_root/)
  assert.match(html, /@media print[\s\S]*?\.dag-detail-panel\{display:none!important\}/)
  assert.match(html, /\.dag-index\{display:block;font-size:8pt\}/)
})

test('Session DAG SQL, preview, and availability participate in immutable report identity', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-session-dag-digest-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const options = {
    environmentFingerprint: 'f'.repeat(64),
    marivoVersion: '0.4.test',
    reportsRoot: root,
    now: () => new Date('2026-08-28T01:00:00.000Z'),
  }
  const base = compileReportVisuals(document, projection())
  assert.equal(base.ok, true, JSON.stringify(base))
  if (!base.ok) return
  const first = await publishReport(base.value, options)
  assert.equal(first.ok, true, JSON.stringify(first))
  if (!first.ok) return

  const sqlChanged = projection()
  const observe = sqlChanged.sessionDag.jobs[0]!
  const sqlProjection: ReportProjectionBundle = {
    ...sqlChanged,
    sessionDag: {
      ...sqlChanged.sessionDag,
      jobs: [
        { ...observe, queries: [{ ...observe.queries[0]!, sql: 'SELECT 2' }] },
        ...sqlChanged.sessionDag.jobs.slice(1),
      ],
    },
  }
  const sqlCompiled = compileReportVisuals(document, sqlProjection)
  assert.equal(sqlCompiled.ok, true, JSON.stringify(sqlCompiled))
  if (!sqlCompiled.ok) return
  const second = await publishReport(sqlCompiled.value, options)
  assert.equal(second.ok, true, JSON.stringify(second))
  if (!second.ok) return
  assert.notEqual(second.reportDigest, first.reportDigest)

  const previewChanged = projection()
  const ready = previewChanged.sessionDag.artifacts[1]!
  const previewProjection: ReportProjectionBundle = {
    ...previewChanged,
    sessionDag: {
      ...previewChanged.sessionDag,
      artifacts: [
        previewChanged.sessionDag.artifacts[0]!,
        { ...ready, previewRows: [[999, 'changed'], ...ready.previewRows.slice(1)] },
        ...previewChanged.sessionDag.artifacts.slice(2),
      ],
    },
  }
  const previewCompiled = compileReportVisuals(document, previewProjection)
  assert.equal(previewCompiled.ok, true, JSON.stringify(previewCompiled))
  if (!previewCompiled.ok) return
  const third = await publishReport(previewCompiled.value, options)
  assert.equal(third.ok, true, JSON.stringify(third))
  if (!third.ok) return
  assert.notEqual(third.reportDigest, first.reportDigest)
})

test('projection parser rejects private query fields and accepts only the raw SQL audit shape', () => {
  const raw = {
    status: 'checked',
    session_id: 'session-dag',
    artifact_outcomes: [],
    session_dag: {
      jobs: [
        {
          id: 'job-1',
          intent: 'observe',
          status: 'succeeded',
          started_at: '2026-08-28T00:00:00Z',
          finished_at: '2026-08-28T00:00:01Z',
          duration_ms: 1,
          analysis_purpose: null,
          params: {},
          input_artifact_refs: [],
          output_artifact_ref: 'artifact-1',
          reused_artifact: false,
          queries: [
            {
              query_id: 'query-1',
              datasource: 'warehouse',
              dialect: 'trino',
              sql: 'SELECT 1',
              sql_digest: 'd'.repeat(64),
              row_count: 1,
              duration_ms: 1,
              started_at: '2026-08-28T00:00:00Z',
              finished_at: '2026-08-28T00:00:01Z',
              status: 'succeeded',
              output_ref: 'artifact-1',
            },
          ],
          query_issues: [],
        },
      ],
      artifacts: [
        {
          ref: 'artifact-1',
          status: 'boundary',
          family: null,
          shape: null,
          columns: [],
          content_hash: null,
          artifact_schema_version: null,
          created_at: null,
          contract: null,
          revalidation: null,
          lineage: null,
          preview_rows: [],
          total_rows: null,
          omitted_rows: null,
          issues: [],
        },
      ],
    },
  }
  const expected = {
    sessionId: 'session-dag',
    artifactRefs: [],
  }
  const parsed = parseReportProjection(Buffer.from(JSON.stringify(raw)), expected)
  assert.equal(parsed.ok, true, JSON.stringify(parsed))
  assert.equal(parsed.value.sessionDag.jobs[0]?.queries[0]?.sql, 'SELECT 1')
  const privateQuery = structuredClone(raw)
  ;(privateQuery.session_dag.jobs[0]!.queries[0]! as Record<string, unknown>).bind_params = [1]
  assert.throws(
    () => parseReportProjection(Buffer.from(JSON.stringify(privateQuery)), expected),
    /bind_params is unknown/,
  )
  const missingReuse = structuredClone(raw)
  ;(missingReuse.session_dag.jobs[0] as Record<string, unknown>).reused_artifact = null
  assert.throws(
    () => parseReportProjection(Buffer.from(JSON.stringify(missingReuse)), expected),
    /reused_artifact must be boolean/,
  )
  const invalidTime = structuredClone(raw)
  invalidTime.session_dag.jobs[0]!.started_at = 'not-a-time'
  assert.throws(
    () => parseReportProjection(Buffer.from(JSON.stringify(invalidTime)), expected),
    /started_at must be an ISO timestamp/,
  )
})
