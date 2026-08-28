import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmod, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { type CodeRunRequest, type CodeRunResult, CodeRuntime } from '@deepseek-ai/dsh-code-runtime'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool, RUN_CODE_NAME } from '@deepseek-ai/dsh-tools'
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
  type ReportArtifactProjection,
  type ReportDocumentV1,
  type ReportProjectionBundle,
  type ReportRenderValueV1,
  registerMarivoReportRenderTool,
  renderReportHtml,
  renderReportToolValue,
  reportDocumentDigest,
  reportPresentationMeta,
} from '../../src/report/index.ts'

const document: ReportDocumentV1 = {
  version: 'dsh-data-analysis-report/v1',
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
  shape: [8, 2] as const,
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
  rowsProjected: true,
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

const projection: ReportProjectionBundle = {
  sessionId: 'session-report',
  artifacts: [artifact],
  findings: [],
  compatibilities: [],
}

function checkedProjectionPayload(raw: {
  readonly session_id: string
  readonly artifacts: readonly Record<string, unknown>[]
  readonly findings: readonly Record<string, unknown>[]
  readonly compatibilities: readonly Record<string, unknown>[]
}) {
  return {
    status: 'checked',
    session_id: raw.session_id,
    finding_group_outcomes: raw.compatibilities.map((value) => ({ status: 'ready', value })),
    finding_outcomes: raw.findings.map((value) => ({ status: 'ready', value })),
    artifact_outcomes: raw.artifacts.map((value) => ({ status: 'ready', value })),
  }
}

function globalBlockedProjection(issues: readonly Record<string, unknown>[]) {
  return { status: 'blocked', issues, omitted_issue_count: 0 }
}

class ReportCodeRuntime extends CodeRuntime {
  readonly language = 'typescript'
  readonly isolation = 'report-test'
  behavior: (request: CodeRunRequest) => Promise<CodeRunResult> = () =>
    Promise.resolve({ logs: [] })

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
    status: 'ready',
    session_id: 'session-report',
    artifacts: [
      {
        ref: artifact.ref,
        family: artifact.family,
        shape: artifact.shape,
        columns: artifact.columns,
        content_hash: artifact.contentHash,
        artifact_schema_version: artifact.artifactSchemaVersion,
        created_at: artifact.createdAt,
        contract,
        revalidation: {
          ...(artifact.revalidation as Record<string, unknown>),
          checked_at: checkedAt,
        },
        lineage: artifact.lineage,
        rows_projected: true,
        rows: artifact.rows,
      },
    ],
    findings: [],
    compatibilities: [],
  }
  const parsed = parseReportProjection(Buffer.from(JSON.stringify(checkedProjectionPayload(raw))), {
    sessionId: 'session-report',
    artifactRefs: [artifact.ref],
    findingIds: [],
    findingGroups: [],
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
  assert.deepEqual(Object.keys(parsed.value).sort(), [
    'artifactRefs',
    'document',
    'findingGroups',
    'findingIds',
  ])

  const invalid = structuredClone(document) as unknown as Record<string, unknown>
  invalid.unknown = true
  const sections = invalid.sections as Array<Record<string, unknown>>
  const blocks = sections[0]?.blocks as Array<Record<string, unknown>>
  blocks[1]!.id = 'summary-text'
  blocks[1]!.x = 'bucket_start'
  const rejected = parseReportDocument(invalid)
  assert.equal(rejected.ok, false)
  if (!rejected.ok) {
    assert.ok(rejected.issues.some((item) => item.code === 'unknown-field'))
    assert.ok(rejected.issues.some((item) => item.code === 'duplicate-block-id'))
    assert.ok(rejected.issues.some((item) => item.code === 'auto-with-fields'))
  }
})

test('ReportDocument parser retains Finding groups without exposing Tool-only repair paths', () => {
  const source: ReportDocumentV1 = {
    version: 'dsh-data-analysis-report/v1',
    title: 'Finding paths',
    locale: 'en-US',
    sections: [
      {
        id: 'summary',
        title: 'Summary',
        blocks: [
          { kind: 'text', id: 'plain', text: 'No source' },
          { kind: 'text', id: 'sourced', text: 'Sourced', finding_ids: ['finding-a', 'finding-b'] },
        ],
      },
      {
        id: 'evidence',
        title: 'Evidence',
        blocks: [
          { kind: 'evidence', id: 'evidence-list', title: 'Sources', finding_ids: ['finding-c'] },
        ],
      },
    ],
  }
  const parsed = parseReportDocument(source)
  assert.equal(parsed.ok, true, JSON.stringify(parsed))
  if (!parsed.ok) return
  assert.deepEqual(parsed.value.findingGroups, [['finding-a', 'finding-b'], ['finding-c']])
  assert.deepEqual(Object.keys(parsed.value).sort(), [
    'artifactRefs',
    'document',
    'findingGroups',
    'findingIds',
  ])
})

test('optional empty Finding arrays canonicalize to omission without creating compatibility groups', () => {
  const withEmptyArrays = structuredClone(document) as unknown as Record<string, unknown>
  const sections = withEmptyArrays.sections as Array<Record<string, unknown>>
  const blocks = sections[0]?.blocks as Array<Record<string, unknown>>
  for (const block of blocks) block.finding_ids = []

  const parsed = parseReportDocument(withEmptyArrays)
  assert.equal(parsed.ok, true, JSON.stringify(parsed))
  if (!parsed.ok) return
  assert.deepEqual(parsed.value.document, document)
  assert.deepEqual(parsed.value.findingIds, [])
  assert.deepEqual(parsed.value.findingGroups, [])
  assert.equal(parsed.inspection.skippedMarivoTargets, 0)
  assert.equal(reportDocumentDigest(parsed.value.document), reportDocumentDigest(document))
})

test('evidence blocks reject empty Finding arrays with evidence-specific repair', () => {
  const parsed = parseReportDocument({
    version: 'dsh-data-analysis-report/v1',
    title: 'Empty evidence',
    locale: 'en-US',
    sections: [
      {
        id: 'evidence',
        title: 'Evidence',
        blocks: [
          {
            kind: 'evidence',
            id: 'empty-evidence',
            title: 'Sources',
            finding_ids: [],
          },
        ],
      },
    ],
  })
  assert.equal(parsed.ok, false)
  if (parsed.ok) return
  assert.deepEqual(
    parsed.issues.map((item) => item.code),
    ['invalid-finding-ids'],
  )
  assert.equal(parsed.issues[0]?.location, 'document.sections[0].blocks[0].finding_ids')
  assert.equal(parsed.inspection.skippedMarivoTargets, 1)
  assert.match(parsed.issues[0]?.message ?? '', /is required.*between 1 and 20/)
  assert.match(parsed.issues[0]?.repair ?? '', /remove the empty evidence block/)
})

test('Finding bounds remain 20 per block and allow 100 unique Findings per document', () => {
  const ids = (start: number, count: number) =>
    Array.from({ length: count }, (_, index) => `finding-${String(start + index).padStart(3, '0')}`)
  const evidenceDocument = (count: number): ReportDocumentV1 => ({
    version: 'dsh-data-analysis-report/v1',
    title: `${String(count)} Findings`,
    locale: 'en-US',
    sections: [
      {
        id: 'evidence',
        title: 'Evidence',
        blocks: Array.from({ length: Math.ceil(count / 20) }, (_, index) => ({
          kind: 'evidence' as const,
          id: `evidence-${String(index + 1)}`,
          title: `Evidence ${String(index + 1)}`,
          finding_ids: ids(index * 20, Math.min(20, count - index * 20)),
        })),
      },
    ],
  })

  const fortySix = parseReportDocument(evidenceDocument(46))
  assert.equal(fortySix.ok, true, JSON.stringify(fortySix))
  if (fortySix.ok) {
    assert.equal(fortySix.value.findingIds.length, 46)
    assert.deepEqual(
      fortySix.value.findingGroups.map((group) => group.length),
      [20, 20, 6],
    )
  }

  const baseOneHundred = evidenceDocument(100)
  const oneHundredDocument: ReportDocumentV1 = {
    ...baseOneHundred,
    sections: [
      {
        ...baseOneHundred.sections[0]!,
        blocks: [
          ...baseOneHundred.sections[0]!.blocks,
          {
            kind: 'evidence',
            id: 'repeated-evidence',
            title: 'Repeated evidence',
            finding_ids: ids(0, 20),
          },
        ],
      },
    ],
  }
  const oneHundred = parseReportDocument(oneHundredDocument)
  assert.equal(oneHundred.ok, true, JSON.stringify(oneHundred))
  if (oneHundred.ok) assert.equal(oneHundred.value.findingIds.length, 100)

  const oneHundredOne = parseReportDocument(evidenceDocument(101))
  assert.equal(oneHundredOne.ok, false)
  if (!oneHundredOne.ok) {
    const issue = oneHundredOne.issues.find((item) => item.code === 'too-many-findings')
    assert.match(issue?.message ?? '', /101 unique Findings; the maximum is 100/)
    assert.match(issue?.repair ?? '', /Do not remove Finding references/)
  }

  const twentyOneInOneBlock = parseReportDocument({
    version: 'dsh-data-analysis-report/v1',
    title: 'Too many in one block',
    locale: 'en-US',
    sections: [
      {
        id: 'evidence',
        title: 'Evidence',
        blocks: [
          {
            kind: 'evidence',
            id: 'too-many',
            title: 'Too many',
            finding_ids: ids(0, 21),
          },
        ],
      },
    ],
  })
  assert.equal(twentyOneInOneBlock.ok, false)
  if (!twentyOneInOneBlock.ok) {
    assert.ok(twentyOneInOneBlock.issues.some((item) => item.code === 'invalid-finding-ids'))
    assert.ok(twentyOneInOneBlock.issues.every((item) => item.code !== 'too-many-findings'))
  }
})

test('ReportDocument treats adjacent chart interpretation as guidance rather than a hard gate', () => {
  const chartOnly: ReportDocumentV1 = {
    version: 'dsh-data-analysis-report/v1',
    title: 'Chart only',
    locale: 'en-US',
    sections: [
      {
        id: 'trend',
        title: 'Trend',
        blocks: [
          {
            kind: 'chart',
            id: 'trend-chart',
            title: 'Trend',
            artifact_ref: 'artifact-trend',
            view: 'line',
            x: 'bucket_start',
            y: 'value',
          },
        ],
      },
    ],
  }
  const parsed = parseReportDocument(chartOnly)
  assert.equal(parsed.ok, true, JSON.stringify(parsed))
})

test('report Tool schema and real argument failures expose one complete retry skeleton', async () => {
  const environment = {
    binding: { fingerprint: 'a'.repeat(64), marivoVersion: '0.4.test' },
    async runCheckedReportProjection() {
      return {
        exitCode: 0,
        stdout: Buffer.from(
          JSON.stringify(
            globalBlockedProjection([
              {
                code: 'session-unavailable',
                location: 'marivo',
                message: 'Session is unavailable.',
                repair: 'Use a valid Session.',
              },
            ]),
          ),
        ),
        stderr: Buffer.alloc(0),
      }
    },
  } as unknown as MarivoEnvironment
  const tool = createMarivoReportRenderTool(environment) as any
  const reportSchema = tool.parameters.properties.document
  const description = reportSchema.description as string
  assert.match(description, /"version":"dsh-data-analysis-report\/v1"/)
  assert.match(description, /"sections":\[\{"id":"summary"/)
  assert.match(description, /"kind":"text","id":"summary-text","text":"Report summary"/)
  assert.match(description, /document\.blocks is invalid/)
  assert.match(description, /document\.sections\[\]\.blocks/)
  assert.match(description, /1-20 sections with 1-20 blocks each/)
  assert.equal(tool.name, 'marivo_report_render')
  assert.match(tool.description, /DSH data-analysis plugin Tool/)
  assert.match(tool.description, /not a marivo\.help target/)
  assert.match(tool.description, /do not call marivo_help/)
  assert.match(tool.parameters.properties.session_id.description, /at most 512 Unicode characters/)

  const sectionSchema = reportSchema.properties.sections.items
  const [textSchema, chartSchema, tableSchema, evidenceSchema] =
    sectionSchema.properties.blocks.items.oneOf
  assert.match(sectionSchema.properties.id.description, /kebab-case/)
  assert.match(textSchema.properties.id.description, /Document-wide unique/)
  assert.match(textSchema.properties.text.description, /plain text/)
  assert.match(textSchema.properties.text.description, /Markdown and HTML are escaped/)
  assert.match(textSchema.properties.finding_ids.description, /Omit finding_ids or pass \[\]/)
  assert.match(textSchema.properties.finding_ids.description, /one to 20 unique/)
  assert.match(textSchema.properties.finding_ids.description, /canonicalized to omission/)
  assert.match(textSchema.properties.finding_ids.description, /mechanically compatible/)
  assert.match(chartSchema.properties.artifact_ref.description, /Artifact in session_id/)
  assert.match(chartSchema.properties.view.description, /auto.*omit x\/y/)
  assert.match(chartSchema.properties.view.description, /line or bar.*both x and y/)
  assert.match(chartSchema.properties.x.description, /not hard quality gates/)
  assert.match(chartSchema.properties.y.description, /does not aggregate/)
  assert.match(tableSchema.properties.columns.description, /one to 100 unique/)
  assert.match(tableSchema.properties.max_rows.description, /from 1 to 100/)
  assert.match(evidenceSchema.properties.finding_ids.description, /Required.*\[\] is invalid/)
  assert.match(evidenceSchema.properties.finding_ids.description, /one to 20 unique/)
  assert.match(evidenceSchema.properties.finding_ids.description, /mechanically compatible/)
  assert.match(description, /100 unique Findings across the document/)
  assert.match(description, /at most 20 Findings in any one block/)

  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  ctx.tools.register(tool)
  const malformedDocuments = [
    {
      document: { blocks: [] },
      issueCode: 'unknown-field',
    },
    {
      document: {
        version: 'dsh-data-analysis-report/v1',
        title: 'Missing table field',
        locale: 'en-US',
        sections: [
          {
            id: 'summary',
            title: 'Summary',
            blocks: [
              {
                kind: 'table',
                id: 'summary-table',
                title: 'Summary',
                artifact_ref: 'artifact-summary',
              },
            ],
          },
        ],
      },
      issueCode: 'invalid-max-rows',
    },
  ]
  for (const [index, fixture] of malformedDocuments.entries()) {
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId(`invalid-document-shape-${String(index)}`),
      name: MARIVO_REPORT_RENDER_TOOL_NAME,
      arguments: { session_id: 'session-report', document: fixture.document },
    })
    assert.equal(result.isError, false, JSON.stringify(result))
    if (result.isError) continue
    const value = result.value as unknown as ReportRenderValueV1
    assert.equal(value.status, 'blocked')
    if (value.status !== 'blocked') continue
    const documentCheck = value.checks[0]
    assert.equal(documentCheck.stage, 'document')
    assert.ok(
      documentCheck.issues.some((issue) => issue.code === fixture.issueCode),
      JSON.stringify(documentCheck.issues),
    )
    assert.equal(result.meta, null)
    const content = result.content[0]?.type === 'text' ? result.content[0].text : ''
    assert.doesNotMatch(content, /invalid arguments/)
    assert.match(content, /Minimal valid document:/)
    assert.match(content, /"version":"dsh-data-analysis-report\/v1"/)
    assert.match(content, /Never submit document\.blocks alone/)
  }

  const invalidSession = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId('invalid-report-session-type'),
    name: MARIVO_REPORT_RENDER_TOOL_NAME,
    arguments: { session_id: 42, document: { blocks: [] } },
  })
  assert.equal(invalidSession.isError, false, JSON.stringify(invalidSession))
  if (!invalidSession.isError) {
    const value = invalidSession.value as unknown as ReportRenderValueV1
    assert.equal(value.status, 'blocked')
    if (value.status === 'blocked') {
      assert.ok(value.checks[0].issues.some((issue) => issue.code === 'invalid-session-id'))
      assert.ok(value.checks[0].issues.some((issue) => issue.code === 'unknown-field'))
      assert.equal(value.checks[1].status, 'skipped')
    }
  }
})

test('report Tool attributes every compatibility problem to its exact block and requires a complete retry', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-report-compatibility-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const reportsRoot = path.join(root, 'reports')
  const source: ReportDocumentV1 = {
    version: 'dsh-data-analysis-report/v1',
    title: 'Blocked groups',
    locale: 'en-US',
    sections: [
      {
        id: 'first',
        title: 'First',
        blocks: [
          {
            kind: 'evidence',
            id: 'first-evidence',
            title: 'First evidence',
            finding_ids: ['finding-a', 'finding-b'],
          },
        ],
      },
      {
        id: 'second',
        title: 'Second',
        blocks: [
          { kind: 'text', id: 'plain', text: 'No source' },
          {
            kind: 'text',
            id: 'second-evidence',
            text: 'Second evidence',
            finding_ids: ['finding-c', 'finding-d'],
          },
        ],
      },
    ],
  }
  const environment = {
    binding: { fingerprint: 'b'.repeat(64), marivoVersion: '0.4.test' },
    async runCheckedReportProjection(
      _sessionId: string,
      _artifactRefs: readonly string[],
      findingGroups: readonly (readonly string[])[],
    ) {
      assert.deepEqual(findingGroups, [
        ['finding-a', 'finding-b'],
        ['finding-c', 'finding-d'],
      ])
      return {
        exitCode: 0,
        stdout: Buffer.from(
          JSON.stringify(
            globalBlockedProjection([
              {
                code: 'evidence-not-compatible',
                location: 'finding_groups[0]',
                message:
                  "Finding selection ['finding-a', 'finding-b'] has compatibility status 'incompatible'. Conflicts: comparability_incompatible findings=['finding-a', 'finding-b'] artifacts=['artifact-a', 'artifact-b'] incompatible_fields=['grain'].",
                repair:
                  'Split the incompatible Findings, then preserve the unaffected content and resubmit the complete ReportDocument v1.',
              },
              {
                code: 'evidence-not-compatible',
                location: 'finding_groups[1]',
                message:
                  "Finding selection ['finding-c', 'finding-d'] has compatibility status 'indeterminate'. Conflicts: evidence_store_unavailable findings=['finding-c'] artifacts=['artifact-c']. Marivo omitted 1 additional issue(s) with kinds=['unknown_scope_rule'].",
                repair:
                  'Remove the unavailable Finding, then preserve the unaffected content and resubmit the complete ReportDocument v1.',
              },
            ]),
          ),
        ),
        stderr: Buffer.alloc(0),
      }
    },
  } as unknown as MarivoEnvironment
  const tool = createMarivoReportRenderTool(environment, { reportsRoot })
  const value = (await tool.execute({ session_id: 'session-report', document: source }, {
    signal: new AbortController().signal,
  } as Parameters<typeof tool.execute>[1])) as ReportRenderValueV1
  assert.equal(value.status, 'blocked', JSON.stringify(value))
  if (value.status !== 'blocked') return
  const marivoCheck = value.checks[1]
  assert.equal(marivoCheck.stage, 'marivo')
  assert.deepEqual(
    marivoCheck.issues.map((issue) => issue.location),
    ['document.sections[0].blocks[0].finding_ids', 'document.sections[1].blocks[1].finding_ids'],
  )
  assert.match(
    marivoCheck.issues[0]?.message ?? '',
    /finding-a.*finding-b.*comparability_incompatible.*grain/,
  )
  assert.match(
    marivoCheck.issues[1]?.message ?? '',
    /finding-c.*finding-d.*omitted 1.*unknown_scope_rule/,
  )
  const rendered = renderReportToolValue(value)
  assert.match(rendered, /resubmit one complete ReportDocument v1/)
  assert.match(rendered, /Never submit document\.blocks alone/)
  assert.equal(reportPresentationMeta(value), null)
  await assert.rejects(() => stat(reportsRoot), { code: 'ENOENT' })
})

test('one best-effort preflight exposes document, Marivo, and visual problems together', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-report-multistage-preflight-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const reportsRoot = path.join(root, 'reports')
  const source = {
    version: 'dsh-data-analysis-report/v1',
    locale: 'en-US',
    sections: [
      {
        id: 'summary',
        title: 'Summary',
        blocks: [
          {
            kind: 'text',
            id: 'summary-text',
            text: 'Summary',
            finding_ids: ['finding-a', 'finding-b'],
          },
          {
            kind: 'chart',
            id: 'bad-chart',
            title: 'Bad chart',
            artifact_ref: 'artifact-good',
            view: 'line',
            x: 'bucket_start',
            y: 'missing-value',
          },
          {
            kind: 'table',
            id: 'bad-table-one',
            title: 'Bad table one',
            artifact_ref: 'artifact-bad-one',
            max_rows: 5,
          },
          {
            kind: 'table',
            id: 'bad-table-two',
            title: 'Bad table two',
            artifact_ref: 'artifact-bad-two',
            max_rows: 5,
          },
        ],
      },
    ],
  }
  const artifactValue = {
    ref: 'artifact-good',
    family: artifact.family,
    shape: artifact.shape,
    columns: artifact.columns,
    content_hash: artifact.contentHash,
    artifact_schema_version: artifact.artifactSchemaVersion,
    created_at: artifact.createdAt,
    contract: { kind: artifact.family, ref: 'artifact-good' },
    revalidation: {
      status: 'admissible',
      artifact_ref: 'artifact-good',
      content_hash: artifact.contentHash,
      artifact_schema_version: artifact.artifactSchemaVersion,
    },
    lineage: artifact.lineage,
    rows_projected: true,
    rows: artifact.rows,
  }
  const findingValue = (findingId: string) => ({
    finding_id: findingId,
    finding_type: 'observation',
    epistemic_kind: 'observed',
    artifact_id: 'artifact-good',
    session_id: 'session-report',
    quality_status: 'ready',
    committed_at: '2026-08-27T00:05:00+00:00',
    value: { kind: 'observation' },
    subject: { kind: 'metric', metric_id: 'payments.success' },
    derivation: { rule_id: 'observation/v1' },
    rendered: { en: `${findingId}: observed.`, zh: `${findingId}：已观测。` },
  })
  const artifactFailure = (ref: string, index: number) => ({
    status: 'blocked',
    ref,
    omitted_issue_count: 0,
    issues: [
      {
        code: 'artifact-not-admissible',
        location: index === 0 ? 'artifacts[0].rows[0][0]' : `artifact_refs[${String(index)}]`,
        message: `Artifact ${ref} is stale.`,
        repair: 'Regenerate the Artifact.',
      },
    ],
  })
  const environment = {
    binding: { fingerprint: '7'.repeat(64), marivoVersion: '0.4.test' },
    async runCheckedReportProjection() {
      return {
        exitCode: 0,
        stdout: Buffer.from(
          JSON.stringify({
            status: 'checked',
            session_id: 'session-report',
            finding_group_outcomes: [
              {
                status: 'blocked',
                group_index: 0,
                omitted_issue_count: 0,
                issues: [
                  {
                    code: 'evidence-not-compatible',
                    location: 'finding_groups[0]',
                    message: 'The two Findings are incompatible.',
                    repair: 'Split the Findings.',
                  },
                ],
              },
            ],
            finding_outcomes: [
              { status: 'ready', value: findingValue('finding-a') },
              { status: 'ready', value: findingValue('finding-b') },
            ],
            artifact_outcomes: [
              { status: 'ready', value: artifactValue },
              artifactFailure('artifact-bad-one', 1),
              artifactFailure('artifact-bad-two', 2),
            ],
          }),
        ),
        stderr: Buffer.alloc(0),
      }
    },
  } as unknown as MarivoEnvironment
  const tool = createMarivoReportRenderTool(environment, { reportsRoot })
  const value = (await tool.execute({ session_id: 'session-report', document: source }, {
    signal: new AbortController().signal,
  } as Parameters<typeof tool.execute>[1])) as ReportRenderValueV1
  assert.equal(value.status, 'blocked', JSON.stringify(value))
  if (value.status !== 'blocked') return
  assert.deepEqual(
    value.checks.map((check) => [check.stage, check.status]),
    [
      ['document', 'failed'],
      ['marivo', 'failed'],
      ['visual', 'partial'],
      ['publish', 'skipped'],
    ],
  )
  assert.deepEqual(
    value.checks[0].issues.map((issue) => issue.code),
    ['invalid-string'],
  )
  assert.deepEqual(
    value.checks[1].issues.map((issue) => issue.code),
    ['evidence-not-compatible', 'artifact-not-admissible', 'artifact-not-admissible'],
  )
  assert.deepEqual(
    value.checks[2].issues.map((issue) => issue.code),
    ['chart-column-not-found'],
  )
  assert.match(value.checks[2].reason ?? '', /2 visual target/)
  assert.match(
    renderReportToolValue(value),
    /document: failed[\s\S]*marivo: failed[\s\S]*visual: partial/,
  )
  await assert.rejects(() => stat(reportsRoot), { code: 'ENOENT' })
})

test('preflight attributes de-duplicated Finding and Artifact failures to every document occurrence', async () => {
  const source = {
    version: 'dsh-data-analysis-report/v1',
    title: 'Repeated sources',
    locale: 'en-US',
    sections: [
      {
        id: 'sources',
        title: 'Sources',
        blocks: [
          { kind: 'text', id: 'finding-one', text: 'One', finding_ids: ['finding-shared'] },
          { kind: 'text', id: 'finding-two', text: 'Two', finding_ids: ['finding-shared'] },
          {
            kind: 'table',
            id: 'table-one',
            title: 'One',
            artifact_ref: 'artifact-shared',
            max_rows: 5,
          },
          {
            kind: 'table',
            id: 'table-two',
            title: 'Two',
            artifact_ref: 'artifact-shared',
            max_rows: 0,
          },
        ],
      },
    ],
  }
  const compatibility = (groupIndex: number) => ({
    status: 'ready',
    value: {
      group_index: groupIndex,
      status: 'compatible',
      finding_ids: ['finding-shared'],
      value: { status: 'compatible' },
    },
  })
  const artifactFailure = (ref: string, index: number) => ({
    status: 'blocked',
    ref,
    omitted_issue_count: 0,
    issues: [
      {
        code: 'artifact-not-admissible',
        location: index === 0 ? 'artifacts[0].rows[0][0]' : `artifact_refs[${String(index)}]`,
        message: `${ref} is not admissible.`,
        repair: 'Regenerate the Artifact.',
      },
    ],
  })
  const environment = {
    binding: { fingerprint: '9'.repeat(64), marivoVersion: '0.4.test' },
    async runCheckedReportProjection() {
      return {
        exitCode: 0,
        stdout: Buffer.from(
          JSON.stringify({
            status: 'checked',
            session_id: 'session-report',
            finding_group_outcomes: [compatibility(0), compatibility(1)],
            finding_outcomes: [
              {
                status: 'blocked',
                finding_id: 'finding-shared',
                artifact_ref: 'artifact-backing',
                omitted_issue_count: 0,
                issues: [
                  {
                    code: 'finding-render-failed',
                    location: 'finding_ids[0]',
                    message: 'Finding rendering failed.',
                    repair: 'Repair the renderer.',
                  },
                ],
              },
            ],
            artifact_outcomes: [
              artifactFailure('artifact-shared', 0),
              artifactFailure('artifact-backing', 1),
            ],
          }),
        ),
        stderr: Buffer.alloc(0),
      }
    },
  } as unknown as MarivoEnvironment
  const tool = createMarivoReportRenderTool(environment)
  const value = (await tool.execute({ session_id: 'session-report', document: source }, {
    signal: new AbortController().signal,
  } as Parameters<typeof tool.execute>[1])) as ReportRenderValueV1
  assert.equal(value.status, 'blocked', JSON.stringify(value))
  if (value.status !== 'blocked') return
  const marivoIssues = value.checks[1].issues
  assert.deepEqual(
    marivoIssues
      .filter((item) => item.code === 'finding-render-failed')
      .map((item) => item.location),
    ['document.sections[0].blocks[0].finding_ids', 'document.sections[0].blocks[1].finding_ids'],
  )
  assert.deepEqual(
    marivoIssues
      .filter((item) => item.message === 'artifact-shared is not admissible.')
      .map((item) => item.location),
    ['document.sections[0].blocks[2].artifact_ref', 'document.sections[0].blocks[3].artifact_ref'],
  )
  assert.deepEqual(
    marivoIssues
      .filter((item) => item.message === 'artifact-backing is not admissible.')
      .map((item) => item.location),
    ['document.sections[0].blocks[0].finding_ids', 'document.sections[0].blocks[1].finding_ids'],
  )
})

test('preflight de-duplicates and bounds each stage while preserving omitted counts', async () => {
  const retained = Array.from({ length: 100 }, (_, index) => ({
    code: `problem-${String(index).padStart(3, '0')}`,
    location: `marivo.targets[${String(index).padStart(3, '0')}]`,
    message: `Problem ${String(index)}`,
    repair: 'Repair the target.',
  }))
  retained[99] = { ...retained[0]! }
  const environment = {
    binding: { fingerprint: '8'.repeat(64), marivoVersion: '0.4.test' },
    async runCheckedReportProjection() {
      return {
        exitCode: 0,
        stdout: Buffer.from(
          JSON.stringify({
            status: 'blocked',
            issues: retained,
            omitted_issue_count: 3,
          }),
        ),
        stderr: Buffer.alloc(0),
      }
    },
  } as unknown as MarivoEnvironment
  const tool = createMarivoReportRenderTool(environment)
  const value = (await tool.execute(
    {
      session_id: 'session-report',
      document: {
        version: 'dsh-data-analysis-report/v1',
        title: 'Bounded',
        locale: 'en-US',
        sections: [
          {
            id: 'summary',
            title: 'Summary',
            blocks: [
              {
                kind: 'text',
                id: 'summary-text',
                text: 'Summary',
              },
            ],
          },
        ],
      },
    },
    { signal: new AbortController().signal } as Parameters<typeof tool.execute>[1],
  )) as ReportRenderValueV1
  assert.equal(value.status, 'blocked')
  if (value.status !== 'blocked') return
  assert.equal(value.checks[1].issues.length, 99)
  assert.equal(value.checks[1].omitted_issue_count, 3)
  assert.equal(value.checks[2].status, 'skipped')
  assert.equal(value.checks[3].status, 'skipped')
})

test('report Tool preserves 46 unique Findings across projection, manifest, and ready result', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-report-forty-six-findings-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const findingIds = Array.from(
    { length: 46 },
    (_, index) => `finding-${String(index + 1).padStart(3, '0')}`,
  )
  const findingGroups = [findingIds.slice(0, 20), findingIds.slice(20, 40), findingIds.slice(40)]
  const source: ReportDocumentV1 = {
    version: 'dsh-data-analysis-report/v1',
    title: '46 Finding report',
    locale: 'en-US',
    sections: [
      {
        id: 'evidence',
        title: 'Evidence',
        blocks: findingGroups.map((group, index) => ({
          kind: 'evidence' as const,
          id: `evidence-${String(index + 1)}`,
          title: `Evidence ${String(index + 1)}`,
          finding_ids: group,
        })),
      },
    ],
  }
  const environment = {
    binding: { fingerprint: '4'.repeat(64), marivoVersion: '0.4.test' },
    async runCheckedReportProjection(
      _sessionId: string,
      artifactRefs: readonly string[],
      groups: readonly (readonly string[])[],
    ) {
      assert.deepEqual(artifactRefs, [])
      assert.deepEqual(groups, findingGroups)
      return {
        exitCode: 0,
        stdout: Buffer.from(
          JSON.stringify(
            checkedProjectionPayload({
              session_id: 'session-report',
              artifacts: [
                {
                  ref: 'artifact-backing',
                  family: artifact.family,
                  shape: artifact.shape,
                  columns: artifact.columns,
                  content_hash: artifact.contentHash,
                  artifact_schema_version: artifact.artifactSchemaVersion,
                  created_at: artifact.createdAt,
                  contract: { kind: artifact.family, ref: 'artifact-backing' },
                  revalidation: {
                    status: 'admissible',
                    artifact_ref: 'artifact-backing',
                    content_hash: artifact.contentHash,
                    artifact_schema_version: artifact.artifactSchemaVersion,
                  },
                  lineage: { steps: [] },
                  rows_projected: false,
                  rows: [],
                },
              ],
              findings: findingIds.map((findingId, index) => ({
                finding_id: findingId,
                finding_type: 'metric_value',
                epistemic_kind: 'observed',
                artifact_id: 'artifact-backing',
                session_id: 'session-report',
                quality_status: null,
                committed_at: '2026-08-27T00:05:00+00:00',
                value: { value: index + 1 },
                subject: { metric_id: `metric-${String(index + 1)}` },
                derivation: { rule_id: 'metric/v1' },
                rendered: {
                  en: `${findingId}: observed ${String(index + 1)}.`,
                  zh: `${findingId}：观测值为 ${String(index + 1)}。`,
                },
              })),
              compatibilities: findingGroups.map((group, index) => ({
                group_index: index,
                status: 'compatible',
                finding_ids: group,
                value: { status: 'compatible' },
              })),
            }),
          ),
        ),
        stderr: Buffer.alloc(0),
      }
    },
  } as unknown as MarivoEnvironment
  const tool = createMarivoReportRenderTool(environment, {
    reportsRoot: path.join(root, 'reports'),
    now: () => new Date('2026-08-27T01:02:03.000Z'),
  })
  const value = (await tool.execute({ session_id: 'session-report', document: source }, {
    signal: new AbortController().signal,
  } as Parameters<typeof tool.execute>[1])) as ReportRenderValueV1
  assert.equal(value.status, 'ready', JSON.stringify(value))
  if (value.status !== 'ready') return
  assert.deepEqual(value.finding_ids, findingIds)
  const manifest = JSON.parse(
    await readFile(path.join(path.dirname(value.path), 'manifest.json'), 'utf8'),
  ) as { finding_ids: string[] }
  assert.deepEqual(manifest.finding_ids, findingIds)
  const html = await readFile(value.path, 'utf8')
  assert.match(html, /finding-001: observed 1\./)
  assert.match(html, /finding-046: observed 46\./)
})

test('visual compiler selects one line mapping, preserves rows, and discloses truncation', () => {
  const result = compiled()
  const chart = result.charts.get('trend-line')
  assert.equal(chart?.view, 'line')
  assert.equal(chart?.x, 'bucket_start')
  assert.equal(chart?.y, 'value')
  assert.equal(chart?.points.length, 8)
  const table = result.tables.get('trend-table')
  assert.equal(table?.rows.length, 3)
  assert.equal(table?.omittedRows, 5)
  assert.ok(result.disclosures.some((item) => item.includes('omits 5')))

  const mixedProjection: ReportProjectionBundle = {
    ...projection,
    artifacts: [
      {
        ...artifact,
        shape: [8, 3],
        columns: [
          ...artifact.columns,
          { name: 'platform', dtype: 'string', nullable: false, role: 'dimension', unit: null },
        ],
        rows: artifact.rows.map((row, index) => [...row, index % 2 ? 'ios' : 'android']),
      },
    ],
  }
  const rejected = compileReportVisuals(document, mixedProjection)
  assert.equal(rejected.ok, false)
  if (!rejected.ok)
    assert.ok(
      rejected.issues.some(
        (item) => item.code === 'mixed-chart-grain' || item.code === 'auto-chart-ambiguous',
      ),
    )
})

test('visual compiler does not impose advisory point-count gates', () => {
  const shortLine = { ...artifact, shape: [7, 2] as const, rows: artifact.rows.slice(0, 7) }
  const lineResult = compileReportVisuals(document, { ...projection, artifacts: [shortLine] })
  assert.equal(lineResult.ok, true, JSON.stringify(lineResult))

  const barDocument: ReportDocumentV1 = {
    version: 'dsh-data-analysis-report/v1',
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
  const barResult = compileReportVisuals(barDocument, { ...projection, artifacts: [sparseBar] })
  assert.equal(barResult.ok, true, JSON.stringify(barResult))

  const denseBar = {
    ...sparseBar,
    shape: [31, 2] as const,
    rows: Array.from({ length: 31 }, (_, index) => [`category-${String(index)}`, index]),
  }
  const denseResult = compileReportVisuals(barDocument, { ...projection, artifacts: [denseBar] })
  assert.equal(denseResult.ok, true, JSON.stringify(denseResult))

  const emptyBar = { ...sparseBar, shape: [0, 2] as const, rows: [] }
  const emptyResult = compileReportVisuals(barDocument, { ...projection, artifacts: [emptyBar] })
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
  const result = compileReportVisuals(document, { ...projection, artifacts: [dstArtifact] })
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
  const rejected = compileReportVisuals(document, { ...projection, artifacts: [duplicateInstant] })
  assert.equal(rejected.ok, false)
  if (!rejected.ok) assert.ok(rejected.issues.some((item) => item.code === 'duplicate-chart-x'))
})

test('bar and Evidence blocks retain category zero-baseline and exact Finding source details', () => {
  const barDocument: ReportDocumentV1 = {
    version: 'dsh-data-analysis-report/v1',
    title: '分平台',
    locale: 'en-US',
    sections: [
      {
        id: 'breakdown',
        title: 'Breakdown',
        blocks: [
          {
            kind: 'chart',
            id: 'platform-bar',
            title: 'Platform',
            artifact_ref: 'artifact-platform',
            view: 'auto',
            finding_ids: ['finding-platform'],
          },
          {
            kind: 'evidence',
            id: 'platform-evidence',
            title: 'Evidence',
            finding_ids: ['finding-platform'],
          },
        ],
      },
    ],
  }
  const barArtifact: ReportArtifactProjection = {
    ...artifact,
    ref: 'artifact-platform',
    family: 'MetricFrame',
    shape: [4, 2],
    columns: [
      { name: 'platform', dtype: 'string', nullable: false, role: 'dimension', unit: null },
      { name: 'value', dtype: 'float64', nullable: false, role: 'value', unit: 'count' },
    ],
    contract: { kind: 'MetricFrame', ref: 'artifact-platform' },
    revalidation: {
      status: 'admissible',
      artifact_ref: 'artifact-platform',
      content_hash: artifact.contentHash,
      artifact_schema_version: artifact.artifactSchemaVersion,
    },
    rows: [
      ['android', -2],
      ['ios', 4],
      ['web', 3],
      ['desktop', 1],
    ],
  }
  const barProjection: ReportProjectionBundle = {
    sessionId: 'session-report',
    artifacts: [barArtifact],
    findings: [
      {
        findingId: 'finding-platform',
        findingType: 'observation',
        epistemicKind: 'observed',
        artifactId: 'artifact-platform',
        sessionId: 'session-report',
        qualityStatus: 'ready',
        committedAt: '2026-08-27T00:05:00+00:00',
        value: { kind: 'observation', row_count: 4 },
        subject: { kind: 'metric', metric_id: 'payments.success' },
        derivation: { rule_id: 'observation/v1' },
        rendered: {
          en: 'payments.success: observed 4 platform rows.',
          zh: 'payments.success：观测到 4 行平台数据。',
        },
      },
    ],
    compatibilities: [
      {
        groupIndex: 0,
        status: 'compatible',
        findingIds: ['finding-platform'],
        value: { status: 'compatible' },
      },
      {
        groupIndex: 1,
        status: 'compatible',
        findingIds: ['finding-platform'],
        value: { status: 'compatible' },
      },
    ],
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
  assert.match(html, /payments\.success: observed 4 platform rows\./)
  assert.match(html, /href="#provenance-artifact-1"/)
  assert.match(html, /Complete technical provenance/)
  assert.ok(
    html.indexOf('payments.success: observed 4 platform rows.') <
      html.indexOf('<details class="audit">'),
  )
  assert.match(html, /<dt>session<\/dt><dd>session-report<\/dd>/)
})

test('reader-facing report content localizes labels and keeps raw Evidence identity in technical provenance', () => {
  const finding: ReportProjectionBundle['findings'][number] = {
    findingId: 'finding-zh',
    findingType: 'observation',
    epistemicKind: 'observed',
    artifactId: artifact.ref,
    sessionId: 'session-report',
    qualityStatus: 'ready',
    committedAt: '2026-08-27T00:05:00+00:00',
    value: { value: 95 },
    subject: { metric_id: 'payments.success' },
    derivation: { rule_id: 'observation/v1' },
    rendered: {
      en: 'English statement should remain out of the Chinese reading path.',
      zh: '支付成功量在观察期末达到 95。',
    },
  }
  const sourcedDocument: ReportDocumentV1 = {
    ...document,
    sections: [
      {
        ...document.sections[0]!,
        blocks: [
          {
            kind: 'text',
            id: 'summary-text',
            text: '结论\n\n1. 优先处理移动端。\n\n2. 持续观察波动。',
            finding_ids: ['finding-zh'],
          },
          ...document.sections[0]!.blocks.slice(1),
        ],
      },
    ],
  }
  const sourced = compileReportVisuals(sourcedDocument, {
    ...projection,
    findings: [finding],
    compatibilities: [
      {
        groupIndex: 0,
        status: 'compatible',
        findingIds: ['finding-zh'],
        value: { status: 'compatible' },
      },
    ],
  })
  assert.equal(sourced.ok, true, JSON.stringify(sourced))
  if (!sourced.ok) return
  const html = renderReportHtml(sourced.value, '2026-08-27T01:02:03.000Z')
  const readingPath = html.slice(0, html.indexOf('<footer>'))
  assert.match(readingPath, /支付成功量在观察期末达到 95。/)
  assert.doesNotMatch(readingPath, /English statement|finding-zh|artifact-trend/)
  assert.match(readingPath, /<ol><li>优先处理移动端。<\/li><li>持续观察波动。<\/li><\/ol>/)
  assert.match(readingPath, /<th scope="col">日期<\/th>/)
  assert.match(readingPath, /8月18日/)
  assert.doesNotMatch(readingPath, /<th scope="col">bucket_start<\/th>/)
  assert.match(html.slice(html.indexOf('<footer>')), /finding-zh|artifact-trend/)
})

test('Finding statements cannot inject HTML, links, or new report markup', () => {
  const unsafeDocument: ReportDocumentV1 = {
    version: 'dsh-data-analysis-report/v1',
    title: 'Unsafe Finding',
    locale: 'en-US',
    sections: [
      {
        id: 'evidence',
        title: 'Evidence',
        blocks: [
          {
            kind: 'evidence',
            id: 'unsafe-evidence',
            title: 'Observed fact',
            finding_ids: ['finding-unsafe'],
          },
        ],
      },
    ],
  }
  const unsafeProjection: ReportProjectionBundle = {
    sessionId: 'session-report',
    artifacts: [{ ...artifact, rowsProjected: false, rows: [] }],
    findings: [
      {
        findingId: 'finding-unsafe',
        findingType: 'observation',
        epistemicKind: 'observed',
        artifactId: artifact.ref,
        sessionId: 'session-report',
        qualityStatus: 'ready',
        committedAt: '2026-08-27T00:05:00+00:00',
        value: { value: 12 },
        subject: { metric_id: 'payments.success' },
        derivation: { rule_id: 'observation/v1' },
        rendered: {
          en: 'Fact <img src=x onerror=alert(1)> [link](https://example.invalid) [^mv-f99].',
          zh: '事实 <img src=x onerror=alert(1)>。',
        },
      },
    ],
    compatibilities: [
      {
        groupIndex: 0,
        status: 'compatible',
        findingIds: ['finding-unsafe'],
        value: { status: 'compatible' },
      },
    ],
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
  assert.match(html, /显示: 3 \/ 总计: 8 \/ 省略: 5/)
  assert.match(html, /业务说明 · 8 个数据点/)
  assert.match(html, /范围: 89 – 95 count · 纵轴聚焦于数据区间/)
  assert.match(
    html,
    /\.report-summary>\.text-block:first-of-type\{[^}]*border-left:3px solid var\(--accent\)/,
  )
  assert.match(
    html,
    /\.chart-block,\.table-block\{[^}]*background:transparent;border:0;border-top:1px solid var\(--line\)/,
  )
  assert.doesNotMatch(html, /\.report-summary\{[^}]*background:var\(--accent-soft\)/)
  assert.match(html, /@media print/)
  assert.doesNotMatch(html, /<script\b|<iframe\b|https?:\/\/|data\.parquet|\.marivo\//)
})

test('canonical digests ignore object key order while document order remains semantic', () => {
  assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }))
  const twoSections: ReportDocumentV1 = {
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
  const reordered: ReportDocumentV1 = {
    ...twoSections,
    sections: [...twoSections.sections].reverse(),
  }
  assert.notEqual(reportDocumentDigest(twoSections), reportDocumentDigest(reordered))
  const changed: ReportDocumentV1 = { ...document, title: '另一份报告' }
  assert.notEqual(reportDocumentDigest(document), reportDocumentDigest(changed))
})

test('publisher atomically creates private immutable files and reuses the same digest', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-report-publish-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const options = {
    environmentFingerprint: 'f'.repeat(64),
    marivoVersion: '0.4.test',
    reportsRoot: path.join(root, 'reports'),
    now: () => new Date('2026-08-27T01:02:03.000Z'),
  }
  const first = await publishReport(compiled(), options)
  assert.equal(first.ok, true, JSON.stringify(first))
  if (!first.ok) return
  const second = await publishReport(compiled(), {
    ...options,
    now: () => new Date('2026-08-28T00:00:00.000Z'),
  })
  assert.equal(second.ok, true, JSON.stringify(second))
  if (!second.ok) return
  assert.equal(second.reused, true)
  assert.equal(second.path, first.path)
  assert.equal(second.generatedAt, first.generatedAt)
  const directory = path.dirname(first.path)
  assert.deepEqual((await readdir(directory)).sort(), [
    'index.html',
    'manifest.json',
    'report-document.json',
  ])
  for (const filename of await readdir(directory)) {
    const mode = (await stat(path.join(directory, filename))).mode & 0o777
    if (process.platform !== 'win32') assert.equal(mode, 0o600)
  }
  assert.equal(
    (await readdir(path.dirname(directory))).some((name) => name.startsWith('.staging-')),
    false,
  )
  assert.doesNotMatch(await readFile(first.path, 'utf8'), /<script\b/)
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
  await assert.rejects(
    () => publishReport(compiled(), options),
    /does not match its expected manifest/,
  )
})

test('publisher ignores volatile revalidation time but identities stable provenance changes', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-report-provenance-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const options = {
    environmentFingerprint: '9'.repeat(64),
    marivoVersion: '0.4.test',
    reportsRoot: path.join(root, 'reports'),
    now: () => new Date('2026-08-27T01:02:03.000Z'),
  }
  const firstReport = parsedCompiledProjection('2026-08-27T01:00:00.000Z')
  const secondReport = parsedCompiledProjection('2026-08-28T01:00:00.000Z')
  assert.equal(
    'checked_at' in (firstReport.projection.artifacts[0]!.revalidation as Record<string, unknown>),
    false,
  )
  const first = await publishReport(firstReport, options)
  const second = await publishReport(secondReport, options)
  assert.equal(first.ok, true, JSON.stringify(first))
  assert.equal(second.ok, true, JSON.stringify(second))
  if (!first.ok || !second.ok) return
  assert.equal(second.reused, true)
  assert.equal(second.path, first.path)
  assert.equal(second.reportDigest, first.reportDigest)

  const changedReport = parsedCompiledProjection('2026-08-28T01:00:00.000Z', {
    kind: 'MetricFrame',
    ref: artifact.ref,
    semantic_revision: 2,
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
    version: 'dsh-data-analysis-report/v1',
    title: '仅 Finding 报告',
    locale: 'zh-CN',
    sections: [
      {
        id: 'evidence',
        title: '事实',
        blocks: [
          {
            kind: 'evidence',
            id: 'finding-only',
            title: '关键事实',
            finding_ids: ['finding-only'],
          },
        ],
      },
    ],
  }
  const backingArtifact: ReportArtifactProjection = {
    ...artifact,
    ref: 'artifact-backing',
    shape: [5_000, 2],
    contract: { kind: 'MetricFrame', ref: 'artifact-backing' },
    revalidation: {
      status: 'admissible',
      artifact_ref: 'artifact-backing',
      content_hash: artifact.contentHash,
      artifact_schema_version: artifact.artifactSchemaVersion,
    },
    rowsProjected: false,
    rows: [],
  }
  const evidenceProjection: ReportProjectionBundle = {
    sessionId: 'session-report',
    artifacts: [backingArtifact],
    findings: [
      {
        findingId: 'finding-only',
        findingType: 'metric_value',
        epistemicKind: 'observed',
        artifactId: 'artifact-backing',
        sessionId: 'session-report',
        qualityStatus: null,
        committedAt: '2026-08-27T00:05:00+00:00',
        value: { value: 12 },
        subject: { metric_id: 'payments.success' },
        derivation: { rule_id: 'metric/v1' },
        rendered: { en: 'payments.success: observed 12.', zh: 'payments.success：观测值为 12。' },
      },
    ],
    compatibilities: [
      {
        groupIndex: 0,
        status: 'compatible',
        findingIds: ['finding-only'],
        value: { status: 'compatible' },
      },
    ],
  }
  const compiledEvidence = compileReportVisuals(evidenceDocument, evidenceProjection)
  assert.equal(compiledEvidence.ok, true, JSON.stringify(compiledEvidence))
  if (!compiledEvidence.ok) return
  const published = await publishReport(compiledEvidence.value, {
    environmentFingerprint: 'e'.repeat(64),
    marivoVersion: '0.4.test',
    reportsRoot: path.join(root, 'reports'),
    now: () => new Date('2026-08-27T01:02:03.000Z'),
  })
  assert.equal(published.ok, true, JSON.stringify(published))
  if (!published.ok) return
  const manifest = JSON.parse(
    await readFile(path.join(path.dirname(published.path), 'manifest.json'), 'utf8'),
  ) as {
    version: string
    renderer_version: string
    provenance_digest: string
    artifacts: Array<{ ref: string; content_hash: string }>
    finding_ids: string[]
  }
  assert.equal(manifest.version, 'dsh-data-analysis-report-manifest/v2')
  assert.equal(manifest.renderer_version, 'dsh-data-analysis-html/v4')
  assert.match(manifest.provenance_digest, /^[a-f0-9]{64}$/)
  assert.deepEqual(manifest.artifacts, [
    { ref: 'artifact-backing', content_hash: artifact.contentHash },
  ])
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
        stdout: Buffer.from(
          JSON.stringify(
            checkedProjectionPayload({
              session_id: 'session-report',
              artifacts: [],
              findings: [],
              compatibilities: [],
            }),
          ),
        ),
        stderr: Buffer.alloc(0),
      }
    },
  } as unknown as MarivoEnvironment
  const tool = createMarivoReportRenderTool(environment, {
    reportsRoot: path.join(root, 'reports'),
  })
  const textDocument: ReportDocumentV1 = {
    version: 'dsh-data-analysis-report/v1',
    title: 'Cancelled',
    locale: 'en-US',
    sections: [
      { id: 'section', title: 'Section', blocks: [{ kind: 'text', id: 'text', text: 'body' }] },
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

test('projection parser accepts one exact atomic bundle and rejects identity drift', () => {
  const raw: any = {
    status: 'ready',
    session_id: 'session-report',
    artifacts: [
      {
        ref: artifact.ref,
        family: artifact.family,
        shape: artifact.shape,
        columns: artifact.columns,
        content_hash: artifact.contentHash,
        artifact_schema_version: artifact.artifactSchemaVersion,
        created_at: artifact.createdAt,
        contract: artifact.contract,
        revalidation: artifact.revalidation,
        lineage: artifact.lineage,
        rows_projected: true,
        rows: artifact.rows,
      },
    ],
    findings: [],
    compatibilities: [],
  }
  const accepted = parseReportProjection(
    Buffer.from(JSON.stringify(checkedProjectionPayload(raw))),
    {
      sessionId: 'session-report',
      artifactRefs: ['artifact-trend'],
      findingIds: [],
      findingGroups: [],
    },
  )
  assert.equal(accepted.ok, true)
  raw.artifacts[0]!.ref = 'drifted'
  assert.throws(
    () =>
      parseReportProjection(Buffer.from(JSON.stringify(checkedProjectionPayload(raw))), {
        sessionId: 'session-report',
        artifactRefs: ['artifact-trend'],
        findingIds: [],
        findingGroups: [],
      }),
    /revalidation identity|requested identities/,
  )
})

test('partial projection parser requires one ordered outcome for every target', () => {
  const artifactWire = (ref: string) => ({
    ref,
    family: artifact.family,
    shape: artifact.shape,
    columns: artifact.columns,
    content_hash: artifact.contentHash,
    artifact_schema_version: artifact.artifactSchemaVersion,
    created_at: artifact.createdAt,
    contract: { kind: artifact.family, ref },
    revalidation: {
      status: 'admissible',
      artifact_ref: ref,
      content_hash: artifact.contentHash,
      artifact_schema_version: artifact.artifactSchemaVersion,
    },
    lineage: artifact.lineage,
    rows_projected: true,
    rows: artifact.rows,
  })
  const blockedArtifact = {
    status: 'blocked',
    ref: 'artifact-two',
    omitted_issue_count: 0,
    issues: [
      {
        code: 'artifact-not-admissible',
        location: 'artifact_refs[1]',
        message: 'Artifact is stale.',
        repair: 'Regenerate it.',
      },
    ],
  }
  const raw: any = {
    status: 'checked',
    session_id: 'session-report',
    finding_group_outcomes: [],
    finding_outcomes: [],
    artifact_outcomes: [{ status: 'ready', value: artifactWire('artifact-one') }, blockedArtifact],
  }
  const expected = {
    sessionId: 'session-report',
    artifactRefs: ['artifact-one', 'artifact-two'],
    findingIds: [],
    findingGroups: [],
  }
  const accepted = parseReportProjection(Buffer.from(JSON.stringify(raw)), expected)
  assert.equal(accepted.ok, false)
  assert.equal(accepted.complete, false)
  assert.deepEqual(
    accepted.value.artifacts.map((item) => item.ref),
    ['artifact-one'],
  )
  assert.deepEqual(
    accepted.issues.map((item) => item.code),
    ['artifact-not-admissible'],
  )

  const missing = structuredClone(raw)
  missing.artifact_outcomes.pop()
  assert.throws(
    () => parseReportProjection(Buffer.from(JSON.stringify(missing)), expected),
    /outcome count/,
  )
  const duplicated = structuredClone(raw)
  duplicated.artifact_outcomes[1] = duplicated.artifact_outcomes[0]
  assert.throws(
    () => parseReportProjection(Buffer.from(JSON.stringify(duplicated)), expected),
    /wrong Artifact ref/,
  )
  const extra = structuredClone(raw)
  extra.artifact_outcomes.push(blockedArtifact)
  assert.throws(
    () => parseReportProjection(Buffer.from(JSON.stringify(extra)), expected),
    /outcome count/,
  )
  const wrongSession = structuredClone(raw)
  wrongSession.session_id = 'other-session'
  assert.throws(
    () => parseReportProjection(Buffer.from(JSON.stringify(wrongSession)), expected),
    /session_id does not match/,
  )
})

test('blocked Finding outcomes may close over a discovered backing Artifact without becoming ready', () => {
  const raw: any = {
    status: 'checked',
    session_id: 'session-report',
    finding_group_outcomes: [
      {
        status: 'ready',
        value: {
          group_index: 0,
          status: 'compatible',
          finding_ids: ['finding-render-broken'],
          value: { status: 'compatible' },
        },
      },
    ],
    finding_outcomes: [
      {
        status: 'blocked',
        finding_id: 'finding-render-broken',
        artifact_ref: 'artifact-backing',
        omitted_issue_count: 0,
        issues: [
          {
            code: 'finding-render-failed',
            location: 'finding_ids[0]',
            message: 'Rendering failed.',
            repair: 'Repair the renderer.',
          },
        ],
      },
    ],
    artifact_outcomes: [
      {
        status: 'blocked',
        ref: 'artifact-backing',
        omitted_issue_count: 0,
        issues: [
          {
            code: 'artifact-not-admissible',
            location: 'artifact_refs[0]',
            message: 'Backing Artifact is stale.',
            repair: 'Regenerate it.',
          },
        ],
      },
    ],
  }
  const expected = {
    sessionId: 'session-report',
    artifactRefs: [],
    findingIds: ['finding-render-broken'],
    findingGroups: [['finding-render-broken']],
  }
  const accepted = parseReportProjection(Buffer.from(JSON.stringify(raw)), expected)
  assert.equal(accepted.ok, false)
  assert.deepEqual(accepted.checkedArtifactRefs, ['artifact-backing'])
  assert.deepEqual(accepted.findingArtifactTargets, [
    {
      findingId: 'finding-render-broken',
      artifactRef: 'artifact-backing',
    },
  ])
  assert.deepEqual(
    accepted.issues.map((item) => item.code),
    ['finding-render-failed', 'artifact-not-admissible'],
  )

  const missingDiscovery = structuredClone(raw)
  delete missingDiscovery.finding_outcomes[0].artifact_ref
  assert.throws(
    () => parseReportProjection(Buffer.from(JSON.stringify(missingDiscovery)), expected),
    /Artifact outcome count/,
  )
  const driftedBacking = structuredClone(raw)
  driftedBacking.artifact_outcomes[0].ref = 'artifact-other'
  assert.throws(
    () => parseReportProjection(Buffer.from(JSON.stringify(driftedBacking)), expected),
    /ref does not match the requested identity/,
  )
})

test('Finding-only provenance accepts an admissible backing Artifact without projecting its rows', () => {
  const backingHash = 'b'.repeat(64)
  const raw = {
    status: 'ready',
    session_id: 'session-report',
    artifacts: [
      {
        ref: 'artifact-backing',
        family: 'MetricFrame',
        shape: [5000, 2],
        columns: artifact.columns,
        content_hash: backingHash,
        artifact_schema_version: artifact.artifactSchemaVersion,
        created_at: artifact.createdAt,
        contract: { kind: 'MetricFrame', ref: 'artifact-backing' },
        revalidation: {
          status: 'admissible',
          artifact_ref: 'artifact-backing',
          content_hash: backingHash,
          artifact_schema_version: artifact.artifactSchemaVersion,
        },
        lineage: { steps: [] },
        rows_projected: false,
        rows: [],
      },
    ],
    findings: [
      {
        finding_id: 'finding-only',
        finding_type: 'metric_value',
        epistemic_kind: 'observed',
        artifact_id: 'artifact-backing',
        session_id: 'session-report',
        quality_status: null,
        committed_at: '2026-08-27T00:05:00+00:00',
        value: { kind: 'metric_value', value: 12 },
        subject: { kind: 'metric', metric_id: 'payments.success' },
        derivation: { rule_id: 'metric/v1' },
        rendered: { en: 'payments.success: observed 12.', zh: 'payments.success：观测值为 12。' },
      },
    ],
    compatibilities: [
      {
        group_index: 0,
        status: 'compatible',
        finding_ids: ['finding-only'],
        value: { status: 'compatible' },
      },
    ],
  }
  const accepted = parseReportProjection(
    Buffer.from(JSON.stringify(checkedProjectionPayload(raw))),
    {
      sessionId: 'session-report',
      artifactRefs: [],
      findingIds: ['finding-only'],
      findingGroups: [['finding-only']],
    },
  )
  assert.equal(accepted.ok, true, JSON.stringify(accepted))
  if (!accepted.ok) return
  assert.equal(accepted.value.artifacts[0]?.rowsProjected, false)
  assert.deepEqual(accepted.value.artifacts[0]?.rows, [])

  assert.throws(
    () =>
      parseReportProjection(Buffer.from(JSON.stringify(checkedProjectionPayload(raw))), {
        sessionId: 'session-report',
        artifactRefs: ['artifact-backing'],
        findingIds: ['finding-only'],
        findingGroups: [['finding-only']],
      }),
    /row projection status/,
  )
})

test('nullable numeric projection cells remain null for table rendering', () => {
  const nullableArtifact: ReportArtifactProjection = {
    ...artifact,
    columns: [artifact.columns[0]!, { ...artifact.columns[1]!, nullable: true }],
    rows: artifact.rows.map((row, index) => (index === 2 ? [row[0]!, null] : row)),
  }
  const tableDocument: ReportDocumentV1 = {
    version: 'dsh-data-analysis-report/v1',
    title: 'Nullable table',
    locale: 'en-US',
    sections: [
      {
        id: 'detail',
        title: 'Detail',
        blocks: [
          {
            kind: 'table',
            id: 'detail-table',
            title: 'Rows',
            artifact_ref: artifact.ref,
            columns: ['bucket_start', 'value'],
            max_rows: 5,
          },
        ],
      },
    ],
  }
  const result = compileReportVisuals(tableDocument, {
    ...projection,
    artifacts: [nullableArtifact],
  })
  assert.equal(result.ok, true, JSON.stringify(result))
  if (!result.ok) return
  assert.match(renderReportHtml(result.value, '2026-08-27T01:02:03.000Z'), /<td>—<\/td>/)
})

test('Code Mode logs one durable ready card block without changing nested Tool text', async () => {
  const ctx = new Context()
  const dispose = installMarivoReportCodeDelivery(ctx)
  const ready = {
    status: 'ready',
    title: 'Code report',
    path: '/reports/code/index.html',
    report_digest: 'a'.repeat(64),
    document_digest: 'b'.repeat(64),
    artifact_refs: [],
    finding_ids: [],
    disclosures: ['bounded'],
  }
  const sessionEvents = [
    {
      type: 'tool/call',
      data: { turn: 7, callId: 'outer', name: RUN_CODE_NAME },
    },
  ]
  const agent = { session: { events: sessionEvents } }
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
    {
      isError: false,
      value: ready,
      content: [{ type: 'text', text: 'original text' }],
    } as never,
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
  assert.deepEqual(original, [{ type: 'text', text: 'original text' }])

  const replayed = await ctx.waterfall(
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
  assert.deepEqual(replayed, original, 'one tools/result observation must mint only one block')

  ctx.emit(
    'tools/result',
    { ...exec, callId: 'outer:code:unowned' } as never,
    {
      isError: false,
      value: ready,
      content: [{ type: 'text', text: 'unowned' }],
    } as never,
  )
  const unowned = await ctx.waterfall(
    'tools/code-dispatch-log',
    {
      exec: { rootCallId: 'unrelated-root' } as never,
      agent: agent as never,
      subCallId: 'outer:code:unowned',
      name: MARIVO_REPORT_RENDER_TOOL_NAME,
      isError: false,
      content: [{ type: 'text', text: 'unowned' }],
    } as never,
    () => Promise.resolve([{ type: 'text', text: 'unowned' }]),
  )
  assert.deepEqual(unowned, [{ type: 'text', text: 'unowned' }])

  ctx.emit(
    'tools/result',
    { ...exec, callId: 'outer:code:2' } as never,
    {
      isError: false,
      value: {
        status: 'blocked',
        checks: [
          { stage: 'document', status: 'failed', issues: [], omitted_issue_count: 1 },
          {
            stage: 'marivo',
            status: 'skipped',
            issues: [],
            omitted_issue_count: 0,
            reason: 'blocked',
          },
          {
            stage: 'visual',
            status: 'skipped',
            issues: [],
            omitted_issue_count: 0,
            reason: 'blocked',
          },
          {
            stage: 'publish',
            status: 'skipped',
            issues: [],
            omitted_issue_count: 0,
            reason: 'blocked',
          },
        ],
      },
      content: [{ type: 'text', text: 'blocked' }],
    } as never,
  )
  const blocked = await ctx.waterfall(
    'tools/code-dispatch-log',
    {
      exec: { rootCallId: 'outer' } as never,
      agent: agent as never,
      subCallId: 'outer:code:2',
      name: MARIVO_REPORT_RENDER_TOOL_NAME,
      isError: false,
      content: [{ type: 'text', text: 'blocked' }],
    } as never,
    () => Promise.resolve([{ type: 'text', text: 'blocked' }]),
  )
  assert.deepEqual(blocked, [{ type: 'text', text: 'blocked' }])

  dispose()
  ctx.emit(
    'tools/result',
    { ...exec, callId: 'outer:code:3' } as never,
    {
      isError: false,
      value: ready,
      content: [{ type: 'text', text: 'after dispose' }],
    } as never,
  )
  const disposed = await ctx.waterfall(
    'tools/code-dispatch-log',
    {
      exec: { rootCallId: 'outer' } as never,
      agent: agent as never,
      subCallId: 'outer:code:3',
      name: MARIVO_REPORT_RENDER_TOOL_NAME,
      isError: false,
      content: [{ type: 'text', text: 'after dispose' }],
    } as never,
    () => Promise.resolve([{ type: 'text', text: 'after dispose' }]),
  )
  assert.deepEqual(disposed, [{ type: 'text', text: 'after dispose' }])
})

test('real run_code sub-dispatch replays the report card block through the standard event', async () => {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime, { mode: 'code' })
  await ctx.plugin(ReportCodeRuntime)
  const ready = {
    status: 'ready',
    title: 'Nested report',
    path: '/reports/nested/index.html',
    report_digest: 'c'.repeat(64),
    document_digest: 'd'.repeat(64),
    artifact_refs: [],
    finding_ids: [],
    disclosures: ['nested delivery'],
  }
  ctx.tools.register(
    defineTool({
      name: MARIVO_REPORT_RENDER_TOOL_NAME,
      description: 'Fixture report renderer',
      parameters: {},
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: () => [{ type: 'text', text: 'nested original text' }],
      },
      execute: () => Promise.resolve(ready),
    }),
  )
  const dispose = installMarivoReportCodeDelivery(ctx)
  const runtime = ctx.codeRuntime as ReportCodeRuntime
  runtime.behavior = async (request) => {
    const value = await request.bindings[0]!.functions[MARIVO_REPORT_RENDER_TOOL_NAME]!({})
    return { logs: [], value: JSON.stringify(value) }
  }
  const events: Array<{ type: string; data: any }> = [
    {
      type: 'tool/call',
      data: { turn: 5, callId: 'report-code-parent', name: RUN_CODE_NAME },
    },
  ]
  const agent = {
    session: {
      events,
      append(type: string, data: unknown) {
        events.push({ type, data })
      },
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
  const dispatch = events.find((event) => event.type === 'tool/code-dispatch')
  assert.ok(dispatch)
  assert.equal(dispatch.data.name, MARIVO_REPORT_RENDER_TOOL_NAME)
  assert.deepEqual(dispatch.data.content, [
    { type: 'text', text: 'nested original text' },
    {
      type: 'marivo-report-card',
      turn: 5,
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

test('registered Tool persists a closed ready card summary and null for blocked results', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-report-tool-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const executable = path.join(root, 'fixture-python')
  const payload = checkedProjectionPayload({
    session_id: 'session-report',
    artifacts: [
      {
        ref: artifact.ref,
        family: artifact.family,
        shape: artifact.shape,
        columns: artifact.columns,
        content_hash: artifact.contentHash,
        artifact_schema_version: artifact.artifactSchemaVersion,
        created_at: artifact.createdAt,
        contract: artifact.contract,
        revalidation: artifact.revalidation,
        lineage: artifact.lineage,
        rows_projected: true,
        rows: artifact.rows,
      },
    ],
    findings: [],
    compatibilities: [],
  })
  await writeFile(
    executable,
    `#!/usr/bin/env node\nprocess.stdout.write(process.env.REPORT_PAYLOAD ?? '')\n`,
  )
  await chmod(executable, 0o755)
  const policy = new FixedSubprocessPolicy(root, {
    PATH: process.env.PATH,
    REPORT_PAYLOAD: JSON.stringify(payload),
  })
  const environment = new MarivoEnvironment(
    {
      projectRoot: root,
      pythonExecutable: executable,
      marivoVersion: '0.4.test',
      packagePath: path.join(root, 'marivo', '__init__.py'),
      subprocessPolicyId: policy.id,
      fingerprint: 'f'.repeat(64),
    },
    policy,
  )
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  registerMarivoReportRenderTool(ctx, environment, {
    reportsRoot: path.join(root, 'reports'),
    now: () => new Date('2026-08-27T01:02:03.000Z'),
  })
  const result = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId('report-1'),
    name: MARIVO_REPORT_RENDER_TOOL_NAME,
    arguments: { session_id: 'session-report', document },
  })
  assert.equal(result.isError, false, JSON.stringify(result))
  if (result.isError) return
  const value = result.value as {
    status: string
    title: string
    path: string
    report_digest: string
    disclosures: string[]
  }
  assert.equal(value.status, 'ready')
  assert.deepEqual(result.meta, {
    kind: 'marivo-html-report',
    version: 1,
    title: value.title,
    path: value.path,
    reportDigest: value.report_digest,
    disclosures: value.disclosures,
  })
  assert.deepEqual(Object.keys(result.meta as object).sort(), [
    'disclosures',
    'kind',
    'path',
    'reportDigest',
    'title',
    'version',
  ])
  assert.match(
    result.content[0]?.type === 'text' ? result.content[0].text : '',
    /HTML report ready/,
  )

  const blocked = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId('report-blocked'),
    name: MARIVO_REPORT_RENDER_TOOL_NAME,
    arguments: {
      session_id: 42,
      document: { ...document, sections: [] },
    },
  })
  assert.equal(blocked.isError, false, JSON.stringify(blocked))
  assert.equal((blocked.value as { status: string }).status, 'blocked')
  assert.equal(blocked.meta, null)
  assert.match(
    blocked.content[0]?.type === 'text' ? blocked.content[0].text : '',
    /HTML report rendering is blocked after best-effort preflight/,
  )
})
