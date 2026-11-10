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
import { installNextStepsAgent } from './next-steps/agent.ts'
import type { NextStepsNotice } from './next-steps/contracts.ts'
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
  'For a requested report or dashboard, load dsh-data-analysis-presentation before preparing component data. If the requested change and its results are already ready, save directly; otherwise use the draft workflow. Before preparing data or planning the complete page, preview confirmed questions and scope without a resourcePatch; keep that draft visible while analysis continues. Reuse one exact immutable result across views when its scope fits, preserving its producer codeRef. New computations use self-contained marivo_python calls; explicit derivations read fixed inputs and persist new outputs, without relying on process memory. Prefer persisted AnalysisFrames rendered with AnalysisFrameView when governed analysis supports the task; local file results can use DatasetView without semantic modeling.',
  'Update the same draft with marivo_present(stage="preview") as results become ready, using resourcePatch.put only for added or replaced resources and combining already-ready related views in one coherent update; do not wait for all calculations. Python and draft writes currently use Harness exclusive scheduling; do not promise concurrent Python execution. Serialize mutations to the same draft using its latest successful revision. Preview means updating the draft through the tool, without requiring browser inspection or user confirmation. A component presentation failure does not block unrelated calculations. Always specify stage when draft identity is present. Save the completed draft once with stage="save"; the final call may also include the last changes.',
  'When refreshing data in a saved report, preserve its page program, component composition, resource names, view settings and text. Refresh requested fixed results explicitly, reuse each new result across its dependent views and preview only same-name resource replacements, then save once. A layout or content edit requires an explicit request for that change.',
  'Get Marivo API Help only through marivo_help, which uses this plugin\'s bound Runtime. In this Host, interpret every `marivo help TARGET` example in Skills or Help as marivo_help({"targets":["TARGET"]}). Do not retrieve Marivo Help through the Workspace .venv/bin/marivo, PATH-resolved marivo, python -m marivo, or another interpreter; they may use a different Marivo installation. If marivo_help is unavailable or fails, report the specific error without falling back to another installation.',
  'Run analysis in the bound Workspace with marivo_python. In this Host, connection setup and repair use marivo_datasource_configure instead of agent-authored datasource configuration; marivo-semantic still owns business definitions. Handle secrets through Harness credential forms, never chat.',
  'Before Marivo analysis or result persistence, check marivo.toml at the bound Workspace root itself. If absent, use marivo_python with datasources=[] to run the bound sys.executable -m marivo init --project-root <Workspace root>, without --force, then verify initialization. Do not accidentally inherit an ancestor project, handwrite the manifest, or use another installation. Existing invalid projects require repair, not reinitialization. Ordinary file inspection needs no project setup.',
  'Answer ordinary questions and short comparisons in chat. Use marivo_present for analysis UI results and reports, and native present for requested file deliverables such as CSV or PNG. Honor explicitly requested formats. Reuse saved results when their scope and freshness fit the task; a requested data refresh needs new results.',
  'In a report, keep supported conclusions, supporting data and material limitations together. While evidence is pending, show the question and remaining work without inventing conclusions. Report completion according to the actual preview, save or delivery receipt. Use the finalization tool after all requested report work is complete.',
  'After the final successful marivo_present save in every Turn that creates or updates a report, generate fresh next steps for that final saved version and finalize with marivo_next_steps, even if a previous Turn already offered recommendations. First honor an explicit request for no recommendations by calling items=[] with emptyReason="declined"; do not generate suggestions in that case. Otherwise offer 1–4 concrete, complementary analyses in the analysis language, usually three when useful. Success concludes the Turn, so finish all requested work before this call. Each short label must fully describe the task; its prompt only expands the same task using only data already available. Never suggest collecting or adding missing dimensions, periods, datasets or inputs; items=[] is preferable to infeasible work. Never recommend work already answered by the report; use fewer items rather than repeat completed work or add filler. If no useful follow-up exists, use items=[] with emptyReason="no-suggestions"; this may trigger one bounded completion retry. Never use declined to mean that no suggestion was found. These temporary Chat buttons are outside the report. Do not run more analysis to generate them or repeat them in report/chat prose.',
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
      controller.addDisposer(
        installNextStepsAgent(
          ctx,
          agent,
          () => resolvePresentationWorkspace(ctx, String(agent.session.id)),
          options.nextStepsPublish ?? (() => {}),
        ),
      )
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
