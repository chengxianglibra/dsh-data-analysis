import { writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { noticeComment, thirdPartyNotices } from './presentation-build/shared.mjs'

const executable = new URL('../lib/bin/environment.js', import.meta.url)
const require = createRequire(import.meta.url)
const result = await build({
  entryPoints: [fileURLToPath(executable)],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22.19',
  packages: 'external',
  // Keep package metadata relative to lib/compatibility.js, not the CLI bundle.
  external: ['../compatibility.js'],
  plugins: [
    {
      name: 'standalone-dsh-home-paths',
      setup(builder) {
        builder.onResolve({ filter: /^@deepseek-ai\/dsh-home-paths$/ }, () => ({
          path: require.resolve('@deepseek-ai/dsh-home-paths'),
        }))
      },
    },
  ],
  metafile: true,
  write: false,
})
const output = result.outputFiles[0]
if (output === undefined) throw new Error('environment CLI build returned no output')
const shebang = /^#![^\n]*\n/.exec(output.text)?.[0]
if (shebang === undefined) throw new Error('environment CLI build lost its executable shebang')
const notices = noticeComment(await thirdPartyNotices(result.metafile))
await writeFile(executable, `${shebang}${notices}${output.text.slice(shebang.length)}`)
