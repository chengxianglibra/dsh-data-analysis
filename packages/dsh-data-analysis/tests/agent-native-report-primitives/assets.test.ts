import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const assetRoot = path.join(packageRoot, 'skills', 'dsh-data-analysis-report', 'assets')
const fixtureRoot = path.join(packageRoot, 'report-contracts', 'fixtures')

interface Registry {
  register(id: string, value: unknown): void
  get(id: string): unknown
  has(id: string): boolean
  list(): readonly string[]
}

interface TraceRegistry extends Registry {
  renderSessionGraph(container: TestElement, trace: unknown): TestElement
  renderSessionGraphs(container: TestElement, traceIds?: readonly string[]): TestElement
}

interface ArtifactComponent {
  render(container: TestElement, datasetId: string): TestElement
}

interface ProjectionContext extends vm.Context {
  ReportData?: Registry & { records(id: string): readonly Record<string, unknown>[] }
  MarivoArtifact?: ArtifactComponent
  ReportTrace?: TraceRegistry
}

type TestListener = (event: { key?: string }) => void

class TestElement {
  readonly childNodes: TestElement[] = []
  readonly dataset: Record<string, string> = {}
  readonly attributes = new Map<string, string>()
  className = ''
  hidden = false
  id = ''
  parentNode: TestElement | null = null
  scope = ''
  type = ''
  private ownText = ''
  private readonly listeners = new Map<string, TestListener[]>()

  get textContent(): string {
    return this.ownText + this.childNodes.map((child) => child.textContent).join('')
  }

  set textContent(value: string) {
    this.replaceChildren()
    this.ownText = String(value)
  }

  append(...children: TestElement[]): void {
    for (const child of children) {
      if (child.parentNode) {
        const index = child.parentNode.childNodes.indexOf(child)
        if (index >= 0) child.parentNode.childNodes.splice(index, 1)
      }
      child.parentNode = this
      this.childNodes.push(child)
    }
  }

  replaceChildren(...children: TestElement[]): void {
    for (const child of this.childNodes) child.parentNode = null
    this.childNodes.length = 0
    this.ownText = ''
    this.append(...children)
  }

  setAttribute(name: string, value: string): void {
    const normalized = String(value)
    this.attributes.set(name, normalized)
    if (name === 'class') this.className = normalized
    if (name === 'id') this.id = normalized
    if (name.startsWith('data-')) {
      const key = name.slice(5).replaceAll(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
      this.dataset[key] = normalized
    }
  }

  addEventListener(type: string, listener: TestListener): void {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  querySelectorAll(selector: string): TestElement[] {
    const result: TestElement[] = []
    const visit = (node: TestElement): void => {
      for (const child of node.childNodes) {
        if (selector.startsWith('.') && child.className.split(/\s+/).includes(selector.slice(1))) {
          result.push(child)
        }
        visit(child)
      }
    }
    visit(this)
    return result
  }
}

class TestDocument {
  createElement(): TestElement {
    return new TestElement()
  }

  createElementNS(): TestElement {
    return new TestElement()
  }
}

async function fixture(name: string): Promise<any> {
  return JSON.parse(await readFile(path.join(fixtureRoot, name), 'utf8'))
}

async function projectionContext(withDom = false): Promise<ProjectionContext> {
  const context = vm.createContext(
    withDom ? { console, document: new TestDocument(), Element: TestElement } : { console },
  ) as ProjectionContext
  for (const name of ['report-data.js', 'marivo-artifact.js', 'marivo-session-dag.js']) {
    vm.runInContext(await readFile(path.join(assetRoot, name), 'utf8'), context, { filename: name })
  }
  return context
}

test('ReportData accepts closed Artifact and computed projections', async () => {
  const context = await projectionContext()
  const registry = context.ReportData!
  const artifact = await fixture('artifact-dataset.json')
  assert.throws(
    () =>
      registry.register('legacy-artifact', { ...artifact, schema: 'dsh-data-analysis-dataset/v1' }),
    /unsupported/,
  )
  registry.register('artifact-sales', artifact)
  assert.deepEqual([...registry.list()], ['artifact-sales'])
  assert.equal(registry.has('artifact-sales'), true)
  assert.equal(Object.isFrozen(registry.get('artifact-sales')), true)
  assert.throws(
    () => registry.register('artifact-sales', structuredClone(artifact)),
    /already registered/,
  )
  assert.deepEqual(JSON.parse(JSON.stringify(registry.records('artifact-sales'))), [
    { month: '2026-01-01T00:00:00' },
  ])

  const computed = await fixture('computed-dataset.json')
  registry.register('computed-sales', computed)
  assert.deepEqual(JSON.parse(JSON.stringify(registry.records('computed-sales'))), [
    { month: '2026-01-01T00:00:00', revenue: 1024.5 },
    { month: '2026-02-01T00:00:00', revenue: null },
  ])
})

test('MarivoArtifact renders one reader summary and only material notices', async () => {
  const context = await projectionContext(true)
  const datasets = context.ReportData!
  const component = context.MarivoArtifact!
  const artifact = await fixture('artifact-dataset.json')
  datasets.register('artifact-sales', artifact)

  const normal = new TestElement()
  component.render(normal, 'artifact-sales')
  assert.match(normal.textContent, /metric_frame · time_series · 1 行 · 结果生成于/)
  for (const hidden of ['session-1', 'artifact-1', 'sha256:fixture', 'Finding', 'lineage']) {
    assert.equal(normal.textContent.includes(hidden), false, hidden)
  }
  assert.equal(normal.querySelectorAll('.marivo-artifact-notice').length, 0)

  const material = structuredClone(artifact)
  material.dataset_id = 'material'
  material.source.artifact.row_count = 3
  material.source.artifact.evidence_status = 'partial'
  material.table.total_rows = 3
  material.table.omitted_rows = 2
  material.source.quality_summary = {
    coverage: 1,
    null_rate: 0,
    sample_size: 3,
    sample_coverage_min: null,
    sample_coverage_avg: null,
    sample_coverage_partial_buckets: null,
    zero_denominator_rows: 0,
    evaluated_check_count: 2,
    failed_check_count: 1,
    warning_check_count: 1,
  }
  material.source.issues = [
    {
      category: 'data_quality',
      kind: 'sample_size_low',
      severity: 'warning',
      check_id: 'row_count',
      expectation: 'row_count >= 5',
      repair: null,
    },
  ]
  material.source.issues_omitted = 1
  material.source.revalidation = {
    ...(await fixture('checked-revalidation.json')),
    result: 'stale',
    semantic_status: 'stale',
  }
  datasets.register('material', material)
  const notices = new TestElement()
  component.render(notices, 'material')
  assert.match(notices.textContent, /展示数据已截断/)
  assert.match(notices.textContent, /分析依据不完整/)
  assert.match(notices.textContent, /stale/)
  assert.match(notices.textContent, /1 项未通过的质量检查/)
  assert.match(notices.textContent, /1 项质量警告/)
  assert.match(notices.textContent, /1 个警告问题/)
  assert.match(notices.textContent, /另有 1 个问题/)

  const computed = await fixture('computed-dataset.json')
  datasets.register('computed-sales', computed)
  assert.throws(
    () => component.render(new TestElement(), 'computed-sales'),
    /artifact-dataset-required/,
  )
})

test('Session DAG runtime validates and freezes Marivo graph projections', async () => {
  const context = await projectionContext()
  const registry = context.ReportTrace!
  const trace = await fixture('trace-succeeded.json')
  assert.throws(
    () =>
      registry.register('legacy-trace', { ...trace, schema: 'dsh-data-analysis-session-trace/v1' }),
    /unsupported/,
  )
  registry.register('trace-succeeded', trace)
  assert.deepEqual([...registry.list()], ['trace-succeeded'])
  assert.equal(registry.has('trace-succeeded'), true)
  assert.equal(Object.isFrozen(registry.get('trace-succeeded')), true)

  const dangling = structuredClone(trace)
  dangling.trace_id = 'dangling'
  dangling.edges[0].run_id = 'missing-run'
  assert.throws(() => registry.register('dangling', dangling), /contains a dangling identity/)

  const queries = structuredClone(trace)
  queries.trace_id = 'queries'
  queries.runs[0].queries = [{}]
  assert.throws(() => registry.register('queries', queries), /must be omitted in reader detail/)

  const publicSummary = structuredClone(trace)
  publicSummary.trace_id = 'public-summary'
  publicSummary.root_run_ids = []
  publicSummary.edges = []
  registry.register('public-summary', publicSummary)
  assert.equal(registry.has('public-summary'), true)
})

test('Session DAG renders Frame row counts, exact previews, and every selected Session', async () => {
  const context = await projectionContext(true)
  const datasets = context.ReportData!
  const traces = context.ReportTrace!
  const dataset = await fixture('artifact-dataset.json')
  dataset.dataset_id = 'artifact-session-1'
  datasets.register('artifact-session-1', dataset)
  const secondDataset = structuredClone(dataset)
  secondDataset.dataset_id = 'artifact-session-2'
  secondDataset.source.artifact.session_id = 'session-2'
  secondDataset.table.rows = [['2026-02-01T00:00:00']]
  datasets.register('artifact-session-2', secondDataset)

  const trace = await fixture('trace-succeeded.json')
  traces.register('trace-succeeded', trace)
  const secondTrace = structuredClone(trace)
  secondTrace.trace_id = 'trace-second'
  secondTrace.session_id = 'session-2'
  traces.register('trace-second', secondTrace)

  const container = new TestElement()
  traces.renderSessionGraphs(container)
  assert.match(container.textContent, /2 个 Session · 2 个聚焦 Graph/)
  assert.match(container.textContent, /session-1/)
  assert.match(container.textContent, /session-2/)
  const frameNodes = container
    .querySelectorAll('.trace-node')
    .filter((node) => node.dataset.nodeKind === 'artifact')
  assert.equal(frameNodes.length, 2)
  assert.ok(frameNodes.every((node) => node.textContent === 'MetricFrame1 行'))
  assert.equal(container.querySelectorAll('.trace-frame-preview').length, 2)
  assert.equal(container.querySelectorAll('.marivo-artifact').length, 2)
  assert.equal(container.textContent.includes('Finding'), false)
  const frameDetails = container
    .querySelectorAll('.trace-detail')
    .filter((detail) => detail.dataset.nodeKey?.startsWith('artifact:'))
  assert.equal(frameDetails.length, 2)
  assert.ok(frameDetails.every((detail) => detail.hidden === false))

  const traceIds = [...traces.list()]
  for (let index = 3; index <= 21; index += 1) {
    const extraTrace = structuredClone(trace)
    extraTrace.trace_id = `trace-${index}`
    traces.register(extraTrace.trace_id, extraTrace)
    traceIds.push(extraTrace.trace_id)
  }
  assert.throws(
    () => traces.renderSessionGraphs(new TestElement(), traceIds),
    /between 1 and 20 registered trace ids/,
  )
})
