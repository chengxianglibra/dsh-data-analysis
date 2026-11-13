import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { MARIVO_DATASOURCE_TEST_TOOL_NAME } from '../../src/datasource/index.ts'
import { MARIVO_HELP_TOOL_NAME } from '../../src/disclosure/index.ts'
import { MARIVO_PRESENT_TOOL_NAME } from '../../src/presentation/receipt.ts'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

test('presentation exposes Help, datasource test, Python and present', () => {
  assert.deepEqual(
    [
      MARIVO_HELP_TOOL_NAME,
      MARIVO_DATASOURCE_TEST_TOOL_NAME,
      'marivo_python',
      MARIVO_PRESENT_TOOL_NAME,
    ].sort(),
    ['marivo_datasource_test', 'marivo_help', 'marivo_python', 'marivo_report_write'],
  )
})

test('package distribution excludes non-deliverables and pins the Runtime dependency', async () => {
  const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'))
  assert.equal(manifest.files.includes('lib/**/*.js.map'), false)
  assert.equal(manifest.files.includes('report-contracts/*.json'), false)
  assert.equal(
    manifest.files.some((filename: string) => filename.startsWith('python/marivo/')),
    false,
  )
  const { version, packageSpec } = manifest.dshDataAnalysisCompatibility.marivo
  assert.deepEqual(
    { version, packageSpec },
    {
      version: '0.6.7',
      packageSpec: 'marivo[duckdb,trino,clickhouse]==0.6.7',
    },
  )
  assert.deepEqual(manifest.dshDataAnalysisCompatibility.contracts, {
    runtimeInstallation: 'dsh-data-analysis-runtime/v5',
    subprocessPolicy: 'direct-argv-inherited-env-snapshot-overlay-v2',
    integration: 'dsh-data-analysis-integration/v1',
  })
})
