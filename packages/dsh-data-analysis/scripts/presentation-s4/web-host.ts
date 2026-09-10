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
  clientOrder: 'native-first' | 'report-first' = 'native-first',
  options: {
    productionPackageRoot?: string
    askDshProbe?: boolean
    rightTabsAcceptance?: boolean
    retainedPresentation?: boolean
    datasourceDefaults?: Record<string, Record<string, unknown>>
  } = {},
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
    [
      'pack',
      options.productionPackageRoot ?? packageRoot,
      '--ignore-scripts',
      '--json',
      '--pack-destination',
      outputRoot,
    ],
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
  // The isolated wrapper composes both public client plugins explicitly so the
  // same real Web can verify either registration order without duplicate seats.
  await writeFile(
    patch,
    '- id: ui-deliverables\n  disabled: true\n- insert:\n    - id: presentation-s4\n      name: dsh-presentation-s4\n',
  )
  await build({
    stdin: {
      resolveDir: repoRoot,
      loader: 'ts',
      contents: `
import {readFile,writeFile} from 'node:fs/promises';
import * as production from '@chengxianglibra/dsh-data-analysis';
import {registerPluginRpc} from ${JSON.stringify(fileURLToPath(new URL('../../src/rpc.ts', import.meta.url)))};
import {inspectStoredSession} from ${JSON.stringify(fileURLToPath(new URL('../harness-session.ts', import.meta.url)))};
import {runPresentationJourneys} from ${JSON.stringify(fileURLToPath(new URL('./host.ts', import.meta.url)))};
${options.rightTabsAcceptance ? `import {createRightTabsDriver} from ${JSON.stringify(fileURLToPath(new URL('../right-tabs/driver.ts', import.meta.url)))};` : ''}
export const name='presentation-s4';
export const inject=[...production.inject,'llm','agentLoop','sessions','sessionPersistence','webServer'];
export async function apply(ctx){
 await ctx.plugin(production,{pythonExecutable:${JSON.stringify(pythonExecutable)},runtimeRoot:${JSON.stringify(path.join(outputRoot, 'web-runtime-marker'))},credentialInteraction:${JSON.stringify(options.rightTabsAcceptance ? 'web' : 'none')},datasourceDefaults:${JSON.stringify(options.datasourceDefaults)}});
 const previous = await readFile(${JSON.stringify(readyFile)},'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT') return undefined; throw error});
 const result=previous ?? await runPresentationJourneys(ctx,${JSON.stringify(workspaceRoot)},${JSON.stringify(outputRoot)},'both',${JSON.stringify(draftPaths)},true);
 const workspace=ctx.workspaceRegistry.get(result.workspaceId);
 ${options.rightTabsAcceptance ? `const prototypeDriver = await createRightTabsDriver(ctx,workspace,${JSON.stringify(draftPaths)});` : ''}
 const stop=registerPluginRpc(ctx.connection,'/presentation-s4-validation',['events','detach','attach'${options.rightTabsAcceptance ? ", 'prototype'" : ''}],async(endpoint,payload)=>{
  ${options.rightTabsAcceptance ? "if(endpoint==='prototype')return prototypeDriver(payload);" : ''}
  if(endpoint==='events'){const stored=await inspectStoredSession(ctx.sessionPersistence,result.sessionId);return {ok:true,value:stored.events.filter(event=>['agent','turn','step','user','request','assistant','tool'].includes(event.type.split('/')[0]))};}
  if(endpoint==='detach'){await workspace.detachSession(result.sessionId);return {ok:true};}
  if(endpoint==='attach'){await workspace.attachSession(result.sessionId);return {ok:true};}
  throw new Error('invalid-validation-request');
 });
 ctx.on('dispose',stop);
 await writeFile(${JSON.stringify(readyFile)},JSON.stringify({...result,url:ctx.connection.authenticatedUrl('http://127.0.0.1:'+ctx.webServer.port)}));
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
  if (
    !productionClient.includes('window.__ModuleLoader__.load') ||
    !productionClient.includes('installPresentation')
  )
    throw new Error('Build the S4 production client before real validation')
  const wrapper = await build({
    stdin: {
      loader: 'ts',
      resolveDir: repoRoot,
      contents: `
import * as production from '@chengxianglibra/dsh-data-analysis/client';
import * as native from '@deepseek-ai/dsh-client-ui-deliverables/client';
${
  options.retainedPresentation
    ? `import {createPluginRpc} from ${JSON.stringify(fileURLToPath(new URL('../../src/client/rpc.ts', import.meta.url)))};
import {installSemanticReferenceSource} from ${JSON.stringify(fileURLToPath(new URL('../../src/client/semantic-reference-source.ts', import.meta.url)))};`
    : ''
}
${options.rightTabsAcceptance ? `import {installReadDelayProbe} from ${JSON.stringify(fileURLToPath(new URL('../right-tabs/client-probe.ts', import.meta.url)))};` : ''}
export const inject=production.inject;
export async function apply(ctx){
 window.__s4Rpc=(channel,endpoint,payload)=>ctx.get('connection').rpc.call('/api',channel.slice(1)+'/'+endpoint,payload);
 ${
   options.askDshProbe
     ? `
 // Isolated acceptance instrumentation only: production modules remain byte-identical.
 const rpc=ctx.get('connection').rpc, call=rpc.call.bind(rpc), calls=[];
 rpc.call=(channel,endpoint,payload,...rest)=>{calls.push({channel,endpoint});return call(channel,endpoint,payload,...rest)};
 const sessions=ctx.sessions, scope=sessions.scope.bind(sessions);
 const resolver=ctx.conversation.input, resolve=resolver.for.bind(resolver);
 let failure, writes=0;
 const wrapped=new WeakSet();
 sessions.scope=(id)=>{if(failure==='scope'){failure=undefined;throw new Error('Ask DSH validation: session unavailable')}return scope(id)};
 resolver.for=(actx)=>{
   if(!wrapped.has(actx)){
     const bail=actx.bail.bind(actx);
     actx.bail=(...args)=>{if(['slash/input-insert-text','slash/input-insert-reference'].includes(args[1])){writes++;if(failure==='write'){failure=undefined;throw new Error('Ask DSH validation: draft write failed')}}return bail(...args)};
     wrapped.add(actx);
   }
   return resolve(actx);
 };
 window.__askDshProbe={
   read:id=>structuredClone(resolve(scope(id)).state.getSnapshot()),
   insertReference:(id,reference)=>{
     const input=resolve(scope(id)), state=input.state.getSnapshot();
     const end=state.occurrences.reduce((n,o)=>n-o.length+1,state.draft.length);
     return input.insertReference(reference,{start:end,end,draftRev:state.draftRev});
   },
   serializeLast:id=>{
     const occurrence=resolve(scope(id)).state.getSnapshot().occurrences.at(-1);
     return ctx.inputTriggers.sessionOf(scope(id)).serializeReference(occurrence.source,occurrence.ref,new AbortController().signal);
   },
   audit:()=>({writes,calls:structuredClone(calls)}),
   failNext:kind=>{if(!['scope','write'].includes(kind))throw new Error('invalid failure');failure=kind},
 };
 `
     : ''
}
 ${clientOrder === 'native-first' ? 'await ctx.plugin(native);' : ''}
 ${options.rightTabsAcceptance ? 'const delay = installReadDelayProbe(ctx); const prototypeFork = ctx.plugin(production,{diagnostics:true,onInstalled(controller){window.__rightTabs=controller}}); window.__rtHost = { current: () => ctx.sessions.list.getSnapshot().current, delay, history: id => ctx.sessions.binding(id)?.eventSource.getSnapshot().hasMore, loadOlder: id => ctx.sessions.binding(id).session.loadOlder(), reconnect: () => ctx.connection.reconnect(), generation: () => !!ctx.connection.generation.getSnapshot(), unload: () => prototypeFork.dispose(), select: id => ctx.sessions.open(id), selectModel: (id, selection) => ctx.get("modelDirectories").directoryFor(id).select(selection), sidebar: ctx.sidebarRight, workspaces: ctx.workspaces.list, input: id => ctx.conversation.input.for(ctx.sessions.scope(id)), clear: () => ctx.sessions.clear() };' : options.retainedPresentation ? 'const presentationRpc = createPluginRpc(ctx.connection.rpc); installSemanticReferenceSource(ctx,presentationRpc); production.installPresentation(ctx,presentationRpc);' : 'production.apply(ctx);'}
 ${clientOrder === 'report-first' ? 'await ctx.plugin(native);' : ''}
 window.__s4ClientOrder=${JSON.stringify(clientOrder)};
}
`,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'cjs',
    jsx: 'automatic',
    loader: { '.wasm': 'binary' },
    external: [
      '@deepseek-ai/*',
      'react',
      'react/*',
      'react-dom',
      'react-dom/*',
      '@chengxianglibra/dsh-data-analysis/client',
      '@deepseek-ai/dsh-client-ui-deliverables/client',
    ],
  })
  await writeFile(
    path.join(plugin, 'client.js'),
    `${await readFile(path.join(repoRoot, 'node_modules/@deepseek-ai/dsh-client-ui-deliverables/lib/client.js'), 'utf8')}\n${productionClient}\nwindow.__ModuleLoader__.load({id:'dsh-presentation-s4',factory:(require)=>{var module={exports:{}};var exports=module.exports;${wrapper.outputFiles[0]!.text};return module.exports;}});`,
  )
  const processAuditPath = path.join(outputRoot, 'process-audit.log')
  const preload = path.join(outputRoot, 'process-audit.mjs')
  await writeFile(processAuditPath, '')
  await writeFile(
    preload,
    `import cp from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const record = method => appendFileSync(${JSON.stringify(processAuditPath)}, method + "\\n");
for(const method of ['spawn','spawnSync','exec','execFile','execSync','execFileSync','fork']) {
 const wrap = fn => new Proxy(fn, {apply(target, receiver, args) {record(method);return Reflect.apply(target,receiver,args)},get(target,key,receiver) {const value=Reflect.get(target,key,receiver);return key===Symbol.for('nodejs.util.promisify.custom') && typeof value==='function' ? wrap(value) : value}});
 cp[method]=wrap(cp[method]);
}
syncBuiltinESMExports();
`,
  )
  let exited = false,
    spawnError: Error | undefined,
    output = ''
  const record = (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-32000)
    void appendFile(logPath, chunk)
  }
  const launch = () => {
    exited = false
    spawnError = undefined
    const child = spawn(
      process.execPath,
      [
        '--import',
        preload,
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
    child.stdout.on('data', record)
    child.stderr.on('data', record)
    child.once('exit', () => {
      exited = true
    })
    child.once('error', (error) => {
      spawnError = error
    })
    return child
  }
  let child = launch()
  async function stop() {
    if (exited || !child.pid) return
    child.kill('SIGTERM')
    const deadline = Date.now() + 5000
    while (!exited && Date.now() < deadline) await pause(50)
    if (!exited) {
      const stopped = new Promise<void>((resolve) => child.once('exit', () => resolve()))
      child.kill('SIGKILL')
      await stopped
    }
  }
  const waitReady = async () => {
    const deadline = Date.now() + 120_000
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError
      if (exited) throw new Error(`S4 DSH Web exited before readiness: ${output}`)
      let ready: (Awaited<ReturnType<typeof runPresentationJourneys>> & { url: string }) | undefined
      try {
        ready = JSON.parse(await readFile(readyFile, 'utf8'))
      } catch {}
      if (ready) {
        try {
          const response = await fetch(ready.url, {
            signal: AbortSignal.timeout(2000),
            redirect: 'manual',
          })
          if (
            response.status === 303 ||
            (response.ok && (await response.text()).includes('__DSH_BOOT__'))
          )
            return ready
        } catch {
          /* A restart can retain the old ready file while its new port is opening. */
        }
      }
      await pause(100)
    }
    throw new Error(`S4 DSH Web readiness timeout: ${output}`)
  }
  try {
    const ready = await waitReady()
    return {
      ...ready,
      home,
      profile,
      logPath,
      moduleDigests,
      processAuditPath,
      clientOrder,
      pid: child.pid,
      stop,
      restart: async () => {
        await stop()
        child = launch()
        return { ...(await waitReady()), pid: child.pid }
      },
    }
  } catch (error) {
    await stop()
    throw error
  }
}
