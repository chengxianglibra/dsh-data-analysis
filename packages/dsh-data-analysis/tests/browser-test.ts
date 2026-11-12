import type { TestContext } from 'node:test'

export const browserTestsEnabled = !['daily', 'release'].includes(
  process.env.DSH_DATA_ANALYSIS_TEST_TIER ?? '',
)

export function skipBrowserTest(t: TestContext): boolean {
  if (browserTestsEnabled) return false
  t.skip('Browser tests are excluded from this tier')
  return true
}
