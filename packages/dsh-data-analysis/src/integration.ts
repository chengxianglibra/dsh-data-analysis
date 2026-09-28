import type { ManagedCredentialDefaults } from './datasource/defaults.ts'
import type { CredentialStore } from './datasource/service.ts'
import type { MarivoEnvironment } from './environment/index.ts'

/** Public extension seam. The version denotes this shape, not a specific consumer. */
export const INTEGRATION_CONTRACT_VERSION = 'dsh-data-analysis-integration/v1' as const

export interface MarivoIntegrationV1 {
  /** Runs once after a Workspace binds, before its environment is returned. */
  readonly onWorkspaceBound?: (environment: MarivoEnvironment) => Promise<void>
  /** Harness-managed store used only by datasource operations. */
  readonly datasourceCredentials?: CredentialStore
  /** Credential reference names, validated against the live Workspace Runtime schema. */
  readonly managedCredentialDefaults?: ManagedCredentialDefaults
}

export { withDatasourceDefaults } from './datasource/defaults.ts'
export { applyWithIntegration } from './plugin.ts'
export { registerPluginRpc } from './rpc.ts'
