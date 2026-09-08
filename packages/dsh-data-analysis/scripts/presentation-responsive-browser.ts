import assert from 'node:assert/strict'
import path from 'node:path'
import type { Page } from 'playwright'
import { CHART_TYPES } from '../src/presentation/contracts/charts.ts'

const WIDTHS = [390, 768, 1440, 1920, 2560] as const
const SPECIAL = new Set([
  'histogram',
  'boxPlot',
  'heatmap',
  'pie',
  'funnel',
  'waterfall',
  'leaderboard',
])

/** Wait for the actual ResizeObserver render, including the SVG drawing coordinate system. */
export async function waitForResponsiveLayout(page: Page) {
  await page.waitForFunction(() => {
    const reader = document.querySelector('[data-presentation-reader][data-mode="interactive"]')
    if (!reader) return false
    const ordinary = [...reader.querySelectorAll<HTMLElement>('.pr-chart .recharts-wrapper')]
    const special = [...reader.querySelectorAll<SVGSVGElement>('.pr-special-chart')]
    return (
      ordinary.every((node) => {
        const chart = node.closest<HTMLElement>('.pr-chart')!
        return Math.abs(node.getBoundingClientRect().width - chart.clientWidth) <= 1
      }) &&
      special.every((node) => {
        const scroll = node.parentElement!
        const minimum = node.closest('[data-chart-type="pie"]') ? 720 : 520
        return Math.abs(node.viewBox.baseVal.width - Math.max(minimum, scroll.clientWidth)) <= 1
      })
    )
  })
}

async function assertPageFits(page: Page) {
  const pageWidth = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  assert.ok(pageWidth.scroll <= pageWidth.viewport + 1, JSON.stringify(pageWidth))
  return pageWidth
}

/** Five viewport widths on the production reader, with measured CSS-pixel geometry. */
export async function verifyResponsiveGallery(
  page: Page,
  output: string,
  prefix: string,
  layout: 'portable' | 'overlay' | 'module-loader',
) {
  const reader = page.locator('[data-presentation-reader][data-mode="interactive"]')
  const results = []
  const baseline = new Map<string, { height: number; fonts: number[] }>()
  const originalViewport = page.viewportSize()!
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1100 })
    await waitForResponsiveLayout(page)
    const pageWidth = await assertPageFits(page)
    const frame = await reader.evaluate((node) => {
      const rect = node.getBoundingClientRect()
      const style = getComputedStyle(node)
      return {
        x: rect.x,
        width: rect.width,
        leftPadding: Number.parseFloat(style.paddingLeft),
        rightPadding: Number.parseFloat(style.paddingRight),
      }
    })
    assert.ok(Math.abs(frame.leftPadding - frame.rightPadding) <= 1)
    if (width >= 1440) {
      assert.ok(frame.width > 1240, `${prefix}: wide reader retains the old width limit`)
      assert.ok(frame.width - frame.leftPadding - frame.rightPadding > 1100)
    }
    if (layout === 'overlay') {
      const overlay = await page
        .getByRole('dialog', { name: '分析快照', exact: true })
        .boundingBox()
      assert.ok(overlay)
      assert.ok(Math.abs(overlay.x - (width - overlay.width) / 2) <= 1)
      assert.ok(Math.abs(overlay.width - width * (width <= 600 ? 1 : 0.96)) <= 2)
    } else if (layout === 'portable') {
      assert.ok(Math.abs(frame.x - (pageWidth.viewport - frame.width) / 2) <= 1)
    }
    for (const markdown of await reader.locator('.pr-markdown').all()) {
      assert.ok((await markdown.boundingBox())!.width <= 821, 'Markdown line length exceeds 820px')
    }
    const charts = []
    for (const type of CHART_TYPES) {
      const cell = reader.locator(`[data-block-id="gallery-${type}"]`)
      const svg = cell
        .locator(SPECIAL.has(type) ? '.pr-special-chart' : 'svg.recharts-surface')
        .first()
      await svg.waitFor()
      const geometry = await svg.evaluate((node: SVGSVGElement) => {
        const rect = node.getBoundingClientRect()
        const matrix = node.getScreenCTM()!
        return {
          width: rect.width,
          height: rect.height,
          viewBox: { width: node.viewBox.baseVal.width, height: node.viewBox.baseVal.height },
          scaleX: Math.hypot(matrix.a, matrix.b),
          scaleY: Math.hypot(matrix.c, matrix.d),
          fonts: [...node.querySelectorAll('text')].map((text) => {
            const transform = text.getScreenCTM()!
            return (
              Number.parseFloat(getComputedStyle(text).fontSize) *
              Math.hypot(transform.c, transform.d)
            )
          }),
        }
      })
      if (SPECIAL.has(type)) {
        assert.ok(geometry.width >= (type === 'pie' ? 720 : 520) - 1)
        assert.ok(Math.abs(geometry.scaleX - 1) < 0.001, `${type}: horizontal SVG scaling`)
        assert.ok(Math.abs(geometry.scaleY - 1) < 0.001, `${type}: vertical SVG scaling`)
        assert.ok(Math.abs(geometry.height - geometry.viewBox.height) <= 1)
        const previous = baseline.get(type)
        if (previous) {
          assert.equal(geometry.height, previous.height, `${type}: resize changed row height`)
          assert.deepEqual(geometry.fonts, previous.fonts, `${type}: resize changed text size`)
        } else baseline.set(type, { height: geometry.height, fonts: geometry.fonts })
      } else {
        assert.equal(geometry.height, type === 'sparkline' ? 128 : 320, `${type}: chart height`)
      }
      charts.push({ type, ...geometry })
    }
    const histogramWidths = await reader
      .locator('[data-block-id="gallery-histogram"] [data-chart-mark] rect')
      .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().width))
    assert.ok(Math.abs(histogramWidths[1]! / histogramWidths[0]! - 2) < 0.01)
    assert.ok(Math.abs(histogramWidths[2]! / histogramWidths[0]! - 3) < 0.01)
    const waterfallWidths = await reader
      .locator('[data-block-id="gallery-waterfall"] [data-chart-mark] rect')
      .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().width))
    assert.ok(waterfallWidths.every((value) => value > 0 && value <= 48.01))
    const pie = reader.locator('[data-block-id="gallery-pie"]')
    const donut = await pie
      .locator('.pr-special-chart circle')
      .evaluate((node: SVGCircleElement) => {
        const svg = node.ownerSVGElement!
        const center = new DOMPoint(node.cx.baseVal.value, node.cy.baseVal.value).matrixTransform(
          node.getCTM()!,
        )
        return { center: center.x, width: svg.viewBox.baseVal.width, radius: node.r.baseVal.value }
      })
    assert.equal(donut.radius, 86)
    assert.ok(Math.abs(donut.center - ((donut.width - 720) / 2 + 165)) < 1)
    if (width === 390) {
      const scroll = pie.locator('.pr-special-scroll')
      const overflow = await scroll.evaluate((node) => ({
        client: node.clientWidth,
        content: node.scrollWidth,
      }))
      assert.ok(overflow.content >= 720 && overflow.content > overflow.client)
      await scroll.evaluate((node) => {
        node.scrollLeft = node.scrollWidth
      })
      assert.ok(await scroll.evaluate((node) => node.scrollLeft > 0))
      const mark = pie.locator('[data-chart-mark]').last()
      await mark.focus()
      assert.ok(await mark.evaluate((node) => node === document.activeElement))
      const tooltip = pie.locator('[data-chart-tooltip]')
      await tooltip.waitFor({ state: 'visible' })
      assert.ok((await tooltip.innerText()).length > 0)
      const tooltipBounds = await tooltip.boundingBox()
      assert.ok(
        tooltipBounds && tooltipBounds.x >= 0 && tooltipBounds.x + tooltipBounds.width <= width + 1,
      )
      await pie.screenshot({ path: path.join(output, `${prefix}-pie-keyboard-${width}.png`) })
      await mark.evaluate((node: SVGElement) => node.blur())
      await scroll.evaluate((node) => {
        node.scrollLeft = 0
      })
    }
    await reader.locator('.pr-header').scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(output, `${prefix}-${width}.png`) })
    results.push({ width, frame, pageWidth, charts, histogramWidths, waterfallWidths, donut })
  }
  const hiddenChart = reader.locator('[data-block-id="gallery-histogram"] .pr-special-scroll')
  const widthBeforeHide = await hiddenChart.locator('svg').getAttribute('width')
  await hiddenChart.evaluate((node: HTMLElement) => {
    node.style.display = 'none'
  })
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  )
  assert.equal(
    await hiddenChart.locator('svg').getAttribute('width'),
    widthBeforeHide,
    'Hidden chart must retain its last nonzero drawing width',
  )
  await hiddenChart.evaluate((node: HTMLElement) => {
    node.style.removeProperty('display')
  })
  await waitForResponsiveLayout(page)
  assert.ok(
    Number(await hiddenChart.locator('svg').getAttribute('width')) < Number(widthBeforeHide),
  )
  await page.setViewportSize(originalViewport)
  await waitForResponsiveLayout(page)
  return {
    responsiveGallery: prefix,
    layout,
    widths: results,
    pieScrollAndKeyboard: true,
    hiddenChartRecovers: true,
  }
}

/** Exercise consecutive resize events while the caller checks user-visible reader state. */
export async function verifyResizeState(page: Page, verify: () => Promise<void>) {
  const originalViewport = page.viewportSize()!
  const widths = [1920, 1440, 1024, 768, 600, 390, 768, 1440, 1920, 2560]
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1100 })
    await waitForResponsiveLayout(page)
    await assertPageFits(page)
    await verify()
  }
  await page.setViewportSize(originalViewport)
  await waitForResponsiveLayout(page)
  return { resizeStatePreserved: true, widths }
}

export async function verifyGalleryResizeState(page: Page) {
  const reader = page.locator('[data-presentation-reader][data-mode="interactive"]')
  const filter = reader.getByRole('button', { name: /^展示范围/ })
  await filter.click()
  await reader.getByRole('menuitemradio', { name: '第二条观测', exact: true }).click()
  const line = reader.locator('[data-block-id="gallery-line"]')
  const series = line.getByRole('button', { name: '显示系列 b', exact: true })
  await series.click()
  const check = await verifyResizeState(page, async () => {
    assert.match(await filter.innerText(), /第二条观测/)
    assert.equal(await series.getAttribute('aria-pressed'), 'false')
    const indices = await line
      .locator('[data-source-row-index]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-source-row-index')))
    assert.ok(indices.length > 0 && indices.every((index) => index === '1'))
  })
  await series.click()
  await reader.getByRole('button', { name: '重置筛选', exact: true }).click()
  return check
}
