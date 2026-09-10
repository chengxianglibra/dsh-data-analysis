import assert from 'node:assert/strict'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  MARIVO_DATASOURCE_CONFIGURE_TOOL_NAME,
  MARIVO_DATASOURCE_TEST_TOOL_NAME,
} from '../../src/datasource/index.ts'
import { MARIVO_HELP_TOOL_NAME } from '../../src/disclosure/index.ts'
import { MARIVO_PRESENT_TOOL_NAME } from '../../src/presentation/receipt.ts'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const sourceRoot = path.join(packageRoot, 'src')
const reportSkillPath = path.join(packageRoot, 'skills', 'dsh-data-analysis-report', 'SKILL.md')

async function sourceFiles(directory: string): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(directory)) {
    const target = path.join(directory, entry)
    if ((await stat(target)).isDirectory()) result.push(...(await sourceFiles(target)))
    else if (target.endsWith('.ts') || target.endsWith('.tsx') || target.endsWith('.py'))
      result.push(target)
  }
  return result
}

test('presentation exposes Help, datasource configuration/test, Python and present', () => {
  assert.deepEqual(
    [
      MARIVO_HELP_TOOL_NAME,
      MARIVO_DATASOURCE_TEST_TOOL_NAME,
      MARIVO_DATASOURCE_CONFIGURE_TOOL_NAME,
      'marivo_python',
      MARIVO_PRESENT_TOOL_NAME,
    ].sort(),
    [
      'marivo_datasource_configure',
      'marivo_datasource_test',
      'marivo_help',
      'marivo_present',
      'marivo_python',
    ],
  )
})

test('removed and rejected convenience surfaces cannot regress into plugin source', async () => {
  const files = await sourceFiles(sourceRoot)
  const source = (
    await Promise.all(files.map(async (filename) => await readFile(filename, 'utf8')))
  ).join('\n')
  for (const forbidden of [
    'marivo_evidence_sources',
    'marivo-evidence-sources-card',
    'marivo_datasource_access',
    'registerMarivoDatasourceAccessTool',
    'marivo_report_render',
    'marivo_test',
    'marivo_session_dag',
    'marivo_artifact_inspect',
    'marivo_artifact_quality',
    'marivo_artifact_contract',
    'marivo_artifact_lineage',
    'marivo_session_resume',
    'marivo_session_context',
    'marivo_artifact_check',
    'marivo_semantic_readiness',
    'marivo_datasource_inspect',
    'marivo_table_inspect',
    'marivo_artifact_materialize',
    'marivo_artifact_export',
    'ReportDocument',
    'dsh-data-analysis-report/v1',
    'dsh-data-analysis-html/v1',
    'dsh_data_analysis_report',
    'MARIVO_REPORT_PROMPT',
    'dsh-data-analysis-report',
  ]) {
    assert.equal(source.includes(forbidden), false, `${forbidden} must stay absent from source`)
  }
  const reportDirectory = path.join(sourceRoot, 'report')
  const remainingReportFiles = await readdir(reportDirectory).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return []
      throw error
    },
  )
  assert.deepEqual(remainingReportFiles, [])
  await assert.rejects(() => stat(path.join(sourceRoot, 'report-check')), { code: 'ENOENT' })
  await assert.rejects(() => stat(path.join(sourceRoot, 'report-disclosure')), { code: 'ENOENT' })
})

test('package cutover removes report exports and pins the native runtime release', async () => {
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
  assert.deepEqual(manifest.dshDataAnalysisCompatibility.marivo, {
    version: '0.5.4',
    packageSpec: 'marivo[duckdb,trino,clickhouse]==0.5.4',
  })
  assert.deepEqual(manifest.dshDataAnalysisCompatibility.contracts, {
    runtimeInstallation: 'dsh-data-analysis-runtime/v3',
    subprocessPolicy: 'direct-argv-inherited-env-snapshot-overlay-v2',
  })
})

test('S2 removes the old helper, report Skill and JavaScript transport together', async () => {
  for (const removed of [
    reportSkillPath,
    path.join(packageRoot, 'python', 'report-kit', 'pyproject.toml'),
    path.join(
      packageRoot,
      'python',
      'report-kit',
      'src',
      'dsh_data_analysis_report',
      '__init__.py',
    ),
    path.join(packageRoot, 'report-contracts'),
  ])
    await assert.rejects(() => stat(removed), { code: 'ENOENT' })
  const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'))
  assert.ok(
    manifest.files.includes(
      'python/presentation-kit/dist/dsh_data_analysis_presentation_kit-1.1.0-py3-none-any.whl',
    ),
  )
  assert.equal(
    manifest.files.some((item: string) => /report-kit|dsh-data-analysis-report/.test(item)),
    false,
  )
})
