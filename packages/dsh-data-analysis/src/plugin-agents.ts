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
import { AnalysisDrafts } from './presentation/drafts.ts'
import {
  installMarivoPresentationCodeDelivery,
  registerMarivoPresentTool,
  registerMarivoUiReadTool,
} from './presentation/index.ts'
import { resolvePresentationWorkspace } from './workspace-identity.ts'

const ROUTING_PROMPT = [
  'For attachment or Workspace data file analysis, first load dsh-data-analysis-files. For governed Marivo analysis, load marivo-analysis. Load marivo-semantic when a shared definition is needed for the task or the user requests authoring.',
  'For a project HTTP service or script endpoint, load marivo-service when the bound Runtime provides it; use marivo_help for the service contract.',
  'Get Marivo API Help only through marivo_help, which uses this plugin\'s bound Runtime. In this Host, interpret every `marivo help TARGET` example in Skills or Help as marivo_help({"targets":["TARGET"]}). Do not retrieve Marivo Help through the Workspace .venv/bin/marivo, PATH-resolved marivo, python -m marivo, or another interpreter; they may use a different Marivo installation. If marivo_help is unavailable or fails, report the specific error without falling back to another installation.',
  'Run analysis in the bound Workspace with marivo_python. In this Host, connection setup and repair use marivo_datasource_configure instead of agent-authored datasource configuration; marivo-semantic still owns business definitions. Handle secrets through Harness credential forms, never chat.',
  'Answer ordinary questions and short comparisons in chat. Create and update analysis reports and dashboards through marivo_present, including requests for a report the user can open. For AnalysisFrame, persist explicitly and pass saved_frame.ref.to_dict(); for DataFrame, persist with mv.persist_dataframe(df) and pass its to_dict() reference. Reuse saved report resources when available. Load dsh-data-analysis-presentation for custom layouts. Use native present only when the user asks for a file deliverable, such as a CSV or PNG. Honor explicitly requested formats.',
  'In a report, keep conclusions, supporting data and material limitations together. After save succeeds, reply briefly. If delivery fails, say so and answer with the available evidence.',
].join('\n')

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
      presentationDrafts?: AnalysisDrafts
    } = {},
) {
  const pythonOptions = resolvePythonOptions(options)
  const presentationDrafts = options.presentationDrafts ?? new AnalysisDrafts()
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
    const controller = installMarivoDisclosure(ctx, agent, helpSource, options)
    try {
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
        ),
      )
      controller.addDisposer(() => credentialService.disposeAgent(agent))
      controller.addDisposer(
        registerMarivoUiReadTool(
          agent.ctx,
          () => resolvePresentationWorkspace(ctx, String(agent.session.id)),
          presentationDrafts,
        ),
      )
      controller.addDisposer(
        registerMarivoPresentTool(
          agent.ctx,
          () => resolvePresentationWorkspace(ctx, String(agent.session.id)),
          agent.session,
          presentationDrafts,
          async () => resolveMarivoEnvironmentSource(source),
        ),
      )
      controller.addDisposer(installMarivoPresentationCodeDelivery(agent.ctx))
      controller.addDisposer(() => presentationDrafts.clear(String(agent.session.id)))
      controller.addDisposer(
        agent.ctx.systemPrompt.section({
          name: 'marivo:routing',
          order: 180,
          text: ROUTING_PROMPT,
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
          ctx.on('session/event', (session, event) => {
            if (event.type === 'turn/end')
              presentationDrafts.clear(String(session.id), event.data.turn)
          }),
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
