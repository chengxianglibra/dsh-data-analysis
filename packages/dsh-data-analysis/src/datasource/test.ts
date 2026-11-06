import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { registerMarivoTool } from '../tool-lifecycle.ts'
import { type MarivoDatasourceBridgeSource, resolveMarivoDatasourceBridge } from './bridge.ts'
import type { MarivoCredentialService } from './service.ts'

export const MARIVO_DATASOURCE_TEST_TOOL_NAME = 'marivo_datasource_test'
export function createMarivoDatasourceTestTool(
  source: MarivoDatasourceBridgeSource,
  service: MarivoCredentialService,
): ToolDefinition {
  return defineTool({
    name: MARIVO_DATASOURCE_TEST_TOOL_NAME,
    description:
      'Test a Marivo datasource through Host credentials after changes, connection failures or explicit requests. Normal analysis needs no preliminary test; successful marivo_datasource_configure already tested the connection. A Web root Agent waits for missing credentials while this call is alive; delegated or noninteractive calls return needs-credentials with handoff guidance and open no form. Configured failures return directly. Only status=ok proves this connection test succeeded; verify table and read access separately.',
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
          service.prepare('test', exec, () => resolveMarivoDatasourceBridge(source), args.name),
        ),
      )
    },
  })
}
export function registerMarivoDatasourceTestTool(
  ctx: Context,
  source: MarivoDatasourceBridgeSource,
  service: MarivoCredentialService,
): () => Promise<void> {
  return registerMarivoTool(ctx, createMarivoDatasourceTestTool(source, service))
}

/** Preserve the datasource tools' public status family; raw Marivo results stay inside the service. */
export function datasourceToolValue(
  result: Awaited<ReturnType<MarivoCredentialService['prepare']>>,
) {
  if (!('ok' in result)) return JSON.parse(JSON.stringify(result))
  return JSON.parse(
    JSON.stringify(
      result.ok
        ? { status: 'ok', name: result.name, latency_ms: result.latency_ms }
        : {
            status: 'failed',
            name: result.name,
            latency_ms: result.latency_ms,
            failure: result.failure,
            repair: result.repair,
          },
    ),
  )
}
