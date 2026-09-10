/** Real native Tab/composer and offline reference acceptance, using only isolated fixtures. */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Browser, Page } from 'playwright'
import {
  applyPresentationEdits,
  presentationEdits,
} from '../../src/presentation/contracts/editing.ts'
import { parsePresentationDocument } from '../../src/presentation/contracts/index.ts'
import type { PresentationReceipt } from '../../src/presentation/contracts/types.ts'
import { interactionFixture } from '../../tests/presentation-reader/interaction-fixture.ts'
import { presentationHtml } from '../presentation-html.ts'

const specialCellId = 'foo\nbar\r\t"\\😀'

export async function prepareContextReferenceInput(root: string): Promise<string> {
  const { draft, document } = await interactionFixture()
  draft.blocks.push(
    { id: 'foo', kind: 'markdown', text: 'Wrong prefix cell' },
    { id: specialCellId, kind: 'markdown', text: 'Exact special-character cell' },
  )
  for (const dataset of draft.datasets) {
    if (dataset.kind !== 'computed') throw new Error('Expected computed fixture')
    dataset.path = `reference-${dataset.id}.json`
    await writeFile(
      path.join(root, dataset.path),
      JSON.stringify(document.datasets.find((entry) => entry.id === dataset.id)!.data, null, 2),
    )
  }
  const filename = 'context-reference.draft.json'
  await writeFile(path.join(root, filename), JSON.stringify(draft, null, 2))
  return filename
}

export async function verifyNativeContextReference(
  page: Page,
  browser: Browser,
  receipt: PresentationReceipt,
  precise: PresentationReceipt,
  outputRoot: string,
) {
  const sessionId = 'right-tabs-native'
  const snapshot = () => page.evaluate((id) => (window as any).__askDshProbe.read(id), sessionId)
  const composer = page.locator('[contenteditable="true"][role="textbox"]:visible')
  const open = async (target: PresentationReceipt) => {
    await page.evaluate(
      (receipt) =>
        (window as any).__rightTabs.navigate('right-tabs-native', {
          kind: 'report',
          workspaceId: receipt.workspaceId,
          reportId: receipt.reportId,
          buildId: receipt.buildId,
        }),
      target,
    )
    const reader = page.locator(`[data-rt-kind=report][data-rt-build="${target.buildId}"]`)
    await reader.waitFor()
    return reader
  }
  let reader = await open(receipt)
  const ask = async (id: string) => {
    const before = await snapshot()
    const escapedId = await page.evaluate((id) => CSS.escape(id), id)
    const cell = reader.locator(`[data-mode=interactive] [data-block-id=${escapedId}]`)
    await cell.getByRole('button', { name: 'cell 更多操作', exact: true }).click()
    await cell.getByRole('menuitem', { name: /^(加入提问|Add to question)$/ }).click()
    const after = await snapshot()
    if (after.occurrences.length === before.occurrences.length) return ''
    return JSON.parse(after.occurrences.at(-1).ref).context.replace(/^\n\n/, '') as string
  }
  await reader.getByRole('button', { name: /^日期/ }).click()
  await reader.getByRole('menuitemradio', { name: '周一', exact: true }).click()
  await reader.getByRole('button', { name: /^集群/ }).click()
  await reader.getByRole('menuitemradio', { name: '甲集群', exact: true }).click()
  const filtered = await ask('count')
  assert.match(filtered, /"optionId":"mon"/)
  assert.match(filtered, /"optionId":"a"/)
  assert.doesNotMatch(filtered, /150|Metric raw|Snapshot row/)
  const readReference = async (reference: string) => {
    const result = await page.evaluate(
      (reference) =>
        (window as any).__s4Rpc('/presentation-s4-validation', 'prototype', {
          action: 'reference-read',
          reference,
        }),
      reference,
    )
    assert.equal(result.ok, true, JSON.stringify(result))
    return result.value
  }
  const read = await readReference(filtered)
  await writeFile(
    path.join(outputRoot, 'reference-filtered-read.json'),
    JSON.stringify(read, null, 2),
  )
  assert.equal(read.exactValue, '150')
  assert.deepEqual(read.rows, [4])
  const specialRead = await readReference(await ask(specialCellId))
  assert.equal(specialRead.cellId, specialCellId)
  assert.equal(specialRead.kind, 'markdown')
  const document = parsePresentationDocument(
    JSON.parse(await readFile(receipt.files.document.path, 'utf8')),
  )
  const table = document.blocks.find((block) => block.kind === 'table')!
  if (table.kind !== 'table') throw new Error('Expected table')
  const tableCell = reader.locator(`[data-mode=interactive] [data-block-id="${table.id}"]`)
  await tableCell.locator('thead button').first().click()
  const sorted = await ask(table.id)
  assert.match(sorted, /Table sort: .*"direction":"ascending"/)
  assert.match(sorted, /all filtered rows, not only the visible page/)
  await composer.fill('保留我的问题、两个引用和附件：')
  const reference = {
    source: 'marivo-semantic',
    ref: JSON.stringify({
      schema: 'dsh-data-analysis-semantic-reference/v1',
      sessionId,
      environmentFingerprint: 'acceptance-only',
      ref: { schema: 'marivo.semantic_ref/v1', kind: 'metric', path: 'sales.revenue' },
    }),
    label: '收入',
    clipboardText: '@metric:sales.revenue',
  }
  for (let i = 0; i < 2; i++)
    assert.equal(
      await page.evaluate(({ id, ref }) => (window as any).__askDshProbe.insertReference(id, ref), {
        id: sessionId,
        ref: reference,
      }),
      true,
    )
  await page.locator('input[type="file"]').setInputFiles({
    name: 'reference.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=',
      'base64',
    ),
  })
  await page.waitForFunction(
    (id) => (window as any).__askDshProbe.read(id).attachmentIds.length === 1,
    sessionId,
  )
  const rich = await snapshot()
  assert.equal(rich.occurrences.length, 2)
  assert.notEqual(rich.occurrences[0].occurrenceId, rich.occurrences[1].occurrenceId)
  // Let the Host's 1000 ms reference-insert history group settle before the next action.
  await page.waitForTimeout(1100)
  const appended = await ask('count')
  const after = await snapshot()
  assert.deepEqual(after.occurrences.slice(0, -1), rich.occurrences)
  assert.equal(after.occurrences.at(-1).source, 'marivo-report-cell')
  assert.deepEqual(after.attachmentIds, rich.attachmentIds)
  await composer.focus()
  await page.keyboard.press('Meta+z')
  assert.deepEqual(await snapshot(), { ...rich, draftRev: (await snapshot()).draftRev })
  await ask('count')
  const once = (await snapshot()).draft
  await ask('count')
  assert.equal((await snapshot()).draft, `${once}\n\n${appended} `)
  const beforeFailure = await snapshot()
  await page.evaluate(() => (window as any).__askDshProbe.failNext('write'))
  await ask('count')
  assert.deepEqual(await snapshot(), beforeFailure)
  await reader.getByText('Ask DSH validation: draft write failed', { exact: true }).waitFor()
  await ask('count')
  assert.equal(
    await reader.getByText('Ask DSH validation: draft write failed', { exact: true }).count(),
    0,
  )

  reader = await open(precise)
  const exact = await ask('metric')
  const preciseRead = await readReference(exact)
  assert.equal(preciseRead.exactValue, '9007199254740993')
  const preciseDocument = parsePresentationDocument(
    JSON.parse(await readFile(precise.files.document.path, 'utf8')),
  )
  const edits = presentationEdits(preciseDocument)
  const intro = edits.blocks.find((block) => block.id === 'intro')!
  if (intro.kind !== 'markdown') throw new Error('Expected Markdown')
  intro.text = '中'.repeat(32768)
  const bar = edits.blocks.find((block) => block.id === 'bar')!
  if (bar.kind !== 'chart') throw new Error('Expected bar')
  bar.chart = 'line'
  bar.options = {
    ...bar.options,
    referenceLines: Array.from({ length: 16 }, (_, i) => ({
      axis: 'y' as const,
      value: i + 1,
      label: '界'.repeat(256),
    })),
  }
  applyPresentationEdits(preciseDocument, edits)
  const saved = await page.evaluate(
    (payload) => (window as any).__s4Rpc('/marivo-presentation', 'reports/save', payload),
    {
      workspaceId: precise.workspaceId,
      reportId: precise.reportId,
      expectedBuildId: precise.buildId,
      edits,
    },
  )
  assert.equal(saved.ok, true, JSON.stringify(saved))
  const large: PresentationReceipt = saved.value.receipt ?? saved.value
  assert.deepEqual(await readReference(exact), preciseRead)
  reader = await open(large)
  const markdown = await ask('intro')
  assert.ok(Buffer.byteLength(markdown) < 1024)
  assert.doesNotMatch(markdown, /中/)
  const explore = async () => {
    const cell = reader.locator('[data-mode=interactive] [data-block-id=bar]')
    await cell.getByRole('button', { name: 'cell 更多操作' }).click()
    await cell.getByRole('menuitem', { name: '探索图表', exact: true }).click()
    return reader.getByRole('region', { name: '探索图表', exact: true })
  }
  const explorer = await explore()
  await explorer.getByRole('combobox', { name: '数据点', exact: true }).selectOption('always')
  const oversizeBefore = await snapshot()
  await ask('bar')
  await reader.getByRole('alert').filter({ hasText: '12 KiB' }).waitFor()
  assert.deepEqual(await snapshot(), oversizeBefore)
  await explorer.getByRole('button', { name: '恢复原图', exact: true }).click()
  await ask('bar')
  assert.equal(await reader.getByRole('alert').filter({ hasText: '12 KiB' }).count(), 0)

  const offline = await browser.newContext({ offline: true })
  try {
    const portable = await offline.newPage()
    await portable.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            ;(window as any).__copied = text
          },
        },
      })
    })
    const portablePath = path.join(
      await mkdtemp(path.join(tmpdir(), 'explicit-html-')),
      'report.html',
    )
    await writeFile(portablePath, await presentationHtml(large))
    await portable.goto(pathToFileURL(portablePath).href)
    const copy = async (id: string) => {
      const cell = portable.locator(`[data-mode=interactive] [data-block-id="${id}"]`)
      await cell.getByRole('button', { name: 'cell 更多操作' }).click()
      await cell.getByRole('menuitem', { name: '复制上下文', exact: true }).click()
    }
    await copy('intro')
    const copied = await portable.evaluate(() => (window as any).__copied)
    assert.equal(markdown, `【报告上下文】\n${copied}\n【报告上下文结束】`)
    const offlineCell = portable.locator('[data-mode=interactive] [data-block-id=bar]')
    await offlineCell.getByRole('button', { name: 'cell 更多操作' }).click()
    await offlineCell.getByRole('menuitem', { name: '探索图表', exact: true }).click()
    await portable
      .getByRole('region', { name: '探索图表', exact: true })
      .getByRole('combobox', { name: '数据点', exact: true })
      .selectOption('always')
    await copy('bar')
    await offlineCell.getByRole('alert').filter({ hasText: '12 KiB' }).waitFor()
    assert.equal(await portable.evaluate(() => (window as any).__copied), copied)
    assert.equal(
      await portable.getByRole('dialog', { name: '手动复制 cell 上下文', exact: true }).isVisible(),
      false,
    )
    await portable.getByRole('button', { name: '恢复原图', exact: true }).click()
    await portable.evaluate(() =>
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }),
    )
    await copy('bar')
    const manual = portable.getByRole('dialog', { name: '手动复制 cell 上下文', exact: true })
    await manual.waitFor()
    assert.match(await manual.getByRole('textbox').inputValue(), /Cell: "bar"/)
    await portable.screenshot({
      path: path.join(outputRoot, 'reference-offline.png'),
      fullPage: true,
    })
  } finally {
    await offline.close()
  }
  // Native submit through the real Host; only the model adapter is scripted.
  await composer.fill('请解释所选指标。')
  reader = await open(receipt)
  const submittedFiltered = await ask('count')
  reader = await open(precise)
  const submittedExact = await ask('metric')
  assert.equal(await composer.locator('[data-composer-chip=marivo-report-cell]').count(), 2)
  assert.doesNotMatch(await composer.innerText(), /报告上下文|Build ID:/)
  await page.screenshot({ path: path.join(outputRoot, 'report-cell-chips.png'), fullPage: true })
  await page.evaluate((id) => {
    const input = (window as any).__rtHost.input(id)
    for (const attachment of input.state.getSnapshot().attachmentIds)
      input.removeAttachment(attachment)
    return (window as any).__rtHost.selectModel(id, {
      provider: 'right-tabs-semantic',
      model: 'deterministic-seam',
    })
  }, sessionId)
  await composer.focus()
  await page.keyboard.press('Enter')
  await page.waitForFunction((id) => (window as any).__askDshProbe.read(id).draft === '', sessionId)
  let captured: any
  const deadline = Date.now() + 25_000
  do {
    const result = await page.evaluate(() =>
      (window as any).__s4Rpc('/presentation-s4-validation', 'prototype', {
        action: 'semantic-requests',
      }),
    )
    assert.equal(result.ok, true)
    captured = result.value.find((request: any) => request.reportText)
    if (!captured) await page.waitForTimeout(100)
  } while (!captured && Date.now() < deadline)
  assert.ok(captured, 'Actual model request must receive expanded report references')
  assert.ok(captured.reportText.includes(submittedFiltered))
  assert.ok(captured.reportText.includes(submittedExact))
  assert.ok(captured.reportText.includes('请解释所选指标。'))
  await writeFile(
    path.join(outputRoot, 'report-cell-model-request.json'),
    JSON.stringify(captured, null, 2),
  )
  const evidence = {
    filteredRead: read,
    exactRead: preciseRead,
    filteredBytes: Buffer.byteLength(filtered),
    markdownBytes: Buffer.byteLength(markdown),
    nativeRichDraftAndUndo: true,
    compactReportCellChips: true,
    nativeSubmitExpandsFullContext: true,
    sorting: true,
    repeatedAppend: true,
    specialCharacterIdentityRead: specialRead,
    oversizePreservesDraftAndClipboard: true,
    offlineCopyAndFallback: true,
  }
  await writeFile(
    path.join(outputRoot, 'context-reference-evidence.json'),
    JSON.stringify(evidence, null, 2),
  )
  return evidence
}
