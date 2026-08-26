import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import {
  renderToolsSdk,
  renderToolsSdkPy,
  RUN_CODE_NAME,
  type ToolExecution,
  type ToolExecutionResult,
} from '@deepseek-ai/dsh-tools'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import {
  loadTargetInventory,
  MARIVO_HELP_TOOL_NAME,
  registerMarivoHelpTool,
  resolveMarivoEnvironmentSource,
} from '../disclosure/help.ts'
import type {
  MarivoEnvironmentSource,
  MarivoHelpLimits,
  MarivoHelpValue,
} from '../disclosure/help.ts'
import type { MarivoEnvironment } from '../environment/binding.ts'

export const HELP_PROTOCOL_SYSTEM_PROMPT = `Before the next analysis action, declare which installed Marivo live-help
targets you need by calling marivo_help.

- Choose targets yourself from the provided canonical target inventory.
- Request a root or surface target when exact detail is not yet known.
- Request zero, one, or multiple targets.
- Use targets=[] when no additional API information is needed.
- Do not execute analysis code in the same help-decision step.
- After the Tool Result arrives, decide and execute the analysis yourself.`

export type HelpCheckpointState = 'needs-help-declaration' | 'analysis-step'

export interface HelpCheckpointLimits {
  maxMissingDeclarationRepairs: number
  maxHelpCallsPerTurn: number
}

export const DEFAULT_CHECKPOINT_LIMITS: Readonly<HelpCheckpointLimits> = Object.freeze({
  maxMissingDeclarationRepairs: 2,
  maxHelpCallsPerTurn: 8,
})

export type CheckpointFailureCode =
  | 'help-call-budget-exceeded'
  | 'missing-declaration-limit'

export class MarivoCheckpointError extends Error {
  readonly code: CheckpointFailureCode
  readonly details: Readonly<Record<string, unknown>>

  constructor(
    code: CheckpointFailureCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'MarivoCheckpointError'
    this.code = code
    this.details = details
  }
}

export interface HelpCallTelemetry {
  requestedTargets: string[]
  outcome: 'success' | 'failure'
  emptyDeclaration: boolean
  helpTextBytes: number
  helpTextCodepoints: number
  latencyMs: number
}

export interface DisclosureTurnTelemetry {
  turn: number
  environmentFingerprint: string
  inventoryBytes: number
  inventoryLatencyMs: number
  helpCalls: HelpCallTelemetry[]
  steeringRepairs: number
  preSteps: number
  additionalModelSteps: number
  checkpointCompleted: boolean
  failure?: 'help-call-budget-exceeded' | 'missing-declaration-limit'
}

export interface InstallCheckpointOptions {
  checkpointLimits?: Partial<HelpCheckpointLimits>
  helpLimits?: Partial<MarivoHelpLimits>
}

function positiveInteger(name: keyof HelpCheckpointLimits, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`Marivo checkpoint ${name} must be a positive safe integer`)
  }
  return value
}

function resolveCheckpointLimits(
  overrides: Partial<HelpCheckpointLimits> = {},
): Readonly<HelpCheckpointLimits> {
  const merged = { ...DEFAULT_CHECKPOINT_LIMITS, ...overrides }
  return Object.freeze({
    maxMissingDeclarationRepairs: positiveInteger(
      'maxMissingDeclarationRepairs',
      merged.maxMissingDeclarationRepairs,
    ),
    maxHelpCallsPerTurn: positiveInteger('maxHelpCallsPerTurn', merged.maxHelpCallsPerTurn),
  })
}

function requestedTargets(exec: Readonly<ToolExecution>): string[] {
  if (typeof exec.arguments !== 'object' || exec.arguments === null || Array.isArray(exec.arguments)) return []
  const targets = (exec.arguments as Record<string, unknown>).targets
  if (!Array.isArray(targets)) return []
  return targets.filter((target): target is string => typeof target === 'string')
}

function helpTextSize(result: Readonly<ToolExecutionResult>): { bytes: number; codepoints: number } {
  if (result.isError || typeof result.value !== 'object' || result.value === null) {
    return { bytes: 0, codepoints: 0 }
  }
  const value = result.value as unknown as Partial<MarivoHelpValue>
  if (!Array.isArray(value.targets)) return { bytes: 0, codepoints: 0 }
  let bytes = 0
  let codepoints = 0
  for (const item of value.targets) {
    if (typeof item !== 'object' || item === null || typeof item.body !== 'string') continue
    bytes += Buffer.byteLength(item.body)
    codepoints += [...item.body].length
  }
  return { bytes, codepoints }
}

function checkpointContext(environment: MarivoEnvironment, inventory: string): string {
  const diagnostics = environment.diagnostics.length === 0
    ? 'none'
    : environment.diagnostics
        .map(item => `${item.id}=${item.status}: ${item.summary}`)
        .join('\n')
  return `Marivo live-help checkpoint
Project root: ${environment.binding.projectRoot}
Python executable: ${environment.binding.pythonExecutable}
Marivo version: ${environment.binding.marivoVersion}
Package path: ${environment.binding.packagePath}
Environment fingerprint: ${environment.binding.fingerprint}
Doctor overall status: ${environment.binding.doctorOverallStatus}
Bounded doctor diagnostics:
${diagnostics}

Canonical target inventory (raw marivo.help("targets") stdout):
${inventory}`
}

/** Per-agent live controller for the two-state checkpoint protocol. */
export class MarivoCheckpointController {
  readonly agent: Agent
  readonly limits: Readonly<HelpCheckpointLimits>
  readonly environmentSource: MarivoEnvironmentSource
  #state: HelpCheckpointState = 'analysis-step'
  #turn = 0
  #inventory = ''
  #helpCalls = 0
  #missingRepairs = 0
  #budgetExceeded = false
  #declarationPending = false
  #restrictionDisposer: (() => void) | undefined
  #disposers: Array<() => void> = []
  #disposed = false
  #activeTelemetry: DisclosureTurnTelemetry | undefined
  #telemetry: DisclosureTurnTelemetry[] = []
  #toolStartedAt = new Map<symbol, number>()
  #toolDurationMs = new Map<symbol, number>()
  #inventoryPromise: Promise<string> | undefined
  #environment: MarivoEnvironment | undefined
  #environmentPromise: Promise<MarivoEnvironment> | undefined
  #inventoryAbort: AbortController | undefined
  #inventoryStartedAt = 0

  constructor(
    agent: Agent,
    environmentSource: MarivoEnvironmentSource,
    limits: Readonly<HelpCheckpointLimits>,
  ) {
    this.agent = agent
    this.environmentSource = environmentSource
    if (typeof environmentSource !== 'function') this.#environment = environmentSource
    this.limits = limits
  }

  get environment(): MarivoEnvironment | undefined {
    return this.#environment
  }

  get state(): HelpCheckpointState {
    return this.#state
  }

  get turn(): number {
    return this.#turn
  }

  get inventory(): string {
    return this.#inventory
  }

  get helpCalls(): number {
    return this.#helpCalls
  }

  get declarationPending(): boolean {
    return this.#declarationPending
  }

  telemetry(): DisclosureTurnTelemetry[] {
    return this.#telemetry.map(turn => ({
      ...turn,
      helpCalls: turn.helpCalls.map(call => ({ ...call, requestedTargets: [...call.requestedTargets] })),
    }))
  }

  addDisposer(disposer: () => void): void {
    this.#disposers.push(disposer)
  }

  beginTurn(turn: number, helpLimits?: Partial<MarivoHelpLimits>): void {
    this.#restrictionDisposer?.()
    this.#restrictionDisposer = undefined
    this.#inventoryAbort?.abort()
    this.#inventoryAbort = new AbortController()

    this.#turn = turn
    this.#state = 'needs-help-declaration'
    this.#inventory = ''
    this.#helpCalls = 0
    this.#missingRepairs = 0
    this.#budgetExceeded = false
    this.#declarationPending = false
    this.#restrictionDisposer = this.agent.ctx.tools.restrict({ allow: [] })
    this.#inventoryStartedAt = performance.now()
    this.#environmentPromise ??= resolveMarivoEnvironmentSource(this.environmentSource)
      .then((environment) => {
        this.#environment = environment
        return environment
      })
    this.#inventoryPromise = this.#environmentPromise.then(environment => loadTargetInventory(environment, {
      limits: helpLimits,
      signal: this.#inventoryAbort?.signal,
    }))
    const telemetry: DisclosureTurnTelemetry = {
      turn,
      environmentFingerprint: this.#environment?.binding.fingerprint ?? 'pending',
      inventoryBytes: 0,
      inventoryLatencyMs: 0,
      helpCalls: [],
      steeringRepairs: 0,
      preSteps: 0,
      additionalModelSteps: 0,
      checkpointCompleted: false,
    }
    this.#activeTelemetry = telemetry
    this.#telemetry.push(telemetry)
  }

  async checkpointContext(signal?: AbortSignal): Promise<string> {
    if (this.#state !== 'needs-help-declaration' || this.#declarationPending) return ''
    const inventoryPromise = this.#inventoryPromise
    if (inventoryPromise === undefined) return ''
    const abort = this.#inventoryAbort
    const onAbort = (): void => abort?.abort()
    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
    try {
      this.#inventory = await inventoryPromise
      if (this.#activeTelemetry !== undefined && this.#activeTelemetry.inventoryBytes === 0) {
        if (this.#environment !== undefined) {
          this.#activeTelemetry.environmentFingerprint = this.#environment.binding.fingerprint
        }
        this.#activeTelemetry.inventoryBytes = Buffer.byteLength(this.#inventory)
        this.#activeTelemetry.inventoryLatencyMs = Math.max(
          0,
          Math.round(performance.now() - this.#inventoryStartedAt),
        )
      }
      if (this.#environment === undefined) {
        throw new Error('Marivo environment resolved without a binding')
      }
      return checkpointContext(this.#environment, this.#inventory)
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }
  }

  onPreStep(): void {
    if (this.#state === 'needs-help-declaration' && this.#declarationPending) {
      this.#declarationPending = false
      this.#state = 'analysis-step'
      if (this.#activeTelemetry !== undefined) this.#activeTelemetry.checkpointCompleted = true
      this.#restrictionDisposer?.()
      this.#restrictionDisposer = undefined
    }
    const telemetry = this.#activeTelemetry
    if (telemetry !== undefined) {
      telemetry.preSteps++
      telemetry.additionalModelSteps = Math.max(0, telemetry.preSteps - 1)
    }
    if (this.#budgetExceeded) {
      if (telemetry !== undefined) telemetry.failure = 'help-call-budget-exceeded'
      throw new MarivoCheckpointError(
        'help-call-budget-exceeded',
        `marivo_help exceeded the per-turn call budget of ${this.limits.maxHelpCallsPerTurn}`,
        { turn: this.#turn, maxHelpCallsPerTurn: this.limits.maxHelpCallsPerTurn },
      )
    }
  }

  beforeTool(exec: Readonly<ToolExecution>): void {
    if (exec.agent === this.agent && exec.name === MARIVO_HELP_TOOL_NAME) {
      this.#toolStartedAt.set(exec.token, performance.now())
    }
  }

  afterToolDispatch(exec: Readonly<ToolExecution>): void {
    const startedAt = this.#toolStartedAt.get(exec.token)
    if (startedAt !== undefined) {
      this.#toolStartedAt.delete(exec.token)
      this.#toolDurationMs.set(exec.token, Math.max(0, Math.round(performance.now() - startedAt)))
    }
  }

  onToolResult(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): void {
    if (exec.agent !== this.agent || exec.name !== MARIVO_HELP_TOOL_NAME || this.#turn === 0) return
    this.#helpCalls++
    if (this.#helpCalls > this.limits.maxHelpCallsPerTurn) this.#budgetExceeded = true

    const targets = requestedTargets(exec)
    const size = helpTextSize(result)
    const latencyMs = this.#toolDurationMs.get(exec.token) ?? 0
    this.#toolDurationMs.delete(exec.token)
    this.#activeTelemetry?.helpCalls.push({
      requestedTargets: targets,
      outcome: result.isError ? 'failure' : 'success',
      emptyDeclaration: !result.isError && targets.length === 0,
      helpTextBytes: size.bytes,
      helpTextCodepoints: size.codepoints,
      latencyMs,
    })

    if (!result.isError && this.#state === 'needs-help-declaration') {
      this.#declarationPending = true
      // Prompt assembly precedes agent/pre-step. Removing only presentation
      // filtering here lets that next request see the analysis surface, while
      // the guard remains closed until onPreStep and blocks same-step follow-ons.
      this.#restrictionDisposer?.()
      this.#restrictionDisposer = undefined
    }
  }

  onTurnStopping(signal: AbortSignal): void {
    if (signal.aborted || this.#state !== 'needs-help-declaration') return
    if (this.#missingRepairs < this.limits.maxMissingDeclarationRepairs) {
      this.#missingRepairs++
      if (this.#activeTelemetry !== undefined) {
        this.#activeTelemetry.steeringRepairs = this.#missingRepairs
      }
      this.agent.steer(createUserMessage({
        content: [{
          type: 'text',
          text: `Checkpoint required: call ${MARIVO_HELP_TOOL_NAME} with targets=[...], or targets=[] when no new Marivo API information is needed. Do not execute analysis in this declaration step.`,
        }],
        source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-data-analysis' },
      }))
      return
    }
    if (this.#activeTelemetry !== undefined) this.#activeTelemetry.failure = 'missing-declaration-limit'
    throw new MarivoCheckpointError(
      'missing-declaration-limit',
      `Marivo help declaration was still missing after ${this.limits.maxMissingDeclarationRepairs} steering repairs`,
      { turn: this.#turn, maxRepairs: this.limits.maxMissingDeclarationRepairs },
    )
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#inventoryAbort?.abort()
    this.#inventoryAbort = undefined
    this.#restrictionDisposer?.()
    this.#restrictionDisposer = undefined
    for (const disposer of this.#disposers.reverse()) disposer()
    this.#disposers = []
  }
}

/**
 * Install the disclosure checkpoint on one already-created Agent scope.
 * The Agent's inherited and scope-local tools stay registered but are hidden
 * and denied until a successful declaration is followed by the next pre-step.
 */
export function installMarivoCheckpoint(
  ctx: Context,
  agent: Agent,
  environmentSource: MarivoEnvironmentSource,
  options: InstallCheckpointOptions = {},
): MarivoCheckpointController {
  const limits = resolveCheckpointLimits(options.checkpointLimits)
  const controller = new MarivoCheckpointController(agent, environmentSource, limits)
  try {
    controller.addDisposer(registerMarivoHelpTool(agent.ctx, environmentSource, options.helpLimits))
    controller.addDisposer(agent.ctx.systemPrompt.section({
      name: 'dsh-data-analysis:help-protocol',
      order: 150,
      text: HELP_PROTOCOL_SYSTEM_PROMPT,
    }))
    controller.addDisposer(agent.ctx.systemPrompt.context({
      name: 'dsh-data-analysis:checkpoint',
      order: 150,
      text: '',
    }))
    controller.addDisposer(agent.ctx.on(
      'system-prompt/assemble',
      async (_assembly, assembleContext, next) => {
        const text = await controller.checkpointContext(assembleContext.signal)
        const downstream = await next()
        const contexts = downstream.contexts.filter(
          context => context.name !== 'dsh-data-analysis:checkpoint',
        )
        if (text !== '') contexts.push({ name: 'dsh-data-analysis:checkpoint', text })
        if (controller.state !== 'needs-help-declaration' || controller.declarationPending) {
          return { ...downstream, contexts }
        }
        return gateAssembly(ctx, agent, { ...downstream, contexts })
      },
    ))
    controller.addDisposer(agent.ctx.tools.guard((exec) => {
      if (exec.agent !== agent || controller.state !== 'needs-help-declaration') return undefined
      if (exec.name === MARIVO_HELP_TOOL_NAME) {
        return controller.helpCalls >= limits.maxHelpCallsPerTurn
          ? `marivo_help per-turn call budget exhausted at ${limits.maxHelpCallsPerTurn}`
          : undefined
      }
      if (exec.name === RUN_CODE_NAME && exec.parent === undefined) return undefined
      return `Marivo checkpoint requires ${MARIVO_HELP_TOOL_NAME} before ${exec.name}`
    }))
    controller.addDisposer(agent.ctx.on('tools/execute', async (exec, next): Promise<ToolExecutionResult> => {
      controller.beforeTool(exec)
      try {
        return await next()
      } finally {
        controller.afterToolDispatch(exec)
      }
    }))
    controller.addDisposer(agent.ctx.on('tools/result', (exec, result) => {
      controller.onToolResult(exec, result)
    }))
    controller.addDisposer(agent.ctx.on(
      'agent/pre-step',
      async (_payload, next): Promise<PreStepDecision> => {
        controller.onPreStep()
        return next()
      },
    ))
    controller.addDisposer(agent.ctx.on('agent/inbox/claimed', ({ message, turn }) => {
      if (message.source.kind === 'user' && turn !== controller.turn) {
        controller.beginTurn(turn, options.helpLimits)
      }
    }))
    controller.addDisposer(agent.ctx.on('agent/turn-stopping', ({ signal }) => {
      controller.onTurnStopping(signal)
    }))
    return controller
  } catch (cause) {
    controller.dispose()
    throw cause
  }
}

function gateAssembly(ctx: Context, agent: Agent, assembly: PromptAssembly): PromptAssembly {
  const codePresented = assembly.tools.some(tool => tool.name === RUN_CODE_NAME)
  const allowed = codePresented
    ? new Set([RUN_CODE_NAME, MARIVO_HELP_TOOL_NAME])
    : new Set([MARIVO_HELP_TOOL_NAME])
  const tools = assembly.tools.filter(tool => allowed.has(tool.name))
  if (!codePresented) return { ...assembly, tools }

  const helpSchema = ctx.tools.schemas(agent).find(tool => tool.name === MARIVO_HELP_TOOL_NAME)
  const helpDefinition = ctx.tools.get(MARIVO_HELP_TOOL_NAME, agent)
  if (helpSchema === undefined || helpDefinition === undefined) {
    throw new Error('Marivo checkpoint help Tool is unavailable during SDK assembly')
  }
  const runtime = ctx.get('codeRuntime') as { language?: unknown } | undefined
  const sdkSchema = [{ ...helpSchema, output: helpDefinition.output.schema }]
  const sdk = runtime?.language === 'typescript'
    ? renderToolsSdk(sdkSchema)
    : runtime?.language === 'python'
      ? renderToolsSdkPy(sdkSchema)
      : undefined
  if (sdk === undefined) {
    throw new Error(`Marivo checkpoint cannot render SDK for code runtime language ${JSON.stringify(runtime?.language)}`)
  }
  const sections = assembly.sections.map(section => (
    section.name === 'tools:sdk' ? { ...section, text: sdk } : section
  ))
  return { ...assembly, sections, tools }
}
