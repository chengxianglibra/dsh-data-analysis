import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createMarivoBridgeSet, type MarivoBridgeSet } from './bridges.ts'
import { registerMarivoDatasourceConfigureTool } from './datasource/configure.ts'
import { registerMarivoPythonTool } from './datasource/python.ts'
import { type MarivoPythonOptions, resolvePythonOptions } from './datasource/python-options.ts'
import { type CredentialStore, MarivoCredentialService } from './datasource/service.ts'
import { registerMarivoDatasourceTestTool } from './datasource/test.ts'
import type { MarivoHelpBridgeSource } from './disclosure/bridge.ts'
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
  MarivoEnvironment,
  type MarivoEnvironmentSource,
  resolveMarivoEnvironmentSource,
} from './environment/index.ts'
import { finishCleanup, PendingTasks } from './lifecycle.ts'
import {
  installMarivoPresentationCodeDelivery,
  registerMarivoPresentTool,
  registerMarivoUiReadTool,
} from './presentation/index.ts'
import { resolvePresentationWorkspace } from './workspace-identity.ts'

const PRESENTATION_PROMPT =
  'Match delivery to the user request. Ordinary answers and simple comparison tables can stay in chat. For analysis of attachments or Workspace data files, including short chat comparisons, first load dsh-data-analysis-files; requested CSV, JSON or PNG files use native present. When a UI helps understand or inspect an existing result, use marivo_present with its exact Frame or dataset-snapshot reference; default surface is tool, explicit reports/dashboard use tab. Default data views already support column selection, exact sorting and local pagination. Simple reference-only presentation needs no extra Skill, Help, Python or read call; UI signatures belong to this plugin, not Marivo live Help. Load dsh-data-analysis-presentation for custom Lang or format-specific guidance. Native custom Lang previews actual argument prefixes. Update an exact basedOnRecordId with only changed named statements; reuse snapshots and read marivo_ui_read only when base context is missing. Offline export and publishing are not available. Use the Runtime skills and live Help for Marivo analysis or semantic authoring; local pandas or native DuckDB file analysis needs no Marivo semantic setup. When analysis reveals a reusable business definition or semantic gap, follow the relevant Skill to assess reuse or handoff to marivo-semantic, limited to what the current task needs or the user has authorized; stop when that scope is answered or its blockers are explicit.'

export type MarivoPluginEnvironmentResolver = (
  agent: Agent,
) => MarivoEnvironment | Promise<MarivoEnvironment>

/**
 * Install one already-bound environment into every live or subsequently published Agent scope.
 * Installation is transactional for existing Agents and is disposed with the Cordis plugin.
 */
export function createMarivoAgentInstallation(
  ctx: Context,
  environmentOrResolver: MarivoEnvironment | MarivoPluginEnvironmentResolver,
  options: MarivoDisclosureOptions &
    MarivoPythonOptions & {
      /** Override used by focused tests; normal plugin installation uses ctx.credentials. */
      credentials?: CredentialStore
      credentialService?: MarivoCredentialService
      credentialInteraction?: 'web' | 'none'
      /** Read once at call admission so saved settings affect existing Agents. */
      pythonOptionsSource?: () => MarivoPythonOptions
      /** Runtime-scoped Help source; normal plugin installation never binds Help to a Workspace. */
      helpBridgeSource?: MarivoHelpBridgeSource
    } = {},
) {
  const pythonOptions = resolvePythonOptions(options)
  const installed = new Map<Agent, MarivoDisclosureController>()
  const credentials = options.credentials ?? ctx.credentials
  if (credentials === undefined) {
    throw new Error('dsh-data-analysis requires the DSH credentials service')
  }
  const credentialService =
    options.credentialService ??
    new MarivoCredentialService(credentials, options.credentialInteraction)
  const ownsCredentials = options.credentialService === undefined
  const retiring = new PendingTasks()
  const failures: unknown[] = []
  const stops: Array<() => void> = []
  let active = true
  let closing: Promise<void> | undefined
  const retire = (controller: MarivoDisclosureController) => {
    retiring.track(
      controller.close().catch((error) => {
        failures.push(error)
      }),
    )
  }
  const close = (): Promise<void> => {
    if (closing) return closing
    active = false
    closing = finishCleanup([
      ...stops.reverse(),
      ...[...installed.values()].map((controller) => () => retire(controller)),
      ...(ownsCredentials ? [() => credentialService.close()] : []),
      async () => {
        await retiring.drain()
        if (failures.length) throw new AggregateError(failures, 'Marivo Agent cleanup failed')
      },
    ])
    installed.clear()
    return closing
  }
  const bridgeSets = new WeakMap<MarivoEnvironment, MarivoBridgeSet>()
  const install = (agent: Agent): void => {
    if (!active || installed.has(agent)) return
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
    try {
      controller.addDisposer(installMarivoExecutionGuidance(agent, controller))
      controller.addDisposer(
        registerMarivoDatasourceTestTool(agent.ctx, datasourceSource, credentialService),
      )
      controller.addDisposer(
        registerMarivoDatasourceConfigureTool(agent.ctx, datasourceSource, credentialService),
      )
      controller.addDisposer(
        registerMarivoPythonTool(
          agent.ctx,
          datasourceSource,
          credentialService,
          options.pythonOptionsSource ?? pythonOptions,
          () => {
            const workspace = resolvePresentationWorkspace(ctx, String(agent.session.id))
            return { workspaceId: workspace.id, projectRoot: workspace.path }
          },
        ),
      )
      controller.addDisposer(() => credentialService.disposeAgent(agent))
      controller.addDisposer(
        registerMarivoUiReadTool(agent.ctx, () =>
          resolvePresentationWorkspace(ctx, String(agent.session.id)),
        ),
      )
      controller.addDisposer(
        registerMarivoPresentTool(agent.ctx, presentationSource, agent.session, () =>
          resolvePresentationWorkspace(ctx, String(agent.session.id)),
        ),
      )
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
    } catch (error) {
      retire(controller)
      throw error
    }
  }

  return {
    install(): void {
      if (!active) throw new Error('Marivo Agent installation disposed')
      try {
        stops.push(
          ctx.on('credentials/reference-updated', (ref) =>
            credentialService.invalidateStorageRef(ref),
          ),
        )
        for (const agent of ctx.agents.list()) install(agent)
        stops.push(
          ctx.on('agent/created', ({ agent }) => {
            install(agent)
          }),
        )
        stops.push(
          ctx.on('agent/disposed', ({ agent }) => {
            const controller = installed.get(agent)
            if (controller) retire(controller)
            installed.delete(agent)
          }),
        )
      } catch (error) {
        void close()
        throw error
      }
    },
    close,
  }
}

/** Stops synchronously; the returned Promise also waits for all owned work. */
export function installMarivoPlugin(
  ...args: Parameters<typeof createMarivoAgentInstallation>
): () => Promise<void> {
  const installation = createMarivoAgentInstallation(...args)
  installation.install()
  return installation.close
}
