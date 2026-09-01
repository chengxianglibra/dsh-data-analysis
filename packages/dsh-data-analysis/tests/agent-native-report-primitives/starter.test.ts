import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import vm from 'node:vm'
import { validateReportContract } from '../../src/report-check/contracts.ts'
import { checkWorkspaceReport } from '../../src/report-check/workspace.ts'
import { TestDocument, TestElement, TestEvent, TestNode } from './starter-dom.ts'

const execute = promisify(execFile)
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const skillRoot = path.join(packageRoot, 'skills', 'dsh-data-analysis-report')
const starterRoot = path.join(skillRoot, 'starter')
const componentRoot = path.join(starterRoot, 'components')
const exampleRoot = path.join(starterRoot, 'examples', 'analysis-brief')
const copyScript = path.join(skillRoot, 'scripts', 'copy-starter.mjs')
const contractRoot = path.join(packageRoot, 'report-contracts')

interface DatasetRegistry {
  register(id: string, value: any): void
  get(id: string): any
  records(id: string): readonly Record<string, unknown>[]
  has(id: string): boolean
  list(): readonly string[]
}

interface ChartRegistry {
  attachDataDetails(container: TestElement, dataset: any): unknown
  renderBarChart(container: TestElement, dataset: any, options: any): TestElement
  renderKpis(container: TestElement, items: any[]): TestElement
  renderLineChart(container: TestElement, dataset: any, options: any): TestElement
  renderTable(container: TestElement, dataset: any, options: any): TestElement
}

interface TraceRegistry {
  register(id: string, value: any): void
  get(id: string): any
  has(id: string): boolean
  list(): readonly string[]
  renderSessionGraph(container: TestElement, trace: any): TestElement
}

interface StarterContext extends vm.Context {
  document?: TestDocument
  ReportCharts?: ChartRegistry
  ReportData?: DatasetRegistry
  ReportTrace?: TraceRegistry
}

async function temporaryDirectory(t: test.TestContext, prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

async function fixture(name: string): Promise<any> {
  return JSON.parse(await readFile(path.join(contractRoot, 'fixtures', name), 'utf8'))
}

function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

async function starterContext(withDom = false): Promise<StarterContext> {
  const document = new TestDocument()
  const context = vm.createContext({
    console,
    ...(withDom
      ? {
          document,
          Element: TestElement,
          Node: TestNode,
        }
      : {}),
  }) as StarterContext
  for (const name of [
    'report-data.js',
    ...(withDom ? ['report-charts.js', 'report-trace.js'] : []),
  ]) {
    vm.runInContext(await readFile(path.join(componentRoot, name), 'utf8'), context, {
      filename: name,
    })
  }
  return context
}

function lineOptions() {
  return {
    x: 'month',
    y: 'revenue',
    title: 'Monthly revenue',
    xLabel: 'Month',
    yLabel: 'Revenue',
    fallback: { columns: ['month', 'revenue'], maxRows: 100, caption: 'Revenue rows' },
  }
}

test('Skill and references keep progressive disclosure closed and complete', async () => {
  const skill = await readFile(path.join(skillRoot, 'SKILL.md'), 'utf8')
  assert.match(
    skill,
    /description: Create or revise a Workspace HTML analysis report\. Use only when the user explicitly requests HTML\/web output or accepts it; never use for inline, text, or other non-HTML output\./,
  )
  assert.ok(skill.length < 5_000)
  assert.match(skill, /Read only the references needed/)
  assert.match(skill, /dsh_data_analysis_report_check/)
  assert.doesNotMatch(skill, /renderLineChart\(|dsh-data-analysis-dataset\/v1|coverage\.external/)

  const references = [
    'checker.md',
    'checker-rules/accessibility-budget.md',
    'checker-rules/dataset-trace.md',
    'checker-rules/html-resource-syntax.md',
    'dataset.md',
    'material-disclosure.md',
    'report-content.md',
    'session-trace.md',
    'starter-components.md',
  ]
  for (const name of references)
    assert.equal((await stat(path.join(skillRoot, 'references', name))).isFile(), true)
  const checker = await readFile(path.join(skillRoot, 'references', 'checker.md'), 'utf8')
  for (const namespace of ['html.*', 'resource.*', 'dataset.*', 'trace.*', 'a11y.*', 'budget.*']) {
    assert.match(checker, new RegExp(namespace.replace('.', '\\.').replace('*', '\\*')))
  }
})

test('basic Starter is only the unresolved technical shell and CSS owns adaptive primitives', async () => {
  const html = await readFile(path.join(starterRoot, 'basic', 'index.html'), 'utf8')
  assert.match(html, /<meta name="dsh-report-starter" content="unresolved">/)
  assert.match(html, /<a class="skip-link"/)
  assert.equal((html.match(/<main\b/g) ?? []).length, 1)
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1)
  assert.doesNotMatch(html, /report-data|report-charts|report-trace|<script|kpi-grid|chart-shell/)

  const css = await readFile(path.join(starterRoot, 'basic', 'assets', 'report-base.css'), 'utf8')
  for (const token of [
    '--paper',
    '--surface',
    '--ink',
    '--accent',
    '--positive',
    '--warning',
    '--critical',
    '--chart-grid',
  ]) {
    assert.match(css, new RegExp(`${token}:`))
  }
  assert.match(css, /width: min\(100% - 144px, 1020px\)/)
  assert.match(css, /min-height: 44px/)
  assert.match(css, /@media \(max-width: 720px\)/)
  assert.match(css, /@media \(prefers-color-scheme: dark\)/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/)
  assert.match(css, /:focus-visible/)
  assert.match(css, /\.chart-details-popover\[data-fallback-open="true"\][\s\S]*position: absolute/)
  assert.match(css, /inset-block-start: 100%/)
  assert.match(css, /inset-inline-end: 0/)
})

test('reference-only example keeps sentinel identities, material warning, and closed dependencies', async () => {
  const html = await readFile(path.join(exampleRoot, 'index.html'), 'utf8')
  assert.match(html, /content="unresolved"/)
  assert.match(html, /Material limitation/)
  assert.match(html, /revalidation 结果为 stale/)
  const scripts = [
    await readFile(path.join(exampleRoot, 'example.js'), 'utf8'),
    await readFile(path.join(exampleRoot, 'example-trace.js'), 'utf8'),
    await readFile(path.join(exampleRoot, 'app.js'), 'utf8'),
  ].join('\n')
  assert.match(scripts, /dsh-starter-placeholder-dataset/)
  assert.match(scripts, /dsh-starter-placeholder-trace/)
  assert.match(scripts, /x: 'month'/)
  assert.match(scripts, /fallback:/)

  for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    const target = path.resolve(exampleRoot, match[1]!)
    assert.equal((await stat(target)).isFile(), true, match[1])
  }
})

test('copy-starter copies only allowlisted resources without overwrite or boundary escape', async (t) => {
  const workspace = await temporaryDirectory(t, 'dsh-report-starter-copy-')
  const result = await execute(
    process.execPath,
    [
      copyScript,
      '--target',
      'reports/demo',
      '--basic',
      '--component',
      'report-data',
      '--component',
      'report-charts',
      '--snippet',
      'chart-with-table',
    ],
    { cwd: workspace },
  )
  assert.deepEqual(result.stdout.trim().split('\n'), [
    'reports/demo/index.html',
    'reports/demo/assets/report-base.css',
    'reports/demo/assets/report-data.js',
    'reports/demo/assets/report-charts.js',
    'reports/demo/snippets/chart-with-table.html',
  ])
  for (const relative of result.stdout.trim().split('\n')) {
    assert.equal((await stat(path.join(workspace, relative))).isFile(), true)
  }

  await assert.rejects(
    execute(process.execPath, [copyScript, '--target', 'reports/demo', '--basic'], {
      cwd: workspace,
    }),
    (error: any) => error.stderr.includes('target-exists'),
  )
  await assert.rejects(
    execute(process.execPath, [copyScript, '--target', '../outside', '--basic'], {
      cwd: workspace,
    }),
    (error: any) => error.stderr.includes('target-invalid'),
  )
  await assert.rejects(
    execute(process.execPath, [copyScript, '--target', '/tmp/outside', '--basic'], {
      cwd: workspace,
    }),
    (error: any) => error.stderr.includes('target-invalid'),
  )
  await assert.rejects(
    execute(
      process.execPath,
      [copyScript, '--target', 'reports/unknown', '--component', 'unknown'],
      { cwd: workspace },
    ),
    (error: any) => error.stderr.includes('component-unknown'),
  )

  const outside = await temporaryDirectory(t, 'dsh-report-starter-outside-')
  await symlink(outside, path.join(workspace, 'linked'))
  await assert.rejects(
    execute(process.execPath, [copyScript, '--target', 'linked/report', '--basic'], {
      cwd: workspace,
    }),
    (error: any) => error.stderr.includes('target-symlink'),
  )
})

test('ReportData validates, freezes, caches records, and fails closed', async () => {
  const context = await starterContext()
  const registry = context.ReportData!
  const dataset = await fixture('computed-dataset.json')
  registry.register('computed-sales', dataset)
  assert.deepEqual(plain(registry.list()), ['computed-sales'])
  assert.equal(registry.has('computed-sales'), true)
  assert.equal(Object.isFrozen(registry.get('computed-sales')), true)
  assert.equal(Object.isFrozen(registry.get('computed-sales').table.rows), true)
  const records = registry.records('computed-sales')
  assert.deepEqual(plain(records), [
    { month: '2026-01-01T00:00:00', revenue: 1024.5 },
    { month: '2026-02-01T00:00:00', revenue: null },
  ])
  assert.equal(registry.records('computed-sales'), records)
  assert.equal(Object.isFrozen(records[0]), true)

  assert.throws(() => registry.register('computed-sales', dataset), /already registered/)
  const invalid = await fixture('computed-dataset.json')
  invalid.table.rows[0].push('extra')
  assert.throws(() => registry.register('computed-invalid', invalid), /dataset_id.*registered id/)
  invalid.dataset_id = 'computed-invalid'
  assert.throws(() => registry.register('computed-invalid', invalid), /exactly 2 cells/)
  assert.throws(() => registry.get('missing'), /not registered/)
})

test('ReportCharts renders accessible bounded fallbacks and details interactions without hidden quality claims', async () => {
  const context = await starterContext(true)
  const registry = context.ReportData!
  const charts = context.ReportCharts!
  const artifact = await fixture('artifact-dataset.json')
  artifact.table.columns.push({
    name: 'revenue',
    dtype: 'float64',
    artifact_dtype: 'float64',
    contains_null: false,
    nullable: false,
    role: 'measure',
  })
  artifact.table.rows[0].push(1024.5)
  registry.register('artifact-sales', artifact)
  const host = new TestElement('figure')
  host.setAttribute('aria-label', 'Monthly revenue')
  charts.renderLineChart(host, registry.get('artifact-sales'), {
    x: 'month',
    y: 'revenue',
    title: 'Monthly revenue',
    xLabel: 'Month',
    yLabel: 'Month value',
    fallback: { columns: ['month'], maxRows: 10, caption: 'Rows' },
  })
  assert.equal(host.querySelectorAll('figcaption').length, 1)
  assert.equal(host.querySelectorAll('svg').length, 1)
  assert.equal(host.querySelectorAll('table').length, 1)
  assert.equal(host.querySelector('svg')!.getAttribute('role'), 'group')
  assert.equal(host.querySelector('.chart-point')!.getAttribute('role'), 'img')
  const trigger = host.querySelector('.chart-details-trigger')!
  const popover = host.querySelector('.chart-details-popover')!
  assert.equal(trigger.getAttribute('aria-expanded'), 'false')
  assert.match(trigger.getAttribute('aria-label')!, /Monthly revenue/)
  trigger.dispatchEvent(new TestEvent('focus'))
  assert.equal(trigger.getAttribute('aria-expanded'), 'true')
  assert.equal(popover.hidden, false)
  assert.match(popover.textContent, /当前状态未检查/)
  assert.match(popover.textContent, /未提供 Artifact 质量摘要/)
  trigger.dispatchEvent(new TestEvent('keydown', { key: 'Escape' }))
  assert.equal(trigger.getAttribute('aria-expanded'), 'false')
  assert.equal(popover.hidden, true)
  trigger.dispatchEvent(new TestEvent('pointerenter'))
  assert.equal(trigger.getAttribute('aria-expanded'), 'true')
  host
    .querySelector('.chart-data-details')!
    .dispatchEvent(new TestEvent('pointerleave', { relatedTarget: null }))
  assert.equal(trigger.getAttribute('aria-expanded'), 'false')
  trigger.dispatchEvent(new TestEvent('click'))
  assert.equal(trigger.getAttribute('aria-expanded'), 'true')
  host
    .querySelector('.chart-data-details')!
    .dispatchEvent(new TestEvent('pointerleave', { relatedTarget: null }))
  assert.equal(trigger.getAttribute('aria-expanded'), 'true')
  assert.equal(popover.querySelectorAll('button').length, 1)
  trigger.dispatchEvent(new TestEvent('click'))
  assert.equal(trigger.getAttribute('aria-expanded'), 'false')

  const computed = await fixture('computed-dataset.json')
  computed.table.rows[1][1] = 900
  registry.register('computed-sales', computed)
  charts.renderLineChart(host, registry.get('computed-sales'), lineOptions())
  assert.equal(host.querySelectorAll('.chart-details-trigger').length, 1)
  assert.deepEqual(
    host.querySelectorAll('.chart-axis-tick-label').map((label) => label.textContent),
    ['2026-01-01T00:00:00', '2026-02-01T00:00:00'],
  )
  assert.doesNotMatch(host.querySelector('.chart-details-popover')!.textContent, /Artifact 质量/)
  assert.match(host.querySelector('.chart-details-popover')!.textContent, /计算结果/)

  const customHost = new TestElement('div')
  customHost.setAttribute('aria-label', 'Custom chart')
  charts.attachDataDetails(customHost, registry.get('computed-sales'))
  assert.match(
    customHost.querySelector('.chart-details-trigger')!.getAttribute('aria-label')!,
    /Custom chart/,
  )

  const barHost = new TestElement('figure')
  charts.renderBarChart(barHost, registry.get('computed-sales'), {
    category: 'month',
    value: 'revenue',
    orientation: 'horizontal',
    title: 'Revenue bars',
    fallback: { columns: ['month', 'revenue'], maxRows: 1, caption: 'Rows' },
  })
  assert.ok(barHost.querySelectorAll('rect').length > 0)
  assert.match(barHost.textContent, /另有 1 行未在此表中展示/)

  const kpiHost = new TestElement('div')
  charts.renderKpis(kpiHost, [
    { label: 'Revenue', value: '1,024', detail: 'Observed', status: 'positive' },
  ])
  assert.equal(kpiHost.querySelectorAll('.kpi').length, 1)
  assert.match(kpiHost.textContent, /状态：正向/)
  const preservedHost = new TestElement('div')
  const preservedContent = new TestElement('p')
  preservedContent.textContent = 'existing content'
  preservedHost.append(preservedContent)
  assert.throws(() =>
    charts.renderLineChart(preservedHost, registry.get('computed-sales'), {
      ...lineOptions(),
      fallback: null,
    }),
  )
  assert.equal(preservedHost.textContent, 'existing content')

  const malformed = plain(computed)
  delete malformed.source
  assert.throws(
    () => charts.renderLineChart(preservedHost, malformed, lineOptions()),
    (error: any) => error.code === 'dataset-unregistered' && error.path === '$dataset',
  )
  assert.equal(preservedHost.textContent, 'existing content')
})

test('ReportTrace validates identities and renders an accessible bounded DAG with linear fallback', async () => {
  const context = await starterContext(true)
  const registry = context.ReportTrace!
  const trace = await fixture('trace-succeeded.json')
  context.ReportData!.register('artifact-sales', await fixture('artifact-dataset.json'))
  registry.register('trace-succeeded', trace)
  assert.deepEqual(plain(registry.list()), ['trace-succeeded'])
  assert.equal(Object.isFrozen(registry.get('trace-succeeded')), true)
  const host = new TestElement('div')
  registry.renderSessionGraph(host, registry.get('trace-succeeded'))
  assert.equal(host.querySelectorAll('.trace-svg').length, 1)
  assert.equal(host.querySelectorAll('.trace-node').length, 2)
  assert.equal(host.querySelectorAll('.trace-edge').length, 1)
  assert.equal(host.querySelectorAll('.trace-component').length, 1)
  assert.equal(host.querySelectorAll('.trace-detail-panel').length, 1)
  assert.equal(host.querySelectorAll('.trace-frame-table').length, 1)
  assert.equal(host.querySelectorAll('.trace-query-panel').length, 1)
  assert.equal(host.querySelectorAll('.trace-query-code').length, 1)
  assert.equal(host.querySelectorAll('table').length, 2)
  assert.match(host.textContent, /Run 与 Artifact 关系/)
  assert.match(host.querySelector('svg')!.textContent, /成功状态不表示报告结论可信/)
  assert.equal(host.querySelector('svg')!.getAttribute('role'), 'group')
  assert.equal(host.querySelector('.trace-node')!.getAttribute('role'), 'button')
  assert.equal(host.querySelector('.trace-edge')!.getAttribute('role'), 'img')

  const bounded = await fixture('trace-succeeded.json')
  bounded.trace_id = 'trace-bounded'
  bounded.truncated = true
  bounded.boundary_artifact_refs = ['artifact-1']
  registry.register('trace-bounded', bounded)
  registry.renderSessionGraph(host, registry.get('trace-bounded'))
  assert.match(host.textContent, /有界链路/)
  assert.match(host.textContent, /semantic_authority_not_checked/)
  assert.equal(host.querySelectorAll('.trace-boundary-node').length, 1)

  const longIdentity = await fixture('trace-succeeded.json')
  const runId = 'run-1234567890-abcdefghijklmnopqrstuvwxyz'
  const artifactRef = 'artifact-1234567890-abcdefghijklmnopqrstuvwxyz'
  longIdentity.trace_id = 'trace-long-identity'
  longIdentity.report_artifact_refs = [artifactRef]
  longIdentity.artifacts[0].ref = artifactRef
  longIdentity.artifacts[0].produced_by_run = runId
  longIdentity.runs[0].run_id = runId
  longIdentity.runs[0].output_artifact_ref = artifactRef
  longIdentity.edges[0].run_id = runId
  longIdentity.edges[0].artifact_ref = artifactRef
  longIdentity.queries[0].run_id = runId
  longIdentity.queries[0].output_artifact_ref = artifactRef
  longIdentity.root_run_ids = [runId]
  longIdentity.head_artifact_refs = [artifactRef]
  registry.register('trace-long-identity', longIdentity)
  registry.renderSessionGraph(host, registry.get('trace-long-identity'))
  const edgeTable = host.querySelector('.trace-fallback')!.querySelector('table')!
  assert.doesNotMatch(edgeTable.textContent, new RegExp(runId))
  assert.doesNotMatch(edgeTable.textContent, new RegExp(artifactRef))
  assert.match(host.textContent, new RegExp(`完整 Run ID：${runId}`))
  assert.match(host.textContent, new RegExp(`完整 Artifact ref：${artifactRef}`))

  const dangling = await fixture('trace-succeeded.json')
  dangling.trace_id = 'trace-dangling'
  dangling.edges[0].run_id = 'missing'
  assert.throws(() => registry.register('trace-dangling', dangling), /dangling identity/)
})

test('example registrations conform to Slice 1 contracts and execute the shared component journey', async () => {
  const context = await starterContext(true)
  vm.runInContext(await readFile(path.join(exampleRoot, 'example.js'), 'utf8'), context)
  vm.runInContext(await readFile(path.join(exampleRoot, 'example-trace.js'), 'utf8'), context)
  const dataset = plain(context.ReportData!.get('dsh-starter-placeholder-dataset'))
  const trace = plain(context.ReportTrace!.get('dsh-starter-placeholder-trace'))
  assert.equal(validateReportContract('dataset', dataset).valid, true)
  assert.equal(validateReportContract('trace', trace).valid, true)
  const document = context.document as TestDocument
  for (const [id, tag] of [
    ['summary-kpis', 'div'],
    ['revenue-chart', 'figure'],
    ['analysis-trace', 'div'],
  ] as const) {
    const host = new TestElement(tag)
    host.id = id
    document.body.append(host)
  }
  const mountSource = await readFile(path.join(starterRoot, 'snippets', 'mount-error.js'), 'utf8')
  vm.runInContext(mountSource, context)
  vm.runInContext(await readFile(path.join(exampleRoot, 'app.js'), 'utf8'), context)
  assert.equal(document.querySelector('#summary-kpis')!.querySelectorAll('.kpi').length, 1)
  assert.equal(document.querySelector('#revenue-chart')!.querySelectorAll('.chart-svg').length, 1)
  assert.equal(document.querySelector('#analysis-trace')!.querySelectorAll('.trace-svg').length, 1)
})

test('copied components and Slice 1 fixtures form a static-checkable bundle', async (t) => {
  const workspace = await temporaryDirectory(t, 'dsh-report-starter-smoke-')
  await execute(
    process.execPath,
    [
      copyScript,
      '--target',
      'report',
      '--basic',
      '--component',
      'report-data',
      '--component',
      'report-charts',
      '--component',
      'report-trace',
    ],
    { cwd: workspace },
  )
  const root = path.join(workspace, 'report')
  await mkdir(path.join(root, 'data'), { recursive: true })
  const computed = await fixture('computed-dataset.json')
  const trace = await fixture('trace-succeeded.json')
  await writeFile(
    path.join(root, 'data', 'computed-sales.js'),
    `ReportData.register('computed-sales', ${JSON.stringify(computed)})\n`,
  )
  await writeFile(
    path.join(root, 'data', 'trace-succeeded.js'),
    `ReportTrace.register('trace-succeeded', ${JSON.stringify(trace)})\n`,
  )
  await writeFile(
    path.join(root, 'assets', 'app.js'),
    `const dataset = ReportData.get('computed-sales')
ReportCharts.renderLineChart(document.querySelector('#chart'), dataset, {
  x: 'month', y: 'revenue', title: 'Revenue', xLabel: 'Month', yLabel: 'Revenue',
  fallback: { columns: ['month', 'revenue'], maxRows: 100, caption: 'Rows' }
})
ReportTrace.renderSessionGraph(document.querySelector('#trace'), ReportTrace.get('trace-succeeded'))
`,
  )
  await writeFile(
    path.join(root, 'index.html'),
    `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Revenue report</title>
<link rel="stylesheet" href="./assets/report-base.css"></head><body><main><h1>Revenue report</h1>
<div id="chart"></div><section aria-labelledby="trace-title"><h2 id="trace-title">Trace</h2><div id="trace"></div></section>
</main><script src="./assets/report-data.js"></script><script src="./data/computed-sales.js"></script>
<script src="./assets/report-charts.js"></script><script src="./assets/report-trace.js"></script>
<script src="./data/trace-succeeded.js"></script><script src="./assets/app.js"></script></body></html>`,
  )
  const result = await checkWorkspaceReport({
    workspaceRoot: workspace,
    entryPath: 'report/index.html',
    signal: new AbortController().signal,
    now: () => new Date('2026-09-01T00:00:00Z'),
  })
  assert.equal(result.status, 'passed_static', JSON.stringify(result.issues, null, 2))
  assert.deepEqual(result.issues, [])
})
