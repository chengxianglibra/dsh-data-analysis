import assert from 'node:assert/strict'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { MARIVO_DATASOURCE_TEST_TOOL_NAME } from '../../src/datasource/index.ts'
import { MARIVO_HELP_TOOL_NAME } from '../../src/disclosure/index.ts'
import { MARIVO_EVIDENCE_SOURCES_TOOL_NAME } from '../../src/evidence/index.ts'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const sourceRoot = path.join(packageRoot, 'src')
const reportSkillPath = path.join(packageRoot, 'skills', 'dsh-data-analysis-report', 'SKILL.md')

async function sourceFiles(directory: string): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(directory)) {
    const target = path.join(directory, entry)
    if ((await stat(target)).isDirectory()) result.push(...(await sourceFiles(target)))
    else if (target.endsWith('.ts') || target.endsWith('.tsx')) result.push(target)
  }
  return result
}

test('public plugin Tool surface contains only the three cross-boundary adapters', () => {
  assert.deepEqual(
    [
      MARIVO_HELP_TOOL_NAME,
      MARIVO_DATASOURCE_TEST_TOOL_NAME,
      MARIVO_EVIDENCE_SOURCES_TOOL_NAME,
    ].sort(),
    ['marivo_datasource_test', 'marivo_evidence_sources', 'marivo_help'],
  )
})

test('removed and rejected convenience surfaces cannot regress into plugin source', async () => {
  const files = await sourceFiles(sourceRoot)
  const source = (
    await Promise.all(files.map(async (filename) => await readFile(filename, 'utf8')))
  ).join('\n')
  for (const forbidden of [
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
    'dsh_data_analysis_report_check',
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
  assert.equal(Object.hasOwn(manifest.exports, './report'), false)
  assert.equal(Object.hasOwn(manifest.exports, './report-check'), false)
  assert.equal(Object.hasOwn(manifest.bin, 'dsh-data-analysis-report-check'), false)
  assert.deepEqual(manifest.dshDataAnalysisCompatibility.marivo, {
    version: '0.5.2',
    packageSpec: 'marivo[duckdb,trino,clickhouse]==0.5.2',
  })
  assert.deepEqual(manifest.dshDataAnalysisCompatibility.contracts, {
    runtimeInstallation: 'dsh-data-analysis-runtime/v1',
    subprocessPolicy: 'direct-argv-inherited-env-snapshot-overlay-v1',
  })
})

test('the report Skill contains principles and only Marivo projection assets', async () => {
  const skill = await readFile(reportSkillPath, 'utf8')
  const normalized = skill.replaceAll(/\s+/g, ' ')
  assert.match(normalized, /name: dsh-data-analysis-report/)
  assert.match(
    normalized,
    /when an analysis needs multiple charts, tables, or a long multi-section presentation/,
  )
  assert.match(normalized, /emit_dataset\(artifact, target, revalidation=\.\.\.\)/)
  assert.match(normalized, /不接受普通 DataFrame/)
  assert.match(normalized, /普通报告资源/)
  assert.match(normalized, /不得注册进 `ReportData` \/ `ReportTrace`/)
  assert.match(normalized, /emit_session_trace\(graph, target, report_artifact_refs=\[\.\.\.\]\)/)
  assert.match(normalized, /每个 Marivo Session/)
  assert.match(normalized, /report_artifact_refs.*实际支撑可见内容/)
  assert.match(normalized, /单次最多接收 20 个 trace/)
  assert.match(normalized, /ReportTrace\.renderSessionGraphs/)
  assert.match(normalized, /session_id \+ artifact_ref/)
  assert.match(normalized, /经典脚本顺序固定/)
  assert.match(normalized, /dataset_id.*trace_id.*必须唯一/)
  assert.match(normalized, /内容组织/)
  assert.match(normalized, /布局与样式/)
  assert.match(normalized, /生成与检查/)
  assert.match(normalized, /新报告使用新的 Workspace 目录；修订使用用户指定或已确认的现有目录/)
  assert.match(normalized, /Produced Files 与 Host opening 只是导航/)
  assert.ok(skill.length < 5_000)
  assert.doesNotMatch(
    skill,
    /dsh_data_analysis_report_check|starter\/|references\/|renderLineChart/,
  )
  assert.deepEqual((await readdir(path.dirname(reportSkillPath))).sort(), ['SKILL.md', 'assets'])
  assert.deepEqual((await readdir(path.join(path.dirname(reportSkillPath), 'assets'))).sort(), [
    'marivo-artifact.js',
    'marivo-session-dag.js',
  ])
})
