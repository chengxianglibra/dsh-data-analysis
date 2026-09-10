/** Isolated browser acceptance using the installed Harness primitives, with no live profile access. */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { type Browser, chromium } from 'playwright'
import { executionFailure, settled, source, successful } from '../tests/python-tool/fixtures.ts'

const directory = await mkdtemp(path.join(tmpdir(), 'dsh-python-tool-web-'))
// Representative Host tokens for this component fixture; the live Host owns its theme.
const palette =
  ':root{--dsw-alias-markdown-code-block:#f6f8fa;--dsw-alias-markdown-code-block-banner:#eef1f4;--dsw-alias-bg-base:#fff;--dsw-alias-label-primary:#1d3036;--shiki-foreground:#1d3036;--shiki-background:#f6f8fa;--shiki-token-keyword:#d6336c;--shiki-token-string:#2f9e44;--shiki-token-constant:#1c7ed6;--shiki-token-function:#6741d9;--shiki-token-comment:#868e96;--shiki-token-punctuation:#495057;--shiki-token-string-expression:#2b8a3e;--shiki-token-parameter:#e8590c}'
await build({
  stdin: {
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
    loader: 'tsx',
    contents: `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {PythonToolCard} from './src/client/python-tool/card.tsx';
import {CopyProvider} from './src/client/i18n/context.tsx';
import {translator} from './src/client/i18n/copy.ts';
const root = createRoot(document.getElementById('root'));
window.renderCard = (block, locale = 'zh-CN') => root.render(<CopyProvider t={translator(locale)}><PythonToolCard block={block} inspect={() => window.inspected = true}/></CopyProvider>);
`,
  },
  bundle: true,
  platform: 'browser',
  format: 'esm',
  outfile: path.join(directory, 'main.js'),
  loader: {
    '.module.css': 'local-css',
    '.woff2': 'dataurl',
    '.woff': 'dataurl',
    '.ttf': 'dataurl',
  },
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'silent',
})
const server = createServer(async (request, response) => {
  const name =
    request.url === '/main.js' ? 'main.js' : request.url === '/main.css' ? 'main.css' : undefined
  response.setHeader(
    'Content-Type',
    name?.endsWith('.js') ? 'text/javascript' : name?.endsWith('.css') ? 'text/css' : 'text/html',
  )
  response.end(
    name
      ? await readFile(path.join(directory, name))
      : `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/main.css"><style>${palette}</style></head><body style="margin:24px;font-family:system-ui"><main id="root" style="max-width:1000px;margin:auto"></main><script type="module" src="/main.js"></script></body></html>`,
  )
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
assert.ok(address && typeof address === 'object')
let browser: Browser | undefined
try {
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1200, height: 1000 },
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${address.port}/`)
  await page.waitForFunction(
    () => typeof (window as unknown as { renderCard: unknown }).renderCard === 'function',
  )
  const render = async (block = settled(), locale = 'zh-CN') => {
    await page.evaluate(
      ({ block, locale }) =>
        (window as unknown as { renderCard: (block: unknown, locale: string) => void }).renderCard(
          block,
          locale,
        ),
      { block, locale },
    )
  }
  await render()
  const row = page.locator('[data-disclosure-row]')
  await row.waitFor()
  assert.equal(
    await page.locator('.mp-code').count(),
    0,
    'Collapsed cards must not mount the highlighter',
  )
  await row.focus()
  await page.keyboard.press('Enter')
  await page.locator('.mp-code pre').waitFor()
  await page.waitForFunction(() => document.querySelectorAll('.mp-code pre span[style]').length > 1)
  assert.ok(
    await page
      .locator('.mp-code pre span[style]')
      .evaluateAll((spans) => new Set(spans.map((span) => getComputedStyle(span).color)).size > 1),
  )
  assert.equal(await page.locator('.mp-code pre').textContent(), source)
  await page.getByRole('button', { name: '复制代码', exact: true }).click()
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), source)
  for (const text of ['print(1)', 'print(1)\n\n', 'print(1)\r\nprint(2)\r\n']) {
    await render(settled(successful, text))
    await page.getByRole('button', { name: '复制代码', exact: true }).waitFor()
    await page.getByRole('button', { name: '复制代码', exact: true }).click()
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), text)
  }
  await render()
  assert.equal(
    await page.locator('section[aria-label="stdout"] pre').textContent(),
    successful.stdout,
  )
  assert.equal(
    await page
      .locator('section[aria-label="stdout"] pre')
      .evaluate((el) => getComputedStyle(el).whiteSpace),
    'pre',
  )
  assert.equal(await page.locator('script').count(), 1, 'Code must remain inert text')
  await page.getByRole('button', { name: '查看', exact: true }).click()
  assert.equal(
    await page.evaluate(() => (window as unknown as { inspected: boolean }).inspected),
    true,
  )
  await page.screenshot({ path: path.join(directory, 'python-card.png'), fullPage: true })
  await row.focus()
  await page.keyboard.press('Space')
  assert.equal(await page.locator('.mp-code').count(), 0)
  await row.click()
  await render(settled({ ...successful, codeCaptureError: 'Do not rerun' }))
  await page.locator('[data-state="warning"]').waitFor()
  assert.ok(await page.getByText('Do not rerun', { exact: true }).isVisible())
  for (const reason of ['not-started', 'unknown'] as const) {
    await render(executionFailure(reason))
    await page.locator(`[data-state="${reason}"]`).waitFor()
    assert.equal(
      await page.locator('.mp-state').textContent(),
      reason === 'unknown' ? '执行结果未确认' : '未执行',
    )
    assert.match(await page.locator('.mp-notice').innerText(), /do not automatically replay/)
    assert.match(await page.locator('.mp-facts').innerText(), /elapsedMs\s+30 ms/)
    assert.match(await page.locator('section[aria-label="输出"] pre').innerText(), /; execution=/)
  }
  await page.screenshot({ path: path.join(directory, 'python-card-unknown.png'), fullPage: true })
  await render(settled(), 'en-US')
  await page.getByText('Execution succeeded', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Copy code', exact: true }).waitFor()
  const longCode = source + '# ' + 'long-column '.repeat(80) + '\n' + 'print(1)\n'.repeat(100)
  await page.setViewportSize({ width: 390, height: 844 })
  await render(settled(successful, longCode))
  await page.waitForFunction(
    (code) => document.querySelector('.mp-code pre')?.textContent === code,
    longCode,
  )
  const layout = await page.locator('.mp-code').evaluate((el) => {
    const scroller = el.parentElement!
    return {
      width: scroller.clientWidth,
      fullWidth: scroller.scrollWidth,
      height: scroller.clientHeight,
      fullHeight: scroller.scrollHeight,
      pageWidth: document.documentElement.scrollWidth,
      viewport: innerWidth,
    }
  })
  assert.ok(layout.height <= 360 && layout.fullHeight > layout.height, JSON.stringify(layout))
  assert.ok(layout.fullWidth > layout.width, JSON.stringify(layout))
  assert.ok(layout.pageWidth <= layout.viewport, JSON.stringify(layout))
  await page.screenshot({ path: path.join(directory, 'python-card-narrow.png'), fullPage: true })
  await render(settled('unparseable output'))
  await page.getByText('unparseable output', { exact: true }).first().waitFor()
  await page.locator('.mp-body summary').click()
  assert.equal(
    await page.locator('.mp-body details pre').first().textContent(),
    settled().call!.argsRaw,
  )
  assert.deepEqual(errors, [])
  await writeFile(
    path.join(directory, 'evidence.json'),
    JSON.stringify(
      {
        status: 'passed',
        checks: [
          'real Harness CodeBlock Python highlighting',
          'exact source clipboard including trailing newline',
          'output alignment',
          'keyboard collapse',
          'inspection callback',
          'capture warning',
          'normalized plugin errors preserve not-started and unknown, timing and next action',
          'locale switch',
          'bounded narrow-screen scrolling',
          'raw fallback',
        ],
        layout,
        errors,
      },
      null,
      2,
    ),
  )
  console.log(JSON.stringify({ status: 'passed', directory }))
} finally {
  try {
    await browser?.close()
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
}
