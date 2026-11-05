import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import { UI_STYLES } from '../../src/client/ui/theme.ts'

test('compiled UI CSS scopes all generated selectors, animation names and Tailwind state', () => {
  const ast = postcss.parse(UI_STYLES)
  ast.walkRules((rule) => {
    let parent: postcss.Rule | postcss.AtRule | postcss.Root | postcss.Document | undefined =
      rule.parent
    while (parent) {
      if (parent.type === 'rule' || (parent.type === 'atrule' && /keyframes$/.test(parent.name)))
        return
      parent = parent.parent
    }
    assert.match(rule.selector, /\.mv-ui/, rule.selector)
  })
  ast.walkAtRules(/keyframes$/, (rule) => assert.match(rule.params, /^mv-/))
  ast.walkAtRules('property', (rule) => assert.match(rule.params, /^--mv-/))
  assert.doesNotMatch(UI_STYLES, /--tw-|@source|@tailwind|@import/)
  assert.match(UI_STYLES, /--chart-8:/)
})

test('locally generated styles match the current explicit client sources', () => {
  execFileSync(
    process.execPath,
    [fileURLToPath(new URL('../../scripts/build-ui-styles.mjs', import.meta.url)), '--check'],
    { stdio: 'pipe' },
  )
})

test('both client formats deliver generated CSS and copied source licenses', async () => {
  execFileSync(
    process.execPath,
    [fileURLToPath(new URL('../../scripts/build-client.mjs', import.meta.url))],
    { stdio: 'pipe' },
  )
  for (const name of ['client.js', 'client-composition.js']) {
    const bundle = await readFile(new URL(`../../lib/${name}`, import.meta.url), 'utf8')
    assert.match(bundle, /tailwindcss v4\.3\.4/)
    assert.match(bundle, /shadcn\/ui copied source/)
    assert.match(bundle, /Copyright \(c\) 2023 shadcn/)
    assert.match(bundle, /tw-animate-css/)
    assert.match(bundle, /Copyright \(c\) 2022 WorkOS/)
  }
})
