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
      'Open Host-managed datasource setup or repair. Use create to create/select a datasource and edit for an existing exact name. Supply a non-secret reason, never connection configuration or credential values. A Web root Agent waits for save and connection test; delegated or noninteractive calls return needs-configuration without opening a form. Follow the returned handoff. Continue only after status=ok, then rediscover the datasource and verify required table and read access. Success already includes a connection test. Local files need no remote setup.',
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
