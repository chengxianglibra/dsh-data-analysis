import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import ts from 'typescript'

const packageRoot = new URL('../', import.meta.url)
const sourceUrl = new URL('src/client.tsx', packageRoot)
const outputUrl = new URL('lib/client.js', packageRoot)
const mapUrl = new URL('lib/client.js.map', packageRoot)
const source = await readFile(sourceUrl, 'utf8')
const transpiled = ts.transpileModule(source, {
  fileName: 'client.tsx',
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
    verbatimModuleSyntax: false,
  },
})
const id = '@chengxianglibra/dsh-data-analysis'
const bundle = [
  `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
  'var module = { exports: {} }; var exports = module.exports;',
  transpiled.outputText,
  'return module.exports; } });',
  '',
].join('\n')
await mkdir(new URL('lib/', packageRoot), { recursive: true })
await writeFile(outputUrl, bundle)
await rm(mapUrl, { force: true })
