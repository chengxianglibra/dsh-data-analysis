import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { bindMarivoEnvironment } from '../../src/environment/index.ts'
import { SemanticBrowserService } from '../../src/semantic-browser/service.ts'
import { createBrowserWorkspace } from './fixtures.ts'

async function tree(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name)
    if (entry.isDirectory())
      for (const [key, value] of Object.entries(await tree(file)))
        result[`${entry.name}/${key}`] = value
    else
      result[entry.name] = createHash('sha256')
        .update(await readFile(file))
        .digest('hex')
  }
  return result
}
function assertCatalogCacheOnly(before: Record<string, string>, after: Record<string, string>) {
  for (const [name, hash] of Object.entries(before)) assert.equal(after[name], hash, name)
  for (const name of Object.keys(after)) {
    if (name in before) continue
    assert.match(
      name,
      /^\.marivo\/(?:$|semantic\/(?:$|search\/(?:$|results\/(?:$|[a-f0-9]{64}\.json$))))/,
      name,
    )
  }
}
test('real Marivo 0.6.3: all 8 kinds, full definitions and relations; no data operations or authored-file changes', async (t) => {
  const python =
    process.env.DSH_DATA_ANALYSIS_TEST_PYTHON ??
    path.join(homedir(), '.dsh/dsh-data-analysis/runtimes/marivo/.venv/bin/python')
  try {
    await access(python)
  } catch {
    t.skip('Marivo 0.6.3 Python unavailable')
    return
  }
  const temp = await mkdtemp(path.join(tmpdir(), 'semantic-browser-real-')),
    root = await realpath(temp)
  t.after(() => rm(root, { recursive: true, force: true }))
  const runner = await bindMarivoEnvironment({ projectRoot: root, pythonExecutable: python })
  const guarded = {
    ...runner,
    binding: runner.binding,
    status: runner.status,
    runChecked: (request: Parameters<typeof runner.runChecked>[0]) =>
      runner.runChecked({
        ...request,
        program:
          String.raw`
import marivo.analysis as mv
import marivo.datasource as md
from marivo.analysis.session.core import Session
from marivo.semantic.catalog import SemanticCatalog
def forbidden(*args, **kwargs):
    raise AssertionError("Browser attempted a data operation")
Session.observe = forbidden
SemanticCatalog.search_original = SemanticCatalog.search
SemanticCatalog.readiness = forbidden
md.DatasourceCatalog.test = forbidden
mv.session = forbidden
` + request.program,
      }),
  }
  const service = new SemanticBrowserService({
    getWorkspace: (id) => ({ id, path: root }),
    projectRoot: () => root,
    resolve: async () => guarded,
  })
  t.after(() => service.dispose())
  const signal = new AbortController().signal
  assert.deepEqual(
    (await service.read({ workspaceId: 'a' }, signal)).objects.map((item) => item.ref),
    [{ schema: 'marivo.semantic_ref/v1', kind: 'datasource', path: 'default' }],
  )
  assertCatalogCacheOnly({}, await tree(root))
  await createBrowserWorkspace(root)
  const before = await tree(root)
  const data = await service.read({ workspaceId: 'a' }, signal)
  const revenueDefinition = data.objects.find((item) => item.ref.path === 'sales.revenue')!
    .computation!
  assert.match(revenueDefinition.expression, /sum/)
  assert.ok(
    revenueDefinition.facts.some(
      (item) => item.name === 'time_bindings' && item.value.includes('ordered_at'),
    ),
  )
  assert.ok(revenueDefinition.facts.some((item) => item.name === 'null_rules'))
  const template = data.objects.find((item) => item.ref.path === 'sales.revenue_at')!
  assert.ok(
    template.computation!.facts.some(
      (item) => item.name === 'time_bindings' && item.value.includes('entity_default'),
    ),
  )
  assert.ok(revenueDefinition.facts.some((item) => item.structured))
  assert.ok(data.objects.some((item) => item.fields.some((field) => field.structured)))
  assert.match(
    data.objects.find((item) => item.ref.path === 'sales.orders.amount')!.computation!.expression,
    /amount/,
  )
  assert.ok(
    data.objects
      .find((item) => item.ref.path === 'sales.linear')!
      .relations.some((item) => item.ref.path === 'sales.revenue'),
  )
  assert.equal(new Set(data.objects.map((item) => item.ref.kind)).size, 8)
  const orders = data.objects.find((item) => item.ref.path === 'sales.orders')!
  assert.equal(
    orders.fields.find((field) => field.name === 'default_time')?.value,
    'time_dimension:sales.orders.ordered_at',
  )
  assert.ok(
    orders.relations.some(
      (item) => item.field === 'default_time' && item.ref.path === 'sales.orders.ordered_at',
    ),
  )
  const revenue = data.objects.find((item) => item.ref.path === 'sales.revenue')!
  assert.ok(revenue.definition!.length > 240)
  assert.ok(revenue.relations.some((relation) => relation.ref.kind === 'measure'))
  assert.ok(
    revenue.relations.some(
      (relation) =>
        relation.field === 'time_bindings' && relation.ref.path === 'sales.orders.ordered_at',
    ),
  )
  assert.ok(revenue.source.line > 0)
  assert.doesNotMatch(JSON.stringify(data), /DO_NOT_DISCLOSE_DATABASE_PATH/)
  assertCatalogCacheOnly(before, await tree(root))
  await writeFile(
    path.join(root, 'models/semantic/sales/objects.py'),
    'raise RuntimeError("PRIVATE")\n',
  )
  const broken = await tree(root)
  await assert.rejects(
    service.read({ workspaceId: 'a' }, signal),
    /\[organization_error\][\s\S]*PRIVATE/,
  )
  assert.deepEqual(await tree(root), broken)
})
