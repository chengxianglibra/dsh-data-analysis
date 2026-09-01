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
import { MarivoShellCredentialBridge } from './datasource/shell-env.ts'
import {
  installMarivoDisclosure,
  type MarivoDisclosureController,
  type MarivoDisclosureOptions,
} from './disclosure/index.ts'
import {
  DEFAULT_SHARED_RUNTIME_INSTALL_TIMEOUT_MS,
  ensureSharedMarivoRuntime,
  MARIVO_PERSIST_CREDENTIALS_DISABLED,
  MARIVO_PERSIST_CREDENTIALS_ENV,
  MarivoEnvironment,
  type MarivoEnvironmentSource,
  MarivoWorkspaceEnvironmentManager,
  resolveMarivoEnvironmentSource,
} from './environment/index.ts'
import {
  installMarivoEvidenceSourcesCodeDelivery,
  registerMarivoEvidenceSourcesTool,
} from './evidence/index.ts'
import { installReportCheckDisclosure } from './report-disclosure/index.ts'

/** Cordis plugin name used by loader diagnostics and lifecycle logs. */
export const name = 'dsh-data-analysis'

/** Services that must exist before the plugin binds and watches Agent scopes. */
export const inject = ['agents', 'credentials', 'shellEnv', 'skills', 'systemPrompt', 'tools']

export const MARIVO_DATASOURCE_CREDENTIAL_PROMPT = [
  'When marivo-semantic is active, every Marivo datasource *_env field must reference a DSH_* environment name.',
  'Never ask the user to provide credential values in chat, and never place credential values in commands or project files.',
  'Immediately after md.register(...) or a manual datasource-file change, call marivo_datasource_test with that datasource name.',
  'If marivo_datasource_test returns needs-credentials, wait for the user to save the Web credential form, then retry marivo_datasource_test before continuing.',
].join(' ')

export const MARIVO_EVIDENCE_SOURCES_PROMPT = [
  'When marivo-analysis is active, do not call marivo_evidence_sources by default merely because the answer contains Findings, facts, numbers, or tables.',
  'Call marivo_evidence_sources only when the user explicitly requests sources, provenance, citations, or audit details for facts supported by exact persisted Findings.',
  'After a successful call, never copy or restate the supported fact, any numeric or textual value from it, Finding statements, machine identifiers, markers, footnotes, or a source appendix into the final answer; this includes every Session, Finding, Artifact, canonical item, schema, extractor, and Environment identifier seen in Skill context, Tool arguments, or Tool results.',
  'Even when the user requests audit details, those machine identities and technical fields belong only in the Web source panel, which displays them on demand.',
  'Do not announce the Tool call, describe the source panel, say where the details can be viewed, or repeat standard Evidence mechanics in the final answer.',
  'If the user request is solely for sources, the final answer must be only one brief acknowledgement that the source details are attached; it must not mention the Web, a panel, or any display location.',
  'If an explicitly requested fact has no exact persisted Finding, disclose that unsupported boundary instead of inventing a source.',
  'Keep only decision-relevant scope, quality, freshness, and limitation disclosures in ordinary prose; do not emit a boilerplate quality or evidence section when nothing material needs disclosure.',
  'A source attachment proves the identity of its Marivo Evidence source; it does not prove that the whole sentence, calculation, or business judgment is correct.',
].join(' ')

const integrationSkillsRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'skills',
)

let persistencePolicyUsers = 0
let previousPersistencePolicy: string | undefined

function acquirePersistencePolicy(): () => void {
  if (persistencePolicyUsers === 0) {
    previousPersistencePolicy = process.env[MARIVO_PERSIST_CREDENTIALS_ENV]
  }
  persistencePolicyUsers += 1
  process.env[MARIVO_PERSIST_CREDENTIALS_ENV] = MARIVO_PERSIST_CREDENTIALS_DISABLED
  let active = true
  return () => {
    if (!active) return
    active = false
    persistencePolicyUsers -= 1
    if (persistencePolicyUsers !== 0) return
    if (previousPersistencePolicy === undefined) {
      delete process.env[MARIVO_PERSIST_CREDENTIALS_ENV]
    } else {
      process.env[MARIVO_PERSIST_CREDENTIALS_ENV] = previousPersistencePolicy
    }
    previousPersistencePolicy = undefined
  }
}

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
  } = {},
): () => void {
  const installed = new Map<Agent, MarivoDisclosureController>()
  const releasePersistencePolicy = acquirePersistencePolicy()
  const credentials = options.credentials ?? ctx.credentials
  if (credentials === undefined) {
    releasePersistencePolicy()
    throw new Error('dsh-data-analysis requires the DSH credentials service')
  }
  const shellCredentials = new MarivoShellCredentialBridge(ctx, credentials)
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
    const helpSource = async () => (await resolveBridgeSet()).help
    const datasourceSource = async () => (await resolveBridgeSet()).datasource
    const evidenceSource = async () => (await resolveBridgeSet()).evidence
    const controller = installMarivoDisclosure(ctx, agent, helpSource, options)
    controller.addDisposer(shellCredentials.installAgent(agent, datasourceSource))
    controller.addDisposer(
      registerMarivoDatasourceTestTool(agent.ctx, datasourceSource, credentials, {
        onDescribe: (bridge, datasourceName, refs) => {
          shellCredentials.recordDatasource(bridge, datasourceName, refs)
        },
      }),
    )
    controller.addDisposer(
      registerMarivoEvidenceSourcesTool(agent.ctx, evidenceSource, agent.session),
    )
    controller.addDisposer(installMarivoEvidenceSourcesCodeDelivery(agent.ctx))
    controller.addDisposer(installReportCheckDisclosure(agent))
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
    installed.set(agent, controller)
  }

  try {
    for (const agent of ctx.agents.list()) install(agent)
  } catch (error: unknown) {
    for (const controller of installed.values()) controller.dispose()
    shellCredentials.dispose()
    releasePersistencePolicy()
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
    releasePersistencePolicy()
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
    customSkillDirs: [runtime.skillsRoot, integrationSkillsRoot],
    watch: false,
  })
  const manager = new MarivoWorkspaceEnvironmentManager(runtime, config.initializeWorkspace ?? true)
  const disposePlugin = installMarivoPlugin(ctx, (agent) =>
    manager.resolve(configuredProjectRoot(config, agent)),
  )
  return () => {
    disposePlugin()
    manager.dispose()
  }
}
