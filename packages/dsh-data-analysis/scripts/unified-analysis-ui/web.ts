/** Disposable DSH Web with the packaged plugin and analysis UI acceptance probe. */
import { execFileSync, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CREDENTIALS_FILENAME,
  parseCredentialsDocument,
  renderFlatLayoutMigration,
} from '@deepseek-ai/dsh-credentials-local'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { build } from 'esbuild'

const reuseIndex = process.argv.indexOf('--reuse')
const reuse = reuseIndex < 0 ? undefined : process.argv[reuseIndex + 1]
const repository = fileURLToPath(new URL('../../../../', import.meta.url))
const packageRoot = path.join(repository, 'packages/dsh-data-analysis')
const probe = process.argv.includes('--next-steps')
  ? 'next-steps-host.ts'
  : process.argv.includes('--drafts')
    ? 'draft-host.ts'
    : 'host.ts'
const python = process.env.DSH_DATA_ANALYSIS_PYTHON
if (!python) throw new Error('Set DSH_DATA_ANALYSIS_PYTHON')
let modelKey = process.env.DEEPSEEK_API_KEY
if (process.argv.includes('--model') && !modelKey) {
  const filename = path.join(resolveDshHome(), CREDENTIALS_FILENAME)
  const raw = await readFile(filename, 'utf8')
  modelKey = parseCredentialsDocument(renderFlatLayoutMigration(raw) ?? raw, filename).refs.get(
    'DEEPSEEK_API_KEY',
  )
  if (!modelKey) throw new Error('Model credential unavailable')
}
const output = reuse
  ? await realpath(reuse)
  : await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-analysis-ui-web-')))
const workspace = path.join(output, 'workspace')
const home = path.join(output, 'home')
const modules = path.join(home, 'profiles/web/node_modules')
const wrapper = path.join(output, 'p0-probe')
await mkdir(workspace, { recursive: !!reuse })
await mkdir(modules, { recursive: true })
await mkdir(wrapper, { recursive: !!reuse })
await writeFile(
  path.join(wrapper, 'runtime-generate.py'),
  await readFile(new URL('runtime-generate.py', import.meta.url)),
)
for (const entry of await readdir(path.join(repository, 'node_modules'))) {
  if (entry.startsWith('.') || entry === '@chengxianglibra') continue
  if (!reuse) await symlink(path.join(repository, 'node_modules', entry), path.join(modules, entry))
}
const installed = path.join(modules, '@chengxianglibra/dsh-data-analysis')
await mkdir(installed, { recursive: true })
const packed = JSON.parse(
  execFileSync(
    'npm',
    ['pack', packageRoot, '--ignore-scripts', '--json', '--pack-destination', output],
    { encoding: 'utf8' },
  ),
)[0]
execFileSync('tar', [
  '-xzf',
  path.join(output, packed.filename),
  '-C',
  installed,
  '--strip-components=1',
])
await writeFile(path.join(output, 'installed-package.json'), JSON.stringify(packed, null, 2))
const manifest = JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8'))
if (!reuse) await symlink(wrapper, path.join(modules, 'dsh-unified-ui-p0'))
if (!reuse) await symlink(modules, path.join(wrapper, 'node_modules'))
await writeFile(
  path.join(wrapper, 'package.json'),
  JSON.stringify({
    name: 'dsh-unified-ui-p0',
    version: '0.0.0',
    type: 'module',
    main: './index.js',
    exports: { '.': './index.js', './client': './client.js', './package.json': './package.json' },
    dsh: { client: manifest.dsh.client },
  }),
)
const ready = path.join(output, 'ready.json')
await import('node:fs/promises').then(({ rm }) => rm(ready, { force: true }))
await build({
  stdin: {
    resolveDir: repository,
    loader: 'ts',
    contents: `
import {writeFile} from 'node:fs/promises';
import * as production from '@chengxianglibra/dsh-data-analysis';
import {installProbe} from ${JSON.stringify(fileURLToPath(new URL(probe, import.meta.url)))};
export const inject=[...production.inject,'llm','agentLoop','webServer'];
export async function apply(ctx){
 await ctx.plugin(production,{pythonExecutable:${JSON.stringify(python)},runtimeRoot:${JSON.stringify(path.join(output, 'runtime-marker'))},credentialInteraction:'none'});
 const result=await installProbe(ctx,${JSON.stringify(workspace)},${JSON.stringify(output)});
 await writeFile(${JSON.stringify(ready)}, JSON.stringify({...result,url:ctx.connection.authenticatedUrl('http://127.0.0.1:'+ctx.webServer.port)}));
}`,
  },
  outfile: path.join(wrapper, 'index.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
})
const client = await build({
  stdin: {
    resolveDir: repository,
    loader: 'ts',
    contents: `
import * as production from '@chengxianglibra/dsh-data-analysis/client';
import * as probe from ${JSON.stringify(fileURLToPath(new URL('client.tsx', import.meta.url)))};
export const inject=[...new Set([...production.inject,...probe.inject])];
export function apply(ctx){production.apply(ctx,{diagnostics:true,onInstalled:(controller)=>window.__p2Tabs=controller});probe.apply(ctx);}
`,
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'cjs',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  external: [
    '@deepseek-ai/*',
    '@chengxianglibra/dsh-data-analysis/client',
    'react',
    'react/*',
    'react-dom',
    'react-dom/*',
  ],
})
await writeFile(
  path.join(wrapper, 'client.js'),
  [
    await readFile(path.join(installed, 'lib/client.js'), 'utf8'),
    `window.__ModuleLoader__.load({id:'dsh-unified-ui-p0',factory:(require)=>{var module={exports:{}};var exports=module.exports;${client.outputFiles[0]!.text};return module.exports;}});`,
  ].join('\n'),
)
const patch = path.join(output, 'probe.patch.yml')
await writeFile(patch, '- insert:\n    - id: unified-ui-p0\n      name: dsh-unified-ui-p0\n')
const child = spawn(
  process.execPath,
  [
    path.join(repository, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
    '--profile',
    'web',
    '--patch',
    patch,
    '--no-open',
    '--port',
    '0',
  ],
  {
    cwd: workspace,
    env: {
      ...process.env,
      DSH_HOME: home,
      DSH_TOOLS_MODE: 'ptc',
      ...(modelKey ? { DEEPSEEK_API_KEY: modelKey } : {}),
      OPENUI_TELEMETRY_DISABLED: '1',
      DO_NOT_TRACK: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
)
const log = await import('node:fs').then(({ createWriteStream }) =>
  createWriteStream(path.join(output, 'host.log')),
)
child.stdout.pipe(log)
child.stderr.pipe(log)
let exited = false
child.once('exit', () => {
  exited = true
})
process.on('SIGTERM', () => child.kill('SIGTERM'))
process.on('SIGINT', () => child.kill('SIGTERM'))
const deadline = Date.now() + 120_000
while (!exited && Date.now() < deadline) {
  const state = await readFile(ready, 'utf8')
    .then(JSON.parse)
    .catch(() => undefined)
  if (state) {
    console.log(JSON.stringify({ output, pid: child.pid, ...state }))
    break
  }
  await new Promise((resolve) => setTimeout(resolve, 100))
}
if (exited) throw new Error(`Host exited: ${await readFile(path.join(output, 'host.log'), 'utf8')}`)
if (Date.now() >= deadline) {
  child.kill('SIGTERM')
  throw new Error(`Host readiness timed out: ${output}`)
}
