/** Operate the production navigation/controller through the isolated Host probe. */
import type { Locator, Page } from 'playwright'

export async function reportAction(reader: Locator, name: string) {
  await reader.getByRole('button', { name: '报告更多操作', exact: true }).click()
  await reader.getByRole('menuitem', { name, exact: true }).click()
  if (name === '编辑报告')
    await reader.getByRole('textbox', { name: '报告标题', exact: true }).waitFor()
}

export async function closeReport(page: Page, reader: Locator) {
  const id = await reader.getAttribute('data-rt-tab')
  if (!id) throw new Error('Missing native report tab identity')
  await page.evaluate((id) => (window as any).__rtHost.sidebar.close(id), id)
  await page.locator(`[data-rt-tab="${id}"]`).waitFor({ state: 'detached' })
}

export async function openReport(
  page: Page,
  sessionId: string,
  target: { workspaceId: string; reportId: string; buildId?: string },
) {
  await page.waitForFunction(
    ({ sessionId, workspaceId }) => {
      const host = (window as any).__rtHost
      const workspaces = host?.workspaces.getSnapshot()
      return (
        host?.current() === sessionId &&
        workspaces?.phase === 'ready' &&
        workspaces.state !== 'error' &&
        workspaces.items.some(
          (workspace: { workspaceId: string; sessionIds: string[] }) =>
            workspace.workspaceId === workspaceId && workspace.sessionIds.includes(sessionId),
        )
      )
    },
    { sessionId, workspaceId: target.workspaceId },
  )
  await page.evaluate(
    ({ sessionId, target }) =>
      (window as any).__rightTabs.navigate(sessionId, { kind: 'report', ...target }),
    { sessionId, target },
  )
  const reader = page.locator('[data-rt-kind="report"]:visible')
  await reader.locator('[data-mode="interactive"]').waitFor()
  return reader
}
