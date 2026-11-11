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

test('package cutover removes report exports and pins the Runtime dependency', async () => {
  const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'))
  assert.equal(Object.hasOwn(manifest.exports, './evidence'), false)
  assert.equal(Object.hasOwn(manifest.exports, './report'), false)
  assert.equal(Object.hasOwn(manifest.exports, './report-check'), false)
  assert.equal(Object.hasOwn(manifest.bin, 'dsh-data-analysis-report-check'), false)
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
      version: '0.6.4',
      packageSpec: 'marivo[duckdb,trino,clickhouse]==0.6.4',
    },
  )
  assert.deepEqual(manifest.dshDataAnalysisCompatibility.contracts, {
    runtimeInstallation: 'dsh-data-analysis-runtime/v5',
    subprocessPolicy: 'direct-argv-inherited-env-snapshot-overlay-v2',
    integration: 'dsh-data-analysis-integration/v1',
  })
})
