import { mkdir, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import {
  assertBrowserInputs,
  noticeComment,
  thirdPartyNotices,
} from './presentation-build/shared.mjs'

const packageRoot = new URL('../', import.meta.url)
const outputUrl = new URL('lib/client.js', packageRoot)
const result = await build({
  entryPoints: [fileURLToPath(new URL('src/client.tsx', packageRoot))],
  bundle: true,
  external: ['@deepseek-ai/*', 'react', 'react/*', 'react-dom', 'react-dom/*'],
  platform: 'browser',
  format: 'cjs',
  target: 'es2022',
  jsx: 'automatic',
  write: false,
  metafile: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  minify: true,
  legalComments: 'eof',
})
assertBrowserInputs(result.metafile, { portable: false })
const output = result.outputFiles[0]
if (output === undefined) throw new Error('client build returned no output')
const id = '@chengxianglibra/dsh-data-analysis'
const bundle = [
  noticeComment(await thirdPartyNotices(result.metafile)),
  `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
  'var module = { exports: {} }; var exports = module.exports;',
  output.text,
  'return module.exports; } });',
  '',
].join('\n')
await mkdir(new URL('lib/', packageRoot), { recursive: true })
await writeFile(outputUrl, bundle)
await rm(new URL('lib/client.js.map', packageRoot), { force: true })
