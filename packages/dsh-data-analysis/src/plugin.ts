import { finishCleanup } from './lifecycle.ts'
import { createMarivoAgentInstallation } from './plugin-agents.ts'
import { registerPublishingCredentials } from './report-publishing/adapters.ts'
import { type ReportPublishingConfig, resolvePublishingConfig } from './report-publishing/config.ts'
import { ReportPublishingService } from './report-publishing/service.ts'
import { resolvePresentationWorkspace } from './workspace-identity.ts'

export { installMarivoPlugin, type MarivoPluginEnvironmentResolver } from './plugin-agents.ts'
export { resolvePresentationWorkspace } from './workspace-identity.ts'

import { referenceEnvironmentResolver } from './semantic-reference/environment.ts'
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
import { MarivoDatasourceBridge } from './datasource/bridge.ts'
import type { DatasourceDefaults } from './datasource/defaults.ts'
import {
  DEFAULT_PYTHON_MAX_TIMEOUT_MS,
  DEFAULT_PYTHON_TIMEOUT_MS,
  type MarivoPythonOptions,
  resolvePythonOptions,
} from './datasource/python-options.ts'
import { registerCredentialRpc } from './datasource/rpc.ts'
import { MarivoCredentialService } from './datasource/service.ts'
import { registerMarivoRuntimeShellEnvironment } from './datasource/shell-env.ts'
import { MarivoHelpBridge } from './disclosure/bridge.ts'
import {
  createSharedMarivoRuntimeRunner,
  DEFAULT_SHARED_RUNTIME_INSTALL_TIMEOUT_MS,
  ensureSharedMarivoRuntime,
  type MarivoEnvironment,
  MarivoWorkspaceEnvironmentManager,
} from './environment/index.ts'
import {
  MarivoPresentationFileService,
  registerMarivoPresentationRpc,
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

/** Loader-safe configuration for the shared Runtime and per-Workspace bindings. */
export interface Config extends MarivoPythonOptions {
  readonly reportPublishing?: ReportPublishingConfig

  /** Non-secret creation defaults by backend; checked against each live Runtime schema. */
  readonly datasourceDefaults?: DatasourceDefaults
  readonly credentialInteraction?: 'web' | 'none'

  /** Explicit project root override; otherwise each Agent uses session.header.cwd. */
  readonly projectRoot?: string
  /** Administrator-provided shared interpreter; must already contain an importable Marivo. */
  readonly pythonExecutable?: string
  /** Shared Runtime root; defaults below $DSH_HOME. */
  readonly runtimeRoot?: string
  /** Local Python used to create the managed venv; an explicit value must be absolute. */
  readonly bootstrapPythonExecutable?: string
  /** Maximum time for installation and lock acquisition. */
  readonly installTimeoutMs?: number
}

/** Cordis loader schema. Runtime defaults are resolved in {@link apply}. */
export const Config: z<Config> = z.object({
  // Defer validation to authoring so loader errors cannot echo configured values.
  datasourceDefaults: z.any(),
  reportPublishing: z.any(),
  pythonTimeoutMs: z.number().default(DEFAULT_PYTHON_TIMEOUT_MS),
  pythonMaxTimeoutMs: z.number().default(DEFAULT_PYTHON_MAX_TIMEOUT_MS),
  credentialInteraction: z.union(['web', 'none']).default('web'),
  projectRoot: z.string(),
  pythonExecutable: z.string(),
  runtimeRoot: z.string(),
  bootstrapPythonExecutable: z.string(),
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

/** Ensure the shared Runtime once, mount its skills, then bind each Workspace lazily. */
export async function apply(ctx: Context, config: Config = {}): Promise<() => Promise<void>> {
  const publishingConfig = resolvePublishingConfig(config.reportPublishing)
  const pythonOptions = resolvePythonOptions(config)
  const pythonExecutable = config.pythonExecutable ?? process.env.DSH_DATA_ANALYSIS_PYTHON
  const runtimeRoot = config.runtimeRoot ?? process.env.DSH_DATA_ANALYSIS_RUNTIME_ROOT
  const bootstrapPythonExecutable =
    config.bootstrapPythonExecutable ?? process.env.DSH_DATA_ANALYSIS_BOOTSTRAP_PYTHON
  const runtime = await ensureSharedMarivoRuntime({
    ...(pythonExecutable === undefined ? {} : { pythonExecutable }),
    ...(runtimeRoot === undefined ? {} : { runtimeRoot }),
    ...(bootstrapPythonExecutable === undefined ? {} : { bootstrapPythonExecutable }),
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
  let disposePublishing: (() => Promise<void>) | undefined
  let disposeCredentials: (() => Promise<void>) | undefined
  let disposeReferences: (() => Promise<void>) | undefined
  let disposePresentation: (() => Promise<void>) | undefined
  let referenceService: SemanticReferenceService | undefined
  let agentInstallation: ReturnType<typeof createMarivoAgentInstallation> | undefined
  let closing: Promise<void> | undefined
  const browserService = new SemanticBrowserService({
    getWorkspace: (id) => ctx.workspaceRegistry.get(WorkspaceId(id)),
    projectRoot: (workspace) =>
      config.projectRoot ?? process.env.DSH_DATA_ANALYSIS_PROJECT_ROOT ?? workspace.path,
    resolve: (root) => manager.resolve(root),
  })
  const close = (): Promise<void> => {
    if (closing) return closing
    closing = finishCleanup([
      () => agentInstallation?.close(),
      () => disposeCredentials?.(),
      () => disposePublishing?.(),
      () => disposePresentation?.(),
      () => disposeReferences?.(),
      () => browserService.close(),
      () => credentialService.close(),
      () => referenceService?.close(),
    ]).then(
      () => finishCleanup([() => manager.close(), disposeRuntimeShellEnvironment]),
      async (error) => {
        await finishCleanup([
          () => manager.close(),
          disposeRuntimeShellEnvironment,
          () => {
            throw error
          },
        ])
      },
    )
    void closing.catch(() => {})
    return closing
  }
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
    const presentationFiles = new MarivoPresentationFileService(
      async (sessionId) => resolvePresentationWorkspace(ctx, sessionId),
      async (id) => {
        const workspace = ctx.workspaceRegistry.get(WorkspaceId(id))
        return workspace ? { id: String(workspace.id), path: workspace.path } : undefined
      },
    )
    disposePresentation = registerMarivoPresentationRpc(ctx.connection, presentationFiles)
    const reportPublishing = new ReportPublishingService(
      publishingConfig,
      ctx.credentials,
      presentationFiles,
      undefined,
      (id) => {
        const workspace = ctx.workspaceRegistry.get(WorkspaceId(id))
        if (!workspace) throw new Error('workspace-unavailable')
        return workspace.title
      },
    )
    disposePublishing = registerPublishingCredentials(ctx.connection, reportPublishing, (id) =>
      Boolean(ctx.workspaceRegistry.get(WorkspaceId(id))),
    )

    agentInstallation = createMarivoAgentInstallation(ctx, resolveEnvironment, {
      ...pythonOptions,
      helpBridgeSource: helpBridge,
      ...(publishingConfig ? { reportPublishing } : {}),
      credentialService,
    })
    agentInstallation.install()
    disposeCredentials = registerCredentialRpc(
      ctx.connection,
      credentialService,
      async (id) => {
        const workspace = ctx.workspaceRegistry.get(WorkspaceId(id))
        if (!workspace) throw new Error('Workspace unavailable')
        const root =
          config.projectRoot ?? process.env.DSH_DATA_ANALYSIS_PROJECT_ROOT ?? workspace.path
        const environment = await manager.resolve(root)
        const current = ctx.workspaceRegistry.get(WorkspaceId(id))
        if (
          !current ||
          current.path !== workspace.path ||
          (config.projectRoot ?? process.env.DSH_DATA_ANALYSIS_PROJECT_ROOT ?? current.path) !==
            root
        )
          throw new Error('Workspace changed')
        return new MarivoDatasourceBridge(environment)
      },
      config.datasourceDefaults,
    )
    let lastDiagnostic = -Infinity
    const usage = new SemanticReferenceUsage(ctx.storageDomain, Date.now, () => {
      if (Date.now() - lastDiagnostic >= 30_000) {
        lastDiagnostic = Date.now()
        console.warn('dsh-data-analysis semantic-reference usage unavailable')
      }
    })
    referenceService = new SemanticReferenceService(
      referenceEnvironmentResolver({
        agent: (sessionId) => ctx.agents.list().find((item) => item.session.id === sessionId),
        binding: (agent) => bindings.get(agent),
        projectRoot: (agent) => configuredProjectRoot(config, agent),
        resolve: resolveEnvironment,
        workspace: (sessionId) => resolvePresentationWorkspace(ctx, sessionId),
      }),
      usage,
    )
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
    try {
      await close()
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Marivo installation and cleanup failed')
    }
    throw error
  }
  return close
}
