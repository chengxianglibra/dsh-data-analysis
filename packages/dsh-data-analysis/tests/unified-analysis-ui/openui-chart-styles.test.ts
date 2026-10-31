import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { OPENUI_CHART_STYLES } from '../../src/client/analysis-ui/frame/openui-chart-styles.ts'

test('bundled chart styles match the pinned OpenUI component stylesheet', async () => {
  const require = createRequire(import.meta.url)
  const dist = dirname(require.resolve('@openuidev/react-ui'))
  const source = await readFile(join(dist, 'components/Charts/charts.css'), 'utf8')
  assert.ok(OPENUI_CHART_STYLES.startsWith(source))
})
