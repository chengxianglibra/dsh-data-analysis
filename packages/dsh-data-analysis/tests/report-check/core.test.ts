import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { REPORT_CHECK_RULES, reportContractRoot } from '../../src/report-check/contracts.ts'
import { checkWorkspaceReport } from '../../src/report-check/workspace.ts'

const VALID_HEAD = [
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<title>Fixture report</title>',
  '<style>:focus-visible { outline: 2px solid blue; }</style>',
].join('')

function html(body: string, head = VALID_HEAD): string {
  return `<!doctype html><html lang="en"><head>${head}</head><body><main><h1>Fixture</h1>${body}</main></body></html>`
}

async function workspace(t: test.TestContext): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-report-check-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

async function check(root: string, limits: Record<string, number> = {}) {
  return checkWorkspaceReport({
    workspaceRoot: root,
    entryPath: 'index.html',
    signal: new AbortController().signal,
    now: () => new Date('2026-08-31T00:00:00Z'),
    limits,
  })
}

function codes(result: Awaited<ReturnType<typeof check>>): Set<string> {
  return new Set(result.issues.map((issue) => issue.code))
}

test('minimal local HTML bundle passes static checks without claiming wider validation', async (t) => {
  const root = await workspace(t)
  await writeFile(path.join(root, 'index.html'), html('<p>Local report.</p>'))
  const result = await check(root)
  assert.equal(result.status, 'passed_static')
  assert.deepEqual(result.coverage, {
    static: 'complete',
    external: 'none_observed',
    browser: 'not_run',
    visual: 'not_run',
    analysis: 'not_checked',
  })
  assert.equal(result.entry_path, 'index.html')
  assert.equal(result.bundle_root, '.')
  assert.equal(result.summary.files_checked, 1)
  assert.deepEqual(result.issues, [])
})

test('document, accessibility, security, and Starter rules report stable codes and locations', async (t) => {
  const root = await workspace(t)
  const source = `<!doctype html><html><head><base href="/"><title></title></head><body>
  <main id="same"><h1></h1><h3>Jump</h3><a href="#missing"></a>
  <img src="data:text/html,unsafe"><input id="password"><button></button>
  <table><tr><td>x</td></tr></table><figure><svg></svg></figure>
  <div id="same" aria-describedby="unknown" tabindex="2" data-status="bad"></div>
  <video autoplay></video><meta name="dsh-report-starter" content="unresolved">
  <script src=""></script></main></body></html>`
  await writeFile(path.join(root, 'index.html'), source)
  const result = await check(root)
  const actual = codes(result)
  for (const expected of [
    'html.lang-missing',
    'html.title-invalid',
    'html.viewport-missing',
    'html.duplicate-id',
    'html.fragment-target-missing',
    'html.aria-reference-missing',
    'html.element-attributes-invalid',
    'html.base-element-forbidden',
    'resource.data-url-kind-forbidden',
    'a11y.image-alt-invalid',
    'a11y.control-name-missing',
    'a11y.table-caption-missing',
    'a11y.table-header-missing',
    'a11y.svg-name-missing',
    'a11y.heading-order-invalid',
    'a11y.h1-invalid',
    'a11y.positive-tabindex',
    'a11y.autoplay-enabled',
    'a11y.color-only-state',
    'security.secret-like-name',
    'starter.placeholder-unresolved',
  ]) {
    assert.ok(actual.has(expected), `missing ${expected}: ${JSON.stringify(result.issues)}`)
  }
  assert.equal(actual.has('a11y.figure-caption-missing'), false)
  assert.equal(result.status, 'failed_static')
  assert.ok(result.issues.every((issue) => !issue.path.startsWith('/')))
})

test('an unclosed HTML attribute quote is located at the opening quote', async (t) => {
  const root = await workspace(t)
  await writeFile(
    path.join(root, 'index.html'),
    '<!doctype html>\n<html lang="en"><head><meta name="viewport" content="width=device-width"><title>x</title></head><body><main><h1>x</h1>\n<div class="d down>broken</div>\n</main></body></html>',
  )
  const result = await check(root)
  const issue = result.issues.find((candidate) => candidate.code === 'html.parse-error')
  assert.deepEqual(
    issue === undefined ? null : { path: issue.path, line: issue.line, column: issue.column },
    { path: 'index.html', line: 3, column: 12 },
  )
})

test('parser and recursive resource graph rules stay bundle-local and expose external coverage', async (t) => {
  const root = await workspace(t)
  const outside = await mkdtemp(path.join(tmpdir(), 'dsh-report-outside-'))
  t.after(() => rm(outside, { recursive: true, force: true }))
  await mkdir(path.join(root, 'assets'))
  await mkdir(path.join(root, 'directory'))
  await writeFile(path.join(outside, 'outside.js'), 'globalThis.outside = true')
  await symlink(path.join(outside, 'outside.js'), path.join(root, 'assets', 'escape.js'))
  await writeFile(
    path.join(root, 'assets', 'bad.css'),
    '@import "missing.css"; a:hover{display:block} x{background:url(https://example.com/a.png);transition:1s}',
  )
  await writeFile(path.join(root, 'assets', 'syntax.css'), 'x{color:red')
  await writeFile(path.join(root, 'assets', 'bad.js'), 'fetch("/dynamic");')
  await writeFile(path.join(root, 'assets', 'syntax.js'), 'export {')
  await writeFile(path.join(root, 'assets', 'bad.json'), '{"x": NaN}')
  await writeFile(path.join(root, 'assets', 'bad.svg'), '<svg><title>x</svg>')
  await writeFile(path.join(root, 'assets', 'unknown.xyz'), 'x')
  await writeFile(
    path.join(root, 'index.html'),
    html(`
      <link rel="stylesheet" href="assets/bad.css">
      <link rel="stylesheet" href="assets/syntax.css">
      <script type="module" src="assets/bad.js"></script><script type="module" src="assets/syntax.js"></script>
      <a href="https://example.com">external</a><a href="mailto:x@example.com">mail</a>
      <a href="file:///tmp/no">file</a><a href="../outside.html">outside</a>
      <object data="assets/bad.json"></object><img alt="x" src="assets/bad.svg">
      <object data="assets/unknown.xyz"></object><object data="directory"></object>
      <script src="assets/escape.js"></script>
    `),
  )
  const result = await check(root)
  const actual = codes(result)
  for (const expected of [
    'resource.missing',
    'resource.not-regular-file',
    'resource.type-unsupported',
    'resource.outside-bundle',
    'resource.file-url-forbidden',
    'resource.external-dependency-unchecked',
    'resource.external-navigation-unchecked',
    'resource.external-action-unchecked',
    'resource.dynamic-network-unchecked',
    'css.parse-error',
    'javascript.parse-error',
    'json.parse-error',
    'svg.parse-error',
    'a11y.hover-only-content',
    'a11y.reduced-motion-missing',
  ]) {
    assert.ok(actual.has(expected), `missing ${expected}: ${JSON.stringify(result.issues)}`)
  }
  assert.equal(result.coverage.external, 'not_checked')
  assert.ok(result.issues.some((issue) => issue.message.includes('symlink escapes')))
})

test('resource tokenizers preserve CSS and srcset URLs while data URLs stay context-bound', async (t) => {
  const root = await workspace(t)
  await writeFile(
    path.join(root, 'style.css'),
    'x{background-image:url(missing-a.png),url(missing-b.png)}',
  )
  await writeFile(
    path.join(root, 'index.html'),
    html(`
      <link rel="stylesheet" href="style.css">
      <link rel="preload" as="font" href="https://example.com/font.woff2">
      <img alt="allowed" srcset="data:image/png;base64,AAAA 1x">
      <script src="data:image/png;base64,AAAA"></script>
    `),
  )
  const result = await check(root)
  const missing = result.issues
    .filter((issue) => issue.code === 'resource.missing')
    .map((issue) => issue.message)
  assert.ok(missing.some((message) => message.includes('missing-a.png')))
  assert.ok(missing.some((message) => message.includes('missing-b.png')))
  assert.ok(!missing.some((message) => message.includes('AAAA')))
  assert.equal(
    result.issues.filter((issue) => issue.code === 'resource.data-url-kind-forbidden').length,
    1,
  )
  assert.ok(codes(result).has('resource.external-dependency-unchecked'))
  assert.ok(!codes(result).has('resource.external-navigation-unchecked'))
})

test('non-literal dynamic imports and resource assignments disclose unchecked network coverage', async (t) => {
  const root = await workspace(t)
  await writeFile(
    path.join(root, 'index.html'),
    html(`<script type="module">
      const name = "chunk";
      import("./" + name + ".js");
      const script = document.createElement("script");
      script.src = globalThis.dynamicScriptUrl;
    </script>`),
  )
  const result = await check(root)
  assert.equal(result.status, 'passed_static')
  assert.equal(result.coverage.external, 'not_checked')
  assert.ok(codes(result).has('resource.dynamic-network-unchecked'))
})

test('dataset and trace registrations enforce provider order, schema, identity, uniqueness, and reads', async (t) => {
  const root = await workspace(t)
  const fixtureRoot = reportContractRoot()
  const computed = JSON.parse(
    await readFile(new URL('fixtures/computed-dataset.json', fixtureRoot), 'utf8'),
  )
  const artifact = JSON.parse(
    await readFile(new URL('fixtures/artifact-dataset.json', fixtureRoot), 'utf8'),
  )
  const trace = JSON.parse(
    await readFile(new URL('fixtures/trace-succeeded.json', fixtureRoot), 'utf8'),
  )
  await writeFile(path.join(root, 'report-data.js'), 'globalThis.ReportData = {};')
  await writeFile(path.join(root, 'report-trace.js'), 'globalThis.ReportTrace = {};')
  await writeFile(
    path.join(root, 'computed.js'),
    `ReportData.register("computed-sales", ${JSON.stringify(computed)});`,
  )
  await writeFile(
    path.join(root, 'artifact.js'),
    `ReportData.register("artifact-sales", ${JSON.stringify(artifact)});`,
  )
  await writeFile(
    path.join(root, 'trace.js'),
    `ReportTrace.register("trace-succeeded", ${JSON.stringify(trace)});`,
  )
  await writeFile(
    path.join(root, 'app.js'),
    'ReportData.get("computed-sales"); ReportTrace.get("trace-succeeded");',
  )
  await writeFile(
    path.join(root, 'index.html'),
    html(`
      <script src="report-data.js"></script><script src="computed.js"></script>
      <script src="artifact.js"></script><script src="report-trace.js"></script>
      <script src="trace.js"></script><script src="app.js"></script>
    `),
  )
  const healthy = await check(root)
  assert.equal(healthy.status, 'passed_static', JSON.stringify(healthy.issues))

  await writeFile(
    path.join(root, 'app.js'),
    'ReportData.register("computed-sales", {}); ReportData.get("missing"); ReportTrace.get("missing");',
  )
  const broken = await check(root)
  const actual = codes(broken)
  assert.ok(actual.has('dataset.schema-invalid'))
  assert.ok(actual.has('dataset.unregistered-read'))
  assert.ok(actual.has('trace.unregistered-read'))

  await writeFile(
    path.join(root, 'index.html'),
    html(
      '<script src="computed.js"></script><script src="report-data.js"></script><script src="computed.js"></script>',
    ),
  )
  const order = await check(root)
  assert.ok(codes(order).has('dataset.registry-order-invalid'))
  assert.ok(codes(order).has('dataset.duplicate-id'))
})

test('Artifact datasets without a valid trace warn while warning-only output still passes', async (t) => {
  const root = await workspace(t)
  const artifact = JSON.parse(
    await readFile(new URL('fixtures/artifact-dataset.json', reportContractRoot()), 'utf8'),
  )
  await writeFile(path.join(root, 'report-data.js'), 'globalThis.ReportData = {};')
  await writeFile(
    path.join(root, 'artifact.js'),
    `ReportData.register("artifact-sales", ${JSON.stringify(artifact)});`,
  )
  await writeFile(
    path.join(root, 'index.html'),
    html('<script src="report-data.js"></script><script src="artifact.js"></script>'),
  )
  const result = await check(root)
  assert.equal(result.status, 'passed_static')
  assert.equal(result.summary.errors, 0)
  assert.ok(codes(result).has('trace.missing-for-artifact-report'))
})

test('Session traces require Frame previews and SQL for produced observe Runs', async (t) => {
  const root = await workspace(t)
  const fixtureRoot = reportContractRoot()
  const artifact = JSON.parse(
    await readFile(new URL('fixtures/artifact-dataset.json', fixtureRoot), 'utf8'),
  )
  const trace = JSON.parse(
    await readFile(new URL('fixtures/trace-succeeded.json', fixtureRoot), 'utf8'),
  )
  await writeFile(path.join(root, 'report-data.js'), 'globalThis.ReportData = {};')
  await writeFile(path.join(root, 'report-trace.js'), 'globalThis.ReportTrace = {};')
  await writeFile(
    path.join(root, 'trace.js'),
    `ReportTrace.register("trace-succeeded", ${JSON.stringify(trace)});`,
  )
  await writeFile(
    path.join(root, 'index.html'),
    html(
      '<script src="report-data.js"></script><script src="report-trace.js"></script><script src="trace.js"></script>',
    ),
  )

  const missingPreview = await check(root)
  assert.equal(missingPreview.status, 'failed_static')
  assert.ok(codes(missingPreview).has('trace.artifact-preview-missing'))
  assert.equal(codes(missingPreview).has('trace.observe-query-missing'), false)

  trace.queries = []
  await writeFile(
    path.join(root, 'artifact.js'),
    `ReportData.register("artifact-sales", ${JSON.stringify(artifact)});`,
  )
  await writeFile(
    path.join(root, 'trace.js'),
    `ReportTrace.register("trace-succeeded", ${JSON.stringify(trace)});`,
  )
  await writeFile(
    path.join(root, 'index.html'),
    html(
      '<script src="report-data.js"></script><script src="artifact.js"></script><script src="report-trace.js"></script><script src="trace.js"></script>',
    ),
  )

  const missingQuery = await check(root)
  assert.equal(missingQuery.status, 'failed_static')
  assert.equal(codes(missingQuery).has('trace.artifact-preview-missing'), false)
  assert.ok(codes(missingQuery).has('trace.observe-query-missing'))
})

test('budgets mark static coverage incomplete and diagnostic truncation is deterministic', async (t) => {
  const root = await workspace(t)
  await writeFile(
    path.join(root, 'index.html'),
    html(
      Array.from({ length: 8 }, (_, index) => `<script src="missing-${index}.js"></script>`).join(
        '',
      ),
    ),
  )
  const truncated = await check(root, { maxIssues: 3 })
  assert.equal(truncated.issues.length, 3)
  assert.equal(truncated.issues[2]?.code, 'budget.issue-count-truncated')
  assert.equal(truncated.omitted_issue_count, 6)

  const fileBudget = await check(root, { maxFiles: 1 })
  assert.equal(fileBudget.coverage.static, 'incomplete')
  assert.ok(codes(fileBudget).has('budget.file-count-exceeded'))

  const textBudget = await check(root, { maxTextFileBytes: 8 })
  assert.equal(textBudget.coverage.static, 'incomplete')
  assert.ok(codes(textBudget).has('budget.text-file-bytes-exceeded'))
})

test('checker never mutates report bytes or timestamps and observes pre-cancelled calls', async (t) => {
  const root = await workspace(t)
  const entry = path.join(root, 'index.html')
  await writeFile(entry, html('<p>immutable</p>'))
  const beforeBytes = await readFile(entry)
  const before = await stat(entry)
  await check(root)
  assert.deepEqual(await readFile(entry), beforeBytes)
  assert.equal((await stat(entry)).mtimeMs, before.mtimeMs)

  const controller = new AbortController()
  controller.abort(new Error('fixture cancel'))
  await assert.rejects(
    () =>
      checkWorkspaceReport({
        workspaceRoot: root,
        entryPath: 'index.html',
        signal: controller.signal,
      }),
    { code: 'aborted' },
  )
})

test('every registered V1 rule has an executable positive fixture and the healthy fixture is negative', async (t) => {
  const root = await workspace(t)
  const observed = new Set<string>()
  const run = async (
    name: string,
    source: string,
    files: Record<string, string | Uint8Array> = {},
    limits: Record<string, number> = {},
  ) => {
    const scenario = path.join(root, name)
    await mkdir(scenario, { recursive: true })
    await writeFile(path.join(scenario, 'index.html'), source)
    for (const [filename, content] of Object.entries(files)) {
      const target = path.join(scenario, filename)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, content)
    }
    const result = await checkWorkspaceReport({
      workspaceRoot: root,
      entryPath: `${name}/index.html`,
      signal: new AbortController().signal,
      limits,
    })
    for (const issue of result.issues) observed.add(issue.code)
    return result
  }

  const healthy = await run('healthy', html('<p>healthy</p>'))
  assert.deepEqual(healthy.issues, [])

  await run(
    'document',
    `<html><head><title></title><base href="/"></head><body>
      <h1></h1><h3>jump</h3><a href="javascript:alert(1)"></a><a href="#missing">x</a>
      <main id="same"><img src="data:text/html,x"><input id="private-key">
      <table><tr><th>x</th></tr></table><table><tr><td>x</td></tr></table><figure><svg></svg></figure>
      <div id="same" aria-labelledby="missing" tabindex="1" data-status="bad"></div>
      <span data-status="color-only"></span>
      <video autoplay></video><meta name="dsh-report-starter" content="unresolved">
      <script src=""></script></main><div role="main"></div></body></html>`,
  )

  const outside = await mkdtemp(path.join(tmpdir(), 'dsh-report-rule-outside-'))
  t.after(() => rm(outside, { recursive: true, force: true }))
  await writeFile(path.join(outside, 'escape.js'), 'globalThis.escape = true')
  const resources = path.join(root, 'resources')
  await mkdir(path.join(resources, 'directory'), { recursive: true })
  await symlink(path.join(outside, 'escape.js'), path.join(resources, 'escape.js'))
  await run(
    'resources',
    html(`
      <link rel="stylesheet" href="valid.css"><link rel="stylesheet" href="syntax.css">
      <script type="module" src="network.js"></script><script type="module" src="syntax.js"></script>
      <a href="https://example.com">web</a><a href="mailto:x@example.com">mail</a>
      <a href="file:///tmp/x">file</a><a href="../outside.html">outside</a>
      <img alt="x" src="data:image/png;base64,AAAA"><img alt="x" src="bad.svg">
      <object data="bad.json"></object><object data="unknown.xyz"></object>
      <object data="directory"></object><script src="escape.js"></script>
    `),
    {
      'valid.css':
        '@import "missing.css"; a:hover{display:block} x{background:url(https://example.com/x.png);transition:1s}',
      'syntax.css': 'x{color:red',
      'network.js': 'fetch("/runtime");',
      'syntax.js': 'export {',
      'bad.json': '{"value": NaN}',
      'bad.svg': '<svg><title>x</svg>',
      'unknown.xyz': 'x',
    },
    { maxDataUrlBytes: 1 },
  )

  const computed = JSON.parse(
    await readFile(new URL('fixtures/computed-dataset.json', reportContractRoot()), 'utf8'),
  )
  const trace = JSON.parse(
    await readFile(new URL('fixtures/trace-succeeded.json', reportContractRoot()), 'utf8'),
  )
  const danglingTrace = structuredClone(trace)
  danglingTrace.trace_id = 'trace-dangling'
  danglingTrace.edges[0].artifact_ref = 'missing-artifact'
  await run(
    'registries',
    html(`
      <script src="dataset.js"></script><script src="report-data.js"></script>
      <script src="dataset.js"></script><script src="bad-dataset.js"></script><script src="data-read.js"></script>
      <script src="trace.js"></script><script src="report-trace.js"></script>
      <script src="trace.js"></script><script src="bad-trace.js"></script>
      <script src="invalid-trace.js"></script><script src="trace-read.js"></script>
    `),
    {
      'report-data.js': 'globalThis.ReportData = {};',
      'report-trace.js': 'globalThis.ReportTrace = {};',
      'dataset.js': `ReportData.register("computed-sales", ${JSON.stringify(computed)});`,
      'bad-dataset.js': 'ReportData.register("bad", {});',
      'data-read.js': 'ReportData.get("missing");',
      'trace.js': `ReportTrace.register("trace-succeeded", ${JSON.stringify(trace)});`,
      'bad-trace.js': `ReportTrace.register("trace-dangling", ${JSON.stringify(danglingTrace)});`,
      'invalid-trace.js': 'ReportTrace.register("invalid", {});',
      'trace-read.js': 'ReportTrace.get("missing");',
    },
  )

  const artifact = JSON.parse(
    await readFile(new URL('fixtures/artifact-dataset.json', reportContractRoot()), 'utf8'),
  )
  await run(
    'artifact-no-trace',
    html('<script src="report-data.js"></script><script src="artifact.js"></script>'),
    {
      'report-data.js': 'globalThis.ReportData = {};',
      'artifact.js': `ReportData.register("artifact-sales", ${JSON.stringify(artifact)});`,
    },
  )

  const missingQueryTrace = structuredClone(trace)
  missingQueryTrace.trace_id = 'trace-missing-query'
  missingQueryTrace.queries = []
  await run(
    'trace-missing-query',
    html(
      '<script src="report-data.js"></script><script src="artifact.js"></script><script src="report-trace.js"></script><script src="trace.js"></script>',
    ),
    {
      'report-data.js': 'globalThis.ReportData = {};',
      'artifact.js': `ReportData.register("artifact-sales", ${JSON.stringify(artifact)});`,
      'report-trace.js': 'globalThis.ReportTrace = {};',
      'trace.js': `ReportTrace.register("trace-missing-query", ${JSON.stringify(missingQueryTrace)});`,
    },
  )

  const manyMissing = html(
    Array.from({ length: 8 }, (_, index) => `<script src="missing-${index}.js"></script>`).join(''),
  )
  await run('issue-budget', manyMissing, {}, { maxIssues: 2 })
  await run('file-budget', manyMissing, {}, { maxFiles: 1 })
  await run(
    'depth-budget',
    html('<link rel="stylesheet" href="style.css">'),
    { 'style.css': 'x{}' },
    { maxDepth: 0 },
  )
  await run('text-budget', html('<p>large</p>'), {}, { maxTextFileBytes: 8 })
  const totalHtml = html('<link rel="stylesheet" href="style.css">')
  await run(
    'total-budget',
    totalHtml,
    { 'style.css': 'x{}'.repeat(20) },
    { maxTextFileBytes: 10_000, maxTotalTextBytes: Buffer.byteLength(totalHtml) + 1 },
  )

  const missing = REPORT_CHECK_RULES.map((rule) => rule.code).filter((code) => !observed.has(code))
  assert.deepEqual(missing, [], `rules without a positive fixture: ${missing.join(', ')}`)
})
