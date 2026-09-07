import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
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
      'Test a Marivo datasource through Host credentials. Missing credentials wait for the Web form while this call remains alive; configured connection failures return directly.',
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
): () => void {
  return ctx.tools.register(createMarivoDatasourceTestTool(source, service))
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
