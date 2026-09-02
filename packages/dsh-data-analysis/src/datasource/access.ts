import type { Context } from '@deepseek-ai/cordis'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import {
  type MarivoDatasourceBridgePort,
  type MarivoDatasourceBridgeSource,
  resolveMarivoDatasourceBridge,
} from './bridge.ts'
import { inspectMarivoDatasourceCredentials } from './credentials.ts'
import type { MarivoShellLeaseReceipt } from './shell-env.ts'

export const MARIVO_DATASOURCE_ACCESS_TOOL_NAME = 'marivo_datasource_access'

interface JsonObject {
  [key: string]: JsonValue
}

export type MarivoDatasourceAccessValue =
  | ({ status: 'needs-credentials'; name: string; refs: string[] } & JsonObject)
  | ({ status: 'ok'; name: string; shell_lease: MarivoShellLeaseReceipt } & JsonObject)

export interface MarivoDatasourceAccessOptions {
  revokeShellLease(bridge: MarivoDatasourceBridgePort, name: string): void
  issueShellLease(
    bridge: MarivoDatasourceBridgePort,
    name: string,
    refs: readonly string[],
  ): MarivoShellLeaseReceipt
}

function datasourceName(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 256) {
    throw new TypeError(
      'marivo_datasource_access name must be a non-empty string of at most 256 characters',
    )
  }
  return value
}

function renderValue(value: MarivoDatasourceAccessValue): string {
  if (value.status === 'needs-credentials') return JSON.stringify(value)
  return [
    `Marivo datasource ${value.name} foreground Shell access is ready for up to ${value.shell_lease.max_uses} executions within ${value.shell_lease.expires_in_ms} ms.`,
    'Reuse the matching exact prelude before each foreground analysis command.',
    `bash prelude:\n${value.shell_lease.bash_prelude}`,
    `pwsh prelude:\n${value.shell_lease.pwsh_prelude}`,
  ].join('\n')
}

/** Build the scoped datasource access Tool without performing a connection test. */
export function createMarivoDatasourceAccessTool(
  bridgeSource: MarivoDatasourceBridgeSource,
  credentials: Pick<CredentialProvider, 'resolve'>,
  options: MarivoDatasourceAccessOptions,
): ToolDefinition {
  return defineTool({
    name: MARIVO_DATASOURCE_ACCESS_TOOL_NAME,
    description:
      'Acquire bounded foreground Shell access for one configured Marivo datasource without testing its connection.',
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
        { type: 'text', text: renderValue(value as MarivoDatasourceAccessValue) },
      ],
    },
    async execute(args, exec): Promise<MarivoDatasourceAccessValue> {
      const name = datasourceName(args.name)
      const bridge = await resolveMarivoDatasourceBridge(bridgeSource)
      options.revokeShellLease(bridge, name)
      const described = await bridge.describe(name, exec.signal)
      const missing = await inspectMarivoDatasourceCredentials(
        described.refs,
        credentials,
        exec.signal,
      )
      if (missing.length > 0) {
        return { status: 'needs-credentials', name: described.name, refs: missing }
      }
      return {
        status: 'ok',
        name: described.name,
        shell_lease: options.issueShellLease(bridge, described.name, described.refs),
      }
    },
  })
}

export function registerMarivoDatasourceAccessTool(
  ctx: Context,
  bridgeSource: MarivoDatasourceBridgeSource,
  credentials: Pick<CredentialProvider, 'resolve'>,
  options: MarivoDatasourceAccessOptions,
): () => void {
  return ctx.tools.register(createMarivoDatasourceAccessTool(bridgeSource, credentials, options))
}
