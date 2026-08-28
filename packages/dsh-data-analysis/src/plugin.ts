/** Cordis lifecycle adapter for the Web-profile shared Marivo Runtime. */

import process from 'node:process'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { apply as installSkillFilesystem } from '@deepseek-ai/dsh-skill-filesystem'
import z from '@deepseek-ai/schemastery'
import { registerMarivoTestTool } from './datasource/index.ts'
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
  MarivoWorkspaceEnvironmentManager,
} from './environment/index.ts'
import { registerMarivoEvidenceCiteTool } from './evidence/index.ts'
import { installMarivoReportCodeDelivery, registerMarivoReportRenderTool } from './report/index.ts'

/** Cordis plugin name used by loader diagnostics and lifecycle logs. */
export const name = 'dsh-data-analysis'

/** Services that must exist before the plugin binds and watches Agent scopes. */
export const inject = ['agents', 'credentials', 'shellEnv', 'skills', 'systemPrompt', 'tools']

export const MARIVO_DATASOURCE_CREDENTIAL_PROMPT = [
  'When marivo-semantic is active, every Marivo datasource *_env field must reference a DSH_* environment name.',
  'Never ask the user to provide credential values in chat, and never place credential values in commands or project files.',
  'Immediately after md.register(...) or a manual datasource-file change, call marivo_test with that datasource name.',
  'If marivo_test returns needs-credentials, wait for the user to save the Web credential form, then retry marivo_test before continuing.',
].join(' ')

export const MARIVO_EVIDENCE_CITATION_PROMPT = [
  'When marivo-analysis is active, every material fact supported by an exact persisted Finding must be cited by default with marivo_evidence_cite before the final answer.',
  'Do not require a citation for an interpretation, recommendation, hypothesis, or fact without an exact persisted Finding; disclose a material unsupported boundary instead of inventing one.',
  'Pass language="zh" for a Chinese final answer or language="en" for an English final answer.',
  'Copy the returned marker (for example [^mv-f1]) immediately after the supported statement, and copy its returned footnote definition verbatim at the end of the answer.',
  'Never invent, rename, or edit a Marivo Evidence handle or definition.',
  'A citation proves the identity of its Marivo Evidence source; it does not prove that the whole sentence or business judgment is correct.',
].join(' ')

export const MARIVO_REPORT_RENDERING_PROMPT = [
  'When marivo-analysis is active, answer inline by default.',
  'Call marivo_report_render only when the user explicitly requests a durable HTML report, accepts an offer to create one, or asks to revise a report already created in this conversation.',
  'Do not call it solely because the analysis is complex or contains charts or Artifacts.',
  'An explicit quick-answer, no-file, or other-output request takes precedence.',
  'Use the live marivo_report_render Tool schema as the exact ReportDocument input contract.',
  'marivo_report_render is a DSH plugin Tool, not a marivo.help target; never call marivo_help for its report contract.',
  'Before authoring a report block with multiple Finding IDs, call session.evidence.compatibility(finding_ids=...) and submit only a compatible selection.',
  'Write for the user, not for the Evidence implementation: use the user language, default to Chinese when the request is Chinese, and never copy Finding IDs, raw Finding JSON, Artifact refs, field names, or audit mechanics into narrative text unless the user explicitly asks for methodology.',
  'For stakeholder reports, put a 2-4 item answer-first executive summary first, then pair each major finding with evidence, plain-language interpretation, and a concrete implication; finish with supported next steps, decision-relevant open questions, and caveats.',
  'Use neutral chart and table titles, put units, scope, denominator, time window, and comparison basis in the subtitle when needed, and place a text block that explains the takeaway immediately before or after every chart.',
  'Attach Finding IDs only as adjacent source metadata. Do not add a duplicate Evidence appendix or evidence block unless the user explicitly asks for a source inventory.',
  'Every call must submit a complete ReportDocument; a revision creates a new report.',
  'After a ready result, copy the returned absolute Path verbatim in the final answer; never shorten it to a basename, invent a file or HTTP URL, or claim it was published.',
  'The returned path and digest are not Marivo Evidence.',
].join(' ')

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
  const install = (agent: Agent): void => {
    if (installed.has(agent)) return
    const source =
      environmentOrResolver instanceof MarivoEnvironment
        ? environmentOrResolver
        : () => Promise.resolve(environmentOrResolver(agent))
    const controller = installMarivoDisclosure(ctx, agent, source, options)
    controller.addDisposer(shellCredentials.installAgent(agent, source))
    controller.addDisposer(
      registerMarivoTestTool(agent.ctx, source, credentials, {
        onDescribe: (environment, datasourceName, refs) => {
          shellCredentials.recordDatasource(environment, datasourceName, refs)
        },
      }),
    )
    controller.addDisposer(registerMarivoEvidenceCiteTool(agent.ctx, source, agent.session))
    controller.addDisposer(registerMarivoReportRenderTool(agent.ctx, source))
    controller.addDisposer(installMarivoReportCodeDelivery(agent.ctx))
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
        name: 'marivo:evidence-citations',
        order: 180,
        text: () =>
          controller.activeSkills.includes('marivo-analysis')
            ? MARIVO_EVIDENCE_CITATION_PROMPT
            : '',
      }),
    )
    controller.addDisposer(
      agent.ctx.systemPrompt.section({
        name: 'marivo:html-report-rendering',
        order: 190,
        text: () =>
          controller.activeSkills.includes('marivo-analysis') ? MARIVO_REPORT_RENDERING_PROMPT : '',
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
    customSkillDirs: [runtime.skillsRoot],
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
