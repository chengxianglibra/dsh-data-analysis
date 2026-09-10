/** Ask DSH through the real alpha composer, with read-only state and boundary-failure probes. */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Browser, Page } from 'playwright'
import type { PresentationDelivery } from '../../src/presentation/receipt.ts'
import { presentationHtml } from '../presentation-html.ts'

export async function verifyAskDsh(
  page: Page,
  browser: Browser,
  deliveries: readonly PresentationDelivery[],
  durableSessionId: string,
  outputRoot: string,
) {
  const precise = deliveries.find((delivery) => delivery.receipt.title === 'S4 精确 computed')!
  const gallery = deliveries.find((delivery) => delivery.receipt.title.includes('图表与探索样例'))!
  assert.ok(precise && gallery, 'Ask DSH validation requires computed and chart gallery reports')
  const sessionId = precise.dshSessionId
  const composer = page.locator('[contenteditable="true"][role="textbox"]:visible')
  const overlay = page.getByRole('dialog', { name: '分析快照', exact: true })
  const reader = overlay.locator('[data-presentation-reader][data-mode="interactive"]')
  const cell = (id: string) => reader.locator(`[data-block-id="${id}"]`)
  const snapshot = () => page.evaluate((id) => (window as any).__askDshProbe.read(id), sessionId)
  const audit = () => page.evaluate(() => (window as any).__askDshProbe.audit())
  const events = () =>
    page.evaluate(() => (window as any).__s4Rpc('/presentation-s4-validation', 'events', {}))
  const open = async (delivery = precise) => {
    await page
      .locator(`[data-presentation-card="${delivery.receipt.buildId}"]`)
      .getByRole('button', { name: '打开分析', exact: true })
      .click()
    await reader.getByRole('heading', { name: delivery.receipt.title, exact: true }).waitFor()
  }
  const ask = async (id: string, keyboard = false) => {
    const trigger = cell(id).getByRole('button', { name: 'cell 更多操作', exact: true })
    if (keyboard) {
      await trigger.focus()
      await page.keyboard.press('Enter')
      await page.keyboard.press('End')
      assert.equal(
        await cell(id)
          .getByRole('menuitem', { name: /^(加入提问|Add to question)$/ })
          .evaluate((element) => element === document.activeElement),
        true,
      )
      await page.keyboard.press('Enter')
    } else {
      await trigger.click()
      await cell(id)
        .getByRole('menuitem', { name: /^(加入提问|Add to question)$/ })
        .click()
    }
  }
  const durableBefore = await page.evaluate(
    (id) => (window as any).__s4Rpc('/presentation-s4-validation', 'events', { sessionId: id }),
    durableSessionId,
  )
  const eventsBefore = await events()
  assert.equal(eventsBefore.ok, true)
  const documentBytes = await Promise.all(
    deliveries.map((delivery) => readFile(delivery.receipt.files.document.path)),
  )
  const before = await audit()
  await composer.waitFor()
  assert.equal((await snapshot()).draft, '')
  await open()
  await ask('metric')
  await overlay.waitFor({ state: 'detached' })
  const first = (await snapshot()).draft.trimEnd()
  assert.ok(first.startsWith('【报告上下文】\n'))
  assert.ok(first.endsWith('\n【报告上下文结束】'))
  assert.ok(first.includes(`Build ID: ${precise.receipt.buildId}`))
  assert.ok(first.includes('Cell: "metric"'))
  assert.ok(first.includes('Report file (relative to this Workspace):'))
  assert.ok(!first.includes('来源 account:'))
  assert.equal((await audit()).writes - before.writes, 1)
  assert.equal((await snapshot()).draft, first + ' ')
  const chip = composer.locator('[data-composer-chip=marivo-report-cell]')
  assert.equal(await chip.count(), 1)
  assert.match(await chip.innerText(), /^# /)
  assert.doesNotMatch(await composer.innerText(), /Build ID:|报告上下文/)
  assert.equal(
    await page.evaluate((id) => (window as any).__askDshProbe.serializeLast(id), sessionId),
    first,
  )

  await composer.fill('请解释这些指标，保留我的问题。')
  const typed = (await snapshot()).draft
  await open(gallery)
  await reader.getByRole('button', { name: /展示范围/ }).click()
  await reader.getByRole('menuitemradio', { name: '第二条观测', exact: true }).click()
  await cell('gallery-line').getByRole('button', { name: 'cell 更多操作', exact: true }).click()
  await cell('gallery-line').getByRole('menuitem', { name: '探索图表', exact: true }).click()
  await cell('gallery-line')
    .getByRole('combobox', { name: '已准备视图', exact: true })
    .selectOption('prepared-histogram')
  await ask('gallery-line', true)
  await overlay.waitFor({ state: 'detached' })
  const filtered = (await snapshot()).draft
  assert.ok(filtered.startsWith(`${typed}\n\n【报告上下文】\n`))
  assert.ok(filtered.includes('展示范围：第二条观测'))
  assert.ok(!filtered.includes('Snapshot row indices:'))
  assert.ok(filtered.includes('Prepared view: "prepared-histogram"'))
  assert.ok(!filtered.includes('Current chart view override:'))
  assert.equal((await audit()).writes - before.writes, 2)

  await open()
  await ask('metric')
  await overlay.waitFor({ state: 'detached' })
  const repeated = (await snapshot()).draft
  assert.equal(repeated, `${filtered}\n\n${first} `)
  assert.equal((await audit()).writes - before.writes, 3)

  await open()
  await overlay.getByRole('button', { name: '编辑报告', exact: true }).click()
  await cell('metric').getByRole('button', { name: 'cell 更多操作', exact: true }).click()
  const disabledAsk = cell('metric').getByRole('menuitem', { name: /^(加入提问|Add to question)$/ })
  assert.equal(await disabledAsk.isDisabled(), true)
  await cell('metric').getByText('请先保存或取消编辑', { exact: true }).waitFor()
  const editingWrites = (await audit()).writes
  await disabledAsk.focus()
  for (const key of ['Enter', 'Space']) {
    await page.keyboard.press(key)
    assert.equal(await disabledAsk.isVisible(), true)
    assert.equal(await overlay.isVisible(), true)
    assert.equal((await snapshot()).draft, repeated)
    assert.equal((await audit()).writes, editingWrites)
  }
  const buttonBounds = await disabledAsk.boundingBox()
  assert.ok(buttonBounds)
  await page.mouse.click(
    buttonBounds.x + buttonBounds.width / 2,
    buttonBounds.y + buttonBounds.height / 2,
  )
  assert.equal(await disabledAsk.isVisible(), true)
  assert.equal(await overlay.isVisible(), true)
  assert.equal((await snapshot()).draft, repeated)
  assert.equal((await audit()).writes, editingWrites)
  await page.keyboard.press('Escape')
  await overlay.getByRole('button', { name: '取消编辑', exact: true }).click()

  for (const kind of ['scope', 'write']) {
    const stateBefore = await snapshot()
    await page.evaluate((failure) => (window as any).__askDshProbe.failNext(failure), kind)
    await ask('metric')
    await overlay
      .getByRole('alert')
      .filter({
        hasText:
          kind === 'scope' ? '报告所属 Session 或 Workspace 已变化或不可用' : 'Ask DSH validation:',
      })
      .waitFor()
    assert.equal(await overlay.isVisible(), true)
    assert.deepEqual(await snapshot(), stateBefore)
    await overlay.screenshot({ path: path.join(outputRoot, `ask-dsh-${kind}-failure.png`) })
  }
  await overlay.getByRole('button', { name: '关闭分析快照', exact: true }).click()
  await overlay.waitFor({ state: 'detached' })
  await page.screenshot({ path: path.join(outputRoot, 'ask-dsh-composer.png') })

  // Exercise alpha's real Lexical chips and browser-owned upload attachments.
  await composer.fill('保留引用与附件：')
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
  for (let index = 0; index < 2; index++)
    assert.equal(
      await page.evaluate(({ id, ref }) => (window as any).__askDshProbe.insertReference(id, ref), {
        id: sessionId,
        ref: reference,
      }),
      true,
    )
  await page.locator('input[type="file"]').setInputFiles({
    name: 'ask-dsh-attachment.png',
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
  const richBefore = await snapshot()
  assert.equal(richBefore.occurrences.length, 2)
  assert.notEqual(richBefore.occurrences[0].occurrenceId, richBefore.occurrences[1].occurrenceId)
  // Let the Host's 1000 ms reference-insert history group settle before the next action.
  await page.waitForTimeout(1100)
  await open()
  await ask('metric')
  await overlay.waitFor({ state: 'detached' })
  const richAfter = await snapshot()
  assert.equal(richAfter.draft, richBefore.draft + '\n\n' + first + ' ')
  assert.deepEqual(richAfter.occurrences.slice(0, -1), richBefore.occurrences)
  assert.equal(richAfter.occurrences.at(-1).source, 'marivo-report-cell')
  assert.deepEqual(richAfter.attachmentIds, richBefore.attachmentIds)
  await composer.focus()
  await page.keyboard.press('Meta+z')
  const undone = await snapshot()
  assert.equal(undone.draft, richBefore.draft)
  assert.deepEqual(undone.occurrences, richBefore.occurrences)
  assert.deepEqual(undone.attachmentIds, richBefore.attachmentIds)

  const offline = await browser.newContext({ offline: true })
  try {
    const portable = await offline.newPage()
    await portable.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    })
    const portablePath = path.join(
      await mkdtemp(path.join(tmpdir(), 'explicit-html-')),
      'report.html',
    )
    await writeFile(portablePath, await presentationHtml(precise.receipt))
    await portable.goto(pathToFileURL(portablePath).href)
    const savedCell = portable.locator('[data-mode="interactive"] [data-block-id="metric"]')
    await savedCell.getByRole('button', { name: 'cell 更多操作', exact: true }).click()
    assert.equal(
      await savedCell.getByRole('menuitem', { name: /^(加入提问|Add to question)$/ }).count(),
      0,
    )
    await savedCell.getByRole('menuitem', { name: '复制上下文', exact: true }).click()
    const manual = portable.getByRole('dialog', { name: '手动复制 cell 上下文', exact: true })
    await manual.waitFor()
    assert.ok(
      (await manual.getByRole('textbox', { name: 'cell 上下文' }).inputValue()).includes(
        'Cell: "metric"',
      ),
    )
  } finally {
    await offline.close()
  }

  assert.deepEqual(await events(), eventsBefore, 'Ask DSH must not add user/Agent/Tool events')
  assert.deepEqual(
    await page.evaluate(
      (id) => (window as any).__s4Rpc('/presentation-s4-validation', 'events', { sessionId: id }),
      durableSessionId,
    ),
    durableBefore,
    'Ask DSH must not persist a message',
  )
  for (const [index, delivery] of deliveries.entries())
    assert.deepEqual(await readFile(delivery.receipt.files.document.path), documentBytes[index])
  const after = await audit()
  const calls = after.calls.slice(before.calls.length) as { channel: string; endpoint: string }[]
  assert.equal(calls.filter((call) => call.endpoint === 'reports/save').length, 0)
  assert.equal(calls.filter((call) => /submit|send|serialize/i.test(call.endpoint)).length, 0)
  return {
    emptyDraft: true,
    compactReportCellChip: true,
    hostCodecPreservesFullContext: true,
    existingDraft: true,
    repeatedAppend: true,
    realLexicalReferencesPreserved: true,
    uploadedAttachmentPreserved: true,
    undoRestoresRichDraftOutsideHostMergeWindow: true,
    fixedBuildCellReference: true,
    filterAndPreparedView: true,
    keyboard: true,
    editingDisabled: true,
    injectedSessionFailureRetainsReport: true,
    injectedWriteFailureRetainsReport: true,
    offlineManualCopy: true,
    agentAndUserEventsUnchanged: true,
    documentBytesUnchanged: true,
    rpcCalls: calls,
    productionDraftWriteAttempts: after.writes - before.writes,
  }
}
