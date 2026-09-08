import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  PresentationContractError,
  parseTypedDataset,
} from '../../src/presentation/contracts/index.ts'
import { lintPresentationDraft } from '../../src/presentation/lint.ts'

const data = (value: unknown) => ({
  schemaVersion: 1,
  columns: [{ id: 'query_count', label: '查询量', type: 'int64', nullable: false }],
  rows: [[value]],
  rowCount: 1,
  limit: 1,
  truncated: false,
})

test('int64 diagnostics retain column context, exactness and one pointer', () => {
  for (const value of [42, 9007199254740992, true, {}, 'abc', '9223372036854775808', null]) {
    assert.throws(
      () => parseTypedDataset(data(value), '/datasets/1/data'),
      (error: unknown) => {
        assert.ok(error instanceof PresentationContractError)
        assert.equal(error.path, '/datasets/1/data/rows/0/0')
        assert.match(error.message, /column query_count type=int64/)
        assert.equal(error.message.split('/datasets/1/data/rows/0/0').length, 2)
        if (typeof value === 'number') {
          assert.match(error.message, /exact integer string/)
          assert.match(error.message, /42 as "42"/)
          assert.match(error.hint, /already rounded/)
        }
        return true
      },
    )
  }
  for (const value of ['42', '9007199254740993', '-9223372036854775808', '9223372036854775807']) {
    assert.equal(parseTypedDataset(data(value)).rows[0]![0], value)
  }
})

test('standalone lint reads computed files, reports failures across datasets, and writes no assets', async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'presentation-lint-')))
  try {
    const draft = {
      schemaVersion: 1,
      title: 'Lint',
      sources: [],
      blocks: [{ id: 'table', kind: 'table', datasetId: 'data0' }],
      datasets: [0, 1].map((index) => ({
        id: `data${index}`,
        kind: 'computed',
        path: `data${index}.json`,
        sourceIds: [],
      })),
    }
    await writeFile(path.join(root, 'draft.json'), JSON.stringify(draft))
    for (const index of [0, 1])
      await writeFile(path.join(root, `data${index}.json`), JSON.stringify(data(42)))
    const before = await readdir(root)
    const result = await lintPresentationDraft(root, 'draft.json')
    assert.equal(result.ok, false)
    assert.deepEqual(
      result.diagnostics.map((error) => error.path),
      ['/datasets/0/data/rows/0/0', '/datasets/1/data/rows/0/0'],
    )
    const cli = new URL('../../src/bin/presentation-lint.ts', import.meta.url)
    const run = () =>
      spawnSync(process.execPath, [cli.pathname, 'draft.json', '--project-root', root], {
        encoding: 'utf8',
      })
    const failed = run()
    assert.equal(failed.status, 1, failed.stderr)
    assert.deepEqual(JSON.parse(failed.stdout), result)
    for (const index of [0, 1])
      await writeFile(
        path.join(root, `data${index}.json`),
        JSON.stringify(data('9007199254740993')),
      )
    const passed = run()
    assert.equal(passed.status, 0, passed.stderr)
    const report = JSON.parse(passed.stdout)
    assert.equal(report.checkedComputedDatasets, 2)
    assert.ok(report.deferredChecks.includes('projected-document-and-rendering'))
    assert.deepEqual(await readdir(root), before)
    await rm(path.join(root, 'data0.json'))
    await symlink(path.join(root, 'data1.json'), path.join(root, 'data0.json'))
    assert.equal(
      (await lintPresentationDraft(root, 'draft.json')).diagnostics[0]!.code,
      'file_boundary',
    )
    await writeFile(path.join(root, 'draft.json'), '{')
    assert.equal(
      (await lintPresentationDraft(root, 'draft.json')).diagnostics[0]!.code,
      'invalid_json',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
