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
import {
  assertDshCredentialReferences,
  MARIVO_CREDENTIAL_GRANT_PREFIX,
  type MarivoShellGrantReceipt,
} from './shell-env.ts'

export const MARIVO_DATASOURCE_TEST_TOOL_NAME = 'marivo_datasource_test'

interface JsonObject {
  [key: string]: JsonValue
}

export type MarivoDatasourceTestValue =
  | ({ status: 'needs-credentials'; name: string; refs: string[] } & JsonObject)
  | ({
      status: 'ok'
      name: string
      latency_ms: number | null
      shell_grant: MarivoShellGrantReceipt
    } & JsonObject)
  | ({
      status: 'failed'
      name: string
      latency_ms: number | null
      failure: MarivoDatasourceFailure
      repair: MarivoDatasourceRepair
    } & JsonObject)

export interface MarivoDatasourceTestOptions {
  /** Issue the one-shot capability only after the real connection test succeeds. */
  issueShellGrant(
    bridge: MarivoDatasourceBridgePort,
    name: string,
    refs: readonly string[],
  ): MarivoShellGrantReceipt
}

function datasourceName(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 256) {
    throw new TypeError(
      'marivo_datasource_test name must be a non-empty string of at most 256 characters',
    )
  }
  return value
}

function renderValue(value: MarivoDatasourceTestValue): string {
  if (value.status === 'needs-credentials') return JSON.stringify(value)
  if (value.status === 'ok') {
    return [
      `Marivo datasource ${value.name} connection test succeeded${value.latency_ms === null ? '' : ` in ${value.latency_ms} ms`}.`,
      `One-shot foreground Shell grant: ${value.shell_grant.token} (expires in ${value.shell_grant.expires_in_ms} ms).`,
      `Use this exact first command line: ${MARIVO_CREDENTIAL_GRANT_PREFIX}${value.shell_grant.token}`,
    ].join('\n')
  }
  return JSON.stringify(value)
}

/** Build the scoped datasource connection-test Tool. */
export function createMarivoDatasourceTestTool(
  bridgeSource: MarivoDatasourceBridgeSource,
  credentials: Pick<CredentialProvider, 'resolve'>,
  options: MarivoDatasourceTestOptions,
): ToolDefinition {
  return defineTool({
    name: MARIVO_DATASOURCE_TEST_TOOL_NAME,
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
      render: (_args, value) => [
        { type: 'text', text: renderValue(value as MarivoDatasourceTestValue) },
      ],
    },
    timeoutMs: 65_000,
    async execute(args, exec): Promise<MarivoDatasourceTestValue> {
      const name = datasourceName(args.name)
      const bridge = await resolveMarivoDatasourceBridge(bridgeSource)
      const described = await bridge.describe(name, exec.signal)
      assertDshCredentialReferences(described.refs)
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
      if (tested.ok) {
        return {
          status: 'ok',
          name: tested.name,
          latency_ms: tested.latency_ms,
          shell_grant: options.issueShellGrant(bridge, tested.name, described.refs),
        }
      }
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

export function registerMarivoDatasourceTestTool(
  ctx: Context,
  bridgeSource: MarivoDatasourceBridgeSource,
  credentials: Pick<CredentialProvider, 'resolve'>,
  options: MarivoDatasourceTestOptions,
): () => void {
  return ctx.tools.register(createMarivoDatasourceTestTool(bridgeSource, credentials, options))
}
