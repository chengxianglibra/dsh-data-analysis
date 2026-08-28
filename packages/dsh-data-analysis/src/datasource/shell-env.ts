import process from 'node:process'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  type CredentialProvider,
  credentialRef,
  isCredentialRefName,
} from '@deepseek-ai/dsh-credentials'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { type MarivoEnvironmentSource, resolveMarivoEnvironmentSource } from '../disclosure/help.ts'
import {
  MARIVO_PERSIST_CREDENTIALS_DISABLED,
  MARIVO_PERSIST_CREDENTIALS_ENV,
  type MarivoEnvironment,
  MarivoEnvironmentError,
} from '../environment/index.ts'

export const DSH_CREDENTIAL_REF_PATTERN = /^DSH_[A-Z][A-Z0-9_]*$/

const SHELL_TOOL_NAMES = new Set(['bash', 'pwsh'])
const INVENTORY_LIMITS = Object.freeze({
  timeoutMs: 30_000,
  stdoutMaxBytes: 262_144,
  stderrMaxBytes: 65_536,
})

type DshCredentialRefName = `DSH_${string}`

interface DatasourceReferences {
  name: string
  refs: string[]
}

interface WorkspaceReferences {
  initialized: boolean
  initializing?: Promise<void>
  byDatasource: Map<string, readonly DshCredentialRefName[]>
}

interface ShellCredentialSnapshot {
  resolvedCount: number
}

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

function invalidReference(ref: string): MarivoEnvironmentError {
  return new MarivoEnvironmentError(
    'datasource-credential-ref-invalid',
    `Marivo datasource credential reference must use the DSH_* namespace: ${ref}`,
    { ref, expected: 'DSH_[A-Z][A-Z0-9_]*' },
  )
}

function persistentShellUnsupported(name: string): MarivoEnvironmentError {
  return new MarivoEnvironmentError(
    'shell-credential-injection-unsupported',
    `The configured persistent ${name} tool cannot receive per-execution DSH datasource credentials; use a standard one-shot ${name} tool`,
    { tool: name, requiredCapability: 'ctx.shellEnv.collect(execution)' },
  )
}

function isHarnessPersistentShell(agent: Agent, name: string): boolean {
  const definition = agent.ctx.tools.get(name, agent)
  return definition?.output.schema.type === 'string'
}

export function assertDshCredentialReferences(
  refs: readonly string[],
): asserts refs is readonly DshCredentialRefName[] {
  for (const ref of refs) {
    if (!isCredentialRefName(ref) || !DSH_CREDENTIAL_REF_PATTERN.test(ref)) {
      throw invalidReference(ref)
    }
  }
}

function parseInventory(stdout: Buffer): DatasourceReferences[] {
  let value: unknown
  try {
    value = JSON.parse(stdout.toString('utf8'))
  } catch (cause) {
    throw new MarivoEnvironmentError(
      'subprocess-output-invalid',
      'Marivo datasource inventory returned invalid JSON',
      { stdoutBytes: stdout.byteLength },
      { cause },
    )
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    !Array.isArray((value as { datasources?: unknown }).datasources)
  ) {
    throw new MarivoEnvironmentError(
      'subprocess-output-invalid',
      'Marivo datasource inventory returned invalid fields',
      { phase: 'datasource-inventory' },
    )
  }
  const parsed: DatasourceReferences[] = []
  for (const item of (value as { datasources: unknown[] }).datasources) {
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof (item as { name?: unknown }).name !== 'string' ||
      !Array.isArray((item as { refs?: unknown }).refs) ||
      !(item as { refs: unknown[] }).refs.every(
        (ref) => typeof ref === 'string' && isCredentialRefName(ref),
      )
    ) {
      throw new MarivoEnvironmentError(
        'subprocess-output-invalid',
        'Marivo datasource inventory returned an invalid datasource entry',
        { phase: 'datasource-inventory' },
      )
    }
    parsed.push({
      name: (item as { name: string }).name,
      refs: (item as { refs: string[] }).refs,
    })
  }
  return parsed
}

/**
 * Cache non-secret datasource reference names and inject freshly resolved values
 * through the existing DSH_* Shell environment for each execution.
 */
export class MarivoShellCredentialBridge {
  readonly #ctx: Context
  readonly #credentials: Pick<CredentialProvider, 'resolve'>
  readonly #workspaces = new WeakMap<MarivoEnvironment, WorkspaceReferences>()
  readonly #executionValues = new WeakMap<
    ToolExecution,
    ReadonlyMap<DshCredentialRefName, string>
  >()
  readonly #contributors = new Map<DshCredentialRefName, () => void>()
  #disposed = false

  constructor(ctx: Context, credentials: Pick<CredentialProvider, 'resolve'>) {
    this.#ctx = ctx
    this.#credentials = credentials
  }

  #workspace(environment: MarivoEnvironment): WorkspaceReferences {
    let state = this.#workspaces.get(environment)
    if (state === undefined) {
      state = { initialized: false, byDatasource: new Map() }
      this.#workspaces.set(environment, state)
    }
    return state
  }

  #ensureContributor(ref: DshCredentialRefName): boolean {
    if (this.#disposed) return false
    if (this.#contributors.has(ref)) return true
    const dispose = shellEnvironmentRegistry(this.#ctx).register({
      name: `dsh-data-analysis:credential:${ref}`,
      variables: {
        [ref]: {
          description: 'Marivo datasource credential resolved by DSH for this Shell execution.',
        },
      },
      resolve: (execution) => {
        const value = this.#executionValues.get(execution)?.get(ref)
        return value === undefined ? {} : { [ref]: value }
      },
    })
    this.#contributors.set(ref, dispose)
    return true
  }

  /** Replace one datasource's non-secret reference-name projection. */
  recordDatasource(environment: MarivoEnvironment, name: string, refs: readonly string[]): void {
    if (this.#disposed) return
    assertDshCredentialReferences(refs)
    const deduplicated = [...new Set(refs)]
    for (const ref of deduplicated) this.#ensureContributor(ref)
    this.#workspace(environment).byDatasource.set(name, Object.freeze(deduplicated))
  }

  async #initialize(environment: MarivoEnvironment, signal: AbortSignal): Promise<void> {
    const state = this.#workspace(environment)
    if (state.initialized) return
    if (state.initializing !== undefined) return state.initializing
    state.initializing = (async () => {
      try {
        const result = await environment.runCheckedDatasourceInventory(INVENTORY_LIMITS, signal)
        if (this.#disposed) return
        if (result.exitCode !== 0) return
        for (const datasource of parseInventory(result.stdout)) {
          const accepted = datasource.refs.filter((ref): ref is DshCredentialRefName =>
            DSH_CREDENTIAL_REF_PATTERN.test(ref),
          )
          const deduplicated = [...new Set(accepted)]
          const registered: DshCredentialRefName[] = []
          for (const ref of deduplicated) {
            try {
              if (this.#ensureContributor(ref)) registered.push(ref)
            } catch {
              // A conflicting managed DSH_* fact stays unavailable to datasource injection.
            }
          }
          if (!state.byDatasource.has(datasource.name)) {
            state.byDatasource.set(datasource.name, Object.freeze(registered))
          }
        }
      } finally {
        state.initialized = true
        delete state.initializing
      }
    })()
    return state.initializing
  }

  /** Resolve a fresh credential snapshot for one Shell execution. */
  async prepareExecution(
    environmentSource: MarivoEnvironmentSource,
    execution: ToolExecution,
  ): Promise<ShellCredentialSnapshot> {
    process.env[MARIVO_PERSIST_CREDENTIALS_ENV] = MARIVO_PERSIST_CREDENTIALS_DISABLED
    const environment = await resolveMarivoEnvironmentSource(environmentSource)
    await this.#initialize(environment, execution.signal)
    const refs = new Set<DshCredentialRefName>()
    for (const datasourceRefs of this.#workspace(environment).byDatasource.values()) {
      for (const ref of datasourceRefs) refs.add(ref)
    }
    const values = new Map<DshCredentialRefName, string>()
    for (const ref of refs) {
      try {
        const resolved = await this.#credentials.resolve(credentialRef(ref))
        if (resolved !== undefined) values.set(ref, resolved.value)
      } catch {
        // Credential provider failures must not prevent Shell-based configuration repair.
      }
    }
    this.#executionValues.set(execution, values)
    return { resolvedCount: values.size }
  }

  /** Install per-execution preparation for one Agent scope. */
  installAgent(agent: Agent, environmentSource: MarivoEnvironmentSource): () => void {
    return agent.ctx.on('tools/pre-execute', async (execution, next) => {
      if (execution.agent === agent && SHELL_TOOL_NAMES.has(execution.name)) {
        let snapshot: ShellCredentialSnapshot | undefined
        try {
          snapshot = await this.prepareExecution(environmentSource, execution)
        } catch {
          // Inventory/binding failures remain fail-open so the Shell can repair the Workspace.
        }
        if (
          snapshot !== undefined &&
          snapshot.resolvedCount > 0 &&
          isHarnessPersistentShell(agent, execution.name)
        ) {
          throw persistentShellUnsupported(execution.name)
        }
      }
      return next()
    })
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    for (const dispose of this.#contributors.values()) dispose()
    this.#contributors.clear()
  }
}
