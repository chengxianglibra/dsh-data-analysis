import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'
import { analysisRecordId } from '../../src/presentation/contracts/analysis-document.ts'
import { draftDeliverySchema } from '../../src/presentation/receipt.ts'
import type * as runner from '../validate-file-analysis-real.ts'

interface Options {
  page: Page
  workspaceId: string
  failureWorkspace: { id: string; root: string }
  fixtureRoot: string
  model: string
  effort: string
  call: typeof runner.call
  prompt: typeof runner.prompt
  deliveries: typeof runner.deliveries
}

const trend = '请根据上传文件说明 2025 年各月订单量的整体走势，以及最明显的回落发生在哪个月。'
const cases = [
  { label: 'implicit-trend', question: trend },
  { label: 'single-value', question: '上传文件中 2025 年 12 月的订单量是多少？' },
  { label: 'text-only', question: `${trend}只在聊天里用文字回答。` },
  { label: 'save-failure', question: trend },
]

export async function verifyAnalysisViewRouting(o: Options) {
  const { page, call, prompt, deliveries } = o
  const name = 'monthly-orders.csv'
  const source = path.join(o.fixtureRoot, name)
  const orders = [40, 45, 48, 52, 56, 60, 44, 50, 57, 66, 78, 90]
  const rows = orders.map((value, i) => `2025-${String(i + 1).padStart(2, '0')},${value}`)
  await writeFile(source, ['month,orders', ...rows, ''].join('\n'))

  const results: { label: string; reply: string; buildId?: string }[] = []
  for (const { label, question } of cases) {
    const failSave = label === 'save-failure'
    const { sessionId } = (await call(page, 'session', 'create', {
      workspaceId: failSave ? o.failureWorkspace.id : o.workspaceId,
    })) as { sessionId: string }
    await call(page, 'session', 'selectModel', {
      sessionId,
      provider: 'deepseek-official',
      model: o.model,
      reasoningEffort: o.effort,
    })
    await page.waitForFunction(
      (id) =>
        (
          window as unknown as { __fileAnalysis: { hasSession(id: string): boolean } }
        ).__fileAnalysis.hasSession(id),
      sessionId,
    )
    await page.evaluate(
      (id) =>
        (
          window as unknown as { __fileAnalysis: { select(id: string): Promise<void> } }
        ).__fileAnalysis.select(id),
      sessionId,
    )

    if (failSave) {
      const root = path.join(o.failureWorkspace.root, '.dsh-data-analysis')
      await mkdir(root, { recursive: true })
      // A regular file in a disposable Workspace blocks the real writer's directory check.
      await writeFile(path.join(root, 'presentations'), 'validation sentinel', { flag: 'wx' })
    }

    const { events } = await prompt(page, sessionId, label, question, { name, source })
    const end = events.filter((event) => event.type === 'turn/end').at(-1)
    const reason = end?.data.reason
    if (reason?.kind === 'error') {
      const blocked = reason.error.code === 'QUOTA' ? ' blocked' : ' failed'
      throw new Error(`${label}: model turn${blocked}: ${reason.error.message}`)
    }
    assert.equal(reason?.kind, 'completed', `${label}: model turn did not complete`)
    const final = events.filter((event) => event.type === 'assistant/message').at(-1)
    const reply = final?.data.message.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('\n')
      .trim()
    assert.ok(reply, `${label}: missing final chat reply`)
    const receipts = deliveries(events, sessionId)
    const entry = page.getByRole('button', {
      name: /在右侧打开分析视图|Open analysis view in sidebar/,
    })
    if (label === 'implicit-trend') {
      assert.equal(receipts.length, 1, 'The trend question should produce a saved analysis view')
      const firstComputation = events.find(
        (event) =>
          (event.type === 'tool/call' || event.type === 'tool/ptc-dispatch') &&
          event.data.name === 'marivo_python',
      )
      assert.ok(firstComputation, 'The trend answer must compute from the uploaded file')
      const earlyDraft = events.some((event) => {
        if (event.seq >= firstComputation.seq) return false
        const candidates: unknown[] =
          event.type === 'tool/result' && !event.data.message.isError
            ? [event.data.meta]
            : event.type === 'tool/ptc-dispatch' && !event.data.isError
              ? event.data.content.map((item) => ('delivery' in item ? item.delivery : undefined))
              : []
        return candidates.some((value) => {
          const parsed = draftDeliverySchema.safeParse(value)
          return parsed.success && parsed.data.dshSessionId === sessionId
        })
      })
      assert.ok(earlyDraft, 'A successful scope draft must precede the first analysis computation')
      const receipt = receipts[0]!
      const recordId = analysisRecordId(receipt.reportId, receipt.buildId)
      await page
        .locator(`[data-analysis-record="${recordId}"] svg.recharts-surface`)
        .first()
        .waitFor()
      await entry.first().waitFor()
      results.push({ label, reply, buildId: receipt.buildId })
    } else {
      assert.equal(receipts.length, 0, `${label}: unexpected saved analysis view`)
      if (failSave) {
        assert.ok(
          events.some((event) => {
            if (event.type === 'tool/result' && event.data.message.isError)
              return JSON.stringify(event.data.message.content).includes(
                'presentation-directory-mismatch',
              )
            if (event.type === 'tool/ptc-dispatch' && event.data.isError)
              return JSON.stringify(event.data.content).includes('presentation-directory-mismatch')
            return false
          }),
          'The writer must reach the injected storage failure',
        )
      } else {
        assert.equal(await entry.count(), 0, `${label}: unexpected analysis view entry`)
      }
      results.push({ label, reply })
    }
    assert.match(reply, label === 'single-value' ? /90/ : /7\s*月|七月|2025-07|July/i)
  }
  return results
}
