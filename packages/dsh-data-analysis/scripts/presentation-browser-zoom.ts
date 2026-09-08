import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium, type Page } from 'playwright'
import { waitForResponsiveLayout } from './presentation-responsive-browser.ts'

type SettingsWindow = Window & {
  chrome: {
    settingsPrivate: {
      getDefaultZoom: (callback: (factor: number) => void) => void
      setDefaultZoom: (factor: number, callback: () => void) => void
    }
  }
}

async function measurements(page: Page) {
  return page.evaluate(() => ({
    innerWidth,
    innerHeight,
    outerWidth,
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    devicePixelRatio,
    visualScale: visualViewport!.scale,
  }))
}

/** Native Chrome page zoom in a throwaway profile, without CSS or device emulation. */
export async function verifyBrowserZoom(portablePath: string, output: string): Promise<unknown> {
  const profile = await mkdtemp(path.join(tmpdir(), 'dsh-presentation-page-zoom-'))
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chrome',
    headless: true,
    viewport: { width: 1440, height: 1100 },
  })
  try {
    const page = await context.newPage()
    const external: string[] = []
    const errors: string[] = []
    page.on('request', (request) => {
      if (!request.url().startsWith('file:')) external.push(request.url())
    })
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(pathToFileURL(portablePath).href)
    await page.waitForFunction(() => document.documentElement.dataset.presentationReady === 'true')
    const reader = page.locator('[data-presentation-reader][data-mode="interactive"]')
    await reader.getByRole('button', { name: /^展示范围/ }).click()
    await reader.getByRole('menuitemradio', { name: '第二条观测', exact: true }).click()
    const series = reader
      .locator('[data-block-id="gallery-line"]')
      .getByRole('button', { name: '显示系列 b', exact: true })
    await series.click()
    assert.equal(await series.getAttribute('aria-pressed'), 'false')
    await waitForResponsiveLayout(page)
    const baseline = await measurements(page)
    assert.equal(baseline.innerWidth, 1440)
    await page.screenshot({ path: path.join(output, 'browser-zoom-100.png') })

    // This calls the same native preference as Chrome's Appearance > Page zoom control.
    // Keeping the report tab alive also proves zoom does not reset reader-local state.
    const settings = await context.newPage()
    await settings.goto('chrome://settings/appearance')
    await settings.evaluate(
      () =>
        new Promise<void>((resolve) => {
          ;(window as unknown as SettingsWindow).chrome.settingsPrivate.setDefaultZoom(2, resolve)
        }),
    )
    const nativeZoom = await settings.evaluate(
      () =>
        new Promise<number>((resolve) => {
          ;(window as unknown as SettingsWindow).chrome.settingsPrivate.getDefaultZoom(resolve)
        }),
    )
    assert.equal(nativeZoom, 2)
    await page.bringToFront()
    await page.waitForFunction(() => innerWidth === 720)
    await waitForResponsiveLayout(page)
    const zoomed = await measurements(page)
    assert.equal(zoomed.innerWidth, baseline.innerWidth / 2)
    assert.equal(zoomed.clientWidth, baseline.clientWidth / 2)
    assert.equal(zoomed.devicePixelRatio, baseline.devicePixelRatio * 2)
    assert.equal(zoomed.outerWidth, baseline.outerWidth)
    assert.equal(zoomed.visualScale, 1)
    assert.ok(zoomed.scrollWidth <= zoomed.clientWidth + 1)
    await reader.getByRole('button', { name: /展示范围.*第二条观测/ }).waitFor()
    assert.equal(await series.getAttribute('aria-pressed'), 'false')
    const screenshot = path.join(output, 'browser-zoom-200.png')
    await page.screenshot({ path: screenshot })
    assert.deepEqual(external, [])
    assert.deepEqual(errors, [])
    return {
      browserZoom: true,
      method: 'Isolated Chrome profile, native Appearance page zoom setting',
      nativeZoom,
      baseline,
      zoomed,
      filterAndSeriesPreserved: true,
      noExternalRequests: true,
      screenshot,
    }
  } finally {
    await context.close()
    await rm(profile, { recursive: true, force: true })
  }
}
