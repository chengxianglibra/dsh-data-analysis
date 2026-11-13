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
  'For attachment or Workspace data files, load dsh-data-analysis-files. For governed analysis, load marivo-analysis; load marivo-semantic when shared definitions are needed or authoring is requested. For project HTTP services, load marivo-service when the bound Runtime provides it.',
  'This Host owns delivery choices; Runtime Skills own analytical methods and stopping. Proactively create the smallest useful analysis view when charts or interaction help understand, compare, or verify findings, even without an explicit report request. Also use it for requested charts, reports, dashboards, or analysis views. Answer in chat when text alone is sufficient and a view adds no useful evidence. Honor explicit output formats, including text-only and file-only requests.',
  'Load dsh-data-analysis-presentation before preparing data for an analysis view, or as soon as its value becomes clear during analysis. For a new view needing data preparation, preview the confirmed question and scope before the first analysis computation, then update the same draft as results become ready. Direct save is for results already ready at task entry or a small edit; do not finish new calculations first and then treat their outputs as pre-existing ready results. The Skill owns composition, preview/save sequencing, and the final reply.',
  'For governed inputs with supported typed analysis, prefer producing and retaining AnalysisFrame results for AnalysisFrameView. Do not convert a Frame to a DataFrame merely for display. Use DatasetView for ordinary file results, external computations, or suitable tabular detail; do not invent semantic models just to change the view type.',
  'Use marivo_help for current Marivo API contracts, including upstream marivo help examples. It uses the verified Runtime; report failures without switching installations.',
  'Run analysis and create, edit, or remove datasource definitions with marivo_python in the bound Workspace. Use marivo_help and the live Runtime contracts for datasource authoring. Put only non-secret configuration and credential references in code; use Harness credential forms for secret values, never chat or code. Use marivo_datasource_test when a connection test is requested or useful.',
  'Deliver analysis views with marivo_report_write and requested files with Harness native present. State the actual delivery status.',
  'Declare computed outputs supporting your answer with marivo_python resultVariables. Reuse matching fixed outputs from prior calls for charts and reports; refresh only when the task calls for new data. A rejected preview can be repaired with the same resources.',
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
        ),
      )
      controller.addDisposer(() => credentialService.disposeAgent(agent))
      controller.addDisposer(registerMarivoUiReadTool(agent.ctx, workspace, presentationDrafts))
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
          async () => resolveMarivoEnvironmentSource(source),
          savedWrites.committed,
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
            return restored ? { ...decision, messages: [...decision.messages, restored] } : decision
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
