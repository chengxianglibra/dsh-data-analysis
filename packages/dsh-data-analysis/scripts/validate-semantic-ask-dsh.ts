/** Packed production plugin, real Harness composer and Runtime; scripted model boundary. */
import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { DraftReference, InputState } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { type Browser, chromium, type Page } from 'playwright'
import { bindMarivoEnvironment } from '../src/environment/index.ts'
import { dataframeResultReference } from '../src/presentation/contracts/result-reference.ts'
import { preparePresentationInputs } from './presentation-s4/runtime.ts'
import { startPresentationWebHost } from './presentation-s4/web-host.ts'
import { closeReport, openReport } from './right-tabs/browser.ts'

const outputRoot = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-semantic-ask-dsh-')))
const workspaceRoot = path.join(outputRoot, 'workspace')
const python =
  process.env.DSH_DATA_ANALYSIS_PYTHON ??
  path.join(resolveDshHome(), 'dsh-data-analysis/runtimes/marivo/.venv/bin/python')
await mkdir(workspaceRoot)
process.stdout.write(`Semantic Ask DSH acceptance: ${outputRoot}\n`)
const inputs = await preparePresentationInputs(workspaceRoot, python)
const boroughs = [
  'Bronx',
  'Brooklyn',
  'EWR',
  'Manhattan',
  'N/A',
  'Queens',
  'Staten Island',
  'Unknown',
]
const runner = await bindMarivoEnvironment({ projectRoot: workspaceRoot, pythonExecutable: python })
const chartFixture = await runner.runChecked({
  program: `
import json
import marivo.analysis as mv
import pandas as pd
boroughs = ${JSON.stringify(boroughs)}
data = pd.DataFrame({
    "borough": boroughs * 2,
    "period": ["Current"] * len(boroughs) + ["Baseline"] * len(boroughs),
    "fare_revenue": [12, 23, 2, 70, 4, 18, 1, 3, 8, 14, 1, 42, 3, 14, 1, 4],
})
print(json.dumps(mv.persist_dataframe(data).to_dict()))
`,
})
assert.equal(chartFixture.exitCode, 0, chartFixture.stderr.toString('utf8'))
const chartTitle = 'Fare revenue by pickup borough'
inputs.requests.push({
  locale: 'en-US',
  title: chartTitle,
  resourcePatch: {
    put: {
      boroughs: {
        kind: 'dataframe',
        ref: dataframeResultReference.parse(JSON.parse(chartFixture.stdout.toString('utf8'))),
      },
    },
  },
  program:
    'root = DatasetView("boroughs", {chart: "bar", encoding: {axis: "borough", series: "period", values: ["fare_revenue"]}});',
})
const server = await startPresentationWebHost(
  workspaceRoot,
  path.join(outputRoot, 'web'),
  python,
  inputs.requests,
  'native-first',
  { rightTabsAcceptance: true, askDshProbe: true },
)
const id = 'right-tabs-semantic'
let browser: Browser | undefined, page: Page | undefined
const checks: string[] = [],
  errors: string[] = []
const record = (check: string) => {
  checks.push(check)
  process.stdout.write(`PASS ${check}\n`)
}
async function verifyPanelModes(page: Page, name: string, verify: (mode: string) => Promise<void>) {
  const panel = (mode: string) =>
    page.locator(`[data-sidebar-right-panel="${mode}"][data-sidebar-right-open]`)
  await panel('push').waitFor()
  await verify('push')
  await page.screenshot({ path: path.join(outputRoot, `${name}-1600-right-panel.png`) })
  await page.getByRole('button', { name: 'Fullscreen', exact: true }).click()
  await panel('fullscreen').waitFor()
  await verify('fullscreen')
  await page.screenshot({ path: path.join(outputRoot, `${name}-1600-fullscreen.png`) })
  await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click()
  await panel('push').waitFor()
}

try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  page.setDefaultTimeout(25_000)
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') process.stdout.write(`Browser console: ${message.text()}\n`)
  })
  await page.goto(server.url)
  await page.getByRole('button', { name: '继续', exact: true }).click({ timeout: 45_000 })
  await page.getByText('内测声明', { exact: true }).waitFor({ state: 'hidden' })
  const later = page.getByRole('button', { name: '稍后配置', exact: true })
  if (await later.isVisible()) await later.click()
  await page.waitForFunction(() => !!(window as any).__rtHost)
  await page.evaluate((id) => (window as any).__rtHost.select(id), id)
  const read = () => page!.evaluate((id) => (window as any).__askDshProbe.read(id), id)
  const calls = () => page!.evaluate(() => (window as any).__askDshProbe.audit().calls)
  const composer = page.locator('[contenteditable="true"][role="textbox"]:visible')
  await composer.waitFor()
  await page.evaluate(
    (id) =>
      (window as any).__rtHost.selectModel(id, {
        provider: 'right-tabs-semantic',
        model: 'deterministic-seam',
      }),
    id,
  )
  const navigate = (metric = 'sales.revenue') =>
    page!.evaluate(
      ({ id, workspaceId, metric }) =>
        (window as any).__rightTabs.navigate(id, {
          kind: 'semantic',
          workspaceId,
          ref: { schema: 'marivo.semantic_ref/v1', kind: 'metric', path: metric },
        }),
      { id, workspaceId: server.deliveries[0]!.receipt.workspaceId, metric },
    )
  const panel = page.locator('.sb-panel:visible')
  await page.evaluate(() => (window as any).__rtHost.locale.setLocale('en'))
  await navigate('sales.precision_account_id')
  const longTitle = panel.getByRole('heading', { name: 'precision_account_id', exact: true })
  await longTitle.waitFor()
  await verifyPanelModes(page, 'semantic-title', async (mode) => {
    const title = await longTitle.evaluate((node) => {
      const range = document.createRange()
      range.selectNodeContents(node)
      const text = range.getBoundingClientRect()
      const actions = node.closest('.sb-detail-top')!.querySelector('.sb-detail-actions')!
      return {
        lines: range.getClientRects().length,
        actionsBelow: actions.getBoundingClientRect().top >= text.bottom,
        twoColumns: getComputedStyle(node.closest('.sb-columns')!).display === 'grid',
      }
    })
    assert.ok(title.lines <= 2, JSON.stringify(title))
    assert.equal(title.twoColumns, true)
    assert.equal(title.actionsBelow, mode === 'push')
    assert.ok(await panel.getByRole('button', { name: 'Copy reference', exact: true }).isEnabled())
    assert.ok(await panel.getByRole('button', { name: 'Add to question', exact: true }).isEnabled())
  })
  record(
    '1600 px right panel and fullscreen keep a long metric title readable and both actions enabled',
  )
  const chartReceipt = server.deliveries.find((item) => item.receipt.title === chartTitle)?.receipt
  assert.ok(chartReceipt)
  const { workspaceId: chartWorkspaceId, reportId, buildId } = chartReceipt
  const chartReader = await openReport(page, id, {
    workspaceId: chartWorkspaceId,
    reportId,
    buildId,
  })
  const plot = chartReader.locator('[data-resource="boroughs"] .fv-plot')
  const ticks = plot.locator('.recharts-xAxis-tick-labels [data-tick] text')
  const verifyBoroughTicks = async () => {
    await ticks.last().waitFor()
    await page!.waitForFunction((expectedCount) => {
      const svg = document.querySelector('[data-resource="boroughs"] svg.recharts-surface')
      if (!svg) return false
      const bounds = svg.getBoundingClientRect()
      const labels = [...svg.querySelectorAll('.recharts-xAxis-tick-labels [data-tick] text')]
      return (
        labels.length === expectedCount &&
        labels.every((label, index) => {
          const rect = label.getBoundingClientRect()
          const previous = labels[index - 1]?.getBoundingClientRect()
          return (
            rect.left >= bounds.left &&
            rect.right <= bounds.right &&
            (!previous || previous.right < rect.left)
          )
        })
      )
    }, boroughs.length)
    assert.deepEqual(await ticks.allTextContents(), boroughs)
    await plot.evaluate((node) => {
      node.scrollLeft = node.scrollWidth
    })
    const last = await ticks.last().evaluate((node) => ({
      right: node.getBoundingClientRect().right,
      plotRight: node.closest('.fv-plot')!.getBoundingClientRect().right,
    }))
    assert.ok(last.right <= last.plotRight)
    await plot.evaluate((node) => {
      node.scrollLeft = 0
    })
  }
  await verifyPanelModes(page, 'borough-chart', verifyBoroughTicks)
  record('1600 px right panel and fullscreen display all eight borough labels without overlap')
  await page.setViewportSize({ width: 1250, height: 1000 })
  await verifyBoroughTicks()
  assert.ok(await plot.evaluate((node) => node.scrollWidth > node.clientWidth))
  await page.setViewportSize({ width: 1600, height: 1000 })
  record('a narrower right panel scrolls locally to reveal the last borough label')
  await closeReport(page, chartReader)
  await page.evaluate(() => (window as any).__rtHost.locale.setLocale('zh'))
  await navigate()
  await panel.getByRole('heading', { name: 'revenue', exact: true }).waitFor()
  await composer.fill('解释这个对象：')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'fixture.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
      'base64',
    ),
  })
  await page.waitForFunction(
    (id) => (window as any).__askDshProbe.read(id).attachmentIds.length === 1,
    id,
  )
  const before = await read(),
    start = (await calls()).length
  await panel.getByRole('button', { name: '加入提问', exact: true }).click()
  await panel.getByText('已加入提问', { exact: true }).waitFor()
  const after = await read()
  assert.equal(after.occurrences.length, 1)
  assert.ok(after.draft.startsWith(before.draft))
  assert.deepEqual(after.attachmentIds, before.attachmentIds)
  const traffic = (await calls()).slice(start)
  assert.equal(traffic.filter((x: any) => x.endpoint.endsWith('/prepare')).length, 1)
  assert.equal(traffic.filter((x: any) => /candidates|serialize/.test(x.endpoint)).length, 0)
  const chips = composer.locator('[contenteditable="false"]')
  const detailChip = await chips
    .last()
    .evaluate((el) => ({ text: el.textContent, html: el.innerHTML }))
  const detailOccurrence = after.occurrences[0]
  record('first browser insertion without candidates preserves draft and image; no early serialize')
  await composer.focus()
  await page.keyboard.press('Meta+z')
  assert.equal((await read()).draft, before.draft)
  assert.deepEqual((await read()).occurrences, before.occurrences)
  assert.deepEqual((await read()).attachmentIds, before.attachmentIds)
  record('one native undo restores draft, references and image')
  // Actual trigger UI selects the same object in the same Session.
  await composer.press('End')
  await page.keyboard.insertText(' @revenue')
  await page.getByText('指标 · sales.revenue', { exact: true }).click()
  await page.waitForFunction(
    (id) => (window as any).__askDshProbe.read(id).occurrences.length === 1,
    id,
  )
  const atOccurrence = (await read()).occurrences[0]
  for (const key of ['source', 'ref', 'label', 'clipboardText'])
    assert.equal(atOccurrence[key], detailOccurrence[key], key)
  assert.deepEqual(
    await chips.last().evaluate((el) => ({ text: el.textContent, html: el.innerHTML })),
    detailChip,
  )
  record('actual @ picker and details render identical chips and reference payloads')
  await page.evaluate(
    ({ workspaceId }) =>
      (window as any).__rtHost.sidebar.openTab('marivo-semantic', { params: { workspaceId } }),
    { id, workspaceId: server.deliveries[0]!.receipt.workspaceId },
  )
  await panel.locator('.sb-objects button').filter({ hasText: 'metric:sales.revenue' }).click()
  await panel.getByRole('button', { name: '加入提问', exact: true }).click()
  await page.waitForFunction(
    (id) => (window as any).__askDshProbe.read(id).occurrences.length === 2,
    id,
  )
  await page.screenshot({ path: path.join(outputRoot, 'semantic-chips.png'), fullPage: true })
  record('list detail insertion appends one chip and preserves the existing @ chip')
  // Hold a real prepare response, navigate away, then release it after returning.
  await page.evaluate(() => (window as any).__rtHost.delay.arm('/semantic-references/prepare'))
  const stable = await read()
  await panel.getByRole('button', { name: '加入提问', exact: true }).click()
  await page.waitForFunction(() => (window as any).__rtHost.delay.held())
  await page.evaluate(() => (window as any).__rtHost.select('right-tabs-cold'))
  await page.waitForFunction(() => {
    const host = (window as any).__rtHost
    return (
      host.current() === 'right-tabs-cold' && typeof host.history('right-tabs-cold') === 'boolean'
    )
  })
  await page.evaluate((id) => (window as any).__rtHost.select(id), id)
  await page.waitForFunction((id) => (window as any).__rtHost.current() === id, id)
  await page.evaluate(() => (window as any).__rtHost.delay.release())
  await panel.getByRole('button', { name: '加入提问', exact: true }).waitFor()
  const restored = await read()
  // The Host assigns occurrence IDs per composer shell when it restores a draft.
  const references = (state: InputState): DraftReference[] =>
    state.occurrences.map(({ occurrenceId: _, ...reference }) => reference)
  assert.equal(restored.draft, stable.draft)
  assert.deepEqual(references(restored), references(stable))
  record('late prepare cannot write after switching Session away and back')
  // Attachment preservation is checked above. This scripted model fixture exercises text submission only.
  await page.evaluate((id) => {
    const input = (window as any).__rtHost.input(id)
    for (const attachment of input.state.getSnapshot().attachmentIds)
      input.removeAttachment(attachment)
  }, id)
  const submitStart = (await calls()).length
  await page.evaluate(() => (window as any).__rtHost.delay.arm('/semantic-references/prepare'))
  await panel.getByRole('button', { name: '加入提问', exact: true }).click()
  await page.waitForFunction(() => (window as any).__rtHost.delay.held())
  await composer.focus()
  await page.keyboard.press('Enter')
  await page.waitForFunction((id) => (window as any).__askDshProbe.read(id).draft === '', id)
  const modelRequests = () =>
    page!.evaluate(() =>
      (window as any).__s4Rpc('/presentation-s4-validation', 'prototype', {
        action: 'semantic-requests',
      }),
    )
  await page.evaluate(() => (window as any).__rtHost.delay.release())
  await panel
    .getByText('加入提问失败，会话、Workspace 或草稿可能已变化，请检查后重试。', { exact: true })
    .waitFor()
  assert.equal((await read()).draft, '')
  assert.deepEqual((await read()).occurrences, [])
  record('completed submission cancels held preparation; late response leaves the next draft empty')
  let result = await modelRequests()
  const requestDeadline = Date.now() + 25_000
  while (result.ok && result.value.length === 0 && Date.now() < requestDeadline) {
    await page.waitForTimeout(100)
    result = await modelRequests()
  }
  assert.equal(result.ok, true)
  assert.equal(result.value.length, 1)
  assert.equal(result.value[0].marker, true)
  assert.match(result.value[0].text, /sales.revenue/)
  assert.equal((result.value[0].text.match(/<marivo-semantic-ref>/g) ?? []).length, 2)
  assert.equal(
    (await calls()).slice(submitStart).filter((x: any) => x.endpoint.endsWith('/serialize')).length,
    2,
  )
  record(
    'native submit runs original codec for both chips; actual model request contains two semantic markers',
  )
  const sentChips = page.locator('[data-ref-chip="command"][title="@metric:sales.revenue"]:visible')
  const assertSentChips = async () => {
    await sentChips.nth(1).waitFor()
    assert.deepEqual(await sentChips.allTextContents(), [
      'metric:sales.revenue',
      'metric:sales.revenue',
    ])
    assert.equal(await page!.getByText(/<marivo-semantic-ref>/).count(), 0)
  }
  await assertSentChips()
  await page.screenshot({ path: path.join(outputRoot, 'semantic-chips-sent.png') })
  record('sent user message renders both semantic chips')
  // Claim through the public Host editor API, then exercise both real UI insertion paths.
  await page.evaluate((id) => {
    const input = (window as any).__rtHost.input(id)
    const { draftRev } = input.state.getSnapshot()
    if (
      !input.beginCommand(
        { name: 'fixture', token: '/fixture ', submit: async () => ({ kind: 'success' }) },
        { start: 0, end: 0, draftRev },
      )
    )
      throw new Error('command claim failed')
  }, id)
  assert.equal((await read()).phase, 'claimed')
  await panel.getByRole('button', { name: '加入提问', exact: true }).click()
  await page.waitForFunction(
    (id) => (window as any).__askDshProbe.read(id).occurrences.length === 1,
    id,
  )
  await composer.focus()
  await page.keyboard.press('End')
  await page.keyboard.insertText(' @revenue')
  await page.getByText('指标 · sales.revenue', { exact: true }).click()
  await page.waitForFunction(
    (id) => (window as any).__askDshProbe.read(id).occurrences.length === 2,
    id,
  )
  const claimed = await read()
  assert.equal(claimed.phase, 'claimed')
  for (const key of ['source', 'ref', 'label', 'clipboardText'])
    assert.equal(claimed.occurrences[0][key], claimed.occurrences[1][key], key)
  record('claimed command draft accepts details and actual @ with identical references')
  await page.evaluate((id) => (window as any).__rtHost.input(id).setDraft(''), id)
  await page.evaluate(() => (window as any).__rtHost.clear())
  assert.equal(await page.getByRole('button', { name: '打开分析视图', exact: true }).count(), 0)
  record('without a foreground Session, the removed footer report shortcut is absent')
  const recreated = await page.evaluate(() =>
    (window as any).__s4Rpc('/presentation-s4-validation', 'prototype', {
      action: 'semantic-recreate-workspace',
    }),
  )
  assert.equal(recreated.ok, true)
  assert.equal(recreated.value.sameAgent, true)
  const workspaceId = recreated.value.workspaceId
  assert.notEqual(workspaceId, server.deliveries[0]!.receipt.workspaceId)
  await page.waitForFunction(
    ({ id, workspaceId }) =>
      (window as any).__rtHost.workspaces
        .getSnapshot()
        .items.some((w: any) => w.workspaceId === workspaceId && w.sessionIds.includes(id)),
    { id, workspaceId },
  )
  await page.evaluate((id) => (window as any).__rtHost.select(id), id)
  await page.evaluate(
    ({ id, workspaceId }) =>
      (window as any).__rightTabs.navigate(id, {
        kind: 'semantic',
        workspaceId,
        ref: { schema: 'marivo.semantic_ref/v1', kind: 'metric', path: 'sales.revenue' },
      }),
    { id, workspaceId },
  )
  await panel.getByRole('heading', { name: 'revenue', exact: true }).waitFor()
  await panel.getByRole('button', { name: '加入提问', exact: true }).click()
  await page.waitForFunction(
    (id) => (window as any).__askDshProbe.read(id).occurrences.length === 1,
    id,
  )
  const fresh = (await read()).occurrences[0]
  assert.notEqual(
    JSON.parse(fresh.ref).environmentFingerprint,
    JSON.parse(detailOccurrence.ref).environmentFingerprint,
  )
  const serialized = await page.evaluate(
    async ({ old, fresh }) => {
      const serialize = (ref: string) =>
        (window as any).__s4Rpc('/dsh-data-analysis', 'semantic-references/serialize', {
          envelope: JSON.parse(ref),
        })
      return { old: await serialize(old), fresh: await serialize(fresh) }
    },
    { old: detailOccurrence.ref, fresh: fresh.ref },
  )
  assert.equal(serialized.old.ok, false)
  assert.equal(serialized.fresh.ok, true)
  await composer.focus()
  await page.keyboard.press('End')
  await page.keyboard.insertText(' @revenue')
  await page.getByText('指标 · sales.revenue', { exact: true }).click()
  await page.waitForFunction(
    (id) => (window as any).__askDshProbe.read(id).occurrences.length === 2,
    id,
  )
  assert.equal((await read()).occurrences[1].ref, fresh.ref)
  record(
    'same-path Workspace recreation keeps Agent alive; fresh details and @ recover while old reference stays invalid',
  )
  await page.evaluate((id) => (window as any).__rtHost.input(id).setDraft(''), id)
  await page.reload()
  await page.waitForFunction(
    (id) => !!(window as any).__rtHost?.sessions.getSnapshot().byId[id],
    id,
  )
  await page.evaluate((id) => {
    const host = (window as any).__rtHost
    if (host.current() !== id) host.select(id)
  }, id)
  await assertSentChips()
  await page.screenshot({ path: path.join(outputRoot, 'semantic-chips-history.png') })
  record('history reload reconstructs both semantic chips from the saved message')
  assert.deepEqual(errors, [])
  await writeFile(
    path.join(outputRoot, 'evidence.json'),
    JSON.stringify(
      {
        status: 'passed',
        boundary:
          'Real packed production plugin, Harness Web/composer and Marivo; scripted model adapter, no real-model reasoning evaluation',
        checks,
        requests: result.value,
        moduleDigests: server.moduleDigests,
      },
      null,
      2,
    ),
  )
  process.stdout.write(`Semantic Ask DSH passed: ${outputRoot}\n`)
} catch (error) {
  if (page) {
    await writeFile(
      path.join(outputRoot, 'failure-dom.txt'),
      await page.locator('body').innerText(),
    )
    await page.screenshot({ path: path.join(outputRoot, 'failure.png'), fullPage: true })
  }
  await writeFile(
    path.join(outputRoot, 'failure.json'),
    JSON.stringify({ error: String(error), errors }, null, 2),
  )
  throw error
} finally {
  await browser?.close()
  await server.stop()
  const skills = path.join(outputRoot, 'web', 'web-runtime-marker', 'plugin-skills')
  const entries = await readdir(skills, { recursive: true, withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return []
      throw error
    },
  )
  for (const entry of entries)
    if (entry.isDirectory()) await chmod(path.join(entry.parentPath, entry.name), 0o700)
  await rm(workspaceRoot, { recursive: true, force: true })
  await rm(path.dirname(server.home), { recursive: true, force: true })
}
