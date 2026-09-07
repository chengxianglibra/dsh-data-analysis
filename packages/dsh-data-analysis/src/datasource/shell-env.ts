import type { Context } from '@deepseek-ai/cordis'
import { isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { MarivoEnvironmentError } from '../environment/index.ts'

export const MARIVO_CREDENTIAL_STORAGE_PREFIX = 'DSH_DATA_ANALYSIS_CREDENTIAL_'
const HOST_SHELL_ENVIRONMENT_NAMES = new Set([
  'DSH_HOME',
  'DSH_SESSION_ID',
  'DSH_SESSION_JSONL',
  'DSH_SHELL',
])
type DshCredentialRefName = `DSH_${string}`
type MarivoCredentialStorageRefName = `DSH_DATA_ANALYSIS_CREDENTIAL_${string}`

interface ShellEnvironmentRegistry {
  register(contributor: {
    name: string
    variables: Readonly<Record<DshCredentialRefName, { description: string }>>
    resolve(execution: ToolExecution): Readonly<Partial<Record<DshCredentialRefName, string>>>
  }): () => void
}

function shellEnvironmentRegistry(ctx: Context): ShellEnvironmentRegistry {
  return (ctx as unknown as { shellEnv: ShellEnvironmentRegistry }).shellEnv
}

/** Publish the exact shared interpreter as a non-secret, per-execution DSH fact. */
export function registerMarivoRuntimeShellEnvironment(
  ctx: Context,
  pythonExecutable: string,
): () => void {
  return shellEnvironmentRegistry(ctx).register({
    name: 'dsh-data-analysis:runtime',
    variables: {
      DSH_DATA_ANALYSIS_PYTHON: {
        description: 'Exact Python interpreter admitted by the shared Marivo Runtime.',
      },
    },
    resolve: () => ({ DSH_DATA_ANALYSIS_PYTHON: pythonExecutable }),
  })
}

function invalidReference(ref: string): MarivoEnvironmentError {
  const valid = isCredentialRefName(ref)
  return new MarivoEnvironmentError(
    'datasource-credential-ref-invalid',
    valid
      ? `Marivo datasource credential reference uses a reserved runtime namespace or Host name: ${ref}`
      : `Marivo datasource credential reference must be a POSIX environment name: ${ref}`,
    {
      ref,
      expected: valid
        ? 'a POSIX environment name outside MARIVO_*, DSH_DATA_ANALYSIS_*, and Host-owned DSH shell facts'
        : '[A-Za-z_][A-Za-z0-9_]*',
    },
  )
}

function isReservedDatasourceCredentialReference(ref: string): boolean {
  const upper = ref.toUpperCase()
  return (
    upper.startsWith('MARIVO_') ||
    upper.startsWith('DSH_DATA_ANALYSIS_') ||
    HOST_SHELL_ENVIRONMENT_NAMES.has(upper)
  )
}

/** Map one user-authored datasource environment reference to plugin-owned DSH storage. */
export function marivoCredentialStorageRef(ref: string): MarivoCredentialStorageRefName {
  if (!isCredentialRefName(ref) || isReservedDatasourceCredentialReference(ref)) {
    throw invalidReference(ref)
  }
  const encoded = [...ref]
    .map((character) => character.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase())
    .join('')
  return `${MARIVO_CREDENTIAL_STORAGE_PREFIX}${encoded}`
}

export function assertMarivoCredentialReferences(refs: readonly string[]): void {
  for (const ref of refs) marivoCredentialStorageRef(ref)
}
