/** Cordis lifecycle adapter for the Web-profile shared Marivo Runtime. */

import process from 'node:process'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-client-connection'
import { apply as installSkillFilesystem } from '@deepseek-ai/dsh-skill-filesystem'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import z from '@deepseek-ai/schemastery'
import { createMarivoBridgeSet, type MarivoBridgeSet } from './bridges.ts'
import { MarivoDatasourceBridge } from './datasource/bridge.ts'
import { registerMarivoDatasourceTestTool } from './datasource/index.ts'
import { registerMarivoPythonTool } from './datasource/python.ts'
import {
  DEFAULT_PYTHON_MAX_TIMEOUT_MS,
  DEFAULT_PYTHON_TIMEOUT_MS,
  type MarivoPythonOptions,
  resolvePythonOptions,
} from './datasource/python-options.ts'
import { registerCredentialRpc } from './datasource/rpc.ts'
import { type CredentialStore, MarivoCredentialService } from './datasource/service.ts'
import { registerMarivoRuntimeShellEnvironment } from './datasource/shell-env.ts'
import { MarivoHelpBridge, type MarivoHelpBridgeSource } from './disclosure/bridge.ts'
import {
  installMarivoExecutionGuidance,
  MARIVO_ANALYSIS_CLOSEOUT_PROMPT,
  MARIVO_DATASOURCE_CREDENTIAL_PROMPT,
} from './disclosure/execution-guidance.ts'
import {
  installMarivoDisclosure,
  type MarivoDisclosureController,
  type MarivoDisclosureOptions,
} from './disclosure/index.ts'
import {
  createSharedMarivoRuntimeRunner,
  DEFAULT_SHARED_RUNTIME_INSTALL_TIMEOUT_MS,
  ensureSharedMarivoRuntime,
  MarivoEnvironment,
  type MarivoEnvironmentSource,
  MarivoWorkspaceEnvironmentManager,
  resolveMarivoEnvironmentSource,
} from './environment/index.ts'
import {
  installMarivoPresentationCodeDelivery,
  MarivoPresentationFileService,
  registerMarivoPresentationRpc,
  registerMarivoPresentTool,
} from './presentation/index.ts'
import { browserFailure, SemanticBrowserService } from './semantic-browser/service.ts'
import {
  registerSemanticReferenceRpc,
  SemanticReferenceService,
  SemanticReferenceUsage,
} from './semantic-reference/index.ts'

export { MARIVO_DATASOURCE_CREDENTIAL_PROMPT } from './disclosure/execution-guidance.ts'

/** Cordis plugin name used by loader diagnostics and lifecycle logs. */
export const name = 'dsh-data-analysis'

/** Services that must exist before the plugin binds and watches Agent scopes. */
export const inject = [
  'agents',
  'connection',
  'storageDomain',
  'workspaceRegistry',
  'credentials',
  'shellEnv',
  'skills',
  'systemPrompt',
  'tools',
]

const PRESENTATION_PROMPT =
  'Answer ordinary factual questions in text. For charts, tables, reports, dashboards or a readable source presentation, load the dsh-data-analysis-presentation skill and deliver through marivo_present. Existing data needs no prior Marivo skill activation; load the Runtime skills and live Help when new analysis or semantic authoring is needed.'

/** Loader-safe configuration for the shared Runtime and per-Workspace bindings. */
export interface Config extends MarivoPythonOptions {
  readonly credentialInteraction?: 'web' | 'none'

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
}

/** Cordis loader schema. Runtime defaults are resolved in {@link apply}. */
export const Config: z<Config> = z.object({
  pythonTimeoutMs: z.number().default(DEFAULT_PYTHON_TIMEOUT_MS),
  pythonMaxTimeoutMs: z.number().default(DEFAULT_PYTHON_MAX_TIMEOUT_MS),
  credentialInteraction: z.union(['web', 'none']).default('web'),
  projectRoot: z.string(),
  pythonExecutable: z.string(),
  runtimeRoot: z.string(),
  uvExecutable: z.string(),
  installTimeoutMs: z.number().default(DEFAULT_SHARED_RUNTIME_INSTALL_TIMEOUT_MS),
})

function configuredProjectRoot(config: Config, agent: Agent): string {
  return (
    config.projectRoot ??
    process.env.DSH_DATA_ANALYSIS_PROJECT_ROOT ??
    agent.session.header.cwd ??
    process.env.DSH_CWD ??
    process.cwd()
  )
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
  options: MarivoDisclosureOptions &
    MarivoPythonOptions & {
      /** Override used by focused tests; normal plugin installation uses ctx.credentials. */
      credentials?: CredentialStore
      credentialService?: MarivoCredentialService
      credentialInteraction?: 'web' | 'none'
      /** Runtime-scoped Help source; normal plugin installation never binds Help to a Workspace. */
      helpBridgeSource?: MarivoHelpBridgeSource
    } = {},
): () => void {
  const pythonOptions = resolvePythonOptions(options)
  const installed = new Map<Agent, MarivoDisclosureController>()
  const credentials = options.credentials ?? ctx.credentials
  if (credentials === undefined) {
    throw new Error('dsh-data-analysis requires the DSH credentials service')
  }
  const credentialService =
    options.credentialService ??
    new MarivoCredentialService(credentials, options.credentialInteraction)
  const stopCredentialUpdates = ctx.on('credentials/reference-updated', (ref) =>
    credentialService.invalidateStorageRef(ref),
  )
  const bridgeSets = new WeakMap<MarivoEnvironment, MarivoBridgeSet>()
  const install = (agent: Agent): void => {
    if (installed.has(agent)) return
    const source: MarivoEnvironmentSource =
      environmentOrResolver instanceof MarivoEnvironment
        ? environmentOrResolver
        : () => Promise.resolve(environmentOrResolver(agent))
    const resolveBridgeSet = async (): Promise<MarivoBridgeSet> => {
      const environment = await resolveMarivoEnvironmentSource(source)
      let bridges = bridgeSets.get(environment)
      if (bridges === undefined) {
        bridges = createMarivoBridgeSet(environment)
        bridgeSets.set(environment, bridges)
      }
      return bridges
    }
    const helpSource = options.helpBridgeSource ?? (async () => (await resolveBridgeSet()).help)
    const datasourceSource = async () => (await resolveBridgeSet()).datasource
    const presentationSource = async () => {
      const workspace = resolvePresentationWorkspace(ctx, String(agent.session.id))
      const projection = (await resolveBridgeSet()).presentation
      const current = resolvePresentationWorkspace(ctx, String(agent.session.id))
      if (
        workspace.id !== current.id ||
        workspace.path !== current.path ||
        projection.binding.projectRoot !== current.path
      )
        throw new Error('Presentation Workspace changed or does not match the bound Runtime')
      return { workspaceId: current.id, projection }
    }
    const controller = installMarivoDisclosure(ctx, agent, helpSource, options)
    controller.addDisposer(installMarivoExecutionGuidance(agent, controller))
    controller.addDisposer(
      registerMarivoDatasourceTestTool(agent.ctx, datasourceSource, credentialService),
    )
    controller.addDisposer(
      registerMarivoPythonTool(agent.ctx, datasourceSource, credentialService, pythonOptions),
    )
    controller.addDisposer(() => credentialService.disposeAgent(agent))
    controller.addDisposer(registerMarivoPresentTool(agent.ctx, presentationSource, agent.session))
    controller.addDisposer(installMarivoPresentationCodeDelivery(agent.ctx))
    controller.addDisposer(
      agent.ctx.systemPrompt.section({
        name: 'marivo:presentation',
        order: 180,
        text: PRESENTATION_PROMPT,
      }),
    )
    controller.addDisposer(
      agent.ctx.systemPrompt.section({
        name: 'marivo:datasource-credentials',
        order: 170,
        text: () =>
          controller.activeSkills.some((skill) =>
            ['marivo-analysis', 'marivo-semantic'].includes(skill),
          )
            ? MARIVO_DATASOURCE_CREDENTIAL_PROMPT
            : '',
      }),
    )
    controller.addDisposer(
      agent.ctx.systemPrompt.section({
        name: 'marivo:analysis-closeout',
        order: 175,
        text: () =>
          controller.activeSkills.includes('marivo-analysis')
            ? MARIVO_ANALYSIS_CLOSEOUT_PROMPT
            : '',
      }),
    )
    installed.set(agent, controller)
  }

  try {
    for (const agent of ctx.agents.list()) install(agent)
  } catch (error: unknown) {
    for (const controller of installed.values()) controller.dispose()
    stopCredentialUpdates()
    void credentialService.close()
    throw error
  }

  const stopCreated = ctx.on('agent/created', ({ agent }) => {
    install(agent)
  })
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
    stopCredentialUpdates()
    for (const controller of installed.values()) controller.dispose()
    installed.clear()
    void credentialService.close()
  }
}

/** Resolve only Harness-owned, header-validated Workspace membership; never infer it from a path. */
export function resolvePresentationWorkspace(
  ctx: Context,
  sessionId: string,
): { id: string; path: string } {
  const matches = ctx.workspaceRegistry
    .list()
    .filter((workspace) => workspace.sessionIds.some((id) => String(id) === sessionId))
  if (matches.length !== 1) throw new Error('Presentation requires one current Session Workspace')
  return { id: String(matches[0]!.id), path: matches[0]!.path }
}

/** Ensure the shared Runtime once, mount its skills, then bind each Workspace lazily. */
export async function apply(ctx: Context, config: Config = {}): Promise<() => Promise<void>> {
  const pythonOptions = resolvePythonOptions(config)
  const pythonExecutable = config.pythonExecutable ?? process.env.DSH_DATA_ANALYSIS_PYTHON
  const runtimeRoot = config.runtimeRoot ?? process.env.DSH_DATA_ANALYSIS_RUNTIME_ROOT
  const uvExecutable = config.uvExecutable ?? process.env.DSH_DATA_ANALYSIS_UV
  const runtime = await ensureSharedMarivoRuntime({
    ...(pythonExecutable === undefined ? {} : { pythonExecutable }),
    ...(runtimeRoot === undefined ? {} : { runtimeRoot }),
    ...(uvExecutable === undefined ? {} : { uvExecutable }),
    ...(config.installTimeoutMs === undefined ? {} : { installTimeoutMs: config.installTimeoutMs }),
  })
  const disposeRuntimeShellEnvironment = registerMarivoRuntimeShellEnvironment(
    ctx,
    runtime.pythonExecutable,
  )
  const manager = new MarivoWorkspaceEnvironmentManager(runtime)
  const bindings = new WeakMap<Agent, { root: string; environment: Promise<MarivoEnvironment> }>()
  const resolveEnvironment = (agent: Agent): Promise<MarivoEnvironment> => {
    const root = configuredProjectRoot(config, agent)
    const existing = bindings.get(agent)
    if (existing?.root === root) return existing.environment
    const environment = manager.resolve(root)
    bindings.set(agent, { root, environment })
    return environment
  }
  const credentialService = new MarivoCredentialService(
    ctx.credentials,
    config.credentialInteraction,
  )
  let disposeCredentials: (() => Promise<void>) | undefined
  let disposeReferences: (() => Promise<void>) | undefined
  let disposePresentation: (() => Promise<void>) | undefined
  let referenceService: SemanticReferenceService | undefined
  let disposePlugin: (() => void) | undefined
  const browserService = new SemanticBrowserService({
    getWorkspace: (id) => ctx.workspaceRegistry.get(WorkspaceId(id)),
    projectRoot: (workspace) =>
      config.projectRoot ?? process.env.DSH_DATA_ANALYSIS_PROJECT_ROOT ?? workspace.path,
    resolve: (root) => manager.resolve(root),
  })
  try {
    installSkillFilesystem(ctx, {
      providerName: 'dsh-data-analysis-marivo',
      includeDefaultRoots: false,
      customSkillDirs: [runtime.skillsRoot],
      watch: false,
    })
    installSkillFilesystem(ctx, {
      providerName: 'dsh-data-analysis-presentation',
      includeDefaultRoots: false,
      customSkillDirs: [fileURLToPath(new URL('../skills/', import.meta.url))],
      watch: false,
    })
    const helpBridge = new MarivoHelpBridge(createSharedMarivoRuntimeRunner(runtime))
    disposePlugin = installMarivoPlugin(ctx, resolveEnvironment, {
      ...pythonOptions,
      helpBridgeSource: helpBridge,
      credentialService,
    })
    disposeCredentials = registerCredentialRpc(ctx.connection, credentialService, async (id) => {
      const workspace = ctx.workspaceRegistry.get(WorkspaceId(id))
      if (!workspace) throw new Error('Workspace unavailable')
      const root =
        config.projectRoot ?? process.env.DSH_DATA_ANALYSIS_PROJECT_ROOT ?? workspace.path
      const environment = await manager.resolve(root)
      const current = ctx.workspaceRegistry.get(WorkspaceId(id))
      if (
        !current ||
        current.path !== workspace.path ||
        (config.projectRoot ?? process.env.DSH_DATA_ANALYSIS_PROJECT_ROOT ?? current.path) !== root
      )
        throw new Error('Workspace changed')
      return new MarivoDatasourceBridge(environment)
    })
    disposePresentation = registerMarivoPresentationRpc(
      ctx.connection,
      new MarivoPresentationFileService(
        async (sessionId) => resolvePresentationWorkspace(ctx, sessionId),
        async (id) => {
          const workspace = ctx.workspaceRegistry.get(WorkspaceId(id))
          return workspace ? { id: String(workspace.id), path: workspace.path } : undefined
        },
      ),
    )
    let lastDiagnostic = -Infinity
    const usage = new SemanticReferenceUsage(ctx.storageDomain, Date.now, () => {
      if (Date.now() - lastDiagnostic >= 30_000) {
        lastDiagnostic = Date.now()
        console.warn('dsh-data-analysis semantic-reference usage unavailable')
      }
    })
    referenceService = new SemanticReferenceService(async (sessionId, purpose) => {
      const agent = ctx.agents.list().find((item) => item.session.id === sessionId)
      if (!agent) throw new Error('unknown-session')
      const bound = bindings.get(agent)
      if (
        purpose === 'reference' &&
        (!bound || bound.root !== configuredProjectRoot(config, agent))
      )
        throw new Error('environment-unbound')
      const environment = await (purpose === 'reference'
        ? bound!.environment
        : resolveEnvironment(agent))
      if (
        !ctx.agents.list().includes(agent) ||
        bindings.get(agent)?.root !== configuredProjectRoot(config, agent)
      )
        throw new Error('environment-changed')
      return environment
    }, usage)
    disposeReferences = registerSemanticReferenceRpc(
      ctx.connection,
      referenceService,
      async (_endpoint, payload, signal) => {
        try {
          return { ok: true, value: await browserService.read(payload, signal) }
        } catch (error) {
          return {
            ok: false,
            error: { code: 'internal', message: browserFailure(error), details: {} },
          }
        }
      },
    )
  } catch (error) {
    browserService.dispose()
    await disposePresentation?.()
    await disposeCredentials?.()
    await credentialService.close()
    await referenceService?.close()
    disposePlugin?.()
    manager.dispose()
    disposeRuntimeShellEnvironment()
    throw error
  }
  return async () => {
    browserService.dispose()
    await disposePresentation?.()
    await disposeCredentials?.()
    await credentialService.close()
    await disposeReferences?.()
    disposePlugin?.()
    manager.dispose()
    disposeRuntimeShellEnvironment()
  }
}
