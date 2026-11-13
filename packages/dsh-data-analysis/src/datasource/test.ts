import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { MarivoEnvironmentError } from '../environment/errors.ts'
import { PythonOperationError } from '../python-exception.ts'
import { registerMarivoTool } from '../tool-lifecycle.ts'
import { type MarivoDatasourceBridgeSource, resolveMarivoDatasourceBridge } from './bridge.ts'
import type { MarivoCredentialService } from './service.ts'
import { CredentialServiceError, credentialRecovery } from './service.ts'

export const MARIVO_DATASOURCE_TEST_TOOL_NAME = 'marivo_datasource_test'
export function createMarivoDatasourceTestTool(
  source: MarivoDatasourceBridgeSource,
  service: MarivoCredentialService,
): ToolDefinition {
  return defineTool({
    name: MARIVO_DATASOURCE_TEST_TOOL_NAME,
    description:
      'Test an existing datasource through Host-managed credentials after a relevant change, connection failure or explicit request. Normal analysis needs no preliminary test. status=ok establishes connection-test success, not table access or analytical readiness. A Web root Agent can wait for missing credentials; delegated or noninteractive calls return needs-credentials without a form. Follow the returned failure or handoff information; never request secret values in chat.',
    parameters: {
      name: { type: 'string', required: true, description: 'Configured datasource name.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      if (!args.name.trim() || args.name.length > 256) throw new Error('Invalid datasource name')
      try {
        return datasourceToolValue(
          await service.track(
            service.prepare('test', exec, () => resolveMarivoDatasourceBridge(source), args.name),
          ),
        )
      } catch (error) {
        exec.signal.throwIfAborted()
        const code =
          error instanceof CredentialServiceError || error instanceof MarivoEnvironmentError
            ? error.code
            : 'datasource-test-failed'
        const exception = error instanceof PythonOperationError ? error.diagnostic : undefined
        const nextAction =
          exception?.repair?.action ??
          credentialRecovery(code) ??
          (code === 'subprocess-timeout'
            ? 'Check the datasource or Runtime response before retrying the connection test.'
            : 'Confirm the datasource in the current Workspace and check its Runtime and credential references.')
        throw new Error(
          `${code}; error=${JSON.stringify({ code, phase: 'datasource-test', ...(exception ? { exception } : {}), recovery: { nextAction } })}`,
        )
      }
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
