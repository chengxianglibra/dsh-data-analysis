/** Actual file-upload receipts, production plugin, real model, and persisted Session recovery. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CREDENTIALS_FILENAME,
  parseCredentialsDocument,
  renderFlatLayoutMigration,
} from '@deepseek-ai/dsh-credentials-local'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { chromium, type Page } from 'playwright'
import { parseSavedPresentation } from '../src/presentation/contracts/analysis-document.ts'
import { parsePresentationReceipt } from '../src/presentation/contracts/index.ts'
import {
  assertFileReportProject,
  captureFileReportProject,
} from './file-analysis-real/report-project.ts'
import { startFileAnalysisWeb } from './file-analysis-real/web-host.ts'

const outputRoot = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-file-analysis-real-')))
console.log(`File analysis real acceptance: ${outputRoot}`)
const python = process.env.DSH_DATA_ANALYSIS_PYTHON
const model = process.env.DSH_DATA_ANALYSIS_VALIDATION_MODEL ?? 'deepseek-v4-pro'
const effort = process.env.DSH_DATA_ANALYSIS_VALIDATION_EFFORT ?? 'high'
const deadlineMs = Number(process.env.DSH_DATA_ANALYSIS_VALIDATION_TURN_TIMEOUT_MS ?? 1_200_000)
assert.ok(Number.isSafeInteger(deadlineMs) && deadlineMs > 0)
let secret = ''
const redact = (value: string) => (secret ? value.replaceAll(secret, '[REDACTED]') : value)
const save = (filename: string, value: unknown) =>
  writeFile(path.join(outputRoot, filename), redact(JSON.stringify(value, null, 2)), {
    mode: 0o600,
  })

async function modelCredential() {
  if (process.env.DEEPSEEK_API_KEY)
    return { value: process.env.DEEPSEEK_API_KEY, source: 'inherited-reference' }
  const filename = path.join(resolveDshHome(), CREDENTIALS_FILENAME)
  let value: string | undefined
  try {
    const raw = await readFile(filename, 'utf8')
    value = parseCredentialsDocument(renderFlatLayoutMigration(raw) ?? raw, filename).refs.get(
      'DEEPSEEK_API_KEY',
    )
  } catch {
    throw new Error(
      'Cannot read the configured Harness model credential reference; acceptance is blocked',
    )
  }
  if (!value)
    throw new Error('DEEPSEEK_API_KEY is not configured; real-model acceptance is blocked')
  return { value, source: 'read-only-harness-reference' }
}

export interface Snapshot {
  header: { cwd: string; agentPreset: string }
  tools: string[]
  status: string
  inspection: { events: SessionEvent[] }
  files: { ref: { attachmentId: string; name: string }; path: string }[]
}
interface BrowserProbe {
  session(
    method: string,
    value: unknown,
  ): Promise<{ ok: boolean; value?: unknown; error?: unknown }>
  rpc(endpoint: string, value: unknown): Promise<{ ok: boolean; value?: unknown; error?: unknown }>
}
export async function call(page: Page, kind: 'session' | 'rpc', method: string, value: unknown) {
  const result = await page.evaluate(
    async ({ kind, method, value }) => {
      const probe = (window as unknown as { __fileAnalysis: BrowserProbe }).__fileAnalysis
      return probe[kind](method, value)
    },
    { kind, method, value },
  )
  assert.equal(result.ok, true, JSON.stringify(result.error))
  return result.value
}
export async function open(page: Page, url: string) {
  await page.goto(url)
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __fileAnalysis?: unknown }).__fileAnalysis),
  )
}
export function calls(events: SessionEvent[]) {
  return events.flatMap((event) => {
    if (event.type === 'tool/call')
      return [
        {
          name: event.data.name,
          args: JSON.parse(event.data.arguments) as Record<string, unknown>,
        },
      ]
    if (event.type === 'tool/ptc-dispatch')
      return [{ name: event.data.name, args: event.data.arguments as Record<string, unknown> }]
    return []
  })
}
function deliveries(events: SessionEvent[], sessionId: string) {
  return events.flatMap((event) => {
    let raw: unknown
    if (event.type === 'tool/result') raw = event.data.meta
    if (
      event.type === 'tool/ptc-dispatch' &&
      event.data.name === 'marivo_report_write' &&
      !event.data.isError
    )
      raw = event.data.content
        .map((item) => item as unknown as { type: string; delivery?: unknown })
        .find((item) => item.type === 'marivo.presentation.delivery')?.delivery
    if (
      !raw ||
      typeof raw !== 'object' ||
      (raw as { kind?: string }).kind !== 'marivo.presentation.delivery'
    )
      return []
    const delivery = raw as { dshSessionId: string; receipt: unknown }
    assert.equal(delivery.dshSessionId, sessionId)
    return [parsePresentationReceipt(delivery.receipt)]
  })
}
export async function prompt(
  page: Page,
  sessionId: string,
  label: string,
  text: string,
  file?: { source: string; name: string } | { source: string; name: string }[],
) {
  const before = (await call(page, 'rpc', 'snapshot', { sessionId })) as Snapshot
  const afterSeq = before.inspection.events.at(-1)?.seq ?? -1
  let uploaded: { receiptId: string; file: { attachmentId: string; name: string } } | undefined
  const uploads = []
  for (const item of file ? (Array.isArray(file) ? file : [file]) : []) {
    const file = item
    const bytes = await readFile(file.source)
    const response = await page.request.post(
      `${new URL(page.url()).origin}/api/session/uploadFileBinary?${new URLSearchParams({ sessionId, name: file.name })}`,
      {
        headers: { 'content-type': 'application/octet-stream' },
        data: bytes,
      },
    )
    assert.equal(response.status(), 200)
    const result = await response.json()
    assert.equal(result.ok, true, JSON.stringify(result))
    uploaded = result.value
    uploads.push(result.value as { receiptId: string })
  }
  const requestId = randomUUID()
  await call(page, 'session', 'prompt', {
    sessionId,
    requestId,
    mode: 'queue',
    content: [
      { type: 'text', text },
      ...uploads.map((upload) => ({ type: 'file', receiptId: upload.receiptId })),
    ],
  })
  const deadline = Date.now() + deadlineMs
  let lastProgress = 0
  while (Date.now() < deadline) {
    const snapshot = (await call(page, 'rpc', 'snapshot', { sessionId })) as Snapshot
    const events = snapshot.inspection.events.filter((event) => event.seq > afterSeq)
    if (Date.now() - lastProgress > 25_000) {
      console.log(`${label}: ${calls(events).length} tool calls; ${snapshot.status}`)
      lastProgress = Date.now()
    }
    if (snapshot.status === 'idle' && events.some((event) => event.type === 'turn/end')) {
      await save(`${label}.json`, { sessionId, requestId, uploaded, prompt: text, ...snapshot })
      return { events, uploaded, files: snapshot.files, cwd: snapshot.header.cwd }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  await call(page, 'session', 'cancel', { sessionId })
  throw new Error(`${label}: real-model turn exceeded deadline`)
}
async function verify(
  events: SessionEvent[],
  sessionId: string,
  rows: number,
  total: number,
  label: string,
  targetPath: string,
  workspace: {
    root: string
    id: string
    cwd: string
    before: Awaited<ReturnType<typeof captureFileReportProject>>
  },
) {
  const executed = calls(events)
  const pythonCalls = executed.filter((call) => call.name === 'marivo_python')
  assert.ok(pythonCalls.length, `${label}: no actual marivo_python execution`)
  for (const call of pythonCalls)
    assert.deepEqual(call.args.datasources, [], 'Local file execution must not admit a datasource')
  assert.ok(
    !executed.some(
      (call) =>
        call.name === 'skill' &&
        ['marivo-analysis', 'marivo-semantic'].includes(String(call.args.name)),
    ),
    'Simple file analysis activated semantic skills',
  )
  assert.ok(
    !events.some(
      (event) =>
        event.type === 'user/message' &&
        (event.data.source as { kind?: string } | undefined)?.kind === 'marivo-disclosure',
    ),
    'Unexpected root Help disclosure',
  )
  const reports = deliveries(events, sessionId)
  assert.ok(reports.length, `${label}: no actual report delivery`)
  const receipt = reports.at(-1)!
  const document = parseSavedPresentation(
    JSON.parse(await readFile(receipt.files.document.path, 'utf8')),
  )
  const snapshots = Object.values(document.resources).flatMap((resource) =>
    resource.kind === 'snapshot' ? [resource] : [],
  )
  assert.ok(
    snapshots.every((resource) => resource.snapshot.kind === 'dataset'),
    'File results must not claim Marivo Frame sources',
  )
  assert.ok(
    `${document.title}\n${document.program}`.includes(path.basename(targetPath)),
    `${label}: report must identify the input file`,
  )
  const summaries = snapshots.filter((resource) =>
    resource.snapshot.data.rows.some(
      (row) =>
        row.some((cell) => Number(cell) === rows) && row.some((cell) => Number(cell) === total),
    ),
  )
  assert.ok(
    summaries.length,
    `${label}: report must contain a summary row with correct count and total`,
  )
  const codeRefs = snapshots.flatMap((resource) =>
    resource.binding.codeRef ? [resource.binding.codeRef] : [],
  )
  assert.ok(codeRefs.length, `${label}: report is missing execution codeRef bindings`)
  const successful = successfulPython(events)
  assert.ok(
    summaries.some((resource) =>
      successful.some(
        (run) =>
          run.codeRef.executionId === resource.binding.codeRef?.executionId &&
          run.codeRef.sha256 === resource.binding.codeRef?.sha256 &&
          referencesPath(run.code, targetPath) &&
          /read_csv|read_json|read_parquet|read_xlsx|open\(/.test(run.code),
      ),
    ),
    `${label}: summary must reference this turn's successful Python reading the exact uploaded file`,
  )
  const project = await assertFileReportProject({
    workspaceRoot: workspace.root,
    workspaceId: workspace.id,
    sessionCwd: workspace.cwd,
    pythonExecutable: python!,
    before: workspace.before,
    receipt,
    document,
  })
  await save(`${label}-report.json`, document)
  return {
    label,
    rows,
    total,
    reportId: receipt.reportId,
    buildId: receipt.buildId,
    codeRefs,
    targetPath,
    project,
  }
}

function successfulPython(events: SessionEvent[]) {
  const submitted = new Map(
    events.flatMap((event) =>
      event.type === 'tool/call' && event.data.name === 'marivo_python'
        ? [[String(event.data.callId), JSON.parse(event.data.arguments).code as string] as const]
        : [],
    ),
  )
  const output: { code: string; codeRef: { executionId: string; sha256: string } }[] = []
  const capture = (code: string | undefined, content: unknown) => {
    if (!code || !Array.isArray(content)) return
    for (const item of content) {
      if (item.type !== 'text') continue
      let result: { exitCode?: number; codeRef?: { executionId: string; sha256: string } }
      try {
        result = JSON.parse(item.text)
      } catch {
        continue
      }
      if (result.exitCode === 0 && result.codeRef) output.push({ code, codeRef: result.codeRef })
    }
  }
  for (const event of events) {
    if (event.type === 'tool/result' && !event.data.message.isError)
      capture(submitted.get(String(event.data.message.toolCallId)), event.data.message.content)
    if (
      event.type === 'tool/ptc-dispatch' &&
      event.data.name === 'marivo_python' &&
      !event.data.isError
    )
      capture((event.data.arguments as { code: string }).code, event.data.content)
  }
  return output
}

/** Parse literals without executing code; Python joins adjacent long-path string literals. */
function referencesPath(code: string, target: string) {
  const parsed = spawnSync(
    python!,
    [
      '-c',
      'import ast,json,sys\ncode,target=json.load(sys.stdin)\nprint(json.dumps(any(isinstance(n,ast.Constant) and n.value==target for n in ast.walk(ast.parse(code)))))',
    ],
    { input: JSON.stringify([code, target]), encoding: 'utf8' },
  )
  assert.equal(parsed.status, 0, 'Unable to inspect the successful Python source')
  return JSON.parse(parsed.stdout) === true
}

let host: Awaited<ReturnType<typeof startFileAnalysisWeb>> | undefined
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
try {
  if (!python)
    throw new Error(
      'Set DSH_DATA_ANALYSIS_PYTHON to a verified Marivo Runtime; acceptance is blocked',
    )
  const credential = await modelCredential()
  secret = credential.value
  const fixtureRoot = path.join(outputRoot, 'fixtures')
  const generated = spawnSync(
    python,
    [fileURLToPath(new URL('./file-analysis-real/fixtures.py', import.meta.url)), fixtureRoot],
    { encoding: 'utf8' },
  )
  assert.equal(generated.status, 0, generated.stderr)
  await save('fixtures.json', JSON.parse(generated.stdout))
  const suite = process.env.DSH_DATA_ANALYSIS_VALIDATION_SUITE ?? 'reports'
  assert.ok(['reports', 'files'].includes(suite), 'Unknown file analysis suite')
  const formats = process.env.DSH_DATA_ANALYSIS_VALIDATION_FORMATS?.split(',') ?? [
    'csv',
    'json',
    'jsonl',
    'parquet',
    'xlsx',
  ]
  assert.ok(
    formats.includes('csv') &&
      formats.every((format) => ['csv', 'json', 'jsonl', 'parquet', 'xlsx'].includes(format)) &&
      new Set(formats).size === formats.length,
    'Selected formats must be unique known formats and include csv for recovery',
  )
  const workspaces = formats.map((format) => path.join(outputRoot, `workspace-${format}`))
  await Promise.all(workspaces.map((root) => mkdir(root)))
  host = await startFileAnalysisWeb(outputRoot, workspaces, python, secret, {
    missingPresentPreset:
      suite === 'files' && process.env.DSH_DATA_ANALYSIS_VALIDATION_FILE_CASES !== 'delivery',
  })
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  let page = await browser.newPage()
  await open(page, host.url)
  if (suite === 'files') {
    const { runFileDelivery } = await import('./file-analysis-real/delivery.ts')
    await runFileDelivery({
      page,
      host,
      outputRoot,
      fixtureRoot,
      workspaces,
      model,
      effort,
      python,
      call,
      prompt,
      calls,
      open,
      save,
    })
  } else {
    const results = []
    let csvSession = ''
    let csvAttachment = ''
    let csvPath = ''
    const task =
      '请分析刚上传的文件，生成可在右侧报告阅读器打开的简短报告：用一行汇总表展示数据记录数和 amount 总和，并说明文件名、读取范围和采用的解析方式。保留可查看的执行代码。'
    for (const [index, format] of formats.entries()) {
      const created = (await call(page, 'session', 'create', {
        workspaceId: host.workspaceIds[index],
      })) as { sessionId: string }
      await call(page, 'session', 'selectModel', {
        sessionId: created.sessionId,
        provider: 'deepseek-official',
        model,
        reasoningEffort: effort,
      })
      const before = await captureFileReportProject(workspaces[index]!)
      const outcome = await prompt(page, created.sessionId, format, task, {
        source: path.join(fixtureRoot, `sales.${format}`),
        name: `sales.${format}`,
      })
      assert.ok(
        calls(outcome.events).some(
          (call) => call.name === 'skill' && call.args.name === 'dsh-data-analysis-files',
        ),
        `${format}: model did not naturally select the file Skill`,
      )
      const targetPath = outcome.files.find(
        (file) => file.ref.attachmentId === outcome.uploaded!.file.attachmentId,
      )!.path
      results.push(
        await verify(outcome.events, created.sessionId, 3, 71, format, targetPath, {
          root: workspaces[index]!,
          id: host.workspaceIds[index]!,
          cwd: outcome.cwd,
          before,
        }),
      )
      if (format === 'csv') {
        csvSession = created.sessionId
        csvAttachment = outcome.uploaded!.file.attachmentId
        csvPath = targetPath
      }
    }
    const csvIndex = formats.indexOf('csv')
    const csvWorkspace = { root: workspaces[csvIndex]!, id: host.workspaceIds[csvIndex]! }
    const beforeReplacement = await captureFileReportProject(csvWorkspace.root)
    const replaced = await prompt(page, csvSession, 'same-name', task, {
      source: path.join(fixtureRoot, 'replacement.csv'),
      name: 'sales.csv',
    })
    assert.notEqual(replaced.uploaded!.file.attachmentId, csvAttachment)
    results.push(
      await verify(
        replaced.events,
        csvSession,
        2,
        300,
        'same-name',
        replaced.files.find(
          (file) => file.ref.attachmentId === replaced.uploaded!.file.attachmentId,
        )!.path,
        { ...csvWorkspace, cwd: replaced.cwd, before: beforeReplacement },
      ),
    )
    await page.close()
    const restarted = await host.restart()
    page = await browser.newPage()
    await open(page, restarted.url)
    const beforeRecovery = await captureFileReportProject(csvWorkspace.root)
    const recovered = await prompt(
      page,
      csvSession,
      'restored-first-file',
      '请重新读取本会话第一次上传的 sales.csv（不是后来上传的同名文件），再次生成可在右侧报告阅读器打开的简短报告，用一行表格列出记录数与 amount 总和，并保留执行代码。',
    )
    results.push(
      await verify(recovered.events, csvSession, 3, 71, 'restored-first-file', csvPath, {
        ...csvWorkspace,
        cwd: recovered.cwd,
        before: beforeRecovery,
      }),
    )
    await page.screenshot({ path: path.join(outputRoot, 'web.png'), fullPage: true })
    await save('result.json', {
      status: 'passed',
      formats,
      model,
      effort,
      credentialSource: credential.source,
      python,
      results,
      boundaries: [
        'actual production Web and native HTTP upload',
        'real model selected Skills from an ordinary file-analysis request',
        'only the isolated validation Web was restarted',
        'engine Tool probes are validated separately',
      ],
    })
    console.log(JSON.stringify({ status: 'passed', outputRoot, results }))
  }
} catch (error) {
  const message = redact(error instanceof Error ? error.message : String(error))
  await save('result.json', {
    status: message.includes('blocked') ? 'blocked' : 'failed',
    model,
    effort,
    message,
  })
  console.error(message)
  process.exitCode = 1
} finally {
  await browser?.close()
  await host?.stop()
}
