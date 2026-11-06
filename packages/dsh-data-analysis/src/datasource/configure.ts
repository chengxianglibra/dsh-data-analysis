import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { registerMarivoTool } from '../tool-lifecycle.ts'
import { type MarivoDatasourceBridgeSource, resolveMarivoDatasourceBridge } from './bridge.ts'
import type { MarivoCredentialService } from './service.ts'

export const MARIVO_DATASOURCE_CONFIGURE_TOOL_NAME = 'marivo_datasource_configure'
export function createMarivoDatasourceConfigureTool(
  source: MarivoDatasourceBridgeSource,
  service: MarivoCredentialService,
): ToolDefinition {
  return defineTool({
    name: MARIVO_DATASOURCE_CONFIGURE_TOOL_NAME,
    description:
      "Request Host connection setup: mode=create lets the user create/select a datasource; mode=edit repairs its exact name. Never author connection configuration on the user's behalf or pass configuration/credential values. A Web root Agent waits for save and connection test; delegated or noninteractive calls return needs-configuration with handoff guidance and open no form. Only status=ok permits continuation: rediscover the datasource and verify the requested table and read access. Success already tested the connection; repeat only after changes, failures or an explicit request. Local files need no remote setup.",
    parameters: {
      mode: {
        type: 'string',
        required: true,
        description:
          'create (also permits choosing an existing datasource) or edit (fixed name and engine).',
      },
      name: { type: 'string', description: 'Existing datasource name, required only for edit.' },
      reason: {
        type: 'string',
        required: true,
        description: 'Brief reason for configuration, at most 1000 characters. No secrets.',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      if (args.mode !== 'create' && args.mode !== 'edit')
        throw new Error('Invalid configuration mode')
      return JSON.parse(
        JSON.stringify(
          await service.track(
            service.configure(exec, () => resolveMarivoDatasourceBridge(source), {
              mode: args.mode,
              name: args.name,
              reason: args.reason,
            }),
          ),
        ),
      )
    },
  })
}
export function registerMarivoDatasourceConfigureTool(
  ctx: Context,
  source: MarivoDatasourceBridgeSource,
  service: MarivoCredentialService,
): () => Promise<void> {
  return registerMarivoTool(ctx, createMarivoDatasourceConfigureTool(source, service))
}
