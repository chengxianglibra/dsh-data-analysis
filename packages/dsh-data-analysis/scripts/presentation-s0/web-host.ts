/** Boot the installed DSH Web CLI in a fresh private profile, with no user profile mutation. */
import { spawn } from 'node:child_process'
import { appendFile, mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url))
const cli = path.join(repoRoot, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function prepareS0WebHost(workspaceRoot: string, outputRoot: string) {
  const home = path.join(outputRoot, 'isolated-dsh-home')
  const profile = path.join(home, 'profiles/web')
  const plugin = path.join(outputRoot, 'dsh-presentation-s0')
  const readyFile = path.join(outputRoot, 'web-host-ready.json')
  const logPath = path.join(outputRoot, 'web-host.log')
  const overlay = path.join(outputRoot, 'web-host.patch.yml')
  await mkdir(workspaceRoot, { recursive: true })
  await mkdir(plugin, { recursive: true })
  await mkdir(path.join(profile, 'node_modules'), { recursive: true })
  // Existing installed packages are reused; only symlinks inside this new profile are created.
  for (const entry of await readdir(path.join(repoRoot, 'node_modules'))) {
    if (entry === '.bin' || entry === '.package-lock.json') continue
    await symlink(
      path.join(repoRoot, 'node_modules', entry),
      path.join(profile, 'node_modules', entry),
    )
  }
  await symlink(plugin, path.join(profile, 'node_modules/dsh-presentation-s0'))
  await symlink(path.join(repoRoot, 'node_modules'), path.join(plugin, 'node_modules'))
  const manifest = {
    name: 'dsh-presentation-s0',
    version: '0.0.0',
    type: 'module',
    main: './index.js',
    exports: { '.': './index.js', './client': './client.js', './package.json': './package.json' },
  }
  await writeFile(path.join(plugin, 'package.json'), JSON.stringify(manifest, null, 2))
  await writeFile(
    overlay,
    '- insert:\n    - id: presentation-s0\n      name: dsh-presentation-s0\n',
  )
  await build({
    stdin: {
      resolveDir: repoRoot,
      loader: 'ts',
      contents: `
import {writeFile} from 'node:fs/promises';
import {WorkspaceId} from '@deepseek-ai/dsh-workspace';
import {registerS0FileRpc,S0FileService} from ${JSON.stringify(fileURLToPath(new URL('./files.ts', import.meta.url)))};
export const name='presentation-s0';
export const inject=['connection','workspaceRegistry','webServer'];
export async function apply(ctx){
  const workspace=await ctx.workspaceRegistry.create(${JSON.stringify(workspaceRoot)},'Presentation S0');
  const dispose=registerS0FileRpc(ctx.get('connection'),new S0FileService(id=>ctx.workspaceRegistry.get(WorkspaceId(id))));
  ctx.on('dispose',dispose);
  await writeFile(${JSON.stringify(readyFile)},JSON.stringify({workspaceId:String(workspace.id),workspaceRoot:workspace.path,url:ctx.connection.authenticatedUrl('http://127.0.0.1:'+ctx.webServer.port)}));
}
`,
    },
    outfile: path.join(plugin, 'index.js'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
  })
  async function launch() {
    await rm(readyFile, { force: true })
    const process = spawn(
      globalThis.process.execPath,
      [cli, '--profile', 'web', '--patch', overlay, '--no-open', '--port', '0'],
      {
        cwd: workspaceRoot,
        env: { ...globalThis.process.env, DSH_HOME: home, DSH_TOOLS_MODE: 'native' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    let output = ''
    const record = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-32000)
      void appendFile(logPath, chunk)
    }
    process.stdout.on('data', record)
    process.stderr.on('data', record)
    let exited = false
    let spawnError: Error | undefined
    process.once('exit', () => {
      exited = true
    })
    process.once('error', (error) => {
      spawnError = error
    })
    async function stop() {
      if (exited || process.pid === undefined) return
      process.kill('SIGTERM')
      const deadline = Date.now() + 5000
      while (!exited && Date.now() < deadline) await pause(50)
      if (!exited) process.kill('SIGKILL')
    }
    try {
      const deadline = Date.now() + 55000
      while (Date.now() < deadline) {
        if (spawnError) throw spawnError
        if (exited) throw new Error(`DSH Web exited before readiness: ${output}`)
        try {
          const ready = JSON.parse(await readFile(readyFile, 'utf8')) as {
            workspaceId: string
            workspaceRoot: string
            url: string
          }
          const response = await fetch(ready.url, {
            signal: AbortSignal.timeout(2000),
            redirect: 'manual',
          })
          if (
            response.status === 303 ||
            (response.ok && (await response.text()).includes('__DSH_BOOT__'))
          )
            return { ...ready, pid: process.pid, stop }
        } catch {
          /* Service activation and the frontend roster settle asynchronously. */
        }
        await pause(100)
      }
      throw new Error(`DSH Web readiness timeout: ${output}`)
    } catch (error) {
      await stop()
      throw error
    }
  }
  const bootstrap = await launch()
  await bootstrap.stop()
  return {
    workspaceId: bootstrap.workspaceId,
    workspaceRoot: bootstrap.workspaceRoot,
    home,
    profile,
    pluginRoot: plugin,
    logPath,
    async start(client: string) {
      await writeFile(path.join(plugin, 'client.js'), client)
      await writeFile(
        path.join(plugin, 'package.json'),
        JSON.stringify(
          {
            ...manifest,
            dsh: {
              client: {
                platform: 'web',
                inject: [
                  '@deepseek-ai/dsh-client-connection',
                  '@deepseek-ai/dsh-client-ui-layout',
                  '@deepseek-ai/dsh-client-ui-sidebar',
                ],
                external: ['react'],
              },
            },
          },
          null,
          2,
        ),
      )
      const started = await launch()
      if (started.workspaceId !== bootstrap.workspaceId) {
        await started.stop()
        throw new Error('Isolated Workspace identity changed between Web boots')
      }
      return started
    },
  }
}
