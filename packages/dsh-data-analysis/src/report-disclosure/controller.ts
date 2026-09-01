import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { scopeParentOf } from '@deepseek-ai/dsh-scope'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { createDshDataAnalysisReportCheckTool } from '../report-check/tool.ts'

const SKILL_TOOL_NAME = 'skill'
export const REPORT_SKILL_NAME = 'dsh-data-analysis-report'

interface ToolLease {
  readonly turn: number
  readonly disposeTool: () => void
  readonly detachAbort: () => void
}

function successfulSkillName(result: Readonly<ToolExecutionResult>): string | undefined {
  if (result.isError || typeof result.value !== 'object' || result.value === null) return undefined
  const name = (result.value as { name?: unknown }).name
  return typeof name === 'string' ? name : undefined
}

function isReportSkillInvocation(message: Readonly<UserMessage>): boolean {
  const source = message.source as { kind?: unknown; name?: unknown; form?: unknown }
  return (
    source.kind === 'skill-invocation' &&
    source.name === REPORT_SKILL_NAME &&
    source.form === 'instructions'
  )
}

function openTurn(agent: Agent): number | undefined {
  for (let index = agent.session.events.length - 1; index >= 0; index -= 1) {
    const event = agent.session.events[index]!
    if (event.type === 'turn/end') return undefined
    if (event.type === 'turn/start') return event.data.turn
  }
  return undefined
}

/** Per-Agent lease for the report Checker Tool after the report Skill loads. */
export class ReportCheckDisclosureController {
  readonly agent: Agent

  #lease: ToolLease | undefined
  #disposers: Array<() => void> = []
  #disposed = false

  constructor(agent: Agent) {
    this.agent = agent
  }

  get activeTurn(): number | undefined {
    return this.#lease?.turn
  }

  addDisposer(disposer: () => void): void {
    this.#disposers.push(disposer)
  }

  observeToolResult(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): void {
    if (
      this.#disposed ||
      exec.agent !== this.agent ||
      exec.name !== SKILL_TOOL_NAME ||
      !this.#inheritedSkillToolVisible() ||
      successfulSkillName(result) !== REPORT_SKILL_NAME
    )
      return
    const turn = openTurn(this.agent)
    if (turn !== undefined) this.#activate(turn, exec.signal)
  }

  observeStep(messages: readonly UserMessage[], turn: number, signal: AbortSignal): void {
    if (this.#disposed || !messages.some(isReportSkillInvocation)) return
    this.#activate(turn, signal)
  }

  observeSessionEvent(session: Agent['session'], event: Agent['session']['events'][number]): void {
    if (this.#disposed || session !== this.agent.session || this.#lease === undefined) return
    if (event.type === 'turn/start' && event.data.turn !== this.#lease.turn) {
      this.#release()
      return
    }
    if (event.type === 'turn/end' && event.data.turn === this.#lease.turn) this.#release()
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#release()
    for (const disposer of this.#disposers.reverse()) disposer()
    this.#disposers = []
  }

  #activate(turn: number, signal: AbortSignal): void {
    if (this.#disposed || signal.aborted) return
    if (this.#lease?.turn === turn) return
    this.#release()
    const disposeTool = this.agent.ctx.tools.register(createDshDataAnalysisReportCheckTool())
    const onAbort = (): void => {
      if (this.#lease?.turn === turn) this.#release()
    }
    signal.addEventListener('abort', onAbort, { once: true })
    this.#lease = {
      turn,
      disposeTool,
      detachAbort: () => signal.removeEventListener('abort', onAbort),
    }
    if (signal.aborted) this.#release()
  }

  #release(): void {
    const lease = this.#lease
    if (lease === undefined) return
    this.#lease = undefined
    lease.detachAbort()
    lease.disposeTool()
  }

  #inheritedSkillToolVisible(): boolean {
    const inheritedSkillTool = this.agent.ctx.tools.get(SKILL_TOOL_NAME, scopeParentOf(this.agent))
    return (
      inheritedSkillTool !== undefined &&
      this.agent.ctx.tools.get(SKILL_TOOL_NAME, this.agent) === inheritedSkillTool
    )
  }
}

/** Install turn-scoped report Checker disclosure into one Agent scope. */
export function installReportCheckDisclosure(agent: Agent): () => void {
  const controller = new ReportCheckDisclosureController(agent)
  try {
    controller.addDisposer(
      agent.ctx.on('tools/result', (exec, result) => {
        controller.observeToolResult(exec, result)
      }),
    )
    controller.addDisposer(
      agent.ctx.on(
        'agent/pre-step',
        async ({ turn, signal }, next): Promise<PreStepDecision> => {
          const decision = await next()
          if (decision.kind === 'enter') controller.observeStep(decision.messages, turn, signal)
          return decision
        },
        true,
      ),
    )
    controller.addDisposer(
      agent.ctx.on('session/event', (session, event) => {
        controller.observeSessionEvent(session, event)
      }),
    )
    return () => controller.dispose()
  } catch (cause) {
    controller.dispose()
    throw cause
  }
}
