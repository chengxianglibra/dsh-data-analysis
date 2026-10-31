/** Fresh persisted Marivo Frames for the production S4 Tool, isolated from user files. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { bindMarivoEnvironment } from '../../src/environment/index.ts'
import type { PresentationRequest } from './host.ts'

interface GeneratedFrame {
  captureId: string
  sessionId: string
  artifactRef: string
  persistedRowCount: number
  valueColumns: string[]
  dataColumns: string[]
}

const frame = (value: GeneratedFrame) => ({
  kind: 'frame-snapshot' as const,
  // Validation-only locator, replaced with a Host-bound snapshotRef before Tool dispatch.
  snapshotRef: `fixture-capture:${value.captureId}`,
})

export async function preparePresentationInputs(workspaceRoot: string, pythonExecutable: string) {
  await mkdir(path.join(workspaceRoot, 'models/datasources'), { recursive: true })
  await mkdir(path.join(workspaceRoot, 'models/semantic/sales'), { recursive: true })
  const environment = await bindMarivoEnvironment({ projectRoot: workspaceRoot, pythonExecutable })
  const code = await readFile(new URL('./runtime-generate.py', import.meta.url), 'utf8')
  const captureDirectory = `.dsh-data-analysis/captures/${randomUUID()}`
  const startedAt = new Date().toISOString()
  const result = await environment.runChecked({
    program: `from dsh_data_analysis_presentation._capture import _capture_scope\nfrom pathlib import Path\nwith _capture_scope(str(Path.cwd()), ${JSON.stringify(captureDirectory)}, ()):\n    exec(${JSON.stringify(code)})`,
    limits: { timeoutMs: 120_000, stdoutMaxBytes: 262_144, stderrMaxBytes: 65_536 },
  })
  assert.equal(result.exitCode, 0, result.stderr.toString('utf8'))
  await writeFile(
    path.join(workspaceRoot, '.dsh-data-analysis/presentation-validation-capture.json'),
    JSON.stringify({ code, captureDirectory, startedAt, finishedAt: new Date().toISOString() }),
  )
  const generated = JSON.parse(result.stdout.toString('utf8')) as {
    primary: GeneratedFrame
    secondary: GeneratedFrame
    precisionProbe: GeneratedFrame
  }
  // Every request has an explicit root so it can also serve as a complete update patch.
  const requests: PresentationRequest[] = [
    {
      surface: 'tab',
      locale: 'zh-CN',
      title: 'S4 真实 Frame',
      resources: { revenue: frame(generated.primary), account: frame(generated.secondary) },
      program: 'root = Stack([AnalysisFrameView("revenue"), AnalysisFrameView("account")]);',
    },
    {
      surface: 'tab',
      locale: 'zh-CN',
      title: 'S4 精确 Frame',
      resources: { precision: frame(generated.precisionProbe) },
      program:
        'root = Stack([TextContent("## 精确快照\\n大整数与 Decimal 按保存值展示。"), AnalysisFrameView("precision")]);',
    },
  ]
  return { binding: environment.binding, generated, requests }
}
