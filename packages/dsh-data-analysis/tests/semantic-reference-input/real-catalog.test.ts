import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { bindMarivoEnvironment } from '../../src/environment/index.ts'
import { SemanticReferenceBridge } from '../../src/semantic-reference/bridge.ts'
import { search } from '../../src/semantic-reference/search.ts'
import { createSemanticWorkspace } from './workspace.ts'

const python =
  process.env.DSH_DATA_ANALYSIS_TEST_PYTHON ??
  path.join(homedir(), '.dsh/dsh-data-analysis/runtimes/marivo/.venv/bin/python')
async function tree(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  const visit = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name),
        relative = path.relative(root, full)
      if (entry.isDirectory()) {
        result[`${relative}/`] = ''
        await visit(full)
      } else
        result[relative] = createHash('sha256')
          .update(await readFile(full))
          .digest('hex')
    }
  }
  await visit(root)
  return result
}
test('real Marivo 0.5.4: empty, large and failed Catalog reads create no Workspace files', async (t) => {
  try {
    await access(python)
  } catch {
    t.skip('Marivo Python missing; set DSH_DATA_ANALYSIS_TEST_PYTHON')
    return
  }
  const root = await mkdtemp(path.join(tmpdir(), 'semantic-real-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const environment = { ...process.env }
  delete environment.MARIVO_TELEMETRY
  delete environment.PYTHONDONTWRITEBYTECODE
  const runner = await bindMarivoEnvironment(
    { projectRoot: root, pythonExecutable: python },
    { environment },
  )
  assert.equal(runner.binding.marivoVersion, '0.5.4')
  let now = 0
  const bridge = new SemanticReferenceBridge(() => now),
    signal = new AbortController().signal
  assert.deepEqual((await bridge.candidates(runner, signal)).items, [])
  assert.deepEqual(await tree(root), {})
  await createSemanticWorkspace(root)
  const before = await tree(root)
  now = 30_000
  const catalog = await bridge.candidates(runner, signal)
  assert.ok(catalog.items.length > 100)
  assert.equal(search(catalog, '').length, catalog.items.length)
  assert.ok(search(catalog, '指标').some((item) => item.refKey === 'metric:sales.revenue'))
  assert.ok(new Set(catalog.items.map((item) => item.ref.kind)).size >= 4)
  const metric = catalog.items.find((item) => item.refKey === 'metric:sales.revenue')!
  assert.equal(metric.ref.schema, 'marivo.semantic_ref/v1')
  assert.equal(Array.from(metric.businessDefinition!).length, 240)
  assert.ok(metric.businessDefinition!.includes('收入'))
  assert.deepEqual(await tree(root), before)
  await writeFile(
    path.join(root, 'models', 'semantic', 'sales', 'datasets.py'),
    'raise RuntimeError("intentional failed load")\n',
  )
  const failedBefore = await tree(root)
  now = 60_000
  await assert.rejects(bridge.candidates(runner, signal))
  assert.deepEqual(await tree(root), failedBefore)
  bridge.dispose()
})
