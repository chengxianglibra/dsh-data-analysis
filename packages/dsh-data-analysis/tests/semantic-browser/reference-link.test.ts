import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import type { SemanticRef } from '../../src/semantic-reference/contracts.ts'

let directory: string
let render: (value: string, refs: SemanticRef[], available?: SemanticRef[]) => string
const ref: SemanticRef = {
  schema: 'marivo.semantic_ref/v1',
  kind: 'entity',
  path: 'sales.orders',
}
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'dsh-semantic-field-'))
  const outfile = path.join(directory, 'render.mjs')
  await build({
    stdin: {
      contents: `import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FieldValue } from './src/client/semantic-browser/reference-link.tsx';
import { refKey } from './src/semantic-reference/contracts.ts';
export function render(value, refs, available = refs) {
  return renderToStaticMarkup(createElement(FieldValue, {
    field: { name: 'participants', value },
    object: { relations: refs.map(ref => ({ field: 'participants', ref })) },
    objects: new Map(available.map(ref => [refKey(ref), { ref }])), navigate() {},
  }));
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
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('field references preserve mapping labels, repeated refs and exact identities', () => {
  const html = render(
    'buyer: entity:sales.orders\nseller: entity:sales.orders\nentity:sales.orders_archive\nentity:sales.orders.id',
    [ref],
  )
  assert.equal((html.match(/<button/g) ?? []).length, 2)
  assert.match(html, /buyer: <button/)
  assert.match(html, /seller: <button/)
  assert.match(html, /entity:sales.orders_archive\nentity:sales.orders.id$/)
})

test('unavailable references are disabled and untyped text stays text', () => {
  assert.match(render('entity:sales.orders', [ref], []), /disabled=""/)
  assert.match(render('entity:sales.orders', [ref], []), /当前目录未包含/)
  assert.equal(render('entity:sales.orders', []), 'entity:sales.orders')
  assert.equal(
    render('<script>entity:sales.orders</script>', []),
    '&lt;script&gt;entity:sales.orders&lt;/script&gt;',
  )
})
