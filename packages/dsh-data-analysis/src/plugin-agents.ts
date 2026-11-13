import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createMarivoBridgeSet, type MarivoBridgeSet } from './bridges.ts'
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
import { installNextStepsAgent } from './next-steps/agent.ts'
import type { NextStepsNotice } from './next-steps/contracts.ts'
import { SavedWriteProofs } from './next-steps/saved-writes.ts'
import { restorePtcSaves } from './presentation/delivery.ts'
import { AnalysisDrafts } from './presentation/drafts.ts'
import {
  installMarivoPresentationCodeDelivery,
  registerMarivoPresentTool,
  registerMarivoReportDeleteTool,
  registerMarivoReportListTool,
  registerMarivoUiReadTool,
} from './presentation/index.ts'
import { restorePythonResults } from './python-results-context.ts'
import { registerReportPublishTool } from './report-publishing/adapters.ts'
import type { ReportPublishingService } from './report-publishing/service.ts'
import { resolvePresentationWorkspace } from './workspace-identity.ts'

const ROUTING_PROMPT = [
  'Load dsh-data-analysis-files for files, marivo-analysis for governed analysis, and marivo-semantic for shared definitions. Load marivo-service for project HTTP services when available.',
  'Use marivo_help for upstream Marivo Help and marivo_python for analysis or datasource authoring in the bound Runtime. Use Harness credential forms for secrets and marivo_datasource_test for connection diagnosis.',
  'Create the smallest useful analysis view when requested or when charts or interaction clarify the answer. Honor text-only and file-only requests. Load dsh-data-analysis-presentation before preparing view data, preview scope before computation, then update the same draft with ready results.',
  'Prefer AnalysisFrameView for governed results and DatasetView for suitable tabular results. Capture fixed outputs with resultVariables, reuse matching resources, and deliver with marivo_report_write. Use Harness native present for requested files.',
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
      reportPublishing?: ReportPublishingService
      nextStepsPublish?: (notice: NextStepsNotice) => void
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
    const workspace = () => resolvePresentationWorkspace(ctx, String(agent.session.id))
    const runner = async () => resolveMarivoEnvironmentSource(source)
    const controller = installMarivoDisclosure(ctx, agent, helpSource, options)
    const savedWrites = new SavedWriteProofs()
    controller.addDisposer(() => savedWrites.close())
    try {
      controller.addDisposer(
        registerMarivoDatasourceTestTool(agent.ctx, datasourceSource, credentialService),
      )
      controller.addDisposer(
        registerMarivoPythonTool(
          agent.ctx,
          datasourceSource,
          credentialService,
          options.pythonOptionsSource ?? pythonOptions,
          workspace,
        ),
      )
      controller.addDisposer(() => credentialService.disposeAgent(agent))
      controller.addDisposer(
        registerMarivoUiReadTool(agent.ctx, workspace, presentationDrafts, runner),
      )
      controller.addDisposer(registerMarivoReportDeleteTool(agent.ctx, workspace))
      controller.addDisposer(registerMarivoReportListTool(agent.ctx, workspace))
      if (options.reportPublishing)
        controller.addDisposer(
          registerReportPublishTool(agent.ctx, options.reportPublishing, agent.session),
        )
      controller.addDisposer(
        registerMarivoPresentTool(
          agent.ctx,
          workspace,
          agent.session,
          presentationDrafts,
          runner,
          savedWrites.committed,
          (token) => savedWrites.get(token),
        ),
      )
      controller.addDisposer(installMarivoPresentationCodeDelivery(agent.ctx))
      controller.addDisposer(
        installNextStepsAgent(
          ctx,
          agent,
          workspace,
          options.nextStepsPublish ?? (() => {}),
          savedWrites,
        ),
      )
      controller.addDisposer(() => presentationDrafts.clear(String(agent.session.id)))
      controller.addDisposer(
        agent.ctx.systemPrompt.section({
          name: 'marivo:routing',
          order: 180,
          text: options.reportPublishing
            ? `${ROUTING_PROMPT}\nThis Host has object-storage publishing enabled. Use marivo_publish_report with the exact saved report ref only when the user explicitly requests publication to object storage.`
            : ROUTING_PROMPT,
        }),
      )
      controller.addDisposer(
        agent.ctx.on(
          'agent/pre-step',
          async ({ signal }, next) => {
            const decision = await next()
            if (decision.kind === 'reject') return decision
            const restored = await restorePythonResults(
              agent.session,
              decision.messages,
              () => workspace().path,
              signal,
            )
            const saved = restorePtcSaves(agent.session, decision.messages, () => workspace().id)
            const recovery = [restored, saved].filter((message) => message !== undefined)
            return recovery.length
              ? { ...decision, messages: [...decision.messages, ...recovery] }
              : decision
          },
          true,
        ),
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
