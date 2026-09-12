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
      'When a requested remote table has no usable configured datasource, use mode=create to let the user create/select one; repair connection configuration with mode=edit and its exact name. The user configures it in the owning Web session right tab; never write connection configuration on their behalf or pass credentials or configuration values. Waits for successful save and connection test, cancellation or failure. Only status=ok permits continuation: rediscover the datasource and verify the requested table and read access before analysis. Success already includes a connection test; do not repeat it unless configuration or credentials change, a connection fails, or the user requests one. Local files need no remote datasource setup.',
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
