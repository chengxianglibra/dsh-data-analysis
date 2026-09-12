/** S2: real-model choices and separately labelled, controlled failure prompts. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tool-present/types'
import type { Page } from 'playwright'
import type * as runner from '../validate-file-analysis-real.ts'
import { assertCsvPreview, assertPtcOuterFailure, captureCandidate } from './guards.ts'
import type { startFileAnalysisWeb } from './web-host.ts'

type Presented = Extract<SessionEvent, { type: 'deliverables/presented' }>
export function presented(events: SessionEvent[]) {
  return events.filter((event): event is Presented => event.type === 'deliverables/presented')
}
interface Options {
  page: Page
  host: Awaited<ReturnType<typeof startFileAnalysisWeb>>
  outputRoot: string
  fixtureRoot: string
  workspaces: string[]
  model: string
  effort: string
  python: string
  call: typeof runner.call
  prompt: typeof runner.prompt
  calls: typeof runner.calls
  open: typeof runner.open
  save: (filename: string, value: unknown) => Promise<void>
}
export async function runFileDelivery(o: Options) {
  const { page, call, prompt, calls, save } = o
  const candidate = await captureCandidate()
  await save('candidate.json', candidate)
  const workspace = o.workspaces[0]!
  const results: { label: string; evidence: string; sessionId: string }[] = []
  const snapshot = async (sessionId: string) =>
    (await call(page, 'rpc', 'snapshot', { sessionId })) as runner.Snapshot
  const select = async (sessionId: string) => {
    await page.waitForFunction(
      (id) =>
        (
          window as unknown as { __fileAnalysis: { hasSession(id: string): boolean } }
        ).__fileAnalysis.hasSession(id),
      sessionId,
    )

    await page.evaluate(async (id) => {
      await (
        window as unknown as { __fileAnalysis: { select(id: string): Promise<void> } }
      ).__fileAnalysis.select(id)
    }, sessionId)
  }
  const create = async (agentPreset: string) => {
    const created = (await call(page, 'session', 'create', {
      workspaceId: o.host.workspaceIds[0],
      agentPreset,
    })) as { sessionId: string; agentPreset: string }
    assert.equal(created.agentPreset, agentPreset)
    await call(page, 'session', 'selectModel', {
      sessionId: created.sessionId,
      provider: 'deepseek-official',
      model: o.model,
      reasoningEffort: o.effort,
    })
    await select(created.sessionId)
    return created.sessionId
  }
  const record = async (label: string, evidence: string, sessionId: string) => {
    results.push({ label, evidence, sessionId })
    await save('delivery-progress.json', results)
  }
  const assertDelivery = (events: SessionEvent[], expected: string, mode: 'native' | 'ptc') => {
    const declarations = presented(events)
    assert.equal(
      declarations.flatMap((event) => event.data.files).length,
      1,
      'Only the requested final file is delivered',
    )
    const matching = declarations.filter((event) =>
      event.data.files.some(
        (file) => path.resolve(workspace, file.path) === path.join(workspace, expected),
      ),
    )
    assert.equal(matching.length, 1, `${expected}: exactly one declaration required`)
    const event = matching[0]!
    assert.ok(
      events.some((entry) => entry.type === 'turn/start' && entry.data.turn === event.data.turn),
    )
    assert.ok(
      events.some((entry) =>
        mode === 'native'
          ? entry.type === 'tool/call' &&
            entry.data.name === 'present' &&
            entry.data.callId === event.data.callId
          : entry.type === 'tool/ptc-dispatch' &&
            entry.data.name === 'present' &&
            entry.data.subCallId === event.data.callId,
      ),
      `${expected}: declaration must correspond to ${mode} call`,
    )
    assert.ok(!calls(events).some((entry) => entry.name === 'marivo_present'))
    return declarations
  }
  const preview = async (sessionId: string, filename: string, png: boolean) => {
    await select(sessionId)
    const card = page.locator('[data-presented-file]').filter({ hasText: filename })
    await card.last().waitFor({ state: 'visible', timeout: 30_000 })
    await card.last().locator('button[title]').click()
    if (png) {
      await page.waitForFunction(() =>
        Array.from(document.querySelectorAll<HTMLImageElement>('[data-image-preview] img')).some(
          (img) => img.complete && img.naturalWidth >= 200 && img.getBoundingClientRect().width > 0,
        ),
      )
    } else {
      await assertCsvPreview(
        page,
        sessionId,
        workspace,
        filename,
        await readFile(path.join(workspace, filename), 'utf8'),
      )
    }
    await page.waitForTimeout(400) // Allow the Host sidebar transition to finish before visual evidence.
    await page.screenshot({
      path: path.join(o.outputRoot, `${filename}-desktop.png`),
      fullPage: true,
    })
    await page.setViewportSize({ width: 390, height: 844 })
    if (png)
      await page.waitForFunction(() =>
        Array.from(document.querySelectorAll<HTMLImageElement>('[data-image-preview] img')).some(
          (img) => img.complete && img.naturalWidth >= 200 && img.getBoundingClientRect().width > 0,
        ),
      )
    else
      await assertCsvPreview(
        page,
        sessionId,
        workspace,
        filename,
        await readFile(path.join(workspace, filename), 'utf8'),
      )
    await page.waitForTimeout(400)
    await page.screenshot({
      path: path.join(o.outputRoot, `${filename}-narrow.png`),
      fullPage: true,
    })
    await page.setViewportSize({ width: 1280, height: 900 })
  }
  const fileCases = process.env.DSH_DATA_ANALYSIS_VALIDATION_FILE_CASES ?? 'all'
  assert.ok(['all', 'delivery', 'failures', 'routing'].includes(fileCases))
  const checkPreview = fileCases !== 'routing'
  await save('delivery-scope.json', { fileCases, checkPreview })
  let ptc = ''
  await page.setViewportSize({ width: 1280, height: 900 })
  if (fileCases !== 'failures') {
    const standard = await create('standard')
    const csv = await prompt(
      page,
      standard,
      'files-csv',
      '请分析本条消息上传的两个同名 sales.csv，合并统计记录数和 amount 总和，导出 summary.csv 给我。CSV 只有 rows,total 两列和一行汇总数据。',
      [
        { source: path.join(o.fixtureRoot, 'sales.csv'), name: 'sales.csv' },
        { source: path.join(o.fixtureRoot, 'replacement.csv'), name: 'sales.csv' },
      ],
    )
    assertDelivery(csv.events, 'summary.csv', 'native')
    assert.ok(
      calls(csv.events).some(
        (entry) => entry.name === 'skill' && entry.args.name === 'dsh-data-analysis-files',
      ),
    )
    const pythonCalls = calls(csv.events).filter((entry) => entry.name === 'marivo_python')
    assert.ok(pythonCalls.length)
    for (const entry of pythonCalls) assert.deepEqual(entry.args.datasources, [])
    assert.equal(new Set(csv.files.map((file) => file.path)).size, 2)
    for (const file of csv.files)
      assert.ok(pythonCalls.some((entry) => JSON.stringify(entry.args).includes(file.path)))
    const contents = await readFile(path.join(workspace, 'summary.csv'), 'utf8')
    assert.match(contents.replaceAll('\r', '').trim(), /^rows,total\n5(?:\.0)?,371(?:\.0)?$/)
    if (checkPreview) await preview(standard, 'summary.csv', false)
    await record(
      checkPreview ? 'same-name CSV and native preview' : 'same-name CSV delivery routing',
      'autonomous model',
      standard,
    )

    const answer = await prompt(
      page,
      standard,
      'files-answer',
      '只用文字告诉我刚才两份文件的总金额，不要创建任何文件或报告。',
    )
    assert.equal(presented(answer.events).length, 0)
    assert.ok(
      !calls(answer.events).some((entry) =>
        ['present', 'marivo_present', 'write', 'edit'].includes(entry.name),
      ),
    )
    await record('text-only answer', 'autonomous model', standard)

    const comparisonSession = await create('standard')
    const comparisonFile = path.join(o.fixtureRoot, 'monthly.csv')
    await writeFile(
      comparisonFile,
      'region,month,amount\nA,2024-09,100\nA,2025-08,200\nA,2025-09,150\nB,2025-08,100\nB,2025-09,120\n',
    )
    const comparison = await prompt(
      page,
      comparisonSession,
      'files-comparison',
      '用一个简短表格告诉我附件中 A、B 两个区域 2025 年 9 月 amount 的同比和环比变化，并解释主要差别。',
      { source: comparisonFile, name: 'monthly.csv' },
    )
    assert.equal(presented(comparison.events).length, 0)
    assert.ok(
      !calls(comparison.events).some((entry) =>
        ['marivo_present', 'present', 'marivo_help'].includes(entry.name),
      ),
      'A short file comparison stays in chat without report delivery or Marivo Help',
    )
    assert.ok(calls(comparison.events).some((entry) => entry.name === 'marivo_python'))
    await save('comparison-review.json', {
      sessionId: comparisonSession,
      expected: {
        A: {
          yearOverYear: { delta: 50, percent: 50 },
          monthOverMonth: { delta: -50, percent: -25 },
        },
        B: { yearOverYear: null, monthOverMonth: { delta: 20, percent: 20 } },
      },
      note: 'Routing is asserted automatically. Review the final table for both comparison denominators, directions and the missing B year-over-year baseline; values alone do not prove correct attribution.',
      events: comparison.events,
    })
    await record(
      'short comparison table routing',
      'autonomous model; numerical closeout requires review',
      comparisonSession,
    )

    ptc = await create('ptc')
    const png = await prompt(
      page,
      ptc,
      'files-png',
      '请分析附件，生成 amount 按 item 顺序的蓝色柱形图 amounts.png 给我，宽至少 240 像素。',
      { source: path.join(o.fixtureRoot, 'sales.csv'), name: 'sales.csv' },
    )
    assertDelivery(png.events, 'amounts.png', 'ptc')
    assert.ok(
      calls(png.events).some(
        (entry) =>
          entry.name === 'marivo_python' && JSON.stringify(entry.args).includes('amounts.png'),
      ),
    )
    assert.ok(
      !calls(png.events).some(
        (entry) => entry.name === 'bash' && /python/.test(String(entry.args.command)),
      ),
      'PNG must use the bound Runtime',
    )
    assert.deepEqual(
      (await readFile(path.join(workspace, 'amounts.png'))).subarray(0, 8),
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    )
    if (checkPreview) await preview(ptc, 'amounts.png', true)
    await record(
      checkPreview ? 'PNG and PTC preview' : 'PNG PTC delivery routing',
      'autonomous model',
      ptc,
    )

    if (checkPreview) {
      const beforeRestart = [
        presented((await snapshot(standard)).inspection.events),
        presented((await snapshot(ptc)).inspection.events),
      ]
      const restarted = await o.host.restart()
      await o.open(page, restarted.url)
      for (const [index, id] of [standard, ptc].entries()) {
        await select(id)
        assert.deepEqual(presented((await snapshot(id)).inspection.events), beforeRestart[index])
      }
      await preview(standard, 'summary.csv', false)
      await preview(ptc, 'amounts.png', true)
      await record('persisted declarations after isolated Host restart', 'recovery', ptc)
    }
  }
  if (fileCases === 'all' || fileCases === 'failures') {
    if (!ptc) {
      ptc = await create('ptc')
      await writeFile(path.join(workspace, 'summary.csv'), 'rows,total\n5,371\n')
    }
    const missing = await create('s2-no-present')
    const unavailable = await prompt(
      page,
      missing,
      'files-no-present',
      '请分析附件，在当前 Workspace 根目录导出 summary.json 给我，内容为单个对象，包含记录数 rows 与金额合计 total。不创建报告；请分别说明文件生成状态和当前环境的原生交付状态。',
      { source: path.join(o.fixtureRoot, 'sales.csv'), name: 'sales.csv' },
    )
    assert.ok(!(await snapshot(missing)).tools.includes('present'))
    assert.equal(presented(unavailable.events).length, 0)
    assert.ok(
      !calls(unavailable.events).some((entry) =>
        ['present', 'marivo_present'].includes(entry.name),
      ),
    )
    assert.deepEqual(JSON.parse(await readFile(path.join(workspace, 'summary.json'), 'utf8')), {
      rows: 3,
      total: 71,
    })
    const missingReply = unavailable.events
      .flatMap((event) =>
        event.type === 'assistant/message'
          ? event.data.message.content
              .filter((block) => block.type === 'text')
              .map((block) => block.text)
          : [],
      )
      .join('\n')
    assert.ok(
      missingReply.includes(path.join(workspace, 'summary.json')),
      'Missing-capability reply must include the accurate absolute path',
    )
    assert.match(missingReply, /不可用|无法|未提供|缺少|没有|不支持|未挂载/)
    await save('missing-capability-review.json', {
      sessionId: missing,
      events: unavailable.events,
      note: 'Review final response for accurate path and explicit delivery limitation.',
    })
    await record(
      'missing present with generated JSON',
      'autonomous model in controlled preset',
      missing,
    )

    const failures = await create('standard')
    const failed = await prompt(
      page,
      failures,
      'files-generation-failure',
      '这是受控失败验收。请用 marivo_python(datasources: []) 执行 raise RuntimeError("S2 generation failed")，原计划产物为 never-created.csv。失败后不要重试、不要生成替代文件，只说明失败。',
    )
    assert.equal(presented(failed.events).length, 0)
    assert.ok(calls(failed.events).some((entry) => entry.name === 'marivo_python'))
    const failedExecution = failed.events.flatMap((event) =>
      event.type === 'tool/result'
        ? event.data.message.content[0].content.flatMap((block) => {
            if (block.type !== 'text') return []
            try {
              return [JSON.parse(block.text) as { exitCode?: number; stderr?: string }]
            } catch {
              return []
            }
          })
        : [],
    )
    assert.ok(
      failedExecution.some(
        (result) => result.exitCode === 1 && result.stderr?.includes('S2 generation failed'),
      ),
    )
    await assert.rejects(() => readFile(path.join(workspace, 'never-created.csv')), {
      code: 'ENOENT',
    })
    const invalid = await prompt(
      page,
      failures,
      'files-declaration-failure',
      '这是受控失败验收。请对当前 Workspace 中不存在的 missing.csv 调用原生 present。不要创建它，不要重试，只说明工具返回的错误。',
    )
    assert.equal(presented(invalid.events).length, 0)
    assert.ok(calls(invalid.events).some((entry) => entry.name === 'present'))
    assert.ok(
      invalid.events.some(
        (event) => event.type === 'tool/result' && event.data.message.content[0].isError,
      ),
    )
    await record('generation and missing-path failure', 'controlled model prompts', failures)
    const repaired = await prompt(
      page,
      failures,
      'files-declaration-repaired',
      '文件已经生成，正确路径是当前 Workspace 的 summary.csv。请仅调用 present 补交付这个已有文件，不要重跑分析或生成任何文件。',
    )
    assertDelivery(repaired.events, 'summary.csv', 'native')
    assert.ok(
      !calls(repaired.events).some((entry) =>
        ['marivo_python', 'bash', 'write', 'edit'].includes(entry.name),
      ),
    )
    await record(
      'corrected declaration without repeating analysis',
      'controlled model prompt',
      failures,
    )

    await writeFile(path.join(workspace, 'ptc-completed.txt'), 'S2 persistent declaration\n')
    const outer = await prompt(
      page,
      ptc,
      'files-ptc-outer-failure',
      '这是受控 PTC 失败验收。请在同一个 run_code 中先 await tools.present({files:[{path:"ptc-completed.txt"}]}), 然后 throw new Error("S2 outer failed")。文件已存在。不要重试、不要再次声明，只说明结果。',
    )
    const [declaration] = assertDelivery(outer.events, 'ptc-completed.txt', 'ptc')
    assertPtcOuterFailure(outer.events, declaration!)
    await record('PTC completed declaration survives outer failure', 'controlled model prompt', ptc)
    await rm(path.join(workspace, 'ptc-completed.txt'))
    assert.equal(
      presented((await snapshot(ptc)).inspection.events).filter((event) =>
        event.data.files.some((file) => file.path === 'ptc-completed.txt'),
      ).length,
      1,
    )
    await select(ptc)
    await page
      .locator('[data-presented-file]')
      .filter({ hasText: 'ptc-completed.txt' })
      .last()
      .locator('button[title]')
      .click()
    await page
      .getByText('文件不存在，可能已被移动或删除。', { exact: true })
      .waitFor({ state: 'visible' })
    await page.waitForTimeout(400)
    await page.screenshot({ path: path.join(o.outputRoot, 'deleted-file.png'), fullPage: true })
    await record(
      'deleted source retains declaration and displays Host not-found error',
      'controlled filesystem failure',
      ptc,
    )
  }
  assert.deepEqual(await captureCandidate(), candidate, 'Candidate changed during acceptance')
  const runtime = spawnSync(
    o.python,
    [
      '-c',
      'import json,sys,marivo,importlib.metadata as m;print(json.dumps(dict(python=sys.executable,version=sys.version,marivo=marivo.__file__,marivoVersion=m.version("marivo"))))',
    ],
    { encoding: 'utf8' },
  )
  assert.equal(runtime.status, 0)
  await save('result.json', {
    status: 'passed',
    suite: 'files',
    fileCases,
    model: o.model,
    effort: o.effort,
    node: process.version,
    harness: JSON.parse(await readFile('node_modules/@deepseek-ai/dsh/package.json', 'utf8'))
      .version,
    profile: 'isolated web',
    runtime: JSON.parse(runtime.stdout),
    head: candidate.head,
    candidate,
    package: JSON.parse(await readFile(path.join(o.outputRoot, 'package.json'), 'utf8')),
    results,
    manualReview: [
      ...(fileCases !== 'failures' ? ['comparison-review.json'] : []),
      ...(fileCases === 'all' || fileCases === 'failures'
        ? ['missing-capability-review.json', 'deleted-file.png']
        : []),
    ],
    boundaries: [
      'No user profile modified',
      'Controlled prompts are not autonomous routing evidence',
      ...(checkPreview ? [] : ['Routing mode does not validate native previews or Host restart']),
    ],
  })
  console.log(JSON.stringify({ status: 'passed', outputRoot: o.outputRoot, results }))
}
