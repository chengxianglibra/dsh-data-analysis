import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { runReportCheckCli } from '../../src/report-check/cli.ts'
import {
  createDshDataAnalysisReportCheckTool,
  DSH_DATA_ANALYSIS_REPORT_CHECK_TOOL_NAME,
} from '../../src/report-check/tool.ts'
import { checkWorkspaceReport } from '../../src/report-check/workspace.ts'

const VALID_HTML =
  '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"><title>Ok</title></head><body><main><h1>Ok</h1></main></body></html>'

async function fixture(t: test.TestContext): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-report-adapter-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(path.join(root, 'index.html'), VALID_HTML)
  return root
}

test('CLI JSON and Workspace adapter return the same canonical value except checked_at', async (t) => {
  const root = await fixture(t)
  let stdout = ''
  let stderr = ''
  const exitCode = await runReportCheckCli(['index.html', '--json'], {
    cwd: () => root,
    writeStdout: (text) => {
      stdout += text
    },
    writeStderr: (text) => {
      stderr += text
    },
  })
  assert.equal(exitCode, 0)
  assert.equal(stderr, '')
  const cli = JSON.parse(stdout)
  const direct = await checkWorkspaceReport({
    workspaceRoot: root,
    entryPath: 'index.html',
    signal: new AbortController().signal,
  })
  delete cli.checked_at
  const { checked_at: _checkedAt, ...withoutTime } = direct
  assert.deepEqual(cli, withoutTime)
})

test('CLI reserves exit 1 for static failure and exit 2 for invalid invocation', async (t) => {
  const root = await fixture(t)
  await writeFile(path.join(root, 'index.html'), '<html>')
  const output: string[] = []
  const io = {
    cwd: () => root,
    writeStdout: (text: string) => output.push(text),
    writeStderr: (text: string) => output.push(text),
  }
  assert.equal(await runReportCheckCli(['index.html'], io), 1)
  assert.equal(await runReportCheckCli([], io), 2)
  assert.equal(await runReportCheckCli(['../index.html'], io), 2)
})

test('Tool definition reads the calling Agent session Workspace and remains unregistered', async (t) => {
  const root = await fixture(t)
  const tool = createDshDataAnalysisReportCheckTool()
  assert.equal(tool.name, DSH_DATA_ANALYSIS_REPORT_CHECK_TOOL_NAME)
  assert.deepEqual(Object.keys((tool.parameters as any).properties), ['entry_path'])
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  assert.equal(ctx.tools.get(DSH_DATA_ANALYSIS_REPORT_CHECK_TOOL_NAME), undefined)
  const unregister = ctx.tools.register(tool)
  t.after(unregister)
  const result = await ctx.tools.execute({
    callId: CallId('report-check-tool'),
    name: DSH_DATA_ANALYSIS_REPORT_CHECK_TOOL_NAME,
    arguments: { entry_path: 'index.html' },
    signal: new AbortController().signal,
    agent: { session: { header: { cwd: root } } } as never,
  })
  assert.equal(result.isError, false, JSON.stringify(result))
  if (result.isError) return
  assert.equal((result.value as unknown as { status: string }).status, 'passed_static')
  assert.equal((result.value as unknown as { entry_path: string }).entry_path, 'index.html')
})
