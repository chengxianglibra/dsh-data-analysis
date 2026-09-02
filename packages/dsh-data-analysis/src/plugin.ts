/** Cordis lifecycle adapter for the Web-profile shared Marivo Runtime. */

import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { apply as installSkillFilesystem } from '@deepseek-ai/dsh-skill-filesystem'
import z from '@deepseek-ai/schemastery'
import { createMarivoBridgeSet, type MarivoBridgeSet } from './bridges.ts'
import { registerMarivoDatasourceTestTool } from './datasource/index.ts'
import {
  MARIVO_CREDENTIAL_GRANT_PREFIX,
  MarivoShellCredentialGrants,
  registerMarivoRuntimeShellEnvironment,
} from './datasource/shell-env.ts'
import { MarivoHelpBridge, type MarivoHelpBridgeSource } from './disclosure/bridge.ts'
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
  installMarivoEvidenceSourcesCodeDelivery,
  registerMarivoEvidenceSourcesTool,
} from './evidence/index.ts'

/** Cordis plugin name used by loader diagnostics and lifecycle logs. */
export const name = 'dsh-data-analysis'

/** Services that must exist before the plugin binds and watches Agent scopes. */
export const inject = ['agents', 'credentials', 'shellEnv', 'skills', 'systemPrompt', 'tools']

export const MARIVO_DATASOURCE_CREDENTIAL_PROMPT = [
  'When marivo-semantic is active, every Marivo datasource *_env field must reference a DSH_* environment name.',
  'Never ask the user to provide credential values in chat, and never place credential values in commands or project files.',
  'Immediately after md.register(...) or a manual datasource-file change, call marivo_datasource_test with that datasource name.',
  'If marivo_datasource_test returns needs-credentials, wait for the user to save the Web credential form, then retry marivo_datasource_test before continuing.',
  `Only a successful test returns a one-shot grant. To use it, start one foreground bash or pwsh command with ${MARIVO_CREDENTIAL_GRANT_PREFIX}<token>, set MARIVO_PERSIST_CREDENTIALS=0 inside that command, and invoke $DSH_DATA_ANALYSIS_PYTHON (bash) or $env:DSH_DATA_ANALYSIS_PYTHON (pwsh).`,
  'Never use a grant with background or persistent Shell execution. A claim is consumed even if later credential resolution fails.',
].join(' ')

export const MARIVO_EVIDENCE_SOURCES_PROMPT = [
  'Call marivo_evidence_sources only when the user explicitly requests sources, citations, provenance, or audit details.',
  'Request only exact persisted Findings by Marivo Session, Artifact, and Finding identity.',
  'Treat source existence as identity and availability evidence, not as proof that the whole conclusion, calculation, or business judgment is entailed or correct.',
  'If no exact Finding exists or its source cannot be recovered, say so instead of inventing or approximating a source.',
].join(' ')

export const MARIVO_REPORT_PROMPT = [
  'Use dsh-data-analysis-report only when the user explicitly requests HTML/web or a durable report file, accepts an Agent proposal to create one, or asks to revise an existing Workspace report bundle.',
  'Answer ordinary analysis in the conversation even when it is long or contains multiple charts or tables.',
  'For existing analysis, recover and revalidate persisted Artifacts; never rerun observe only to create the report or fill DAG details.',
].join(' ')

const integrationSkillsRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'skills',
)

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
}

/** Cordis loader schema. Runtime defaults are resolved in {@link apply}. */
export const Config: z<Config> = z.object({
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
  options: MarivoDisclosureOptions & {
    /** Override used by focused tests; normal plugin installation uses ctx.credentials. */
    credentials?: Pick<CredentialProvider, 'resolve'>
    /** Runtime-scoped Help source; normal plugin installation never binds Help to a Workspace. */
    helpBridgeSource?: MarivoHelpBridgeSource
  } = {},
): () => void {
  const installed = new Map<Agent, MarivoDisclosureController>()
  const credentials = options.credentials ?? ctx.credentials
  if (credentials === undefined) {
    throw new Error('dsh-data-analysis requires the DSH credentials service')
  }
  const shellCredentials = new MarivoShellCredentialGrants(ctx, credentials)
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
    const evidenceSource = async () => (await resolveBridgeSet()).evidence
    const controller = installMarivoDisclosure(ctx, agent, helpSource, options)
    controller.addDisposer(shellCredentials.installAgent(agent, datasourceSource))
    controller.addDisposer(
      registerMarivoDatasourceTestTool(agent.ctx, datasourceSource, credentials, {
        issueShellGrant: (bridge, datasourceName, refs) =>
          shellCredentials.issueGrant(agent, bridge, datasourceName, refs),
      }),
    )
    controller.addDisposer(
      registerMarivoEvidenceSourcesTool(agent.ctx, evidenceSource, agent.session),
    )
    controller.addDisposer(installMarivoEvidenceSourcesCodeDelivery(agent.ctx))
    controller.addDisposer(
      agent.ctx.systemPrompt.section({
        name: 'marivo:datasource-credentials',
        order: 170,
        text: () =>
          controller.activeSkills.includes('marivo-semantic')
            ? MARIVO_DATASOURCE_CREDENTIAL_PROMPT
            : '',
      }),
    )
    controller.addDisposer(
      agent.ctx.systemPrompt.section({
        name: 'marivo:evidence-sources',
        order: 180,
        text: () =>
          controller.activeSkills.includes('marivo-analysis') ? MARIVO_EVIDENCE_SOURCES_PROMPT : '',
      }),
    )
    controller.addDisposer(
      agent.ctx.systemPrompt.section({
        name: 'marivo:report',
        order: 185,
        text: () =>
          controller.activeSkills.includes('marivo-analysis') ? MARIVO_REPORT_PROMPT : '',
      }),
    )
    installed.set(agent, controller)
  }

  try {
    for (const agent of ctx.agents.list()) install(agent)
  } catch (error: unknown) {
    for (const controller of installed.values()) controller.dispose()
    shellCredentials.dispose()
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
    for (const controller of installed.values()) controller.dispose()
    installed.clear()
    shellCredentials.dispose()
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
  const disposeRuntimeShellEnvironment = registerMarivoRuntimeShellEnvironment(
    ctx,
    runtime.pythonExecutable,
  )
  const manager = new MarivoWorkspaceEnvironmentManager(runtime)
  let disposePlugin: () => void
  try {
    installSkillFilesystem(ctx, {
      providerName: 'dsh-data-analysis-marivo',
      includeDefaultRoots: false,
      customSkillDirs: [runtime.skillsRoot, integrationSkillsRoot],
      watch: false,
    })
    const helpBridge = new MarivoHelpBridge(createSharedMarivoRuntimeRunner(runtime))
    disposePlugin = installMarivoPlugin(
      ctx,
      (agent) => manager.resolve(configuredProjectRoot(config, agent)),
      { helpBridgeSource: helpBridge },
    )
  } catch (error) {
    manager.dispose()
    disposeRuntimeShellEnvironment()
    throw error
  }
  return () => {
    disposePlugin()
    manager.dispose()
    disposeRuntimeShellEnvironment()
  }
}
