import assert from 'node:assert/strict'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import LocalBashExecutor from '@deepseek-ai/dsh-bash-local'
import { CallId } from '@deepseek-ai/dsh-llm'
import * as ShellEnv from '@deepseek-ai/dsh-shell-env'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as ToolBash from '@deepseek-ai/dsh-tool-bash'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { MARIVO_DATASOURCE_TEST_TOOL_NAME } from '../../src/datasource/index.ts'
import { MARIVO_HELP_TOOL_NAME } from '../../src/disclosure/index.ts'
import { MARIVO_EVIDENCE_SOURCES_TOOL_NAME } from '../../src/evidence/index.ts'
import { DSH_DATA_ANALYSIS_REPORT_CHECK_TOOL_NAME } from '../../src/report-check/index.ts'

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

test('public plugin Tool surface contains only the four cross-boundary adapters', () => {
  assert.deepEqual(
    [
      MARIVO_HELP_TOOL_NAME,
      MARIVO_DATASOURCE_TEST_TOOL_NAME,
      MARIVO_EVIDENCE_SOURCES_TOOL_NAME,
      DSH_DATA_ANALYSIS_REPORT_CHECK_TOOL_NAME,
    ].sort(),
    [
      'dsh_data_analysis_report_check',
      'marivo_datasource_test',
      'marivo_evidence_sources',
      'marivo_help',
    ],
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
})

test('package cutover removes report exports and pins the native runtime release', async () => {
  const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'))
  assert.equal(Object.hasOwn(manifest.exports, './report'), false)
  assert.deepEqual(manifest.dshDataAnalysisCompatibility.marivo, {
    version: '0.5.1',
    packageSpec: 'marivo[duckdb,trino,clickhouse]==0.5.1',
  })
  assert.deepEqual(manifest.dshDataAnalysisCompatibility.contracts, {
    runtimeInstallation: 'dsh-data-analysis-runtime/v1',
    subprocessPolicy: 'direct-argv-inherited-env-snapshot-overlay-v1',
  })
})

test('the report Skill is a short progressive-disclosure router for the Workspace workflow', async () => {
  const skill = await readFile(reportSkillPath, 'utf8')
  const normalized = skill.replaceAll(/\s+/g, ' ')
  assert.match(normalized, /name: dsh-data-analysis-report/)
  assert.match(
    normalized,
    /when an analysis needs multiple charts\/tables or a long multi-section presentation/,
  )
  assert.match(normalized, /recover its exact persisted Artifacts and revalidate them/)
  assert.match(normalized, /Never rerun `observe` only to render HTML/)
  assert.match(normalized, /Read only the references needed/)
  assert.match(normalized, /dsh_data_analysis_report_check/)
  assert.match(normalized, /Static success is not browser or analytical validation/)
  assert.match(normalized, /top-level file Tool as the bundle's final mutation/)
  assert.match(normalized, /If any bundle file changes afterward/)
  assert.match(normalized, /exact file-Tool path as Markdown inline code/)
  assert.match(normalized, /Produced Files and Host opening are navigation only/)
  assert.ok(skill.length < 5_000)
  assert.doesNotMatch(skill, /marivo_report_render|ReportDocument|report_publish|renderLineChart/)
})

test('the real runner shell stack executes through the production DSH Bash Tool', async (t) => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(ShellEnv)
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(LocalBashExecutor, { cwd: packageRoot })
  await ctx.plugin(ToolBash, { enableRunInBackground: false })

  const result = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId('agent-native-report-bash-smoke'),
    name: 'bash',
    arguments: {
      command: 'printf AGENT_NATIVE_REPORT_BASH_OK',
      description: 'Exercise the real report-validation shell seam',
    },
  })
  assert.equal(result.isError, false)
  assert.match(JSON.stringify(result.content), /AGENT_NATIVE_REPORT_BASH_OK/)
})
