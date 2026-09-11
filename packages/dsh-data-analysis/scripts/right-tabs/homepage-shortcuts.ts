/** Production composer and directory tabs in the isolated Harness; no live model calls. */
import assert from 'node:assert/strict'
import path from 'node:path'
import type { Page } from 'playwright'

export async function verifyHomepageShortcuts(page: Page, outputRoot: string) {
  const shortcuts = page.locator('.marivo-workspace-shortcuts')
  await page.evaluate(() => (window as any).__rtHost.clear())
  await shortcuts.waitFor({ state: 'hidden' })
  await page.evaluate(() => (window as any).__rtHost.select('right-tabs-native'))
  await shortcuts.waitFor()
  assert.equal(await shortcuts.getByRole('button').count(), 3)
  const alignment = await shortcuts.evaluate((element) => {
    const row = element.closest('[data-slot="conversation.input.dock"]')!.previousElementSibling!
    const workspace = row.querySelector('button')!.getBoundingClientRect()
    const actions = [...element.querySelectorAll('button')].map((button) => {
      const rect = button.getBoundingClientRect()
      return { center: rect.y + rect.height / 2, left: rect.left }
    })
    return {
      center: workspace.y + workspace.height / 2,
      right: row.getBoundingClientRect().right,
      actions,
    }
  })
  for (const action of alignment.actions) {
    assert.ok(Math.abs(action.center - alignment.center) <= 2, 'homepage controls share one row')
    assert.ok(
      action.left >= alignment.right,
      'shortcuts follow workspace and preset without overlap',
    )
  }
  const snapshot = () =>
    page.evaluate(() => (window as any).__askDshProbe.read('right-tabs-native'))
  const composer = page.locator('[contenteditable="true"][role="textbox"]:visible')
  await composer.fill('保留首页草稿 ')
  assert.equal(
    await page.evaluate(() =>
      (window as any).__askDshProbe.insertReference('right-tabs-native', {
        source: 'marivo-semantic',
        label: '收入',
        clipboardText: '@metric:sales.revenue',
        ref: JSON.stringify({
          schema: 'dsh-data-analysis-semantic-reference/v1',
          sessionId: 'right-tabs-native',
          environmentFingerprint: 'acceptance-only',
          ref: { schema: 'marivo.semantic_ref/v1', kind: 'metric', path: 'sales.revenue' },
        }),
      }),
    ),
    true,
  )
  await page.locator('input[type="file"]').setInputFiles({
    name: 'shortcut.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=',
      'base64',
    ),
  })
  await page.waitForFunction(
    () => (window as any).__askDshProbe.read('right-tabs-native').attachmentIds.length === 1,
  )
  const before = await snapshot()
  const workspaceId = await page.evaluate(
    () =>
      (window as any).__rtHost.workspaces
        .getSnapshot()
        .items.find((w: any) => w.sessionIds.includes('right-tabs-native')).workspaceId,
  )
  for (const [label, kind] of [
    ['数据源与凭证', 'datasources'],
    ['语义层', 'semantic'],
    ['报告', 'reports'],
  ]) {
    const button = shortcuts.getByRole('button', { name: `打开${label}`, exact: true })
    await button.focus()
    await page.keyboard.press('Enter')
    await page.waitForFunction(
      ({ kind, workspaceId }) => {
        const tab = (window as any).__rtHost.sidebar.active()
        return (
          tab?.kind === `marivo-${kind}` &&
          [...(window as any).__rightTabs.pages.values()].some(
            (page: any) =>
              page.sessionId === 'right-tabs-native' &&
              page.target.kind === kind &&
              page.target.workspaceId === workspaceId,
          )
        )
      },
      { kind, workspaceId },
    )
    const id = await page.evaluate(() => (window as any).__rtHost.sidebar.active().id)
    await button.click()
    assert.equal(await page.evaluate(() => (window as any).__rtHost.sidebar.active().id), id)
    assert.deepEqual(await snapshot(), before)
  }
  // Hold a rendered action while its foreground Session authority changes.
  // Only the authority read is fault-injected; the actual Session registry is unchanged.
  await page.evaluate(() => {
    const host = (window as any).__rtHost
    const original = host.sessions.getSnapshot
    host.restoreSessionRead = () => {
      host.sessions.getSnapshot = original
    }
    host.sessions.getSnapshot = () => ({ ...original(), current: 'right-tabs-ptc' })
  })
  try {
    await shortcuts.getByRole('button', { name: '打开报告', exact: true }).click()
    await shortcuts.getByRole('alert').waitFor()
    assert.deepEqual(await snapshot(), before)
  } finally {
    await page.evaluate(() => (window as any).__rtHost.restoreSessionRead())
  }
  await shortcuts.getByRole('button', { name: '打开报告', exact: true }).click()
  await shortcuts.getByRole('alert').waitFor({ state: 'hidden' })
  await page.evaluate(() => {
    const sidebar = (window as any).__rtHost.sidebar
    if (sidebar.isExpanded()) sidebar.toggleExpanded()
  })
  await page.evaluate(() => (window as any).__rtHost.locale.setLocale('en'))
  await shortcuts.getByRole('button', { name: 'Open Semantic layer', exact: true }).waitFor()
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await shortcuts.getByRole('button').count(), 3)
  for (const label of await shortcuts.locator('button span').all())
    assert.equal(await label.isVisible(), true)
  await shortcuts
    .getByRole('button', { name: 'Open Semantic layer', exact: true })
    .click({ trial: true })
  assert.equal(await shortcuts.evaluate((e) => e.scrollWidth <= e.clientWidth), true)
  await page.screenshot({
    path: path.join(outputRoot, 'homepage-shortcuts-narrow.png'),
    fullPage: true,
  })
  await page.setViewportSize({ width: 1680, height: 1100 })
  await page.evaluate(() => (window as any).__rtHost.locale.setLocale('zh'))
  await page.screenshot({ path: path.join(outputRoot, 'homepage-shortcuts.png'), fullPage: true })
  assert.deepEqual(await snapshot(), before)
  await page.evaluate(() => {
    const input = (window as any).__rtHost.input('right-tabs-native')
    for (const id of input.state.getSnapshot().attachmentIds) input.removeAttachment(id)
    input.setDraft('')
  })
  await page.evaluate(() => (window as any).__rtHost.select('right-tabs-ptc'))
  await shortcuts.waitFor()
  await page.evaluate(() => (window as any).__rtHost.select('right-tabs-native'))
  await shortcuts.waitFor()
}
