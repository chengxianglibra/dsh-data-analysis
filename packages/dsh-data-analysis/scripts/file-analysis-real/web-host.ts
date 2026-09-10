/** Isolated production Web with public upload/prompt APIs and read-only trace instrumentation. */
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFile, mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { build } from 'esbuild'

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const packageRoot = path.join(repositoryRoot, 'packages/dsh-data-analysis')
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function startFileAnalysisWeb(
  outputRoot: string,
  workspaces: string[],
  python: string,
  credential: string,
) {
  const home = path.join(outputRoot, 'dsh-home')
  const modules = path.join(home, 'profiles/web/node_modules')
  const plugin = path.join(outputRoot, 'dsh-file-analysis-real')
  const readyPath = path.join(outputRoot, 'ready.json')
  const logPath = path.join(outputRoot, 'web.log')
  const patch = path.join(outputRoot, 'web.patch.yml')
  const redact = (value: string) => value.replaceAll(credential, '[REDACTED]')
  await mkdir(modules, { recursive: true })
  await mkdir(plugin)
  for (const entry of await readdir(path.join(repositoryRoot, 'node_modules'))) {
    if (['.bin', '.package-lock.json', '@chengxianglibra'].includes(entry)) continue
    await symlink(path.join(repositoryRoot, 'node_modules', entry), path.join(modules, entry))
  }
  const installed = path.join(modules, '@chengxianglibra/dsh-data-analysis')
  await mkdir(installed, { recursive: true })
  const supplied = process.env.DSH_DATA_ANALYSIS_VALIDATION_PACKAGE
  const manifest = supplied
    ? { filename: path.basename(supplied), supplied: true }
    : JSON.parse(
        (
          await promisify(execFile)(
            'npm',
            ['pack', packageRoot, '--ignore-scripts', '--json', '--pack-destination', outputRoot],
            { cwd: repositoryRoot },
          )
        ).stdout,
      )[0]
  const tarball = supplied ? path.resolve(supplied) : path.join(outputRoot, manifest.filename)
  await promisify(execFile)('tar', ['-xzf', tarball, '-C', installed, '--strip-components=1'])
  await writeFile(
    path.join(outputRoot, 'package.json'),
    JSON.stringify(
      {
        ...manifest,
        sha256: createHash('sha256')
          .update(await readFile(tarball))
          .digest('hex'),
      },
      null,
      2,
    ),
  )
  await symlink(plugin, path.join(modules, 'dsh-file-analysis-real'))
  await symlink(modules, path.join(plugin, 'node_modules'))
  const productionManifest = JSON.parse(
    await readFile(path.join(installed, 'package.json'), 'utf8'),
  )
  await writeFile(
    path.join(plugin, 'package.json'),
    JSON.stringify({
      name: 'dsh-file-analysis-real',
      version: '0.0.0',
      type: 'module',
      main: './index.js',
      exports: { '.': './index.js', './client': './client.js', './package.json': './package.json' },
      dsh: { client: productionManifest.dsh.client },
    }),
  )
  await writeFile(
    patch,
    '- insert:\n    - id: file-analysis-real\n      name: dsh-file-analysis-real\n',
  )
  await build({
    stdin: {
      loader: 'ts',
      resolveDir: repositoryRoot,
      contents: `
import {writeFile} from 'node:fs/promises';
import * as production from '@chengxianglibra/dsh-data-analysis';
import {SessionId} from '@deepseek-ai/dsh-session';
export const name='file-analysis-real';
export const inject=[...production.inject,'sessions','sessionController','webServer','fileUploads','attachments'];
export async function apply(ctx){
 await ctx.plugin(production,{pythonExecutable:${JSON.stringify(python)},runtimeRoot:${JSON.stringify(path.join(outputRoot, 'runtime-marker'))},credentialInteraction:'none'});
 const workspaceIds=[];
 for(const root of ${JSON.stringify(workspaces)})workspaceIds.push(String((await ctx.workspaceRegistry.create(root)).id));
 const dispose=ctx.connection.fetch.register({path:'/api/file-analysis-validation/snapshot',methods:['GET'],requestBody:'buffered',fetch:async(request)=>{
   const id=SessionId(new URL(request.url).searchParams.get('sessionId'));
   const agent=ctx.agents.get(id);
   if(agent?.status==='idle')await ctx.sessions.flush(agent.session);
   const inspection=await ctx.sessionController.inspect(id);
   const files=inspection.events.flatMap(event=>event.type==='user/message'?event.data.content.filter(block=>block.type==='file').map(block=>({ref:block.attachment,path:ctx.attachments.fileHostPath(block.attachment)})):[]);
   return Response.json({ok:true,value:{status:agent?.status??'cold',inspection,files}});
 }});
 ctx.on('dispose',dispose);
 await writeFile(${JSON.stringify(readyPath)},JSON.stringify({workspaceIds,url:ctx.connection.authenticatedUrl('http://127.0.0.1:'+ctx.webServer.port)}));
}
`,
    },
    outfile: path.join(plugin, 'index.js'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
  })
  const wrapper = await build({
    stdin: {
      loader: 'ts',
      resolveDir: repositoryRoot,
      contents: `
import * as production from '@chengxianglibra/dsh-data-analysis/client';
export const inject=[...production.inject,'remote.session'];
export function apply(ctx){
 production.apply(ctx);
 window.__fileAnalysis={session:(method,value)=>ctx.get('remote.session')[method](value),rpc:async(endpoint,payload)=>{const response=await fetch('/api/file-analysis-validation/'+endpoint+'?'+new URLSearchParams(payload));const text=await response.text();if(!response.ok)throw new Error('snapshot HTTP '+response.status+': '+text);return JSON.parse(text)}};
}
`,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'cjs',
    external: ['@chengxianglibra/dsh-data-analysis/client'],
  })
  const productionClient = await readFile(path.join(installed, 'lib/client.js'), 'utf8')
  assert.ok(
    productionClient.includes('window.__ModuleLoader__.load'),
    'Build the plugin before validation',
  )
  await writeFile(
    path.join(plugin, 'client.js'),
    `${productionClient}\nwindow.__ModuleLoader__.load({id:'dsh-file-analysis-real',factory:(require)=>{var module={exports:{}};var exports=module.exports;${wrapper.outputFiles[0]!.text};return module.exports;}});`,
  )
  let child: ReturnType<typeof spawn> | undefined
  async function stop() {
    const current = child
    if (!current || current.exitCode !== null || current.signalCode !== null) return
    current.kill('SIGTERM')
    const deadline = Date.now() + 5000
    while (current.exitCode === null && current.signalCode === null && Date.now() < deadline)
      await pause(50)
    if (current.exitCode === null && current.signalCode === null) {
      const closed = new Promise<void>((resolve) => current.once('exit', () => resolve()))
      current.kill('SIGKILL')
      await closed
    }
  }
  async function launch(): Promise<{ url: string; workspaceIds: string[] }> {
    await rm(readyPath, { force: true })
    child = spawn(
      process.execPath,
      [
        path.join(repositoryRoot, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
        '--profile',
        'web',
        '--patch',
        patch,
        '--no-open',
        '--port',
        '0',
      ],
      {
        cwd: workspaces[0],
        env: {
          ...process.env,
          DSH_HOME: home,
          DEEPSEEK_API_KEY: credential,
          MARIVO_TELEMETRY: 'off',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    let failed: Error | undefined
    child.once('error', (error) => {
      failed = error
    })
    for (const stream of [child.stdout, child.stderr])
      stream?.on('data', (chunk: Buffer) => {
        void appendFile(logPath, redact(chunk.toString()))
      })
    const deadline = Date.now() + 120_000
    while (Date.now() < deadline) {
      if (failed) throw failed
      if (child.exitCode !== null) throw new Error(`Isolated Web exited; inspect ${logPath}`)
      const ready = await readFile(readyPath, 'utf8')
        .then(JSON.parse)
        .catch(() => undefined)
      if (ready) {
        const response = await fetch(ready.url, {
          signal: AbortSignal.timeout(2000),
          redirect: 'manual',
        }).catch(() => undefined)
        if (response && (response.status === 303 || response.ok)) return ready
      }
      await pause(100)
    }
    throw new Error(`Isolated Web readiness timed out; inspect ${logPath}`)
  }
  try {
    const ready = await launch()
    return {
      ...ready,
      home,
      stop,
      restart: async () => {
        await stop()
        return launch()
      },
    }
  } catch (error) {
    await stop()
    throw error
  }
}
