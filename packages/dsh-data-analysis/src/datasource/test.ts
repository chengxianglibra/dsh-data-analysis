import type { Context } from '@deepseek-ai/cordis'
import {
  credentialRef,
  isCredentialRefName,
  type CredentialProvider,
} from '@deepseek-ai/dsh-credentials'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { MarivoEnvironmentError } from '../environment/errors.ts'
import {
  resolveMarivoEnvironmentSource,
  type MarivoEnvironmentSource,
} from '../disclosure/help.ts'
import { assertDshCredentialReferences } from './shell-env.ts'

export const MARIVO_TEST_TOOL_NAME = 'marivo_test'

const DATASOURCE_LIMITS = Object.freeze({
  timeoutMs: 30_000,
  stdoutMaxBytes: 262_144,
  stderrMaxBytes: 65_536,
})

interface JsonObject {
  [key: string]: JsonValue
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
  help_target: string
  action: string
  snippet: string | null
  candidates: string[]
  preserves_evidence: boolean | null
}

export type MarivoTestValue =
  | ({ status: 'needs-credentials'; name: string; refs: string[] } & JsonObject)
  | ({ status: 'ok'; name: string; latency_ms: number | null } & JsonObject)
  | ({
      status: 'failed'
      name: string
      latency_ms: number | null
      failure: MarivoDatasourceFailure
      repair: MarivoDatasourceRepair
    } & JsonObject)

interface DescribePayload {
  name: string
  refs: string[]
}

interface TestPayload {
  name: string
  ok: boolean
  latency_ms: number | null
  failure: MarivoDatasourceFailure | null
  repair: MarivoDatasourceRepair | null
}

export interface MarivoTestOptions {
  /** Observe the validated non-secret datasource reference-name projection. */
  onDescribe?: (
    environment: Awaited<ReturnType<typeof resolveMarivoEnvironmentSource>>,
    name: string,
    refs: readonly string[],
  ) => void
}

function datasourceName(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 256) {
    throw new TypeError('marivo_test name must be a non-empty string of at most 256 characters')
  }
  return value
}

function parseJsonObject(stdout: Buffer, phase: 'describe' | 'test'): Record<string, unknown> {
  try {
    const parsed = JSON.parse(stdout.toString('utf8')) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new TypeError('payload must be an object')
    }
    return parsed as Record<string, unknown>
  } catch {
    throw new MarivoEnvironmentError(
      'subprocess-output-invalid',
      `Marivo datasource ${phase} returned an invalid payload`,
      { phase, stdoutBytes: stdout.byteLength },
    )
  }
}

function parseDescribe(stdout: Buffer): DescribePayload {
  const value = parseJsonObject(stdout, 'describe')
  if (typeof value.name !== 'string' || !Array.isArray(value.refs)) {
    throw new MarivoEnvironmentError(
      'subprocess-output-invalid',
      'Marivo datasource describe returned invalid fields',
      { phase: 'describe' },
    )
  }
  const refs: string[] = []
  const seen = new Set<string>()
  for (const ref of value.refs) {
    if (typeof ref !== 'string' || !isCredentialRefName(ref)) {
      throw new MarivoEnvironmentError(
        'subprocess-output-invalid',
        'Marivo datasource describe returned an invalid credential reference',
        { phase: 'describe' },
      )
    }
    if (!seen.has(ref)) {
      seen.add(ref)
      refs.push(ref)
    }
  }
  return { name: value.name, refs }
}

function redactString(value: string, secrets: readonly string[]): string {
  let redacted = value
  for (const secret of secrets) {
    if (secret !== '') redacted = redacted.split(secret).join('[REDACTED]')
  }
  return redacted
}

function redactUnknown(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === 'string') return redactString(value, secrets)
  if (Array.isArray(value)) return value.map(item => redactUnknown(item, secrets))
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, redactUnknown(item, secrets)]),
  )
}

function parseTest(stdout: Buffer, secrets: readonly string[]): TestPayload {
  const value = redactUnknown(parseJsonObject(stdout, 'test'), secrets) as Record<string, unknown>
  if (
    typeof value.name !== 'string'
    || typeof value.ok !== 'boolean'
    || (value.latency_ms !== null && typeof value.latency_ms !== 'number')
  ) {
    throw new MarivoEnvironmentError(
      'subprocess-output-invalid',
      `Marivo datasource test returned invalid fields (name=${typeof value.name}, ok=${typeof value.ok}, latency=${value.latency_ms === null ? 'null' : typeof value.latency_ms})`,
      { phase: 'test' },
    )
  }
  if (value.ok) return { name: value.name, ok: true, latency_ms: value.latency_ms as number | null, failure: null, repair: null }
  if (typeof value.failure !== 'object' || value.failure === null || typeof value.repair !== 'object' || value.repair === null) {
    throw new MarivoEnvironmentError(
      'subprocess-output-invalid',
      'Marivo datasource test failure omitted structured failure or repair',
      { phase: 'test' },
    )
  }
  return value as unknown as TestPayload
}

function renderValue(value: MarivoTestValue): string {
  if (value.status === 'needs-credentials') return JSON.stringify(value)
  if (value.status === 'ok') {
    return `Marivo datasource ${value.name} connection test succeeded${value.latency_ms === null ? '' : ` in ${value.latency_ms} ms`}.`
  }
  return JSON.stringify(value)
}

/** Build the scoped datasource connection-test Tool. */
export function createMarivoTestTool(
  environmentSource: MarivoEnvironmentSource,
  credentials: Pick<CredentialProvider, 'resolve'>,
  options: MarivoTestOptions = {},
): ToolDefinition {
  return defineTool({
    name: MARIVO_TEST_TOOL_NAME,
    description: 'Test one configured Marivo datasource connection. Missing datasource environment references are requested through the DSH credential service.',
    parameters: {
      name: {
        type: 'string',
        required: true,
        description: 'Configured Marivo datasource name.',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: renderValue(value as MarivoTestValue) }],
    },
    timeoutMs: 65_000,
    async execute(args, exec): Promise<MarivoTestValue> {
      const name = datasourceName(args.name)
      const environment = await resolveMarivoEnvironmentSource(environmentSource)
      const describedResult = await environment.runCheckedDatasourceDescribe(
        name,
        DATASOURCE_LIMITS,
        exec.signal,
      )
      if (describedResult.exitCode !== 0) {
        throw new MarivoEnvironmentError(
          'subprocess-failed',
          `Marivo datasource describe failed with exit code ${String(describedResult.exitCode)}`,
          { phase: 'describe', exitCode: describedResult.exitCode },
        )
      }
      const described = parseDescribe(describedResult.stdout)
      assertDshCredentialReferences(described.refs)
      options.onDescribe?.(environment, described.name, described.refs)
      const overlay: NodeJS.ProcessEnv = {}
      const missing: string[] = []
      const values: string[] = []
      for (const refName of described.refs) {
        const resolved = await credentials.resolve(credentialRef(refName))
        if (resolved === undefined) {
          missing.push(refName)
          continue
        }
        overlay[refName] = resolved.value
        values.push(resolved.value)
      }
      if (missing.length > 0) return { status: 'needs-credentials', name: described.name, refs: missing }

      const testedResult = await environment.runCheckedDatasourceTest(
        name,
        overlay,
        DATASOURCE_LIMITS,
        exec.signal,
      )
      if (testedResult.exitCode !== 0) {
        throw new MarivoEnvironmentError(
          'subprocess-failed',
          `Marivo datasource test failed with exit code ${String(testedResult.exitCode)}`,
          { phase: 'test', exitCode: testedResult.exitCode },
        )
      }
      const tested = parseTest(testedResult.stdout, values)
      if (tested.ok) return { status: 'ok', name: tested.name, latency_ms: tested.latency_ms }
      return {
        status: 'failed',
        name: tested.name,
        latency_ms: tested.latency_ms,
        failure: tested.failure as MarivoDatasourceFailure,
        repair: tested.repair as MarivoDatasourceRepair,
      }
    },
  })
}

export function registerMarivoTestTool(
  ctx: Context,
  environmentSource: MarivoEnvironmentSource,
  credentials: Pick<CredentialProvider, 'resolve'>,
  options: MarivoTestOptions = {},
): () => void {
  return ctx.tools.register(createMarivoTestTool(environmentSource, credentials, options))
}
