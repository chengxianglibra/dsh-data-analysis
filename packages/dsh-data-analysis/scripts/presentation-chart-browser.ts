import assert from 'node:assert/strict'
import type { Locator, Page, Request } from 'playwright'
import { CHART_TYPES } from '../src/presentation/contracts/charts.ts'

async function openExplorer(cell: Locator) {
  await cell.getByRole('button', { name: 'cell 更多操作', exact: true }).click()
  await cell.getByRole('menuitem', { name: '探索图表', exact: true }).click()
  return cell.getByRole('region', { name: '探索图表', exact: true })
}

/** Exercise the actual shared reader rather than inferring rendering from responsive SSR. */
export async function verifyChartGallery(page: Page) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  const requests: string[] = []
  const recordRequest = (request: Request) => requests.push(request.url())
  page.on('request', recordRequest)
  const reader = page.locator('[data-presentation-reader][data-mode="interactive"]')
  const cell = (type: string) => reader.locator(`[data-block-id="gallery-${type}"]`)
  for (const type of CHART_TYPES) {
    await cell(type).scrollIntoViewIfNeeded()
    assert.ok(await cell(type).locator('svg').count(), `${type}: no rendered SVG`)
    assert.doesNotMatch(
      (await cell(type).locator('svg').first().getAttribute('viewBox')) ?? '',
      /NaN|Infinity/,
    )
    assert.deepEqual(
      await cell(type)
        .locator('svg *')
        .evaluateAll((nodes) =>
          nodes.flatMap((node) =>
            [...node.attributes]
              .filter(
                (attribute) =>
                  /^(?:d|x|y|cx|cy|r|width|height|transform)$/.test(attribute.name) &&
                  /NaN|Infinity/.test(attribute.value),
              )
              .map((attribute) => `${node.tagName}:${attribute.name}=${attribute.value}`),
          ),
        ),
      [],
      `${type}: invalid SVG coordinate`,
    )
  }
  assert.equal(await cell('boxPlot').locator('[data-box-part="median"]').count(), 2)
  assert.equal(await cell('boxPlot').locator('[data-box-part="whisker"]').count(), 2)
  const widths = await cell('histogram')
    .locator('[data-chart-mark="histogram"] rect')
    .evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute('width'))))
  assert.equal(widths.length, 3)
  assert.ok(
    Math.abs(widths[1]! / widths[0]! - 2) < 0.01,
    'Histogram must preserve unequal numeric bin widths',
  )
  assert.ok(Math.abs(widths[2]! / widths[0]! - 3) < 0.01)
  assert.equal(await cell('heatmap').locator('[data-chart-mark]').count(), 24)
  assert.equal(await cell('waterfall').locator('[data-waterfall-role="delta"]').count(), 2)
  assert.equal(
    await cell('line').locator('.recharts-line-curve[stroke-dasharray="5 5"]').count(),
    1,
  )
  assert.equal(
    await cell('dotted').locator('.recharts-line-curve[stroke-dasharray="2 4"]').count(),
    1,
  )
  assert.match(await cell('line').innerText(), /参考值/)

  const line = cell('line')
  const panel = await openExplorer(line)
  assert.equal(
    await panel.getByRole('combobox', { name: '图形类型', exact: true }).locator('option').count(),
    18,
  )
  assert.ok(
    await panel
      .getByRole('combobox', { name: '图形类型', exact: true })
      .locator('option[value="histogram"]')
      .evaluate((node: HTMLOptionElement) => node.disabled),
  )
  await panel.getByRole('combobox', { name: '图形类型', exact: true }).selectOption('horizontalBar')
  await panel.getByRole('combobox', { name: 'X 字段', exact: true }).selectOption('coordinate')
  await panel.getByRole('checkbox', { name: 'b', exact: true }).uncheck()
  assert.equal(await panel.getByText('分类过滤', { exact: true }).count(), 0)
  assert.equal(await line.locator('.recharts-bar-rectangle').count(), 12)
  await line.getByRole('button', { name: 'cell 更多操作', exact: true }).click()
  await line.getByRole('menuitem', { name: '数据源', exact: true }).click()
  const dialog = reader.locator('dialog.pr-source-dialog')
  await dialog.getByRole('tab', { name: '数据预览', exact: true }).click()
  assert.equal(await dialog.locator('tbody tr').count(), 12)
  assert.deepEqual(
    await dialog
      .locator('tbody tr')
      .evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute('data-row-index')))),
    Array.from({ length: 12 }, (_, i) => i),
  )
  assert.deepEqual(
    await dialog
      .locator('thead th button')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label'))),
    ['按 coordinate 排序', '按 a 排序'],
  )
  await dialog.press('Escape')
  await line.getByRole('button', { name: 'cell 更多操作', exact: true }).click()
  await line.getByRole('menuitem', { name: '复制上下文', exact: true }).click()
  await line.getByText('已复制', { exact: true }).waitFor()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  assert.match(copied, /Build ID: chart-gallery/)
  assert.match(copied, /Saved chart binding: .*"chart":"line"/)
  assert.match(copied, /Current chart binding: .*"chart":"horizontalBar"/)
  assert.match(copied, /"x":"coordinate","y":\["a"\]/)
  assert.doesNotMatch(copied, /Category filters:/)
  assert.match(
    copied,
    /page-local exploration \(not saved; full-report download retains original chart\)/,
  )
  await panel.getByRole('button', { name: '恢复原图', exact: true }).click()
  assert.equal(
    await panel.getByRole('combobox', { name: '图形类型', exact: true }).inputValue(),
    'line',
  )
  const forecast = line.getByRole('button', { name: '显示系列 b', exact: true })
  await forecast.focus()
  await forecast.press('Space')
  assert.equal(await line.locator('.recharts-line-curve').count(), 1)
  await panel.getByRole('button', { name: '恢复原图', exact: true }).click()
  assert.equal(await line.locator('.recharts-line-curve').count(), 2)
  await panel.getByRole('combobox', { name: '数据点', exact: true }).selectOption('never')
  assert.equal(await line.locator('[data-chart-point]').count(), 0)
  await panel.getByRole('combobox', { name: 'a 线型', exact: true }).selectOption('dotted')
  assert.equal(
    await line.locator('.recharts-line-curve').first().getAttribute('stroke-dasharray'),
    '2 4',
  )
  await panel.getByRole('combobox', { name: 'a 角色', exact: true }).selectOption('target')
  assert.equal(await line.getByText('target', { exact: true }).count(), 1)
  await panel.getByRole('button', { name: '恢复原图', exact: true }).click()
  await panel
    .getByRole('combobox', { name: '已准备视图', exact: true })
    .selectOption('prepared-boxPlot')
  assert.equal(await line.locator('[data-box-part="median"]').count(), 2)
  await panel
    .getByRole('combobox', { name: '已准备视图', exact: true })
    .selectOption('prepared-stackedBar100')
  assert.equal(
    await panel.getByRole('combobox', { name: '柱形模式', exact: true }).inputValue(),
    'percent',
  )
  await panel.getByRole('combobox', { name: '方向', exact: true }).selectOption('horizontal')
  assert.equal(
    await panel.getByRole('combobox', { name: '图形类型', exact: true }).inputValue(),
    'horizontalStackedBar100',
  )
  await panel.getByRole('button', { name: '恢复原图', exact: true }).click()
  await panel.getByRole('button', { name: '关闭探索图表', exact: true }).click()

  const percent = cell('stackedBar100')
  const beforePercent = await percent.locator('.recharts-bar-rectangle').first().boundingBox()
  assert.ok(beforePercent)
  await percent.getByRole('button', { name: '显示系列 b', exact: true }).click()
  const afterPercent = await percent.locator('.recharts-bar-rectangle').first().boundingBox()
  assert.ok(afterPercent)
  assert.ok(
    Math.abs(afterPercent.height - beforePercent.height) < 0.01,
    'Hiding a percentage series changed the authored denominator',
  )
  await percent.getByRole('button', { name: '显示系列 b', exact: true }).click()

  const pie = cell('pie')
  const mark = pie.locator('[data-source-row-index="1"][data-chart-mark]')
  const authoredShare =
    Number(await mark.getAttribute('data-share-end')) -
    Number(await mark.getAttribute('data-share-start'))
  await reader.getByRole('button', { name: /^展示范围/ }).click()
  await reader.getByRole('menuitemradio', { name: '第二条观测', exact: true }).click()
  assert.equal(await pie.locator('[data-chart-mark]').count(), 1)
  assert.equal(Number(await mark.getAttribute('data-share-start')), 0)
  assert.ok(
    Math.abs(Number(await mark.getAttribute('data-share-end')) - authoredShare) < 0.000001,
    'Global slice must preserve the supplied share extent without normalizing it to a full circle',
  )

  await page.emulateMedia({ media: 'print' })
  const print = page.locator('[data-presentation-reader][data-mode="static"]')
  assert.ok(await print.isVisible())
  assert.equal(await print.locator('[data-block-id="gallery-pie"] tbody tr').count(), 3)
  assert.equal(await print.locator('[data-block-id="gallery-line"] tbody tr').count(), 12)
  await page.emulateMedia({ media: 'screen' })
  assert.equal(await pie.locator('[data-chart-mark]').count(), 1)
  await reader.getByRole('button', { name: '重置筛选', exact: true }).click()
  page.off('request', recordRequest)
  assert.deepEqual(requests, [], 'Exploration must not request network or Runtime data')
  return {
    allTypes: [...CHART_TYPES],
    geometry: true,
    fieldSelection: true,
    preparedViews: true,
    originalRowIdentity: true,
    copiedSavedAndExploredBindings: true,
    keyboardSeriesVisibility: true,
    lineStyleAndPoints: true,
    fixedPercentageHeights: true,
    explorationRequests: requests,
    fixedPieShares: true,
    originalPrintSnapshot: true,
    reset: true,
  }
}

export async function verifyChartReopen(page: Page, reopen: () => Promise<void>) {
  const reader = page.locator('[data-mode="interactive"]')
  const line = reader.locator('[data-block-id="gallery-line"]')
  const panel = await openExplorer(line)
  await panel.getByRole('combobox', { name: '图形类型', exact: true }).selectOption('horizontalBar')
  await reader.getByRole('button', { name: /^展示范围/ }).click()
  await reader.getByRole('menuitemradio', { name: '第二条观测', exact: true }).click()
  await panel.getByRole('checkbox', { name: '显示 b', exact: true }).uncheck()
  await reopen()
  await line.locator('.recharts-line-curve').first().waitFor()
  assert.equal(await line.getByRole('region', { name: '探索图表', exact: true }).count(), 0)
  assert.equal(await line.locator('.recharts-line-curve').count(), 2)
  assert.equal(
    await line
      .getByRole('button', { name: '显示系列 b', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  )
  assert.equal(await line.locator('[data-chart-point]').count(), 24)
  return { reopenedAuthoredView: true, clearedFilterAndVisibility: true }
}
