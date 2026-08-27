import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { scopeParentOf } from '@deepseek-ai/dsh-scope'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import {
  MARIVO_HELP_TOOL_NAME,
  readMarivoHelpTargets,
  registerMarivoHelpTool,
  renderMarivoHelpValue,
  resolveMarivoEnvironmentSource,
  type MarivoEnvironmentSource,
  type MarivoHelpDelivery,
  type MarivoHelpDeliveryQuery,
  type MarivoHelpLimits,
  type MarivoHelpValue,
} from './help.ts'

const SKILL_TOOL_NAME = 'skill'

export const MARIVO_ROOT_HELP_TARGETS = Object.freeze({
  'marivo-analysis': 'analysis',
  'marivo-semantic': 'authoring',
} as const)

export type MarivoSkillName = keyof typeof MARIVO_ROOT_HELP_TARGETS
export type MarivoRootHelpTarget = (typeof MARIVO_ROOT_HELP_TARGETS)[MarivoSkillName]

const MARIVO_SKILL_ORDER: readonly MarivoSkillName[] = [
  'marivo-analysis',
  'marivo-semantic',
]

export interface MarivoDisclosureOptions {
  helpLimits?: Partial<MarivoHelpLimits>
}

export interface MarivoSkillActivationRecord {
  skill: MarivoSkillName
  source: 'model' | 'user'
}

export interface MarivoRootHelpDisclosureRecord {
  skill: MarivoSkillName
  target: MarivoRootHelpTarget
  environmentFingerprint: string
  bodyDigest: string
  delivery: MarivoHelpDelivery
  reason: 'activation' | 'recovery'
  helpTextBytes: number
  latencyMs: number
}

export interface MarivoDisclosureFailureRecord {
  skills: MarivoSkillName[]
  message: string
}

export interface MarivoDisclosureTelemetry {
  activations: MarivoSkillActivationRecord[]
  rootHelp: MarivoRootHelpDisclosureRecord[]
  failures: MarivoDisclosureFailureRecord[]
}

export interface MarivoDisclosureSource {
  readonly kind: 'marivo-disclosure'
  readonly form: 'root-help'
  readonly skill: MarivoSkillName
  readonly target: MarivoRootHelpTarget
  readonly environmentFingerprint: string
  readonly bodyDigest: string
  readonly update?: true
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'marivo-disclosure': MarivoDisclosureSource
  }
}

export class MarivoDisclosureError extends Error {
  readonly code = 'root-help-failed'
  readonly skills: readonly MarivoSkillName[]

  constructor(skills: readonly MarivoSkillName[], cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    super(`Marivo root help disclosure failed for ${skills.join(', ')}: ${detail}`, { cause })
    this.name = 'MarivoDisclosureError'
    this.skills = [...skills]
  }
}

interface VisibleHelp {
  environmentFingerprint: string
  target: string
  bodyDigest: string
}

interface PendingRootHelp {
  skill: MarivoSkillName
  target: MarivoRootHelpTarget
  reason: 'activation' | 'recovery'
  startedAt: number
  value: MarivoHelpValue
}

function isMarivoSkillName(value: unknown): value is MarivoSkillName {
  return typeof value === 'string' && Object.hasOwn(MARIVO_ROOT_HELP_TARGETS, value)
}

function rootHelpSource(value: unknown): MarivoDisclosureSource | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const source = value as Partial<MarivoDisclosureSource>
  if (
    source.kind !== 'marivo-disclosure'
    || source.form !== 'root-help'
    || !isMarivoSkillName(source.skill)
    || source.target !== MARIVO_ROOT_HELP_TARGETS[source.skill]
    || typeof source.environmentFingerprint !== 'string'
    || typeof source.bodyDigest !== 'string'
  ) return undefined
  return source as MarivoDisclosureSource
}

function focusedHelpMeta(value: unknown): VisibleHelp[] {
  if (typeof value !== 'object' || value === null) return []
  const meta = value as {
    kind?: unknown
    environmentFingerprint?: unknown
    targets?: unknown
  }
  if (
    meta.kind !== 'marivo-help-disclosure'
    || typeof meta.environmentFingerprint !== 'string'
    || !Array.isArray(meta.targets)
  ) return []
  return meta.targets.flatMap((item): VisibleHelp[] => {
    if (typeof item !== 'object' || item === null) return []
    const target = (item as { target?: unknown }).target
    const bodyDigest = (item as { bodyDigest?: unknown }).bodyDigest
    const delivery = (item as { delivery?: unknown }).delivery
    if (
      typeof target !== 'string'
      || typeof bodyDigest !== 'string'
      || (delivery !== 'delivered' && delivery !== 'replacement')
    ) return []
    return [{
      environmentFingerprint: meta.environmentFingerprint as string,
      target,
      bodyDigest,
    }]
  })
}

function successfulSkillName(result: Readonly<ToolExecutionResult>): MarivoSkillName | undefined {
  if (result.isError || typeof result.value !== 'object' || result.value === null) return undefined
  const name = (result.value as { name?: unknown }).name
  return isMarivoSkillName(name) ? name : undefined
}

function successfulHelpValue(result: Readonly<ToolExecutionResult>): MarivoHelpValue | undefined {
  if (result.isError || typeof result.value !== 'object' || result.value === null) return undefined
  const value = result.value as Partial<MarivoHelpValue>
  if (
    typeof value.environment !== 'object'
    || value.environment === null
    || typeof value.environment.fingerprint !== 'string'
    || !Array.isArray(value.targets)
  ) return undefined
  return value as MarivoHelpValue
}

function renderRootHelpMessage(
  skill: MarivoSkillName,
  value: MarivoHelpValue,
  update: boolean,
): UserMessage {
  const target = MARIVO_ROOT_HELP_TARGETS[skill]
  const item = value.targets[0]
  if (item === undefined || item.target !== target) {
    throw new Error(`Marivo root help ${target} did not return its requested target`)
  }
  return createUserMessage({
    content: [{
      type: 'text',
      text: [
        `<marivo_help_context skill="${skill}" target="${target}">`,
        update
          ? 'This live root help replaces the earlier disclosure for this skill.'
          : 'This live root help accompanies the loaded Marivo skill.',
        '',
        renderMarivoHelpValue(value),
        '</marivo_help_context>',
      ].join('\n'),
    }],
    source: {
      kind: 'marivo-disclosure',
      form: 'root-help',
      skill,
      target,
      environmentFingerprint: value.environment.fingerprint,
      bodyDigest: item.bodyDigest,
      ...(update ? { update: true as const } : {}),
    },
  })
}

/** Per-Agent controller for skill-triggered, prompt-visible Marivo help disclosure. */
export class MarivoDisclosureController {
  readonly agent: Agent
  readonly environmentSource: MarivoEnvironmentSource
  readonly options: Readonly<MarivoDisclosureOptions>

  #activeSkills = new Set<MarivoSkillName>()
  #pendingSkills = new Set<MarivoSkillName>()
  #visibleHelp = new Map<string, VisibleHelp>()
  #lifecycleAbort = new AbortController()
  #disposers: Array<() => void> = []
  #disposed = false
  #telemetry: MarivoDisclosureTelemetry = { activations: [], rootHelp: [], failures: [] }

  constructor(
    agent: Agent,
    environmentSource: MarivoEnvironmentSource,
    options: MarivoDisclosureOptions = {},
  ) {
    this.agent = agent
    this.environmentSource = environmentSource
    this.options = Object.freeze({
      ...(options.helpLimits === undefined ? {} : { helpLimits: { ...options.helpLimits } }),
    })
    this.#restoreActiveSkills()
  }

  get activeSkills(): readonly MarivoSkillName[] {
    return MARIVO_SKILL_ORDER.filter(skill => this.#activeSkills.has(skill))
  }

  telemetry(): MarivoDisclosureTelemetry {
    return {
      activations: this.#telemetry.activations.map(record => ({ ...record })),
      rootHelp: this.#telemetry.rootHelp.map(record => ({ ...record })),
      failures: this.#telemetry.failures.map(record => ({ ...record, skills: [...record.skills] })),
    }
  }

  addDisposer(disposer: () => void): void {
    this.#disposers.push(disposer)
  }

  #activate(skill: MarivoSkillName, source: MarivoSkillActivationRecord['source']): void {
    this.#activeSkills.add(skill)
    this.#pendingSkills.add(skill)
    this.#telemetry.activations.push({ skill, source })
  }

  observeToolResult(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): void {
    if (exec.agent !== this.agent) return
    if (exec.name === SKILL_TOOL_NAME && this.#inheritedSkillToolVisible()) {
      const skill = successfulSkillName(result)
      if (skill !== undefined) this.#activate(skill, 'model')
      return
    }
    if (exec.name !== MARIVO_HELP_TOOL_NAME) return
    const value = successfulHelpValue(result)
    if (value === undefined) return
    for (const item of value.targets) {
      if (item.delivery === 'already-visible') continue
      this.#visibleHelp.set(item.target, {
        environmentFingerprint: value.environment.fingerprint,
        target: item.target,
        bodyDigest: item.bodyDigest,
      })
    }
  }

  resolveDelivery(query: Readonly<MarivoHelpDeliveryQuery>): MarivoHelpDelivery {
    const visible = this.#visibleHelp.get(query.target)
    if (
      visible?.environmentFingerprint === query.environmentFingerprint
      && visible.bodyDigest === query.bodyDigest
    ) return 'already-visible'
    return visible === undefined ? 'delivered' : 'replacement'
  }

  async prepareStep(
    messages: readonly UserMessage[],
    signal: AbortSignal,
  ): Promise<UserMessage[]> {
    if (this.#disposed) throw this.#lifecycleAbort.signal.reason
    this.#observeExplicitInvocations(messages)
    this.#refreshVisibleHelp(messages)
    if (this.#activeSkills.size === 0) return []

    const environment = await resolveMarivoEnvironmentSource(this.environmentSource)
    if (this.#disposed) throw this.#lifecycleAbort.signal.reason
    const requested = MARIVO_SKILL_ORDER.filter((skill) => {
      if (!this.#activeSkills.has(skill)) return false
      const target = MARIVO_ROOT_HELP_TARGETS[skill]
      const visible = this.#visibleHelp.get(target)
      return this.#pendingSkills.has(skill)
        || visible?.environmentFingerprint !== environment.binding.fingerprint
    })
    if (requested.length === 0) return []

    const batchAbort = new AbortController()
    const readSignal = AbortSignal.any([signal, this.#lifecycleAbort.signal, batchAbort.signal])
    let primaryCause: unknown
    const settled = await Promise.allSettled(requested.map(async (skill): Promise<PendingRootHelp> => {
      try {
        const target = MARIVO_ROOT_HELP_TARGETS[skill]
        const reason = this.#pendingSkills.has(skill) ? 'activation' : 'recovery'
        const startedAt = performance.now()
        const value = await readMarivoHelpTargets(environment, [target], {
          limits: this.options.helpLimits,
          signal: readSignal,
          resolveDelivery: query => this.resolveDelivery(query),
        })
        return { skill, target, reason, startedAt, value }
      } catch (cause) {
        primaryCause ??= cause
        batchAbort.abort(cause)
        throw cause
      }
    }))
    if (this.#disposed) throw this.#lifecycleAbort.signal.reason
    const rejected = settled.find(result => result.status === 'rejected')
    if (rejected !== undefined) {
      const error = new MarivoDisclosureError(requested, primaryCause ?? rejected.reason)
      this.#telemetry.failures.push({ skills: [...requested], message: error.message })
      throw error
    }
    readSignal.throwIfAborted()
    const reads = settled.map((result) => {
      if (result.status !== 'fulfilled') throw new Error('unreachable rejected root Help read')
      return result.value
    })

    const injections: UserMessage[] = []
    for (const read of reads) {
      const item = read.value.targets[0]
      if (item === undefined || item.target !== read.target) {
        const error = new MarivoDisclosureError([read.skill], new Error('root target missing'))
        this.#telemetry.failures.push({ skills: [read.skill], message: error.message })
        throw error
      }
      const update = this.#visibleHelp.has(read.target) || this.#hasHistoricalDisclosure(read.skill)
      this.#telemetry.rootHelp.push({
        skill: read.skill,
        target: read.target,
        environmentFingerprint: read.value.environment.fingerprint,
        bodyDigest: item.bodyDigest,
        delivery: item.delivery,
        reason: read.reason,
        helpTextBytes: Buffer.byteLength(item.body),
        latencyMs: Math.max(0, Math.round(performance.now() - read.startedAt)),
      })
      this.#pendingSkills.delete(read.skill)
      if (item.delivery === 'already-visible') continue
      const message = renderRootHelpMessage(read.skill, read.value, update)
      injections.push(message)
      this.#visibleHelp.set(read.target, {
        environmentFingerprint: read.value.environment.fingerprint,
        target: read.target,
        bodyDigest: item.bodyDigest,
      })
    }
    return injections
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#lifecycleAbort.abort(new Error('Marivo disclosure controller disposed'))
    for (const disposer of this.#disposers.reverse()) disposer()
    this.#disposers = []
    this.#activeSkills.clear()
    this.#pendingSkills.clear()
    this.#visibleHelp.clear()
  }

  #inheritedSkillToolVisible(): boolean {
    const inheritedSkillTool = this.agent.ctx.tools.get(
      SKILL_TOOL_NAME,
      scopeParentOf(this.agent),
    )
    return inheritedSkillTool !== undefined
      && this.agent.ctx.tools.get(SKILL_TOOL_NAME, this.agent) === inheritedSkillTool
  }

  #observeExplicitInvocations(messages: readonly UserMessage[]): void {
    for (const message of messages) {
      const source = message.source as { kind?: unknown; name?: unknown }
      if (source.kind === 'skill-invocation' && isMarivoSkillName(source.name)) {
        this.#activate(source.name, 'user')
      }
    }
  }

  #restoreActiveSkills(): void {
    for (const event of this.agent.session.events) {
      if (event.type !== 'user/message') continue
      const disclosure = rootHelpSource(event.data.source)
      if (disclosure !== undefined) this.#activeSkills.add(disclosure.skill)
      const source = event.data.source as { kind?: unknown; name?: unknown }
      if (source.kind === 'skill-invocation' && isMarivoSkillName(source.name)) {
        this.#activeSkills.add(source.name)
      }
    }
  }

  #refreshVisibleHelp(messages: readonly UserMessage[]): void {
    this.#visibleHelp.clear()
    const visible = new Set(this.agent.session.surface.nodes)
    for (const event of this.agent.session.events) {
      if (!visible.has(event.seq)) continue
      if (event.type === 'user/message') {
        const source = rootHelpSource(event.data.source)
        if (source !== undefined) {
          this.#visibleHelp.set(source.target, {
            environmentFingerprint: source.environmentFingerprint,
            target: source.target,
            bodyDigest: source.bodyDigest,
          })
        }
      } else if (event.type === 'tool/result') {
        for (const item of focusedHelpMeta(event.data.meta)) {
          this.#visibleHelp.set(item.target, item)
        }
      }
    }
    for (const message of messages) {
      const source = rootHelpSource(message.source)
      if (source === undefined) continue
      this.#visibleHelp.set(source.target, {
        environmentFingerprint: source.environmentFingerprint,
        target: source.target,
        bodyDigest: source.bodyDigest,
      })
    }
  }

  #hasHistoricalDisclosure(skill: MarivoSkillName): boolean {
    return this.agent.session.events.some(event => (
      event.type === 'user/message' && rootHelpSource(event.data.source)?.skill === skill
    ))
  }
}

/** Install skill-triggered Marivo live-help disclosure for one Agent scope. */
export function installMarivoDisclosure(
  ctx: Context,
  agent: Agent,
  environmentSource: MarivoEnvironmentSource,
  options: MarivoDisclosureOptions = {},
): MarivoDisclosureController {
  const controller = new MarivoDisclosureController(agent, environmentSource, options)
  try {
    controller.addDisposer(registerMarivoHelpTool(
      agent.ctx,
      environmentSource,
      options.helpLimits,
      query => controller.resolveDelivery(query),
    ))
    controller.addDisposer(agent.ctx.on('tools/result', (exec, result) => {
      controller.observeToolResult(exec, result)
    }))
    controller.addDisposer(agent.ctx.on(
      'agent/pre-step',
      async ({ signal }, next): Promise<PreStepDecision> => {
        const decision = await next()
        if (decision.kind === 'reject') return decision
        const injections = await controller.prepareStep(decision.messages, signal)
        return injections.length === 0
          ? decision
          : { kind: 'enter', messages: [...decision.messages, ...injections] }
      },
      true,
    ))
    return controller
  } catch (cause) {
    controller.dispose()
    throw cause
  }
}
