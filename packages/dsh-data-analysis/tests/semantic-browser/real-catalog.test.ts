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
test('real Marivo 0.5.4: all 13 kinds, full definitions and relations; no data operations or project writes', async (t) => {
  const python =
    process.env.DSH_DATA_ANALYSIS_TEST_PYTHON ??
    path.join(homedir(), '.dsh/dsh-data-analysis/runtimes/marivo/.venv/bin/python')
  try {
    await access(python)
  } catch {
    t.skip('Marivo 0.5.4 Python unavailable')
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
SemanticCatalog.preview = forbidden
SemanticCatalog.readiness = forbidden
md.test = forbidden
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
  assert.deepEqual((await service.read({ workspaceId: 'a' }, signal)).objects, [])
  assert.deepEqual(await tree(root), {})
  await createBrowserWorkspace(root)
  const before = await tree(root)
  const data = await service.read({ workspaceId: 'a' }, signal)
  const cumulative = data.objects.find((x) => x.ref.path === 'sales.quarter_spend')!
  for (const [name, expression] of [
    ['sales.order_count', "t1['id'].count()"],
    ['sales.cancelled_orders', "t1['is_cancelled'].cast('int64').sum()"],
  ]) {
    const node = data.objects.find((x) => x.ref.path === name)!.computation!.node
    assert.equal(node.status, 'unsupported')
    assert.equal((node.display as { text: string }).text, expression)
  }
  assert.equal(cumulative.computation!.node.kind, 'cumulative')
  assert.deepEqual(cumulative.computation!.node.anchor, {
    kind: 'grain_to_date',
    grain: {
      kind: 'semantic',
      calendar: { schema: 'marivo.semantic_ref/v1', kind: 'period_calendar', path: 'sales.fiscal' },
      level: 'week',
    },
  })
  assert.ok(cumulative.relations.some((x) => x.ref.path === 'sales.fiscal'))
  assert.deepEqual(
    data.objects.find((x) => x.ref.path === 'sales.orders.amount')!.computation!.node.display,
    {
      language: 'python',
      form: 'normalized_ibis',
      text: 't1["amount"]',
      bindings: [
        {
          alias: 't1',
          ref: { schema: 'marivo.semantic_ref/v1', kind: 'entity', path: 'sales.orders' },
        },
      ],
      redacted_literals: false,
    },
  )
  assert.equal(
    data.objects.find((x) => x.ref.path === 'sales.orders.amount')!.computation!.node.kind,
    'expression',
  )
  assert.equal(
    (data.objects.find((x) => x.ref.path === 'sales.linear')!.computation!.node.terms as unknown[])
      .length,
    3,
  )
  assert.equal(new Set(data.objects.map((item) => item.ref.kind)).size, 13)
  const revenue = data.objects.find((item) => item.ref.path === 'sales.revenue')!
  assert.ok(revenue.definition!.length > 240)
  assert.ok(revenue.relations.some((relation) => relation.ref.kind === 'measure'))
  assert.ok(revenue.source.line > 0)
  assert.doesNotMatch(JSON.stringify(data), /DO_NOT_DISCLOSE_DATABASE_PATH/)
  assert.deepEqual(await tree(root), before)
  await writeFile(
    path.join(root, 'models/semantic/sales/objects.py'),
    'raise RuntimeError("PRIVATE")\n',
  )
  const broken = await tree(root)
  await assert.rejects(service.read({ workspaceId: 'a' }, signal), /catalog-load-failed/)
  assert.deepEqual(await tree(root), broken)
})
