import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import {
  assertBrowserInputs,
  noticeComment,
  thirdPartyNotices,
} from './presentation-build/shared.mjs'

const packageRoot = new URL('../', import.meta.url)
const sourceRoot = new URL('src/client/presentation/', packageRoot)
const assetsRoot = new URL('lib/presentation/assets/', packageRoot)
const common = {
  absWorkingDir: fileURLToPath(packageRoot),
  bundle: true,
  loader: { '.wasm': /** @type {const} */ ('binary') },
  write: /** @type {const} */ (false),
  jsx: /** @type {const} */ ('automatic'),
  target: 'es2022',
  minify: true,
  legalComments: /** @type {const} */ ('eof'),
  define: { 'process.env.NODE_ENV': '"production"' },
  metafile: /** @type {const} */ (true),
}

const [portable, staticRenderer, styles, builder] = await Promise.all([
  build({
    ...common,
    entryPoints: [fileURLToPath(new URL('portable-entry.tsx', sourceRoot))],
    platform: 'browser',
    format: 'iife',
  }),
  build({
    ...common,
    stdin: {
      resolveDir: fileURLToPath(sourceRoot),
      contents: `import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server.browser';
import {PresentationReader} from './reader.tsx';
export function renderFallback(document) {
  return renderToStaticMarkup(createElement(PresentationReader, {document, mode: 'static'}));
}`,
      loader: 'ts',
    },
    platform: 'browser',
    format: 'esm',
  }),
  build({
    ...common,
    entryPoints: [fileURLToPath(new URL('styles.ts', sourceRoot))],
    platform: 'browser',
    format: 'esm',
  }),
  build({
    ...common,
    entryPoints: [fileURLToPath(new URL('src/presentation/build/index.ts', packageRoot))],
    platform: 'node',
    format: 'esm',
    minify: false,
    plugins: [
      {
        name: 'shared-presentation-contracts',
        setup(context) {
          context.onResolve({ filter: /^\.\.\/contracts\/index\.ts$/ }, () => ({
            path: '../contracts/index.js',
            external: true,
          }))
        },
      },
    ],
  }),
])
// absWorkingDir makes esbuild's metafile inputs package-relative. Normalize once.
for (const result of [portable, staticRenderer, styles]) {
  result.metafile.inputs = Object.fromEntries(
    Object.entries(result.metafile.inputs).map(([input, details]) => [
      input === '<stdin>' ? input : fileURLToPath(new URL(input, packageRoot)),
      details,
    ]),
  )
  assertBrowserInputs(result.metafile, { portable: true })
}
const [portableNotices, staticNotices] = await Promise.all([
  thirdPartyNotices(portable.metafile),
  thirdPartyNotices(staticRenderer.metafile),
])
const portableOutput = portable.outputFiles[0]
const staticOutput = staticRenderer.outputFiles[0]
const stylesOutput = styles.outputFiles[0]
const builderOutput = builder.outputFiles[0]
if (!portableOutput || !staticOutput || !stylesOutput || !builderOutput)
  throw new Error('presentation build returned no output')
const { PRESENTATION_STYLES } = await import(
  `data:text/javascript;base64,${Buffer.from(stylesOutput.text).toString('base64')}`
)
if (typeof PRESENTATION_STYLES !== 'string') throw new Error('missing presentation styles')

await mkdir(assetsRoot, { recursive: true })
await mkdir(new URL('lib/presentation/build/', packageRoot), { recursive: true })
await writeFile(
  new URL('portable.js', assetsRoot),
  `${noticeComment(portableNotices)}export const script=${JSON.stringify(portableOutput.text)};\nexport const styles=${JSON.stringify(PRESENTATION_STYLES)};\nexport const notices=${JSON.stringify(portableNotices)};\n`,
)
await writeFile(new URL('static.js', assetsRoot), noticeComment(staticNotices) + staticOutput.text)
await writeFile(new URL('lib/presentation/build/index.js', packageRoot), builderOutput.text)
