/** Cordis lifecycle adapter for the Web-profile shared Marivo Runtime. */

import process from 'node:process'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { apply as installSkillFilesystem } from '@deepseek-ai/dsh-skill-filesystem'
import z from '@deepseek-ai/schemastery'
import {
  installMarivoCheckpoint,
  type InstallCheckpointOptions,
  type MarivoCheckpointController,
} from './checkpoint/index.ts'
import {
  DEFAULT_SHARED_RUNTIME_INSTALL_TIMEOUT_MS,
  ensureSharedMarivoRuntime,
  MarivoWorkspaceEnvironmentManager,
  MarivoEnvironment,
} from './environment/index.ts'

/** Cordis plugin name used by loader diagnostics and lifecycle logs. */
export const name = 'dsh-data-analysis'

/** Services that must exist before the plugin binds and watches Agent scopes. */
export const inject = ['agents', 'skills', 'tools', 'systemPrompt']

/** Loader-safe configuration for the shared Runtime and per-Workspace bindings. */
export interface Config {
  /** Explicit project root override; otherwise each Agent uses session.header.cwd. */
  readonly projectRoot?: string
  /** Administrator-provided shared interpreter; must already contain an importable Marivo. */
  readonly pythonExecutable?: string
  /** Shared Runtime root; defaults below $DSH_HOME. */
  readonly runtimeRoot?: string
  /** Local uv executable; an explicit value must be absolute. */
  readonly uvExecutable?: string
  /** Maximum time for installation and lock acquisition. */
  readonly installTimeoutMs?: number
  /** Create missing marivo.toml, models/, and .marivo/ in each Workspace. */
  readonly initializeWorkspace?: boolean
}

/** Cordis loader schema. Runtime defaults are resolved in {@link apply}. */
export const Config: z<Config> = z.object({
  projectRoot: z.string(),
  pythonExecutable: z.string(),
  runtimeRoot: z.string(),
  uvExecutable: z.string(),
  installTimeoutMs: z.number().default(DEFAULT_SHARED_RUNTIME_INSTALL_TIMEOUT_MS),
  initializeWorkspace: z.boolean().default(true),
})

function configuredProjectRoot(config: Config, agent: Agent): string {
  return config.projectRoot
    ?? process.env.DSH_DATA_ANALYSIS_PROJECT_ROOT
    ?? agent.session.header.cwd
    ?? process.env.DSH_CWD
    ?? process.cwd()
}

export type MarivoPluginEnvironmentResolver = (
  agent: Agent,
) => MarivoEnvironment | Promise<MarivoEnvironment>

/**
 * Install one already-bound environment into every live or subsequently published Agent scope.
 * Installation is transactional for existing Agents and is disposed with the Cordis plugin.
 */
export function installMarivoPlugin(
  ctx: Context,
  environmentOrResolver: MarivoEnvironment | MarivoPluginEnvironmentResolver,
  options: InstallCheckpointOptions = {},
): () => void {
  const installed = new Map<Agent, MarivoCheckpointController>()
  const install = (agent: Agent): void => {
    if (installed.has(agent)) return
    const source = environmentOrResolver instanceof MarivoEnvironment
      ? environmentOrResolver
      : () => Promise.resolve(environmentOrResolver(agent))
    installed.set(agent, installMarivoCheckpoint(ctx, agent, source, options))
  }

  try {
    for (const agent of ctx.agents.list()) install(agent)
  } catch (error: unknown) {
    for (const controller of installed.values()) controller.dispose()
    throw error
  }

  const stopCreated = ctx.on('agent/created', ({ agent }) => { install(agent) })
  const stopDisposed = ctx.on('agent/disposed', ({ agent }) => {
    installed.get(agent)?.dispose()
    installed.delete(agent)
  })
  let active = true
  return () => {
    if (!active) return
    active = false
    stopCreated()
    stopDisposed()
    for (const controller of installed.values()) controller.dispose()
    installed.clear()
  }
}

/** Ensure the shared Runtime once, mount its skills, then bind each Workspace lazily. */
export async function apply(ctx: Context, config: Config = {}): Promise<() => void> {
  const pythonExecutable = config.pythonExecutable ?? process.env.DSH_DATA_ANALYSIS_PYTHON
  const runtimeRoot = config.runtimeRoot ?? process.env.DSH_DATA_ANALYSIS_RUNTIME_ROOT
  const uvExecutable = config.uvExecutable ?? process.env.DSH_DATA_ANALYSIS_UV
  const runtime = await ensureSharedMarivoRuntime({
    ...(pythonExecutable === undefined ? {} : { pythonExecutable }),
    ...(runtimeRoot === undefined ? {} : { runtimeRoot }),
    ...(uvExecutable === undefined ? {} : { uvExecutable }),
    ...(config.installTimeoutMs === undefined ? {} : { installTimeoutMs: config.installTimeoutMs }),
  })
  installSkillFilesystem(ctx, {
    providerName: 'dsh-data-analysis-marivo',
    includeDefaultRoots: false,
    customSkillDirs: [runtime.skillsRoot],
    watch: false,
  })
  const manager = new MarivoWorkspaceEnvironmentManager(
    runtime,
    config.initializeWorkspace ?? true,
  )
  const disposePlugin = installMarivoPlugin(
    ctx,
    agent => manager.resolve(configuredProjectRoot(config, agent)),
  )
  return () => {
    disposePlugin()
    manager.dispose()
  }
}
