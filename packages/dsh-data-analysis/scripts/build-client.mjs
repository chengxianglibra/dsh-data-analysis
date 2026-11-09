import { mkdir, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { buildAnalysisCatalog } from './generate-analysis-catalog.mjs'
import { generateSkillBuild } from './generate-skill-build.mjs'
import {
  assertBrowserInputs,
  noticeComment,
  thirdPartyNotices,
} from './presentation-build/shared.mjs'

const packageRoot = new URL('../', import.meta.url)
const outputUrl = new URL('lib/client.js', packageRoot)
await buildAnalysisCatalog()
await generateSkillBuild()
const result = await build({
  entryPoints: [fileURLToPath(new URL('src/client.tsx', packageRoot))],
  outfile: fileURLToPath(outputUrl),
  bundle: true,
  loader: { '.wasm': 'binary' },
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
assertBrowserInputs(result.metafile)
if (result.outputFiles.some((file) => !file.path.endsWith('.js')))
  throw new Error('unexpected-client-build-output')
const output = result.outputFiles.find((file) => file.path.endsWith('.js'))
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
const composition = await build({
  entryPoints: [fileURLToPath(new URL('src/client.tsx', packageRoot))],
  outfile: fileURLToPath(new URL('lib/client-composition.js', packageRoot)),
  bundle: true,
  loader: { '.wasm': 'binary' },
  external: ['@deepseek-ai/*', 'react', 'react/*', 'react-dom', 'react-dom/*'],
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  jsx: 'automatic',
  write: false,
  metafile: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  minify: true,
  legalComments: 'eof',
})
assertBrowserInputs(composition.metafile)
if (composition.outputFiles.some((file) => !file.path.endsWith('.js')))
  throw new Error('unexpected-client-composition-build-output')
const compositionOutput = composition.outputFiles.find((file) => file.path.endsWith('.js'))
if (compositionOutput === undefined) throw new Error('client composition build returned no output')
await writeFile(
  new URL('lib/client-composition.js', packageRoot),
  noticeComment(await thirdPartyNotices(composition.metafile)) + compositionOutput.text,
)
await rm(new URL('lib/client.js.map', packageRoot), { force: true })
