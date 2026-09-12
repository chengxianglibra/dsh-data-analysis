import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { CHART_TYPES } from '../../src/presentation/contracts/charts.ts'
import {
  type PresentationDraft,
  parsePresentationDocument,
  parsePresentationDraft,
  parseTypedDataset,
} from '../../src/presentation/contracts/index.ts'

const packageRoot = fileURLToPath(new URL('../../', import.meta.url))
const skillRoot = path.join(packageRoot, 'skills', 'dsh-data-analysis-presentation')
const examplesRoot = path.join(skillRoot, 'references', 'examples')

async function files(root: string): Promise<string[]> {
  return (
    await Promise.all(
      (
        await readdir(root, { withFileTypes: true })
      ).map(async (entry) => {
        const target = path.join(root, entry.name)
        return entry.isDirectory() ? files(target) : [target]
      }),
    )
  ).flat()
}

async function drafts(): Promise<PresentationDraft[]> {
  return Promise.all(
    (await files(examplesRoot))
      .filter((file) => file.endsWith('.draft.json'))
      .map(async (file) => parsePresentationDraft(JSON.parse(await readFile(file, 'utf8')))),
  )
}

async function computedExample(relativePath: string) {
  assert.equal(path.dirname(relativePath), 'presentation-example')
  return parseTypedDataset(
    JSON.parse(await readFile(path.join(examplesRoot, path.basename(relativePath)), 'utf8')),
  )
}

for (const skillName of ['dsh-data-analysis-presentation', 'dsh-data-analysis-files']) {
  test(`${skillName} resources are reachable within the shipped folder and stay bounded`, async () => {
    const skillRoot = path.join(packageRoot, 'skills', skillName)
    const entrypoint = path.join(skillRoot, 'SKILL.md')
    const allFiles = (await files(skillRoot)).sort()
    const visited = new Set<string>()
    const pending = [entrypoint]
    let totalBytes = 0
    while (pending.length > 0) {
      const file = pending.pop()!
      if (visited.has(file)) continue
      visited.add(file)
      const actual = await realpath(file)
      assert.ok(actual.startsWith(`${skillRoot}${path.sep}`), `${file} leaves the shipped Skill`)
      const content = await readFile(file, 'utf8')
      const size = Buffer.byteLength(content)
      totalBytes += size
      assert.ok(
        size <= (file === entrypoint ? 6 * 1024 : 16 * 1024),
        `${file} needs disclosure split`,
      )
      if (!file.endsWith('.md')) continue
      for (const link of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
        const href = link[1]!.split('#')[0]!
        if (/^https:\/\//.test(href)) {
          assert.equal(
            new URL(href).hostname,
            'github.com',
            'Only the upstream Host contract is external',
          )
          continue
        }
        assert.ok(href && !path.isAbsolute(href) && !/^\w+:/.test(href), href)
        pending.push(path.resolve(path.dirname(file), href))
      }
    }
    assert.deepEqual([...visited].sort(), allFiles, 'Every shipped resource must be discoverable')
    assert.ok(totalBytes <= 80 * 1024, 'Keep the complete Skill and 18-chart examples bounded')
  })
}

test('all presentation draft examples validate with production draft and document parsers', async () => {
  const examples = await drafts()
  const artifactFixture = parsePresentationDocument(
    JSON.parse(
      await readFile(
        path.join(packageRoot, 'tests', 'presentation-s0', 'fixtures', 'artifact.document.json'),
        'utf8',
      ),
    ),
  )
  for (const draft of examples) {
    // Source identities in tutorials are placeholders. This checks generated shape and field
    // selections against typed data; it does not claim a live Artifact recovery.
    parsePresentationDocument({
      schemaVersion: 3,
      locale: 'zh-CN',
      workspaceId: 'skill-example-workspace',
      reportId: 'report',
      buildId: 'skill-example-build',
      title: draft.title,
      generatedAt: '2026-09-07T00:00:00Z',
      sources: draft.sources.map((source) =>
        draft.datasets.some((dataset) => dataset.kind === 'artifact')
          ? { ...source, status: 'available', label: 'Example source shape', facts: [] }
          : {
              ...source,
              status: 'unavailable',
              reason: 'Tutorial identity has not been resolved.',
            },
      ),
      datasets: await Promise.all(
        draft.datasets.map(async (dataset) => ({
          id: dataset.id,
          origin: dataset.kind,
          data:
            dataset.kind === 'computed'
              ? await computedExample(dataset.path)
              : artifactFixture.datasets[0]!.data,
          sourceIds: dataset.kind === 'computed' ? dataset.sourceIds : [dataset.sourceId],
        })),
      ),
      blocks: draft.blocks,
      ...(draft.interaction ? { interaction: draft.interaction } : {}),
      diagnostics: [],
    })
  }
  assert.deepEqual(
    new Set(examples.flatMap((draft) => draft.blocks.map((block) => block.kind))),
    new Set(['markdown', 'metric', 'chart', 'table', 'source']),
  )
  assert.deepEqual(
    new Set(
      examples.flatMap((draft) =>
        draft.blocks.flatMap((block) => (block.kind === 'chart' ? [block.chart] : [])),
      ),
    ),
    new Set(CHART_TYPES),
  )
  assert.ok(examples.some((draft) => draft.datasets.length === 0 && draft.sources.length > 0))
  for (const sourceCount of [0, 2]) {
    assert.ok(
      examples.some((draft) =>
        draft.datasets.some(
          (dataset) => dataset.kind === 'computed' && dataset.sourceIds.length === sourceCount,
        ),
      ),
    )
  }
})

test('runnable Python examples write the documented typed data at every draft computed path', async (t) => {
  const workspace = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-presentation-skill-')))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const receipts = new Map<string, Record<string, unknown>>()
  for (const script of (await files(examplesRoot)).filter((file) => file.endsWith('.py'))) {
    const result = spawnSync(
      'uv',
      [
        'run',
        '--project',
        path.join(packageRoot, 'python', 'presentation-kit'),
        '--frozen',
        'python',
        script,
      ],
      { cwd: workspace, encoding: 'utf8', timeout: 60_000 },
    )
    if (result.error) throw result.error
    assert.equal(result.status, 0, result.stderr || result.stdout)
    const output = JSON.parse(result.stdout)
    for (const receipt of Array.isArray(output) ? output : [output]) {
      assert.equal(receipts.has(receipt.path), false, `Duplicate output: ${receipt.path}`)
      receipts.set(receipt.path, receipt)
    }
  }
  const paths = new Set(
    (await drafts()).flatMap((draft) =>
      draft.datasets.flatMap((dataset) => (dataset.kind === 'computed' ? [dataset.path] : [])),
    ),
  )
  assert.ok(paths.size > 0)
  for (const relativePath of paths) {
    const outputPath = path.join(workspace, relativePath)
    const raw = await readFile(outputPath, 'utf8')
    const actual = parseTypedDataset(JSON.parse(raw))
    assert.deepEqual(actual, await computedExample(relativePath))
    const receipt = receipts.get(outputPath)
    assert.ok(receipt, `No writer receipt for ${relativePath}`)
    assert.equal(receipt.path, outputPath)
    assert.equal(receipt.bytes, Buffer.byteLength(raw))
    assert.equal(receipt.row_count, actual.rowCount)
    assert.equal(receipt.written_rows, actual.rows.length)
    assert.equal(receipt.limit, actual.limit)
    assert.equal(receipt.truncated, actual.truncated)
  }
  assert.equal(receipts.size, paths.size)
})

test('the comparison example reconciles selected decreases with the full baseline and other net change', async () => {
  const full = await computedExample('presentation-example/comparison.dataset.json')
  const selected = await computedExample('presentation-example/comparison-selected.dataset.json')
  const summary = await computedExample('presentation-example/comparison-summary.dataset.json')
  const draft = parsePresentationDraft(
    JSON.parse(await readFile(path.join(examplesRoot, 'comparison.draft.json'), 'utf8')),
  )
  const values = (data: typeof full, columnId: string) => {
    const index = data.columns.findIndex((column) => column.id === columnId)
    assert.notEqual(index, -1, columnId)
    return data.rows.map((row) => Number(row[index]))
  }
  const sum = (numbers: number[]) => numbers.reduce((total, number) => total + number, 0)
  const baseline = values(full, 'baseline')
  const current = values(full, 'current')
  const delta = values(full, 'delta_current_minus_baseline')
  assert.deepEqual(baseline, [100, 80, 20])
  assert.deepEqual(current, [50, 50, 50])
  assert.deepEqual(
    delta,
    current.map((value, index) => value - baseline[index]!),
  )
  assert.equal(sum(delta), -50)
  assert.equal(sum(delta) / sum(baseline), -0.25)

  assert.equal(selected.rowCount, 2)
  assert.equal(selected.truncated, false)
  assert.equal(full.rowCount, 3)
  assert.deepEqual(
    selected.rows.map((row) => row[0]),
    ['A', 'B'],
  )
  const decreases = values(selected, 'decrease_baseline_minus_current')
  const selectedDelta = values(selected, 'delta_current_minus_baseline')
  assert.deepEqual(
    decreases,
    selectedDelta.map((value) => -value),
  )
  assert.equal(sum(decreases), 80)
  const summaryDelta = values(summary, 'delta_current_minus_baseline')
  assert.deepEqual(values(summary, 'baseline'), [200, 180, 20])
  assert.deepEqual(values(summary, 'current'), [150, 100, 50])
  assert.deepEqual(summaryDelta, [-50, -80, 30])
  assert.equal(summaryDelta[0], summaryDelta[1]! + summaryDelta[2]!)

  const chart = draft.blocks.find((block) => block.kind === 'chart')
  assert.ok(chart && chart.kind === 'chart')
  assert.equal(chart.datasetId, 'selected')
  assert.equal(chart.x, 'category')
  assert.deepEqual(chart.y, ['decrease_baseline_minus_current'])
  const metric = draft.blocks.find((block) => block.kind === 'metric')
  assert.ok(metric && metric.kind === 'metric')
  assert.equal(metric.datasetId, 'summary')
  assert.equal(metric.columnId, 'current')
  assert.equal(metric.comparisons?.[0]?.referenceColumnId, 'baseline')
  assert.equal(metric.comparisons?.[0]?.deltaColumnId, 'delta_current_minus_baseline')
  assert.equal(metric.rowIndex, 0)
})
