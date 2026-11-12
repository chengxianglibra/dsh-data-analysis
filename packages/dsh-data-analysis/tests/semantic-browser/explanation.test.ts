import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

let directory: string
let render: (explanation: string, locale: string) => string

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'dsh-semantic-explanation-'))
  const outfile = path.join(directory, 'render.mjs')
  await build({
    stdin: {
      contents: `import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CopyProvider } from './src/client/i18n/context.tsx';
import { translator } from './src/client/i18n/copy.ts';
import { ComputationCard } from './src/client/semantic-browser/computation.tsx';
export function render(explanation, locale) {
  const object = { ref: { kind: 'metric', path: 'sales.revenue' }, computation: { expression: '', explanation, facts: [] }, fields: [], relations: [] };
  return renderToStaticMarkup(createElement(CopyProvider, { t: translator(locale) }, createElement(ComputationCard, { object, objects: new Map(), navigate() {} })));
}`,
      resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
  })
  ;({ render } = await import(pathToFileURL(outfile).href))
})

after(async () => rm(directory, { recursive: true, force: true }))

test('a metric calculation explanation is visible as English source text in either locale', () => {
  for (const locale of ['zh-CN', 'en-US']) {
    const html = render('Sum <amount> over orders.', locale)
    assert.match(html, /lang="en">Sum &lt;amount&gt; over orders\.<\/div>/)
    assert.match(html, /sb-fact-label/)
  }
  assert.equal(render('', 'zh-CN'), '')
})
