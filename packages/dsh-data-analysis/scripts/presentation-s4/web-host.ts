/** Actual DSH CLI/profile with production server and client; only its model adapter is scripted. */
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFile, mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { build } from 'esbuild'
import type { runPresentationJourneys } from './host.ts'

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url))
const packageRoot = path.join(repoRoot, 'packages/dsh-data-analysis')
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function startPresentationWebHost(
  workspaceRoot: string,
  outputRoot: string,
  pythonExecutable: string,
  draftPaths: readonly string[],
) {
  const home = path.join(outputRoot, 'isolated-dsh-home')
  const profile = path.join(home, 'profiles/web')
  const plugin = path.join(outputRoot, 'dsh-presentation-s4')
  const readyFile = path.join(outputRoot, 'web-host-ready.json')
  const logPath = path.join(outputRoot, 'web-host.log')
  const patch = path.join(outputRoot, 'web-host.patch.yml')
  await mkdir(path.join(profile, 'node_modules'), { recursive: true })
  await mkdir(plugin, { recursive: true })
  for (const entry of await readdir(path.join(repoRoot, 'node_modules'))) {
    if (entry === '.bin' || entry === '.package-lock.json' || entry === '@chengxianglibra') continue
    await symlink(
      path.join(repoRoot, 'node_modules', entry),
      path.join(profile, 'node_modules', entry),
    )
  }
  const productionPackage = path.join(profile, 'node_modules/@chengxianglibra/dsh-data-analysis')
  await mkdir(productionPackage, { recursive: true })
  const packed = await promisify(execFile)(
    'npm',
    ['pack', packageRoot, '--ignore-scripts', '--json', '--pack-destination', outputRoot],
    { cwd: repoRoot, maxBuffer: 16 * 1024 * 1024 },
  )
  const manifest = JSON.parse(packed.stdout)[0]
  await promisify(execFile)('tar', [
    '-xzf',
    path.join(outputRoot, manifest.filename),
    '-C',
    productionPackage,
    '--strip-components=1',
  ])
  await writeFile(path.join(outputRoot, 'installed-package.json'), packed.stdout)
  await symlink(plugin, path.join(profile, 'node_modules/dsh-presentation-s4'))
  await symlink(path.join(profile, 'node_modules'), path.join(plugin, 'node_modules'))
  const productionManifest = JSON.parse(
    await readFile(path.join(productionPackage, 'package.json'), 'utf8'),
  )
  const moduleDigests = Object.fromEntries(
    await Promise.all(
      (await readdir(path.join(productionPackage, 'lib'), { recursive: true }))
        .filter((file) => file.endsWith('.js'))
        .sort()
        .map(async (file) => [
          file,
          createHash('sha256')
            .update(await readFile(path.join(productionPackage, 'lib', file)))
            .digest('hex'),
        ]),
    ),
  )
  await writeFile(
    path.join(outputRoot, 'production-module-digests.json'),
    JSON.stringify(moduleDigests, null, 2),
  )
  await writeFile(
    path.join(plugin, 'package.json'),
    JSON.stringify(
      {
        name: 'dsh-presentation-s4',
        version: '0.0.0',
        type: 'module',
        main: './index.js',
        exports: {
          '.': './index.js',
          './client': './client.js',
          './package.json': './package.json',
        },
        dsh: { client: productionManifest.dsh.client },
      },
      null,
      2,
    ),
  )
  await writeFile(patch, '- insert:\n    - id: presentation-s4\n      name: dsh-presentation-s4\n')
  await build({
    stdin: {
      resolveDir: repoRoot,
      loader: 'ts',
      contents: `
import {writeFile} from 'node:fs/promises';
import * as production from '@chengxianglibra/dsh-data-analysis';
import {runPresentationJourneys} from ${JSON.stringify(fileURLToPath(new URL('./host.ts', import.meta.url)))};
export const name='presentation-s4';
export const inject=[...production.inject,'llm','agentLoop','sessions','sessionPersistence','webServer'];
export async function apply(ctx){
 await ctx.plugin(production,{pythonExecutable:${JSON.stringify(pythonExecutable)},runtimeRoot:${JSON.stringify(path.join(outputRoot, 'web-runtime-marker'))},credentialInteraction:'none'});
 const result=await runPresentationJourneys(ctx,${JSON.stringify(workspaceRoot)},${JSON.stringify(outputRoot)},'both',${JSON.stringify(draftPaths)},true);
 const workspace=ctx.workspaceRegistry.get(result.workspaceId);
 const stop=ctx.connection.rpc.handle('/presentation-s4-validation',async(endpoint,payload)=>{
  if(endpoint==='detach'){await workspace.detachSession(result.sessionId);return {ok:true};}
  if(endpoint==='attach'){await workspace.attachSession(result.sessionId);return {ok:true};}
  throw new Error('invalid-validation-request');
 },{authority:'trusted-host'});
 ctx.on('dispose',stop);
 await writeFile(${JSON.stringify(readyFile)},JSON.stringify({...result,url:'http://127.0.0.1:'+ctx.webServer.port}));
}
`,
    },
    outfile: path.join(plugin, 'index.js'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    external: [fileURLToPath(new URL('./host.ts', import.meta.url))],
  })
  const productionClient = await readFile(path.join(productionPackage, 'lib/client.js'), 'utf8')
  if (!productionClient.includes('installPresentation'))
    throw new Error('Build the S4 production client before real validation')
  const wrapper = await build({
    stdin: {
      loader: 'ts',
      resolveDir: repoRoot,
      contents: `
import * as production from '@chengxianglibra/dsh-data-analysis/client';
export const inject=production.inject;
export function apply(ctx){
 window.__s4Rpc=(channel,endpoint,payload)=>ctx.get('connection').rpc.call(channel,endpoint,payload);
 return production.apply(ctx);
}
`,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'cjs',
    external: ['@chengxianglibra/dsh-data-analysis/client'],
  })
  await writeFile(
    path.join(plugin, 'client.js'),
    `${productionClient}\nwindow.__ModuleLoader__.load({id:'dsh-presentation-s4',factory:(require)=>{var module={exports:{}};var exports=module.exports;${wrapper.outputFiles[0]!.text};return module.exports;}});`,
  )
  const child = spawn(
    process.execPath,
    [
      path.join(repoRoot, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
      '--profile',
      'web',
      '--patch',
      patch,
      '--no-open',
      '--port',
      '0',
    ],
    {
      cwd: workspaceRoot,
      env: { ...process.env, DSH_HOME: home, DSH_TOOLS_MODE: 'both' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let exited = false,
    spawnError: Error | undefined,
    output = ''
  const record = (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-32000)
    void appendFile(logPath, chunk)
  }
  child.stdout.on('data', record)
  child.stderr.on('data', record)
  child.once('exit', () => {
    exited = true
  })
  child.once('error', (error) => {
    spawnError = error
  })
  async function stop() {
    if (exited || !child.pid) return
    child.kill('SIGTERM')
    const deadline = Date.now() + 5000
    while (!exited && Date.now() < deadline) await pause(50)
    if (!exited) child.kill('SIGKILL')
  }
  try {
    const deadline = Date.now() + 120_000
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError
      if (exited) throw new Error(`S4 DSH Web exited before readiness: ${output}`)
      let ready: (Awaited<ReturnType<typeof runPresentationJourneys>> & { url: string }) | undefined
      try {
        ready = JSON.parse(await readFile(readyFile, 'utf8'))
      } catch {}
      if (ready) {
        const response = await fetch(ready.url, { signal: AbortSignal.timeout(2000) })
        if (response.ok && (await response.text()).includes('__DSH_BOOT__'))
          return { ...ready, home, profile, logPath, moduleDigests, pid: child.pid, stop }
      }
      await pause(100)
    }
    throw new Error(`S4 DSH Web readiness timeout: ${output}`)
  } catch (error) {
    await stop()
    throw error
  }
}
