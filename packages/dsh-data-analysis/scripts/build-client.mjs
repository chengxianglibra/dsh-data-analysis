import { mkdir, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const packageRoot = new URL('../', import.meta.url)
const outputUrl = new URL('lib/client.js', packageRoot)
const result = await build({
  entryPoints: [fileURLToPath(new URL('src/client.tsx', packageRoot))],
  bundle: true,
  packages: 'external',
  platform: 'browser',
  format: 'cjs',
  target: 'es2022',
  jsx: 'automatic',
  write: false,
  metafile: true,
})
for (const input of Object.keys(result.metafile.inputs)) {
  if (
    !/(?:^|\/)src\/(client(?:\.tsx|\/)|semantic-reference\/contracts\.ts$|semantic-browser\/(?:contracts|definition)\.ts$)/.test(
      input,
    )
  ) {
    throw new Error(`Host module in browser bundle: ${input}`)
  }
}
const output = result.outputFiles[0]
if (output === undefined) throw new Error('client build returned no output')
const id = '@chengxianglibra/dsh-data-analysis'
const bundle = [
  `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
  'var module = { exports: {} }; var exports = module.exports;',
  output.text,
  'return module.exports; } });',
  '',
].join('\n')
await mkdir(new URL('lib/', packageRoot), { recursive: true })
await writeFile(outputUrl, bundle)
await rm(new URL('lib/client.js.map', packageRoot), { force: true })
