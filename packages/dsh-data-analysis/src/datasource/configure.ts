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
      'Ask the user to create/select or edit a datasource in the owning Web session right tab. Waits until the user saves and tests successfully, cancels, or hands off a failure. Never pass credentials or configuration values. After success, rediscover the datasource and verify the requested table before analysis.',
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
