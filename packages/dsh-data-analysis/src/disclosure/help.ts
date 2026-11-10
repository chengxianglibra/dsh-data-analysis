import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { registerMarivoTool } from '../tool-lifecycle.ts'
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

export interface MarivoHelpTargetFailure {
  target: string
  code: 'target-failed' | 'empty-help'
  phase: 'help-target'
  message: string
  recovery: { action: 'correct-input'; message: string }
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
  errors?: MarivoHelpTargetFailure[]
}

export interface MarivoHelpToolValue {
  environment: {
    version: string
    /** Host-owned disclosure identity, retained for replay with this Harness contract. */
    fingerprint: string
  }
  targets: MarivoHelpTargetResult[]
  errors?: MarivoHelpTargetFailure[]
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
    ...(value.errors ?? []).map(
      (item) => `Target: ${item.target}\nHelp unavailable (${item.code}): ${item.message}`,
    ),
  ].join('\n\n')
}

/** Read targets sequentially; optional per-target failures never become visible Help. */
export async function readMarivoHelpTargets(
  bridge: MarivoHelpBridgePort,
  rawTargets: unknown,
  options: {
    limits?: Partial<MarivoHelpLimits>
    signal?: AbortSignal
    resolveDelivery?: MarivoHelpDeliveryResolver
    allowTargetFailures?: boolean
  } = {},
): Promise<MarivoHelpValue> {
  const limits = resolveMarivoHelpLimits(options.limits)
  const targets = normalizeHelpTargets(rawTargets, limits)
  const environmentIdentity = {
    version: bridge.binding.marivoVersion,
    fingerprint: bridge.binding.fingerprint,
  }

  const results: MarivoHelpTargetResult[] = []
  const errors: MarivoHelpTargetFailure[] = []
  let combinedBytes = 0
  for (const target of targets) {
    options.signal?.throwIfAborted()
    let stdout: Buffer
    try {
      stdout = await bridge.runTarget(
        target,
        {
          timeoutMs: limits.targetTimeoutMs,
          stdoutMaxBytes: limits.focusedStdoutMaxBytes,
          stderrMaxBytes: limits.stderrMaxBytes,
        },
        options.signal,
      )
    } catch (error) {
      options.signal?.throwIfAborted()
      // Only completed target executions can fail locally. Environment, identity,
      // cancellation, timeout and output-budget failures remain call-level errors.
      if (
        !options.allowTargetFailures ||
        !(error instanceof MarivoHelpError) ||
        !(
          error.code === 'empty-help' ||
          (error.code === 'target-failed' && typeof error.details.exitCode === 'number')
        )
      )
        throw error
      const message = error.message.slice(0, 4_096)
      combinedBytes += Buffer.byteLength(message)
      if (combinedBytes > limits.combinedStdoutMaxBytes)
        throw new MarivoHelpError(
          'combined-output-limit',
          'marivo_help combined output limit exceeded',
        )
      errors.push({
        target,
        code: error.code,
        phase: 'help-target',
        message,
        recovery: {
          action: 'correct-input',
          message: 'Choose a valid target from current Runtime Help; keep successful targets.',
        },
      })
      continue
    }
    options.signal?.throwIfAborted()
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
  return {
    environment: environmentIdentity,
    targets: results,
    ...(errors.length ? { errors } : {}),
  }
}

/** Build the native Harness ToolDefinition without registering Agent activation behavior. */
export function createMarivoHelpTool(
  bridgeSource: MarivoHelpBridgeSource,
  limitOverrides: Partial<MarivoHelpLimits> = {},
  resolveDelivery?: MarivoHelpDeliveryResolver,
): ToolDefinition {
  const limits = resolveMarivoHelpLimits(limitOverrides)
  return defineTool({
    name: MARIVO_HELP_TOOL_NAME,
    description:
      'Read current Marivo API contracts from the verified shared Runtime. Targets run individually in order; completed target failures are returned in errors while successful Help remains available. Identity, cancellation and resource-limit failures abort the call. Returned Help owns signatures and constraints, while plugin Skills own report workflows. Use this tool for upstream marivo help examples without switching installations.',
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
              fingerprint: {
                type: 'string',
                required: true,
                description: 'Host-owned Runtime identity for durable Help disclosure.',
              },
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
          errors: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                target: { type: 'string', required: true },
                code: { type: 'string', required: true, enum: ['target-failed', 'empty-help'] },
                phase: { type: 'string', required: true, enum: ['help-target'] },
                message: { type: 'string', required: true },
                recovery: {
                  type: 'object',
                  required: true,
                  additionalProperties: false,
                  properties: {
                    action: { type: 'string', required: true, enum: ['correct-input'] },
                    message: { type: 'string', required: true },
                  },
                },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderMarivoHelpValue(value) }],
      presentationMeta: (_args, value) => {
        return {
          kind: 'marivo-help-disclosure',
          environmentFingerprint: value.environment.fingerprint,
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
      exec.signal.throwIfAborted()
      const bridge = await resolveMarivoHelpBridge(bridgeSource)
      const internal = await readMarivoHelpTargets(bridge, args.targets, {
        limits,
        signal: exec.signal,
        resolveDelivery,
        allowTargetFailures: true,
      })
      exec.signal.throwIfAborted()
      const value: MarivoHelpToolValue = {
        environment: internal.environment,
        targets: internal.targets,
        ...(internal.errors ? { errors: internal.errors } : {}),
      }
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
): () => Promise<void> {
  return registerMarivoTool(ctx, createMarivoHelpTool(bridgeSource, limits, resolveDelivery))
}
