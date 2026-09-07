import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { type MarivoDatasourceBridgeSource, resolveMarivoDatasourceBridge } from './bridge.ts'
import type { MarivoCredentialService } from './service.ts'
import { datasourceToolValue } from './test.ts'

export const MARIVO_DATASOURCE_ACCESS_TOOL_NAME = 'marivo_datasource_access'
export function createMarivoDatasourceAccessTool(
  source: MarivoDatasourceBridgeSource,
  service: MarivoCredentialService,
): ToolDefinition {
  return defineTool({
    name: MARIVO_DATASOURCE_ACCESS_TOOL_NAME,
    description:
      'Authorize up to 64 foreground marivo_python executions for one datasource within 30 minutes. Does not test already-configured credentials. No secret is returned or injected into ordinary Shell.',
    parameters: {
      name: { type: 'string', required: true, description: 'Configured datasource name.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      if (!args.name.trim() || args.name.length > 256) throw new Error('Invalid datasource name')
      return datasourceToolValue(
        await service.track(
          service.prepare('access', exec, () => resolveMarivoDatasourceBridge(source), args.name),
        ),
      )
    },
  })
}
export function registerMarivoDatasourceAccessTool(
  ctx: Context,
  source: MarivoDatasourceBridgeSource,
  service: MarivoCredentialService,
): () => void {
  return ctx.tools.register(createMarivoDatasourceAccessTool(source, service))
}
