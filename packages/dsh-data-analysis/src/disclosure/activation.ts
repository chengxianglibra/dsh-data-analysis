import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { scopeParentOf } from '@deepseek-ai/dsh-scope'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { renderSkillContent, type SkillResourceBase } from '@deepseek-ai/dsh-skill'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { MarivoEnvironmentError } from '../environment/errors.ts'
import { finishCleanup, PendingTasks } from '../lifecycle.ts'
import {
  MARIVO_HELP_TOOL_NAME,
  type MarivoHelpBridgeSource,
  type MarivoHelpDelivery,
  type MarivoHelpDeliveryQuery,
  type MarivoHelpLimits,
  type MarivoHelpValue,
  readMarivoHelpTargets,
  registerMarivoHelpTool,
  renderMarivoHelpValue,
  resolveMarivoHelpBridge,
} from './help.ts'

const SKILL_TOOL_NAME = 'skill'

export const MARIVO_ROOT_HELP_TARGETS = Object.freeze({
  'marivo-analysis': 'analysis',
  'marivo-semantic': 'authoring',
  'marivo-service': 'analysis',
} as const)

export type MarivoSkillName = keyof typeof MARIVO_ROOT_HELP_TARGETS
export type MarivoRootHelpTarget = (typeof MARIVO_ROOT_HELP_TARGETS)[MarivoSkillName]

const MARIVO_SKILL_ORDER: readonly MarivoSkillName[] = [
  'marivo-analysis',
  'marivo-semantic',
  'marivo-service',
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
  /** Hash of the exact loaded Skill body, checked against the bound Runtime. */
  readonly skillBodyDigest?: string
  readonly update?: true
}

interface MarivoSkillIdentitySource {
  readonly kind: 'marivo-skill-identity'
  readonly skill: MarivoSkillName
  readonly skillBodyDigest: string
}

interface MarivoHelpUnavailableSource {
  readonly kind: 'marivo-help-unavailable'
  readonly targets: readonly MarivoRootHelpTarget[]
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'marivo-disclosure': MarivoDisclosureSource
    'marivo-skill-identity': MarivoSkillIdentitySource
    'marivo-help-unavailable': MarivoHelpUnavailableSource
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
  skillBodyDigest: string
}

interface LoadedSkill {
  provider: string
  content: string
  resourceBase?: SkillResourceBase
}

/** Correlate registry sources without exposing provider values or resource locations. */
function skillSource(skill: LoadedSkill): string {
  const sourceId = createHash('sha256')
    .update(JSON.stringify([skill.provider, skill.resourceBase ?? null]))
    .digest('hex')
    .slice(0, 16)
  return `registry source ${sourceId}, resource kind ${skill.resourceBase?.kind ?? 'unknown'}`
}

function loadedSkill(value: unknown): LoadedSkill | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const skill = value as { provider?: unknown; content?: unknown; resourceBase?: unknown }
  if (typeof skill.provider !== 'string' || typeof skill.content !== 'string') return undefined
  if (skill.resourceBase === undefined) return { provider: skill.provider, content: skill.content }
  if (typeof skill.resourceBase !== 'object' || skill.resourceBase === null) return undefined
  const base = skill.resourceBase as {
    kind?: unknown
    path?: unknown
    url?: unknown
    description?: unknown
  }
  let resourceBase: SkillResourceBase
  if (base.kind === 'directory' && typeof base.path === 'string')
    resourceBase = { kind: 'directory', path: base.path }
  else if (base.kind === 'url' && typeof base.url === 'string')
    resourceBase = { kind: 'url', url: base.url }
  else if (base.kind === 'opaque' && typeof base.description === 'string')
    resourceBase = { kind: 'opaque', description: base.description }
  else return undefined
  return {
    provider: skill.provider,
    content: skill.content,
    resourceBase,
  }
}

interface ObservedSkillResult {
  skill: MarivoSkillName
  loaded?: LoadedSkill
  renderedMatches: boolean
}

/** Extract only the canonical public DSH rendering; this does not identify its provider. */
function renderedSkillBody(text: string, skill: MarivoSkillName): string | undefined {
  // Derive framing from the public DSH renderer rather than copying its format.
  // Resource hints vary by provider; only the stable name and body boundary
  // from the renderer's own template are used to inspect historical text.
  const sentinel = 'dsh-data-analysis-skill-body-sentinel'
  const template = renderSkillContent({ name: skill, provider: 'fixture', content: sentinel })
  const position = template.indexOf(sentinel)
  const firstLine = template.indexOf('\n')
  const boundary = template.lastIndexOf('\n\n', position)
  if (position < 0 || firstLine < 0 || boundary <= firstLine) return undefined
  const prefix = template.slice(0, firstLine + 1)
  const separator = template.slice(boundary, position)
  const suffix = template.slice(position + sentinel.length)
  if (!separator || !suffix) return undefined
  if (!text.startsWith(prefix) || !text.endsWith(suffix)) return undefined
  const start = text.indexOf(separator, prefix.length)
  if (start < 0) return undefined
  return text.slice(start + separator.length, -suffix.length)
}

/** Matches the body published by DSH's filesystem Skill provider. */
function skillBody(source: string): string | undefined {
  const match = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(source)
  return match === null ? undefined : source.slice(match[0].length).trim()
}

function isMarivoSkillName(value: unknown): value is MarivoSkillName {
  return typeof value === 'string' && Object.hasOwn(MARIVO_ROOT_HELP_TARGETS, value)
}

function rootHelpSource(value: unknown): MarivoDisclosureSource | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const source = value as Partial<MarivoDisclosureSource>
  if (
    source.kind !== 'marivo-disclosure' ||
    source.form !== 'root-help' ||
    !isMarivoSkillName(source.skill) ||
    source.target !== MARIVO_ROOT_HELP_TARGETS[source.skill] ||
    typeof source.environmentFingerprint !== 'string' ||
    typeof source.bodyDigest !== 'string'
  )
    return undefined
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
    meta.kind !== 'marivo-help-disclosure' ||
    typeof meta.environmentFingerprint !== 'string' ||
    !Array.isArray(meta.targets)
  )
    return []
  return meta.targets.flatMap((item): VisibleHelp[] => {
    if (typeof item !== 'object' || item === null) return []
    const target = (item as { target?: unknown }).target
    const bodyDigest = (item as { bodyDigest?: unknown }).bodyDigest
    const delivery = (item as { delivery?: unknown }).delivery
    if (
      typeof target !== 'string' ||
      typeof bodyDigest !== 'string' ||
      (delivery !== 'delivered' && delivery !== 'replacement')
    )
      return []
    return [
      {
        environmentFingerprint: meta.environmentFingerprint as string,
        target,
        bodyDigest,
      },
    ]
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
    typeof value.environment !== 'object' ||
    value.environment === null ||
    typeof value.environment.fingerprint !== 'string' ||
    !Array.isArray(value.targets)
  )
    return undefined
  return value as MarivoHelpValue
}

function renderRootHelpMessage(
  skill: MarivoSkillName,
  value: MarivoHelpValue,
  update: boolean,
  skillBodyDigest: string,
): UserMessage {
  const target = MARIVO_ROOT_HELP_TARGETS[skill]
  const item = value.targets[0]
  if (item === undefined || item.target !== target) {
    throw new Error(`Marivo root help ${target} did not return its requested target`)
  }
  return createUserMessage({
    content: [
      {
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
      },
    ],
    source: {
      kind: 'marivo-disclosure',
      form: 'root-help',
      skill,
      target,
      environmentFingerprint: value.environment.fingerprint,
      bodyDigest: item.bodyDigest,
      skillBodyDigest,
      ...(update ? { update: true as const } : {}),
    },
  })
}

/** Per-Agent controller for skill-triggered, prompt-visible Marivo help disclosure. */
export class MarivoDisclosureController {
  readonly agent: Agent
  readonly bridgeSource: MarivoHelpBridgeSource
  readonly options: Readonly<MarivoDisclosureOptions>

  #activeSkills = new Set<MarivoSkillName>()
  #pendingSkills = new Set<MarivoSkillName>()
  #loadedSkills = new Map<MarivoSkillName, LoadedSkill>()
  #observedSkillResults = new Map<string, ObservedSkillResult>()
  #shadowSkillResults = new Set<string>()
  #verifiedSkills = new Map<MarivoSkillName, string>()
  #visibleHelp = new Map<string, VisibleHelp>()
  #lifecycleAbort = new AbortController()
  #disposers: Array<() => unknown> = []
  readonly #tasks = new PendingTasks()
  #closing: Promise<void> | undefined
  #disposed = false
  #telemetry: MarivoDisclosureTelemetry = { activations: [], rootHelp: [], failures: [] }
  #failedRootBatch?: { turn: number; targets: string }

  constructor(
    agent: Agent,
    bridgeSource: MarivoHelpBridgeSource,
    options: MarivoDisclosureOptions = {},
  ) {
    this.agent = agent
    this.bridgeSource = bridgeSource
    this.options = Object.freeze({
      ...(options.helpLimits === undefined ? {} : { helpLimits: { ...options.helpLimits } }),
    })
    this.#restoreActiveSkills()
  }

  get activeSkills(): readonly MarivoSkillName[] {
    return MARIVO_SKILL_ORDER.filter((skill) => this.#activeSkills.has(skill))
  }

  telemetry(): MarivoDisclosureTelemetry {
    return {
      activations: this.#telemetry.activations.map((record) => ({ ...record })),
      rootHelp: this.#telemetry.rootHelp.map((record) => ({ ...record })),
      failures: this.#telemetry.failures.map((record) => ({
        ...record,
        skills: [...record.skills],
      })),
    }
  }

  addDisposer(disposer: () => unknown): void {
    this.#disposers.push(disposer)
  }

  #activate(skill: MarivoSkillName, source: MarivoSkillActivationRecord['source']): void {
    this.#activeSkills.add(skill)
    this.#pendingSkills.add(skill)
    this.#telemetry.activations.push({ skill, source })
  }

  observeToolResult(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): void {
    if (exec.agent !== this.agent) return
    if (exec.name === SKILL_TOOL_NAME && !this.#inheritedSkillToolVisible()) {
      if (typeof exec.callId === 'string') this.#shadowSkillResults.add(exec.callId)
      return
    }
    if (exec.name === SKILL_TOOL_NAME) {
      const skill = successfulSkillName(result)
      if (skill !== undefined) {
        const loaded = loadedSkill(result.value)
        const renderedMatches =
          loaded !== undefined &&
          result.content.length === 1 &&
          result.content[0]?.type === 'text' &&
          result.content[0].text === renderSkillContent({ name: skill, ...loaded })
        if (typeof exec.callId === 'string')
          this.#observedSkillResults.set(exec.callId, {
            skill,
            ...(loaded ? { loaded } : {}),
            renderedMatches,
          })
        if (!renderedMatches || loaded === undefined) this.#loadedSkills.delete(skill)
        else this.#loadedSkills.set(skill, loaded)
        this.#verifiedSkills.delete(skill)
        this.#activate(skill, 'model')
      }
      return
    }
    if (exec.name !== MARIVO_HELP_TOOL_NAME || exec.parent !== undefined) return
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
      visible?.environmentFingerprint === query.environmentFingerprint &&
      visible.bodyDigest === query.bodyDigest
    )
      return 'already-visible'
    return visible === undefined ? 'delivered' : 'replacement'
  }

  prepareStep(
    messages: readonly UserMessage[],
    signal: AbortSignal,
    turn?: number,
  ): Promise<UserMessage[]> {
    return this.#tasks.track(this.#prepareStep(messages, signal, turn))
  }

  async #prepareStep(
    messages: readonly UserMessage[],
    signal: AbortSignal,
    turn?: number,
  ): Promise<UserMessage[]> {
    if (this.#disposed) throw this.#lifecycleAbort.signal.reason
    this.#observeExplicitInvocations(messages)
    this.#refreshVisibleHelp(messages)
    // A historical same-name Tool may be a scoped shadow. Its text is checked
    // only after a trusted live or previously attested activation.
    const visibleSkills = this.#visibleSkillContent().filter((item) =>
      this.#activeSkills.has(item.skill),
    )
    const checkedSkills = MARIVO_SKILL_ORDER.filter((skill) => this.#activeSkills.has(skill))
    if (checkedSkills.length === 0) return []

    const bridge = await resolveMarivoHelpBridge(this.bridgeSource)
    if (this.#disposed) throw this.#lifecycleAbort.signal.reason
    const requested = MARIVO_SKILL_ORDER.filter((skill) => {
      if (!this.#activeSkills.has(skill)) return false
      const target = MARIVO_ROOT_HELP_TARGETS[skill]
      const visible = this.#visibleHelp.get(target)
      return (
        this.#pendingSkills.has(skill) ||
        visible?.environmentFingerprint !== bridge.binding.fingerprint
      )
    })
    // Explicit invocations carry only the name in their source. The public registry
    // can identify the selected provider only when its rendering matches the exact
    // message supplied to this step. Never infer a source from a name alone.
    const verificationSignal = AbortSignal.any([signal, this.#lifecycleAbort.signal])
    for (const message of messages) {
      const source = message.source as { kind?: unknown; name?: unknown; form?: unknown }
      if (
        source.kind !== 'skill-invocation' ||
        source.form !== 'instructions' ||
        !isMarivoSkillName(source.name)
      )
        continue
      this.#loadedSkills.delete(source.name)
      this.#verifiedSkills.delete(source.name)
      const registry = this.agent.ctx.get('skills')
      if (!registry) continue
      let selected: Awaited<ReturnType<typeof registry.get>>
      try {
        selected = await registry.get(source.name, {
          cwd: this.agent.session.header.cwd,
          scope: this.agent,
          signal: verificationSignal,
        })
      } catch {
        if (this.#disposed) throw this.#lifecycleAbort.signal.reason
        verificationSignal.throwIfAborted()
        const error = new MarivoDisclosureError(
          [source.name],
          new Error(
            `Cannot inspect the selected ${source.name} Skill. Reload it after resolving the provider error.`,
          ),
        )
        this.#telemetry.failures.push({ skills: [source.name], message: error.message })
        throw error
      }
      if (this.#disposed) throw this.#lifecycleAbort.signal.reason
      verificationSignal.throwIfAborted()
      const loaded = loadedSkill(selected)
      if (
        loaded &&
        message.content.length === 1 &&
        message.content[0]?.type === 'text' &&
        message.content[0].text === renderSkillContent(selected!)
      )
        this.#loadedSkills.set(source.name, loaded)
    }

    const identities = new Map<MarivoSkillName, string>()
    for (const skill of checkedSkills) {
      try {
        const selected = this.#loadedSkills.get(skill)
        const skillFile = path.join(
          path.dirname(bridge.binding.packagePath),
          'skills',
          skill,
          'SKILL.md',
        )
        let raw: string
        try {
          raw = await readFile(skillFile, { encoding: 'utf8', signal: verificationSignal })
        } catch {
          verificationSignal.throwIfAborted()
          throw new Error(
            `Cannot read the bound Runtime Skill ${skill} (skills/${skill}/SKILL.md); repair the Runtime before continuing.`,
          )
        }
        const expected = skillBody(raw)
        if (expected === undefined) throw new Error(`Cannot verify bound Runtime Skill ${skill}.`)
        const digest = createHash('sha256').update(expected).digest('hex')
        for (const visible of visibleSkills.filter((item) => item.skill === skill)) {
          if (visible.body !== expected)
            throw new Error(
              `Conflicting or unverifiable ${skill} instructions remain visible in this Session. Visible source: ${visible.source}. Expected Runtime Skill: skills/${skill}/SKILL.md in the bound Runtime. Inspect the Host Skill registry to align the conflicting source, then start a new Session or have the Host remove those instructions from the model-visible context before continuing; no history was deleted.`,
            )
        }
        if (selected !== undefined) {
          if (selected.content !== expected)
            throw new Error(
              `Loaded ${skill} has different instructions from the bound Marivo Runtime. Selected source: ${skillSource(selected)}. Expected Runtime Skill: skills/${skill}/SKILL.md in the bound Runtime. Inspect the Host Skill registry. Align the selected Skill with the Runtime and reload it before continuing; no Workspace Skill was changed.`,
            )
        } else if (this.#activeSkills.has(skill) && this.#verifiedSkills.get(skill) !== digest) {
          throw new Error(
            `Cannot verify the loaded ${skill} against the bound Marivo Runtime Skill (skills/${skill}/SKILL.md). Reload this Skill before continuing.`,
          )
        }
        identities.set(skill, digest)
      } catch (cause) {
        if (this.#disposed) throw this.#lifecycleAbort.signal.reason
        verificationSignal.throwIfAborted()
        const error = new MarivoDisclosureError([skill], cause)
        this.#telemetry.failures.push({ skills: [skill], message: error.message })
        throw error
      }
    }
    if (requested.length === 0) return []

    const targets = [...new Set(requested.map((skill) => MARIVO_ROOT_HELP_TARGETS[skill]))]
    const batch = targets.join(',')
    if (
      turn !== undefined &&
      this.#failedRootBatch?.turn === turn &&
      this.#failedRootBatch.targets === batch
    )
      return []
    const batchAbort = new AbortController()
    const readSignal = AbortSignal.any([signal, this.#lifecycleAbort.signal, batchAbort.signal])
    let primaryCause: unknown
    const settled = await Promise.allSettled(
      requested.map(async (skill): Promise<PendingRootHelp> => {
        try {
          const target = MARIVO_ROOT_HELP_TARGETS[skill]
          const reason = this.#pendingSkills.has(skill) ? 'activation' : 'recovery'
          const startedAt = performance.now()
          const skillBodyDigest = identities.get(skill)!
          const value = await readMarivoHelpTargets(bridge, [target], {
            limits: this.options.helpLimits,
            signal: readSignal,
            resolveDelivery: (query) => this.resolveDelivery(query),
          })
          return { skill, target, reason, startedAt, value, skillBodyDigest }
        } catch (cause) {
          primaryCause ??= cause
          batchAbort.abort(cause)
          throw cause
        }
      }),
    )
    if (this.#disposed) throw this.#lifecycleAbort.signal.reason
    const rejected = settled.find((result) => result.status === 'rejected')
    if (rejected !== undefined) {
      const cause = primaryCause ?? rejected.reason
      const error = new MarivoDisclosureError(requested, cause)
      this.#telemetry.failures.push({ skills: [...requested], message: error.message })
      if (signal.aborted) throw error
      if (
        cause instanceof MarivoEnvironmentError &&
        (cause.code === 'binding-identity-mismatch' || cause.code === 'binding-failed')
      )
        throw error
      if (turn !== undefined) this.#failedRootBatch = { turn, targets: batch }
      const visible = new Set(this.agent.session.surface.nodes)
      const matches = (source: UserMessage['source']) =>
        source.kind === 'marivo-help-unavailable' &&
        JSON.stringify(source.targets) === JSON.stringify(targets)
      if (
        messages.some((message) => matches(message.source)) ||
        this.agent.session
          .snapshotEvents()
          .some(
            (event) =>
              visible.has(event.seq) && event.type === 'user/message' && matches(event.data.source),
          )
      )
        return []
      return [
        createUserMessage({
          source: { kind: 'marivo-help-unavailable', targets },
          content: [
            {
              type: 'text',
              text: `Automatic Marivo Help unavailable for ${targets.join(', ')}. Query the needed target with marivo_help. If it still fails, report the blocked Marivo operation and continue independent work.`,
            },
          ],
        }),
      ]
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
      const visible = this.#visibleHelp.get(read.target)
      const delivery =
        visible?.environmentFingerprint === read.value.environment.fingerprint &&
        visible.bodyDigest === item.bodyDigest
          ? 'already-visible'
          : item.delivery
      const update = visible !== undefined || this.#hasHistoricalDisclosure(read.skill)
      this.#telemetry.rootHelp.push({
        skill: read.skill,
        target: read.target,
        environmentFingerprint: read.value.environment.fingerprint,
        bodyDigest: item.bodyDigest,
        delivery,
        reason: read.reason,
        helpTextBytes: Buffer.byteLength(item.body),
        latencyMs: Math.max(0, Math.round(performance.now() - read.startedAt)),
      })
      this.#pendingSkills.delete(read.skill)
      this.#verifiedSkills.set(read.skill, read.skillBodyDigest)
      if (delivery === 'already-visible') {
        // Keep an auditable identity even when the matching Help was already visible.
        injections.push(
          createUserMessage({
            content: [
              {
                type: 'text',
                text: `Loaded ${read.skill} matches the bound Marivo Runtime Skill.`,
              },
            ],
            source: {
              kind: 'marivo-skill-identity',
              skill: read.skill,
              skillBodyDigest: read.skillBodyDigest,
            },
          }),
        )
        continue
      }
      const message = renderRootHelpMessage(read.skill, read.value, update, read.skillBodyDigest)
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
    this.#closing = finishCleanup([...this.#disposers.reverse(), () => this.#tasks.drain()])
    this.#disposers = []
    this.#activeSkills.clear()
    this.#pendingSkills.clear()
    this.#loadedSkills.clear()
    this.#observedSkillResults.clear()
    this.#shadowSkillResults.clear()
    this.#verifiedSkills.clear()
    this.#visibleHelp.clear()
  }

  close(): Promise<void> {
    this.dispose()
    return this.#closing!
  }

  #inheritedSkillToolVisible(): boolean {
    const inheritedSkillTool = this.agent.ctx.tools.get(SKILL_TOOL_NAME, scopeParentOf(this.agent))
    return (
      inheritedSkillTool !== undefined &&
      this.agent.ctx.tools.get(SKILL_TOOL_NAME, this.agent) === inheritedSkillTool
    )
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
    const skillCalls = new Map<string, MarivoSkillName>()
    for (const event of this.agent.session.snapshotEvents()) {
      if (event.type === 'tool/call' && event.data.name === SKILL_TOOL_NAME) {
        try {
          const value: unknown =
            typeof event.data.arguments === 'string'
              ? JSON.parse(event.data.arguments)
              : event.data.arguments
          if (
            typeof value === 'object' &&
            value !== null &&
            isMarivoSkillName((value as { name?: unknown }).name)
          )
            skillCalls.set(event.data.callId, (value as { name: MarivoSkillName }).name)
        } catch {
          // Invalid historical arguments establish no Skill identity.
        }
      }
      if (event.type === 'tool/result') {
        const skill = skillCalls.get(event.data.message.toolCallId)
        if (skill && this.#activeSkills.has(skill) && event.data.message.isError === false) {
          // The persisted result has no structured provider/registration identity.
          // Conservatively revoke a prior attestation; the call may also have
          // been to a scoped shadow and can therefore require an unnecessary reload.
          // Without prior activation, a same-name Tool alone establishes nothing.
          this.#verifiedSkills.delete(skill)
        }
      }
      if (event.type !== 'user/message') continue
      const disclosure = rootHelpSource(event.data.source)
      if (disclosure !== undefined) {
        this.#activeSkills.add(disclosure.skill)
        if (
          typeof disclosure.skillBodyDigest === 'string' &&
          /^[a-f0-9]{64}$/.test(disclosure.skillBodyDigest)
        )
          this.#verifiedSkills.set(disclosure.skill, disclosure.skillBodyDigest)
        else this.#verifiedSkills.delete(disclosure.skill)
      }
      const source = event.data.source as { kind?: unknown; name?: unknown }
      const identity = event.data.source as Partial<MarivoSkillIdentitySource>
      if (
        identity.kind === 'marivo-skill-identity' &&
        isMarivoSkillName(identity.skill) &&
        typeof identity.skillBodyDigest === 'string' &&
        /^[a-f0-9]{64}$/.test(identity.skillBodyDigest)
      ) {
        this.#activeSkills.add(identity.skill)
        this.#verifiedSkills.set(identity.skill, identity.skillBodyDigest)
      }
      if (source.kind === 'skill-invocation' && isMarivoSkillName(source.name)) {
        this.#activeSkills.add(source.name)
        this.#verifiedSkills.delete(source.name)
      }
    }
  }

  /** Inspect actual model-visible Skill text without asserting historical provider identity. */
  #visibleSkillContent(): Array<{
    skill: MarivoSkillName
    body: string | undefined
    source: string
  }> {
    const events = this.agent.session.snapshotEvents()
    const visible = new Set(this.agent.session.surface.nodes)
    const calls = new Map<string, MarivoSkillName>()
    const result: Array<{ skill: MarivoSkillName; body: string | undefined; source: string }> = []
    for (const event of events) {
      if (event.type === 'tool/call' && event.data.name === SKILL_TOOL_NAME) {
        try {
          const args: unknown =
            typeof event.data.arguments === 'string'
              ? JSON.parse(event.data.arguments)
              : event.data.arguments
          if (
            typeof args === 'object' &&
            args !== null &&
            isMarivoSkillName((args as { name?: unknown }).name)
          )
            calls.set(event.data.callId, (args as { name: MarivoSkillName }).name)
        } catch {
          /* Invalid historical arguments do not identify a Skill. */
        }
      }
      if (!visible.has(event.seq)) continue
      let skill: MarivoSkillName | undefined
      let observed: ObservedSkillResult | undefined
      if (event.type === 'tool/result' && event.data.message.isError === false) {
        const callId = event.data.message.toolCallId
        if (this.#shadowSkillResults.has(callId)) continue
        skill = calls.get(callId)
        observed = this.#observedSkillResults.get(callId)
      } else if (event.type === 'user/message') {
        const source = event.data.source as { kind?: unknown; form?: unknown; name?: unknown }
        if (
          source.kind === 'skill-invocation' &&
          source.form === 'instructions' &&
          isMarivoSkillName(source.name)
        )
          skill = source.name
      }
      if (skill === undefined) continue
      const message = this.agent.session.deriveEventMessage(event)
      if (!message) continue
      const bodies = message.content.flatMap((part) => {
        if (part.type !== 'text') return []
        const body = renderedSkillBody(part.text, skill!)
        return body === undefined ? [] : [body]
      })
      if (observed) {
        const loaded = observed.loaded
        const exact =
          observed.skill === skill &&
          observed.renderedMatches &&
          loaded !== undefined &&
          message.content.length === 1 &&
          message.content[0]?.type === 'text' &&
          message.content[0].text === renderSkillContent({ name: skill, ...loaded })
        result.push({
          skill,
          body: exact ? loaded.content : undefined,
          source: `Session event ${event.seq}${loaded ? `, ${skillSource(loaded)}` : ', provider unavailable'}`,
        })
      } else if (bodies.length > 0) {
        result.push({
          skill,
          body: message.content.length === 1 && bodies.length === 1 ? bodies[0] : undefined,
          source: `Session event ${event.seq}, provider unavailable after history restoration`,
        })
      }
    }
    return result
  }

  #refreshVisibleHelp(messages: readonly UserMessage[]): void {
    this.#visibleHelp.clear()
    const visible = new Set(this.agent.session.surface.nodes)
    for (const event of this.agent.session.snapshotEvents()) {
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
    return this.agent.session
      .snapshotEvents()
      .some(
        (event) =>
          event.type === 'user/message' && rootHelpSource(event.data.source)?.skill === skill,
      )
  }
}

/** Install skill-triggered Marivo live-help disclosure for one Agent scope. */
export function installMarivoDisclosure(
  _ctx: Context,
  agent: Agent,
  bridgeSource: MarivoHelpBridgeSource,
  options: MarivoDisclosureOptions = {},
): MarivoDisclosureController {
  const controller = new MarivoDisclosureController(agent, bridgeSource, options)
  try {
    controller.addDisposer(
      registerMarivoHelpTool(agent.ctx, bridgeSource, options.helpLimits, (query) =>
        controller.resolveDelivery(query),
      ),
    )
    controller.addDisposer(
      agent.ctx.on('tools/result', (exec, result) => {
        controller.observeToolResult(exec, result)
      }),
    )
    controller.addDisposer(
      agent.ctx.on(
        'agent/pre-step',
        async ({ signal, turn }, next): Promise<PreStepDecision> => {
          const decision = await next()
          if (decision.kind === 'reject') return decision
          const injections = await controller.prepareStep(decision.messages, signal, turn)
          signal.throwIfAborted()
          return injections.length === 0
            ? decision
            : { ...decision, messages: [...decision.messages, ...injections] }
        },
        true,
      ),
    )
    return controller
  } catch (cause) {
    controller.dispose()
    throw cause
  }
}
