import { isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { MarivoEnvironmentError } from '../environment/errors.ts'
import type { MarivoBridgeSource } from '../environment/source.ts'
import { resolveMarivoBridgeSource } from '../environment/source.ts'
import type { MarivoCheckedRunner, MarivoEnvironmentBinding } from '../environment/types.ts'
import {
  DATASOURCE_AUTHORING_PROGRAM,
  type DatasourceAuthoring,
  type DatasourceCreateInput,
  datasourceAuthoringSchema,
} from './authoring.ts'
import {
  MARIVO_DATASOURCE_DESCRIBE_PROGRAM,
  MARIVO_DATASOURCE_INVENTORY_PROGRAM,
  MARIVO_DATASOURCE_TEST_PROGRAM,
} from './bridge-programs.ts'
import { marivoCredentialStorageRef } from './shell-env.ts'

const DATASOURCE_LIMITS = Object.freeze({
  timeoutMs: 30_000,
  stdoutMaxBytes: 262_144,
  stderrMaxBytes: 65_536,
})

interface JsonObject {
  [key: string]: JsonValue
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  phase: 'describe' | 'inventory' | 'test',
): void {
  const expected = new Set(keys)
  if (Object.keys(value).some((key) => !expected.has(key)) || keys.some((key) => !(key in value))) {
    throw new MarivoEnvironmentError(
      'subprocess-output-invalid',
      `Marivo datasource ${phase} returned an unexpected payload shape`,
      { phase },
    )
  }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function jsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(jsonValue)
  const fields = object(value)
  return fields !== undefined && Object.values(fields).every(jsonValue)
}

export interface MarivoDatasourceFailure extends JsonObject {
  code: string
  exception_type: string
  backend_code: string | null
  backend_name: string | null
  message: string
}

export interface MarivoDatasourceRepair extends JsonObject {
  kind: string
  help_target: { surface: string; canonical_id: string | null }
  action: string
  snippet: string | null
  candidates: string[]
  preserves_evidence: boolean | null
}

export interface MarivoDatasourceDescription {
  name: string
  backend?: string
  properties?: Record<string, JsonValue>
  refs: string[]
  fields: Record<string, string>
  definition: string
}

export interface MarivoDatasourceTestResult {
  name: string
  ok: boolean
  latency_ms: number | null
  failure: MarivoDatasourceFailure | null
  repair: MarivoDatasourceRepair | null
}

export interface MarivoDatasourceBridgePort {
  readonly binding: Readonly<MarivoEnvironmentBinding>
  authoring?(signal?: AbortSignal): Promise<DatasourceAuthoring>
  create?(
    input: DatasourceCreateInput,
    signal?: AbortSignal,
  ): Promise<{ name?: string; error?: string }>
  describe(name: string, signal?: AbortSignal): Promise<MarivoDatasourceDescription>
  inventory(signal?: AbortSignal): Promise<MarivoDatasourceDescription[]>
  test(
    description: Readonly<MarivoDatasourceDescription>,
    values: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<MarivoDatasourceTestResult>
}

export type MarivoDatasourceBridgeSource = MarivoBridgeSource<MarivoDatasourceBridgePort>
export type MarivoDatasourceInventoryBridge = Pick<MarivoDatasourceBridgePort, 'inventory'>
export type MarivoDatasourceInventoryBridgeSource =
  MarivoBridgeSource<MarivoDatasourceInventoryBridge>

function parseJsonObject(
  stdout: Buffer,
  phase: 'describe' | 'inventory' | 'test',
): Record<string, unknown> {
  try {
    const parsed = JSON.parse(stdout.toString('utf8')) as unknown
    if (object(parsed) === undefined) {
      throw new TypeError('payload must be an object')
    }
    return parsed as Record<string, unknown>
  } catch (cause) {
    throw new MarivoEnvironmentError(
      'subprocess-output-invalid',
      `Marivo datasource ${phase} returned an invalid payload`,
      { phase, stdoutBytes: stdout.byteLength },
      { cause },
    )
  }
}

function parseDescription(
  value: unknown,
  phase: 'describe' | 'inventory',
): MarivoDatasourceDescription {
  const source = object(value)
  if (source === undefined) {
    throw new MarivoEnvironmentError(
      'subprocess-output-invalid',
      `Marivo datasource ${phase} returned invalid fields`,
      { phase },
    )
  }
  exactKeys(source, ['name', 'backend', 'properties', 'refs', 'fields', 'definition'], phase)
  const name = string(source.name)
  const backend = string(source.backend)
  const properties = object(source.properties)
  if (
    name === undefined ||
    name.length > 256 ||
    backend === undefined ||
    backend.length > 256 ||
    properties === undefined ||
    !jsonValue(properties) ||
    !Array.isArray(source.refs) ||
    source.refs.length > 128
  ) {
    throw new MarivoEnvironmentError(
      'subprocess-output-invalid',
      `Marivo datasource ${phase} returned invalid fields`,
      { phase },
    )
  }
  const refs: string[] = []
  const seen = new Set<string>()
  for (const ref of source.refs) {
    if (typeof ref !== 'string' || ref.length > 256 || !isCredentialRefName(ref)) {
      throw new MarivoEnvironmentError(
        'subprocess-output-invalid',
        `Marivo datasource ${phase} returned an invalid credential reference`,
        { phase },
      )
    }
    if (!seen.has(ref)) {
      seen.add(ref)
      refs.push(ref)
    }
  }
  const fields = object(source.fields)
  if (
    !fields ||
    typeof source.definition !== 'string' ||
    !/^[a-f0-9]{64}$/.test(source.definition) ||
    Object.values(fields).some((ref) => typeof ref !== 'string' || !refs.includes(ref)) ||
    refs.some((ref) => !Object.values(fields).includes(ref))
  )
    throw new Error('Invalid datasource definition projection')
  return {
    name,
    backend,
    properties: properties as Record<string, JsonValue>,
    refs,
    fields: fields as Record<string, string>,
    definition: source.definition,
  }
}

function parseInventory(stdout: Buffer): MarivoDatasourceDescription[] {
  const value = parseJsonObject(stdout, 'inventory')
  exactKeys(value, ['datasources'], 'inventory')
  if (!Array.isArray(value.datasources)) {
    throw new MarivoEnvironmentError(
      'subprocess-output-invalid',
      'Marivo datasource inventory returned invalid fields',
      { phase: 'datasource-inventory' },
    )
  }
  return value.datasources.map((item) => parseDescription(item, 'inventory'))
}

function parseFailure(value: unknown): MarivoDatasourceFailure {
  const source = object(value)
  if (source === undefined) throw new TypeError('failure must be an object')
  exactKeys(source, ['code', 'exception_type', 'backend_code', 'backend_name', 'message'], 'test')
  if (
    string(source.code) === undefined ||
    string(source.exception_type) === undefined ||
    !nullableString(source.backend_code) ||
    !nullableString(source.backend_name) ||
    typeof source.message !== 'string'
  ) {
    throw new TypeError('failure fields are invalid')
  }
  return source as unknown as MarivoDatasourceFailure
}

function parseRepair(value: unknown): MarivoDatasourceRepair {
  const source = object(value)
  if (source === undefined) throw new TypeError('repair must be an object')
  exactKeys(
    source,
    ['kind', 'help_target', 'action', 'snippet', 'candidates', 'preserves_evidence'],
    'test',
  )
  if (
    string(source.kind) === undefined ||
    object(source.help_target) === undefined ||
    string(object(source.help_target)?.surface) === undefined ||
    !nullableString(object(source.help_target)?.canonical_id) ||
    typeof source.action !== 'string' ||
    !nullableString(source.snippet) ||
    !Array.isArray(source.candidates) ||
    source.candidates.some((item) => typeof item !== 'string') ||
    (source.preserves_evidence !== null && typeof source.preserves_evidence !== 'boolean')
  ) {
    throw new TypeError('repair fields are invalid')
  }
  return source as unknown as MarivoDatasourceRepair
}

function redactUnknown(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === 'string') {
    let result = value
    for (const secret of secrets)
      if (secret !== '') result = result.split(secret).join('[REDACTED]')
    return result
  }
  if (Array.isArray(value)) return value.map((item) => redactUnknown(item, secrets))
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, redactUnknown(item, secrets)]),
  )
}

function parseTest(stdout: Buffer, secrets: readonly string[]): MarivoDatasourceTestResult {
  const value = redactUnknown(parseJsonObject(stdout, 'test'), secrets) as Record<string, unknown>
  exactKeys(value, ['name', 'ok', 'latency_ms', 'failure', 'repair'], 'test')
  if (
    string(value.name) === undefined ||
    typeof value.ok !== 'boolean' ||
    (value.latency_ms !== null &&
      (typeof value.latency_ms !== 'number' ||
        !Number.isFinite(value.latency_ms) ||
        value.latency_ms < 0))
  ) {
    throw new MarivoEnvironmentError(
      'subprocess-output-invalid',
      `Marivo datasource test returned invalid fields (name=${typeof value.name}, ok=${typeof value.ok}, latency=${value.latency_ms === null ? 'null' : typeof value.latency_ms})`,
      { phase: 'test' },
    )
  }
  if (value.ok) {
    if (value.failure !== null || value.repair !== null) {
      throw new MarivoEnvironmentError(
        'subprocess-output-invalid',
        'Marivo datasource test success included failure or repair fields',
        { phase: 'test' },
      )
    }
    return {
      name: value.name as string,
      ok: true,
      latency_ms: value.latency_ms as number | null,
      failure: null,
      repair: null,
    }
  }
  if (value.failure === null || value.repair === null) {
    throw new MarivoEnvironmentError(
      'subprocess-output-invalid',
      'Marivo datasource test failure omitted structured failure or repair',
      { phase: 'test' },
    )
  }
  try {
    return {
      name: value.name as string,
      ok: false,
      latency_ms: value.latency_ms as number | null,
      failure: parseFailure(value.failure),
      repair: parseRepair(value.repair),
    }
  } catch (cause) {
    if (cause instanceof MarivoEnvironmentError) throw cause
    throw new MarivoEnvironmentError(
      'subprocess-output-invalid',
      'Marivo datasource test returned invalid failure or repair fields',
      { phase: 'test' },
      { cause },
    )
  }
}

/** Identity-checked adapter for Marivo datasource metadata and connection tests. */
export class MarivoDatasourceBridge {
  readonly binding: Readonly<MarivoEnvironmentBinding>
  readonly #runner: MarivoCheckedRunner

  constructor(runner: MarivoCheckedRunner) {
    this.#runner = runner
    this.binding = runner.binding
  }

  async authoring(signal?: AbortSignal): Promise<DatasourceAuthoring> {
    const result = await this.#runner.runChecked({
      program: DATASOURCE_AUTHORING_PROGRAM,
      stdin: JSON.stringify({ action: 'schema' }),
      limits: DATASOURCE_LIMITS,
      signal,
    })
    this.#assertSuccess(result, 'inventory')
    return datasourceAuthoringSchema.parse({
      ...parseJsonObject(result.stdout, 'inventory'),
      fingerprint: this.binding.fingerprint,
    })
  }

  async create(
    input: DatasourceCreateInput,
    signal?: AbortSignal,
  ): Promise<{ name?: string; error?: string }> {
    const refs = Object.entries(input.fields)
      .filter(([key]) => key.endsWith('_env'))
      .flatMap(([, value]) =>
        typeof value === 'string'
          ? [value]
          : value && typeof value === 'object' && !Array.isArray(value)
            ? Object.values(value)
            : [],
      )
    for (const ref of refs) {
      if (typeof ref !== 'string') return { error: 'datasource-credential-ref-invalid' }
      try {
        marivoCredentialStorageRef(ref)
      } catch (error) {
        if (
          error instanceof MarivoEnvironmentError &&
          error.code === 'datasource-credential-ref-invalid'
        )
          return { error: 'datasource-credential-ref-invalid' }
        throw error
      }
    }
    const result = await this.#runner.runChecked({
      program: DATASOURCE_AUTHORING_PROGRAM,
      stdin: JSON.stringify({ action: 'create', ...input, refs }),
      limits: DATASOURCE_LIMITS,
      signal,
    })
    this.#assertSuccess(result, 'inventory')
    const value = parseJsonObject(result.stdout, 'inventory')
    if (
      value.error === 'datasource-already-exists' ||
      value.error === 'datasource-definition-invalid'
    )
      return { error: value.error }
    if (typeof value.name !== 'string') throw new Error('Invalid datasource creation result')
    return { name: value.name }
  }

  async describe(name: string, signal?: AbortSignal): Promise<MarivoDatasourceDescription> {
    const result = await this.#runner.runChecked({
      program: MARIVO_DATASOURCE_DESCRIBE_PROGRAM,
      args: [name],
      limits: DATASOURCE_LIMITS,
      signal,
    })
    this.#assertSuccess(result, 'describe')
    return parseDescription(parseJsonObject(result.stdout, 'describe'), 'describe')
  }

  async inventory(signal?: AbortSignal): Promise<MarivoDatasourceDescription[]> {
    const result = await this.#runner.runChecked({
      program: MARIVO_DATASOURCE_INVENTORY_PROGRAM,
      limits: DATASOURCE_LIMITS,
      signal,
    })
    this.#assertSuccess(result, 'inventory')
    return parseInventory(result.stdout)
  }

  async test(
    description: Readonly<MarivoDatasourceDescription>,
    values: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<MarivoDatasourceTestResult> {
    const { name } = description
    const result = await this.#runner.runChecked({
      program: MARIVO_DATASOURCE_TEST_PROGRAM,
      args: [name],
      stdin: JSON.stringify({
        project_root: this.binding.projectRoot,
        grants: { [name]: description },
        values,
      }),
      secretValues: Object.values(values),
      limits: DATASOURCE_LIMITS,
      signal,
    })
    this.#assertSuccess(result, 'test')
    return parseTest(result.stdout, Object.values(values))
  }

  #assertSuccess(
    result: Awaited<ReturnType<MarivoCheckedRunner['runChecked']>>,
    phase: 'describe' | 'inventory' | 'test',
  ): void {
    if (result.exitCode === 0) return
    throw new MarivoEnvironmentError(
      'subprocess-failed',
      `Marivo datasource ${phase} failed with exit code ${String(result.exitCode)}`,
      { phase, exitCode: result.exitCode, stderr: result.stderr.toString('utf8').slice(0, 2_000) },
    )
  }
}

export function resolveMarivoDatasourceBridge(
  source: MarivoDatasourceBridgeSource,
): Promise<MarivoDatasourceBridgePort> {
  return resolveMarivoBridgeSource(source)
}

export function resolveMarivoDatasourceInventoryBridge(
  source: MarivoDatasourceInventoryBridgeSource,
): Promise<MarivoDatasourceInventoryBridge> {
  return resolveMarivoBridgeSource(source)
}
