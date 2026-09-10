/** Production portable reader and downloaded files, using synthetic data; no Runtime or Harness claim. */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium, type Page } from 'playwright'
import { buildPresentation } from '../src/presentation/build/index.ts'
import { parsePresentationDocument } from '../src/presentation/contracts/index.ts'
import { interactionFixture } from '../tests/presentation-reader/interaction-fixture.ts'
import { chartGallery } from './presentation-chart-gallery.ts'

const output = await mkdtemp(path.join(tmpdir(), 'dsh-presentation-export-'))
process.stdout.write(`Export acceptance: ${output}\n`)
const browser = await chromium.launch({ headless: true })
const errors: string[] = []
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
})
const page = await context.newPage()
page.setDefaultTimeout(15000)
page.on('pageerror', (error) => errors.push(error.message))
const download = async (target: Page, name: string, filename: string) => {
  await target.getByRole('button', { name: '导出报告', exact: true }).click()
  const pending = target.waitForEvent('download')
  await target.getByRole('menuitem', { name, exact: true }).click()
  const result = await pending
  const file = path.join(output, filename)
  await result.saveAs(file)
  return file
}
const choose = async (field: string, option: string) => {
  await page.getByRole('button', { name: new RegExp(`^${field}`) }).click()
  await page.getByRole('menuitemradio', { name: option, exact: true }).click()
}
try {
  const { document } = await interactionFixture()
  const detail = document.datasets.find((entry) => entry.id === 'detail')!
  document.sources.push({
    id: 'saved-source',
    ref: { sessionId: 'export-test', artifactRef: 'saved-artifact' },
    status: 'available',
    label: '保存的来源',
    facts: [
      { label: '创建时间', value: '历史时间不可解析' },
      {
        label: '公开语义引用',
        value: JSON.stringify([{ kind: 'entity', path: 'business.saved' }]),
      },
      { label: 'Issues', value: JSON.stringify([{ kind: 'partial-data', severity: 'warning' }]) },
      { label: 'unrelated', value: 'RAW_SOURCE_SENTINEL' },
    ],
  })
  detail.sourceIds = ['saved-source']
  document.blocks.push({ id: 'source-list', kind: 'source', sourceIds: ['saved-source'] })
  detail.data.rows[0]![0] = 'UNSELECTED_BUSINESS_SENTINEL'
  detail.data.columns.push({ id: 'private', label: 'private', type: 'string', nullable: false })
  for (const row of detail.data.rows) row.push('UNBOUND_COLUMN_SENTINEL')
  const table = document.blocks.find((block) => block.kind === 'table')!
  assert.equal(table.kind, 'table')
  table.columns = ['query_count', 'category']
  document.title = '筛选导出 <script>alert("x")</script>'
  // Separate fixed table verifies pagination, precise numbers, nulls, and unbound columns.
  document.datasets.push({
    id: 'long',
    origin: 'computed',
    sourceIds: [],
    data: {
      schemaVersion: 1,
      columns: [
        { id: 'n', label: '精确整数', type: 'int64', nullable: true },
        { id: 'decimal', label: '精确小数', type: 'decimal', nullable: false },
        { id: 'private', label: '未绑定字段', type: 'string', nullable: false },
      ],
      rows: [
        ...Array.from({ length: 65 }, (_, index) => [
          String(9007199254740992n + BigInt(index)),
          '0.1000',
          'UNBOUND_COLUMN_SENTINEL',
        ]),
        [null, '0.1000', 'UNBOUND_COLUMN_SENTINEL'],
      ],
      rowCount: 100,
      limit: 66,
      truncated: true,
    },
  })
  document.blocks.push({
    id: 'long-table',
    kind: 'table',
    datasetId: 'long',
    columns: ['decimal', 'n'],
  })
  const built = await buildPresentation(parsePresentationDocument(document))
  const input = path.join(output, 'report.html')
  await writeFile(input, built.htmlBytes)
  await page.goto(pathToFileURL(input).href)
  await page.locator('html[data-presentation-ready=true]').waitFor()
  const reader = page.locator('#reader [data-presentation-reader]')
  const sourceList = reader.locator('[data-block-id="source-list"]')
  assert.equal(await sourceList.getByText('保存的来源', { exact: true }).isVisible(), true)
  assert.equal(
    await sourceList.getByText('实体：business.saved', { exact: true }).isVisible(),
    true,
  )
  assert.equal(await sourceList.getByRole('list', { name: '数据来源列表' }).count(), 1)
  assert.doesNotMatch(
    await sourceList.innerText(),
    /报告生成时间|来源创建时间|Artifact|Session ID|个来源/,
  )
  await sourceList.screenshot({ path: path.join(output, 'source-list-desktop.png') })
  await choose('日期', '周一')
  await choose('集群', '甲集群')
  await reader
    .locator('[data-block-id="table"]')
    .getByRole('button', { name: '按 query_count 排序' })
    .click()
  const long = reader.locator('[data-block-id="long-table"]')
  await long.getByRole('button', { name: '按 精确整数 排序' }).click()
  await long.getByRole('button', { name: '按 精确整数 排序' }).click()
  await long.getByRole('button', { name: '下一页' }).click()
  const chart = reader.locator('[data-block-id="chart"]')
  await chart.locator('svg.recharts-surface').waitFor()
  await chart.getByRole('button', { name: 'cell 更多操作' }).click()
  await chart.getByRole('menuitem', { name: '探索图表' }).click()
  const explorer = page.getByRole('region', { name: '探索图表', exact: true })
  await explorer.getByRole('combobox', { name: '图形类型' }).selectOption('line')
  await explorer.press('Escape')
  await chart.locator('[data-chart-type="line"] svg').waitFor()
  // Arrow navigation and Escape return focus without closing the reader.
  await reader.getByRole('button', { name: '导出报告', exact: true }).focus()
  await page.keyboard.press('ArrowDown')
  assert.equal(
    await page
      .getByRole('menuitem', { name: '下载完整报告', exact: true })
      .evaluate((node) => node === window.document.activeElement),
    true,
  )
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')
  assert.equal(
    await reader
      .getByRole('button', { name: '导出报告', exact: true })
      .getAttribute('aria-expanded'),
    'false',
  )
  await page.setViewportSize({ width: 390, height: 844 })
  await reader.getByRole('button', { name: '导出报告', exact: true }).click()
  const menuBounds = await reader.getByRole('menu', { name: '导出报告', exact: true }).boundingBox()
  assert(menuBounds && menuBounds.x >= 0 && menuBounds.x + menuBounds.width <= 390)
  await page.screenshot({ path: path.join(output, 'export-menu-mobile.png') })
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.waitForFunction(() => {
    const frame = window.document.querySelector('#reader [data-block-id="chart"] .pr-chart')!
    const svg = frame.querySelector('svg')!
    return Math.abs(svg.getBoundingClientRect().width - frame.clientWidth) < 1
  })
  const file = await download(page, '导出当前视图', 'current-view.html')
  const html = await readFile(file, 'utf8')
  assert.doesNotMatch(
    html,
    /UNSELECTED_BUSINESS_SENTINEL|UNBOUND_COLUMN_SENTINEL|RAW_SOURCE_SENTINEL|<script\b|<button\b|presentation-data|<dialog\b/,
  )
  assert.match(html, /来源 Build：interaction-test/)
  assert.match(html, /日期：周一 · 集群：甲集群/)
  assert.match(html, /导出时间/)
  assert.match(html, /0\.1000/)
  assert.match(html, /历史时间不可解析/)
  assert.match(html, /business.saved/)
  assert.match(html, /partial-data/)
  // A later selection must not affect the already downloaded file.
  await choose('集群', '乙集群')
  const offline = await browser.newContext({
    javaScriptEnabled: false,
    offline: true,
    viewport: { width: 1440, height: 1000 },
  })
  const exported = await offline.newPage()
  await exported.goto(pathToFileURL(file).href)
  const result = exported.locator('[data-export-view]')
  const exportedSources = result.locator('[data-block-id="source-list"]')
  assert.equal(await exportedSources.getByText('保存的来源', { exact: true }).isVisible(), true)
  assert.equal(
    await exportedSources.getByText('实体：business.saved', { exact: true }).isVisible(),
    true,
  )
  assert.equal(await exportedSources.locator('[data-source-id="saved-source"]').count(), 1)
  assert.equal(
    await result.locator('[data-block-id="count"] [data-metric-value]').innerText(),
    '150',
  )
  assert.equal(
    await result.locator('[data-block-id="fixed"] [data-metric-value]').innerText(),
    '550',
  )
  assert.deepEqual(
    await result
      .locator('[data-block-id="table"] tbody tr')
      .evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute('data-row-index')))),
    [9, 8],
  )
  const rows = result.locator('[data-block-id="long-table"] tbody tr')
  assert.equal(await rows.count(), 66)
  assert.equal(await rows.first().locator('[data-column-id="n"]').innerText(), '9007199254741056')
  assert.equal(await rows.last().locator('[data-cell-null="true"]').count(), 1)
  assert.match(await result.innerText(), /已截断/)
  assert.equal(
    await result.locator('[data-block-id="chart"] [data-chart-type="line"] svg').count(),
    1,
  )
  await exported.screenshot({ path: path.join(output, 'current-view-desktop.png'), fullPage: true })
  await exported.setViewportSize({ width: 390, height: 844 })
  assert(await result.locator('[data-block-id="chart"] svg').isVisible())
  assert(
    await exported.evaluate(
      () => window.document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  )
  await exported.screenshot({ path: path.join(output, 'current-view-mobile.png'), fullPage: true })
  const full = await download(page, '下载完整报告', 'complete-report.html')
  const restored = await context.newPage()
  await restored.goto(pathToFileURL(full).href)
  await restored.locator('html[data-presentation-ready=true]').waitFor()
  assert.equal(
    await restored.locator('#reader [data-block-id="count"] [data-metric-value]').innerText(),
    '550',
  )

  const gallery = await chartGallery()
  const galleryInput = path.join(output, 'gallery.html')
  await writeFile(galleryInput, (await buildPresentation(gallery)).htmlBytes)
  await page.goto(pathToFileURL(galleryInput).href)
  await page.locator('html[data-presentation-ready=true]').waitFor()
  const galleryReader = page.locator('#reader [data-presentation-reader]')
  for (const block of gallery.blocks.filter((block) => block.kind === 'chart'))
    await galleryReader.locator(`[data-block-id="${block.id}"] svg`).first().waitFor()
  const series = galleryReader.locator('[data-block-id="gallery-line"] .pr-legend button').last()
  await series.click()
  const galleryFile = await download(page, '导出当前视图', 'gallery-view.html')
  await exported.goto(pathToFileURL(galleryFile).href)
  for (const block of gallery.blocks.filter((block) => block.kind === 'chart'))
    assert(
      await exported.locator(`[data-block-id="${block.id}"] svg`).first().isVisible(),
      block.id,
    )
  assert.match(
    await exported.locator('[data-block-id="gallery-line"] .pr-legend').innerText(),
    /已隐藏/,
  )
  await exported.setViewportSize({ width: 1440, height: 1000 })
  await exported.screenshot({ path: path.join(output, 'gallery-view.png'), fullPage: true })
  await choose('展示范围', '第二条观测')
  const preparedCell = galleryReader.locator('[data-block-id="gallery-line"]')
  await preparedCell.getByRole('button', { name: 'cell 更多操作' }).click()
  await preparedCell.getByRole('menuitem', { name: '探索图表', exact: true }).click()
  const prepared = preparedCell.locator('[data-chart-explorer]')
  await prepared
    .getByRole('combobox', { name: '已准备视图', exact: true })
    .selectOption('prepared-histogram')
  await prepared.getByRole('button', { name: '关闭探索图表', exact: true }).click()
  const preparedFile = await download(page, '导出当前视图', 'prepared-view.html')
  await exported.goto(pathToFileURL(preparedFile).href)
  const preparedChart = exported.locator(
    '[data-block-id="gallery-line"] [data-chart-type="histogram"]',
  )
  assert(await preparedChart.isVisible())
  assert.deepEqual(
    await preparedChart
      .locator('[data-chart-mark]')
      .evaluateAll((nodes) => [
        ...new Set(nodes.map((node) => node.getAttribute('data-source-row-index'))),
      ]),
    ['1'],
  )
  await choose('展示范围', '空结果')
  const emptyFile = await download(page, '导出当前视图', 'empty-view.html')
  await exported.goto(pathToFileURL(emptyFile).href)
  assert.equal(
    await exported.locator('[data-block-kind="chart"] .pr-empty').count(),
    gallery.blocks.filter((block) => block.kind === 'chart').length,
  )
  assert.deepEqual(errors, [])
  await writeFile(
    path.join(output, 'evidence.json'),
    JSON.stringify(
      {
        status: 'passed',
        checks: [
          'combined filters and fixed content',
          'chart exploration and hidden series',
          'all 18 chart types',
          'cross-dataset prepared view with selected row identity',
          'saved source overview without arbitrary payloads',
          'all sorted table pages and exact int64/decimal/null',
          'no unselected rows or unbound columns embedded',
          'no-script offline and narrow viewport',
          'full-report restores default selection',
          'empty slices',
          'keyboard menu',
        ],
        errors,
      },
      null,
      2,
    ),
  )
  process.stdout.write(`Passed: ${output}\n`)
} finally {
  await browser.close()
}
