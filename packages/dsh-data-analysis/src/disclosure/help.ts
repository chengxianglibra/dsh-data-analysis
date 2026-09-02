import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import {
  type MarivoHelpBridgePort,
  type MarivoHelpBridgeSource,
  MarivoHelpError,
  resolveMarivoHelpBridge,
} from './bridge.ts'

export type {
  MarivoHelpBridgePort,
  MarivoHelpBridgeSource,
  MarivoHelpFailureCode,
} from './bridge.ts'
export { MarivoHelpError, resolveMarivoHelpBridge } from './bridge.ts'

export const MARIVO_HELP_TOOL_NAME = 'marivo_help'

export interface MarivoHelpLimits {
  maxTargets: number
  maxTargetChars: number
  maxTotalTargetChars: number
  targetTimeoutMs: number
  focusedStdoutMaxBytes: number
  inventoryStdoutMaxBytes: number
  stderrMaxBytes: number
  combinedStdoutMaxBytes: number
  toolTimeoutMs: number
}

export const DEFAULT_MARIVO_HELP_LIMITS: Readonly<MarivoHelpLimits> = Object.freeze({
  maxTargets: 8,
  maxTargetChars: 256,
  maxTotalTargetChars: 2_048,
  targetTimeoutMs: 30_000,
  focusedStdoutMaxBytes: 262_144,
  inventoryStdoutMaxBytes: 1_048_576,
  stderrMaxBytes: 65_536,
  combinedStdoutMaxBytes: 1_048_576,
  toolTimeoutMs: 245_000,
})

export interface MarivoHelpTargetResult {
  target: string
  body: string
  bodyDigest: string
  delivery: MarivoHelpDelivery
}

export type MarivoHelpDelivery = 'delivered' | 'already-visible' | 'replacement'

export interface MarivoHelpDeliveryQuery {
  environmentFingerprint: string
  target: string
  bodyDigest: string
}

export type MarivoHelpDeliveryResolver = (
  query: Readonly<MarivoHelpDeliveryQuery>,
) => MarivoHelpDelivery

export interface MarivoHelpValue {
  environment: {
    version: string
    fingerprint: string
  }
  targets: MarivoHelpTargetResult[]
}

export interface MarivoHelpToolValue {
  environment: {
    version: string
  }
  targets: MarivoHelpTargetResult[]
}

function positiveInteger(name: keyof MarivoHelpLimits, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`marivo_help ${name} must be a positive safe integer`)
  }
  return value
}

export function resolveMarivoHelpLimits(
  overrides: Partial<MarivoHelpLimits> = {},
): Readonly<MarivoHelpLimits> {
  const merged = { ...DEFAULT_MARIVO_HELP_LIMITS, ...overrides }
  return Object.freeze({
    maxTargets: positiveInteger('maxTargets', merged.maxTargets),
    maxTargetChars: positiveInteger('maxTargetChars', merged.maxTargetChars),
    maxTotalTargetChars: positiveInteger('maxTotalTargetChars', merged.maxTotalTargetChars),
    targetTimeoutMs: positiveInteger('targetTimeoutMs', merged.targetTimeoutMs),
    focusedStdoutMaxBytes: positiveInteger('focusedStdoutMaxBytes', merged.focusedStdoutMaxBytes),
    inventoryStdoutMaxBytes: positiveInteger(
      'inventoryStdoutMaxBytes',
      merged.inventoryStdoutMaxBytes,
    ),
    stderrMaxBytes: positiveInteger('stderrMaxBytes', merged.stderrMaxBytes),
    combinedStdoutMaxBytes: positiveInteger(
      'combinedStdoutMaxBytes',
      merged.combinedStdoutMaxBytes,
    ),
    toolTimeoutMs: positiveInteger('toolTimeoutMs', merged.toolTimeoutMs),
  })
}

/** Validate only mechanical resource boundaries and deduplicate in first-seen order. */
export function normalizeHelpTargets(input: unknown, limits: Readonly<MarivoHelpLimits>): string[] {
  if (!Array.isArray(input)) {
    throw new MarivoHelpError('invalid-request', 'marivo_help targets must be an array')
  }
  if (input.length === 0) {
    throw new MarivoHelpError(
      'invalid-request',
      'marivo_help targets must contain at least one target',
    )
  }
  if (input.length > limits.maxTargets) {
    throw new MarivoHelpError(
      'invalid-request',
      `marivo_help accepts at most ${limits.maxTargets} targets per call`,
      { maxTargets: limits.maxTargets, received: input.length },
    )
  }

  const targets: string[] = []
  const seen = new Set<string>()
  let totalChars = 0
  for (const [index, target] of input.entries()) {
    if (typeof target !== 'string' || target.length === 0) {
      throw new MarivoHelpError(
        'invalid-request',
        `marivo_help target at index ${index} must be a non-empty string`,
        { index },
      )
    }
    if (target.length > limits.maxTargetChars) {
      throw new MarivoHelpError(
        'invalid-request',
        `marivo_help target at index ${index} exceeds ${limits.maxTargetChars} characters`,
        { index, maxTargetChars: limits.maxTargetChars, received: target.length },
      )
    }
    totalChars += target.length
    if (totalChars > limits.maxTotalTargetChars) {
      throw new MarivoHelpError(
        'invalid-request',
        `marivo_help targets exceed ${limits.maxTotalTargetChars} total characters`,
        { maxTotalTargetChars: limits.maxTotalTargetChars, received: totalChars },
      )
    }
    if (!seen.has(target)) {
      seen.add(target)
      targets.push(target)
    }
  }
  return targets
}

/** Read the current raw canonical inventory without parsing or caching it. */
export async function loadTargetInventory(
  bridge: MarivoHelpBridgePort,
  options: { limits?: Partial<MarivoHelpLimits>; signal?: AbortSignal } = {},
): Promise<string> {
  const limits = resolveMarivoHelpLimits(options.limits)
  const stdout = await bridge.inventory(
    {
      timeoutMs: limits.targetTimeoutMs,
      stdoutMaxBytes: limits.inventoryStdoutMaxBytes,
      stderrMaxBytes: limits.stderrMaxBytes,
    },
    options.signal,
  )
  return stdout.toString('utf8')
}

export function marivoHelpBodyDigest(body: string): string {
  return createHash('sha256').update(body).digest('hex')
}

export function renderMarivoHelpValue(value: MarivoHelpToolValue): string {
  const header = `Marivo version: ${value.environment.version}`
  return [
    header,
    ...value.targets.map((item) => {
      if (item.delivery === 'already-visible') {
        return `Target: ${item.target}\nCurrent help is already visible in this prompt.`
      }
      return `Target: ${item.target}\n${item.body}`
    }),
  ].join('\n\n')
}

function helpPresentationKey(value: MarivoHelpToolValue): string {
  return JSON.stringify([
    value.environment.version,
    value.targets.map((item) => [item.target, item.bodyDigest, item.delivery]),
  ])
}

/** Read one all-or-nothing batch from the bound live Marivo help surface. */
export async function readMarivoHelpTargets(
  bridge: MarivoHelpBridgePort,
  rawTargets: unknown,
  options: {
    limits?: Partial<MarivoHelpLimits>
    signal?: AbortSignal
    resolveDelivery?: MarivoHelpDeliveryResolver
  } = {},
): Promise<MarivoHelpValue> {
  const limits = resolveMarivoHelpLimits(options.limits)
  const targets = normalizeHelpTargets(rawTargets, limits)
  const environmentIdentity = {
    version: bridge.binding.marivoVersion,
    fingerprint: bridge.binding.fingerprint,
  }

  const results: MarivoHelpTargetResult[] = []
  let combinedBytes = 0
  for (const target of targets) {
    const stdout = await bridge.runTarget(
      target,
      {
        timeoutMs: limits.targetTimeoutMs,
        stdoutMaxBytes: limits.focusedStdoutMaxBytes,
        stderrMaxBytes: limits.stderrMaxBytes,
      },
      options.signal,
    )
    combinedBytes += stdout.byteLength
    if (combinedBytes > limits.combinedStdoutMaxBytes) {
      throw new MarivoHelpError(
        'combined-output-limit',
        `marivo_help combined stdout exceeds ${limits.combinedStdoutMaxBytes} bytes`,
        { maxBytes: limits.combinedStdoutMaxBytes, observedBytes: combinedBytes, target },
      )
    }
    const body = stdout.toString('utf8')
    const bodyDigest = marivoHelpBodyDigest(body)
    results.push({
      target,
      body,
      bodyDigest,
      delivery:
        options.resolveDelivery?.({
          environmentFingerprint: environmentIdentity.fingerprint,
          target,
          bodyDigest,
        }) ?? 'delivered',
    })
  }
  return { environment: environmentIdentity, targets: results }
}

/** Build the native Harness ToolDefinition without registering Agent activation behavior. */
export function createMarivoHelpTool(
  bridgeSource: MarivoHelpBridgeSource,
  limitOverrides: Partial<MarivoHelpLimits> = {},
  resolveDelivery?: MarivoHelpDeliveryResolver,
): ToolDefinition {
  const limits = resolveMarivoHelpLimits(limitOverrides)
  const presentations = new Map<string, string[]>()
  return defineTool({
    name: MARIVO_HELP_TOOL_NAME,
    description:
      'Request current live Marivo API help for one or more canonical string targets from the exact shared Runtime.',
    parameters: {
      targets: {
        type: 'array',
        required: true,
        description: 'One or more canonical Marivo help targets.',
        items: { type: 'string' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          environment: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              version: { type: 'string', required: true },
            },
          },
          targets: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                target: { type: 'string', required: true },
                body: { type: 'string', required: true },
                bodyDigest: { type: 'string', required: true },
                delivery: {
                  type: 'string',
                  required: true,
                  enum: ['delivered', 'already-visible', 'replacement'],
                },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderMarivoHelpValue(value) }],
      presentationMeta: (_args, value) => {
        const key = helpPresentationKey(value)
        const pending = presentations.get(key)
        const environmentFingerprint = pending?.shift()
        if (pending?.length === 0) presentations.delete(key)
        if (environmentFingerprint === undefined) {
          throw new Error('marivo_help presentation identity is unavailable')
        }
        return {
          kind: 'marivo-help-disclosure',
          environmentFingerprint,
          targets: value.targets.map((item) => ({
            target: item.target,
            bodyDigest: item.bodyDigest,
            delivery: item.delivery,
          })),
        }
      },
    },
    timeoutMs: limits.toolTimeoutMs,
    async execute(args, exec) {
      const bridge = await resolveMarivoHelpBridge(bridgeSource)
      const internal = await readMarivoHelpTargets(bridge, args.targets, {
        limits,
        signal: exec.signal,
        resolveDelivery,
      })
      const value: MarivoHelpToolValue = {
        environment: { version: internal.environment.version },
        targets: internal.targets,
      }
      const key = helpPresentationKey(value)
      const pending = presentations.get(key) ?? []
      pending.push(internal.environment.fingerprint)
      presentations.set(key, pending)
      return value
    },
  })
}

/** Register the focused Help Tool; skill-triggered root disclosure is composed separately. */
export function registerMarivoHelpTool(
  ctx: Context,
  bridgeSource: MarivoHelpBridgeSource,
  limits: Partial<MarivoHelpLimits> = {},
  resolveDelivery?: MarivoHelpDeliveryResolver,
): () => void {
  return ctx.tools.register(createMarivoHelpTool(bridgeSource, limits, resolveDelivery))
}
