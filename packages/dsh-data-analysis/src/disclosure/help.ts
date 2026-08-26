import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { MarivoEnvironmentError } from '../environment/errors.ts'
import type { MarivoEnvironment } from '../environment/binding.ts'

export const MARIVO_HELP_TOOL_NAME = 'marivo_help'

/** A fixed binding or a lazy per-Agent/per-Workspace binding. */
export type MarivoEnvironmentSource = MarivoEnvironment | (() => Promise<MarivoEnvironment>)

export function resolveMarivoEnvironmentSource(
  source: MarivoEnvironmentSource,
): Promise<MarivoEnvironment> {
  return typeof source === 'function' ? source() : Promise.resolve(source)
}

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

export type MarivoHelpFailureCode =
  | 'invalid-request'
  | 'target-failed'
  | 'empty-help'
  | 'combined-output-limit'

export class MarivoHelpError extends Error {
  readonly code: MarivoHelpFailureCode
  readonly details: Readonly<Record<string, unknown>>

  constructor(
    code: MarivoHelpFailureCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'MarivoHelpError'
    this.code = code
    this.details = details
  }
}

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
    pythonExecutable: string
    packagePath: string
    fingerprint: string
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
    inventoryStdoutMaxBytes: positiveInteger('inventoryStdoutMaxBytes', merged.inventoryStdoutMaxBytes),
    stderrMaxBytes: positiveInteger('stderrMaxBytes', merged.stderrMaxBytes),
    combinedStdoutMaxBytes: positiveInteger('combinedStdoutMaxBytes', merged.combinedStdoutMaxBytes),
    toolTimeoutMs: positiveInteger('toolTimeoutMs', merged.toolTimeoutMs),
  })
}

/** Validate only mechanical resource boundaries and deduplicate in first-seen order. */
export function normalizeHelpTargets(input: unknown, limits: Readonly<MarivoHelpLimits>): string[] {
  if (!Array.isArray(input)) {
    throw new MarivoHelpError('invalid-request', 'marivo_help targets must be an array')
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

function boundedStderr(stderr: Buffer): string {
  const text = stderr.toString('utf8').trim()
  return text.length === 0 ? 'no stderr was returned' : text.slice(0, 4_000)
}

async function runHelpTarget(
  environment: MarivoEnvironment,
  target: string,
  stdoutMaxBytes: number,
  limits: Readonly<MarivoHelpLimits>,
  signal?: AbortSignal,
): Promise<Buffer> {
  try {
    const result = await environment.runCheckedHelpTarget(target, {
      timeoutMs: limits.targetTimeoutMs,
      stdoutMaxBytes,
      stderrMaxBytes: limits.stderrMaxBytes,
    }, signal)
    if (result.exitCode !== 0) {
      throw new MarivoHelpError(
        'target-failed',
        `marivo_help target ${JSON.stringify(target)} failed with exit code ${String(result.exitCode)}: ${boundedStderr(result.stderr)}`,
        { target, exitCode: result.exitCode },
      )
    }
    if (result.stdout.byteLength === 0) {
      throw new MarivoHelpError(
        'empty-help',
        `marivo_help target ${JSON.stringify(target)} returned empty stdout`,
        { target },
      )
    }
    return result.stdout
  } catch (cause) {
    if (cause instanceof MarivoHelpError) throw cause
    if (
      cause instanceof MarivoEnvironmentError
      && (cause.code === 'binding-identity-mismatch' || cause.code === 'binding-failed')
    ) throw cause
    if (cause instanceof MarivoEnvironmentError) {
      throw new MarivoHelpError(
        'target-failed',
        `marivo_help target ${JSON.stringify(target)} failed: ${cause.message}`,
        { target, environmentFailureCode: cause.code },
        { cause },
      )
    }
    throw new MarivoHelpError(
      'target-failed',
      `marivo_help target ${JSON.stringify(target)} failed`,
      { target },
      { cause },
    )
  }
}

/** Read the current raw canonical inventory without parsing or caching it. */
export async function loadTargetInventory(
  environment: MarivoEnvironment,
  options: { limits?: Partial<MarivoHelpLimits>; signal?: AbortSignal } = {},
): Promise<string> {
  const limits = resolveMarivoHelpLimits(options.limits)
  const stdout = await runHelpTarget(
    environment,
    'targets',
    limits.inventoryStdoutMaxBytes,
    limits,
    options.signal,
  )
  return stdout.toString('utf8')
}

export function marivoHelpBodyDigest(body: string): string {
  return createHash('sha256').update(body).digest('hex')
}

export function renderMarivoHelpValue(value: MarivoHelpValue): string {
  if (value.targets.length === 0) {
    return `Marivo help request completed for ${value.environment.version}: no targets requested.`
  }
  const header = `Marivo environment: ${value.environment.version}; Python: ${value.environment.pythonExecutable}; Package: ${value.environment.packagePath}; Fingerprint: ${value.environment.fingerprint}`
  return [header, ...value.targets.map((item) => {
    if (item.delivery === 'already-visible') {
      return `Target: ${item.target}\nCurrent help is already visible in this prompt (digest: ${item.bodyDigest}).`
    }
    const replacement = item.delivery === 'replacement'
      ? `Replacement digest: ${item.bodyDigest}\n`
      : ''
    return `Target: ${item.target}\n${replacement}${item.body}`
  })].join('\n\n')
}

/** Read one all-or-nothing batch from the bound live Marivo help surface. */
export async function readMarivoHelpTargets(
  environment: MarivoEnvironment,
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
    version: environment.binding.marivoVersion,
    pythonExecutable: environment.binding.pythonExecutable,
    packagePath: environment.binding.packagePath,
    fingerprint: environment.binding.fingerprint,
  }
  if (targets.length === 0) return { environment: environmentIdentity, targets: [] }

  const results: MarivoHelpTargetResult[] = []
  let combinedBytes = 0
  for (const target of targets) {
    const stdout = await runHelpTarget(
      environment,
      target,
      limits.focusedStdoutMaxBytes,
      limits,
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
      delivery: options.resolveDelivery?.({
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
  environmentSource: MarivoEnvironmentSource,
  limitOverrides: Partial<MarivoHelpLimits> = {},
  resolveDelivery?: MarivoHelpDeliveryResolver,
): ToolDefinition {
  const limits = resolveMarivoHelpLimits(limitOverrides)
  return defineTool({
    name: MARIVO_HELP_TOOL_NAME,
    description: 'Request current live Marivo API help for zero, one, or multiple canonical string targets from the bound project environment.',
    parameters: {
      targets: {
        type: 'array',
        required: true,
        description: 'Canonical Marivo help targets. Use an empty array when no additional API information is needed.',
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
              pythonExecutable: { type: 'string', required: true },
              packagePath: { type: 'string', required: true },
              fingerprint: { type: 'string', required: true },
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
      presentationMeta: (_args, value) => ({
        kind: 'marivo-help-disclosure',
        environmentFingerprint: value.environment.fingerprint,
        targets: value.targets.map(item => ({
          target: item.target,
          bodyDigest: item.bodyDigest,
          delivery: item.delivery,
        })),
      }),
    },
    timeoutMs: limits.toolTimeoutMs,
    async execute(args, exec) {
      const environment = await resolveMarivoEnvironmentSource(environmentSource)
      return readMarivoHelpTargets(environment, args.targets, {
        limits,
        signal: exec.signal,
        resolveDelivery,
      })
    },
  })
}

/** Register the focused Help Tool; skill-triggered root disclosure is composed separately. */
export function registerMarivoHelpTool(
  ctx: Context,
  environmentSource: MarivoEnvironmentSource,
  limits: Partial<MarivoHelpLimits> = {},
  resolveDelivery?: MarivoHelpDeliveryResolver,
): () => void {
  return ctx.tools.register(createMarivoHelpTool(environmentSource, limits, resolveDelivery))
}
