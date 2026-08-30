import type { Context } from '@deepseek-ai/cordis'
import { type CredentialProvider, credentialRef } from '@deepseek-ai/dsh-credentials'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import {
  type MarivoDatasourceBridgePort,
  type MarivoDatasourceBridgeSource,
  type MarivoDatasourceFailure,
  type MarivoDatasourceRepair,
  resolveMarivoDatasourceBridge,
} from './bridge.ts'
import { assertDshCredentialReferences } from './shell-env.ts'

export const MARIVO_TEST_TOOL_NAME = 'marivo_test'

interface JsonObject {
  [key: string]: JsonValue
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

export interface MarivoTestOptions {
  /** Observe the validated non-secret datasource reference-name projection. */
  onDescribe?: (bridge: MarivoDatasourceBridgePort, name: string, refs: readonly string[]) => void
}

function datasourceName(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 256) {
    throw new TypeError('marivo_test name must be a non-empty string of at most 256 characters')
  }
  return value
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
  bridgeSource: MarivoDatasourceBridgeSource,
  credentials: Pick<CredentialProvider, 'resolve'>,
  options: MarivoTestOptions = {},
): ToolDefinition {
  return defineTool({
    name: MARIVO_TEST_TOOL_NAME,
    description:
      'Test one configured Marivo datasource connection. Missing datasource environment references are requested through the DSH credential service.',
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
      const bridge = await resolveMarivoDatasourceBridge(bridgeSource)
      const described = await bridge.describe(name, exec.signal)
      assertDshCredentialReferences(described.refs)
      options.onDescribe?.(bridge, described.name, described.refs)
      const overlay: NodeJS.ProcessEnv = {}
      const missing: string[] = []
      for (const refName of described.refs) {
        const resolved = await credentials.resolve(credentialRef(refName))
        if (resolved === undefined) {
          missing.push(refName)
          continue
        }
        overlay[refName] = resolved.value
      }
      if (missing.length > 0)
        return { status: 'needs-credentials', name: described.name, refs: missing }

      const tested = await bridge.test(name, overlay, exec.signal)
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
  bridgeSource: MarivoDatasourceBridgeSource,
  credentials: Pick<CredentialProvider, 'resolve'>,
  options: MarivoTestOptions = {},
): () => void {
  return ctx.tools.register(createMarivoTestTool(bridgeSource, credentials, options))
}
