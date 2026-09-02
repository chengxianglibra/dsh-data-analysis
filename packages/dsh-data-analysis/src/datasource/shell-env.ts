import { randomBytes } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  type CredentialProvider,
  credentialRef,
  isCredentialRefName,
} from '@deepseek-ai/dsh-credentials'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { MarivoEnvironmentError } from '../environment/index.ts'
import {
  type MarivoDatasourceBridgePort,
  type MarivoDatasourceBridgeSource,
  resolveMarivoDatasourceBridge,
} from './bridge.ts'

export const MARIVO_CREDENTIAL_STORAGE_PREFIX = 'DSH_DATA_ANALYSIS_CREDENTIAL_'
export const MARIVO_CREDENTIAL_LEASE_PREFIX = '# dsh-marivo-credential-lease:'
export const DEFAULT_MARIVO_CREDENTIAL_LEASE_TTL_MS = 30 * 60_000
export const DEFAULT_MARIVO_CREDENTIAL_LEASE_MAX_USES = 64

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
const SHELL_TOOL_NAMES = new Set(['bash', 'pwsh'])
const HOST_SHELL_ENVIRONMENT_NAMES = new Set([
  'DSH_HOME',
  'DSH_SESSION_ID',
  'DSH_SESSION_JSONL',
  'DSH_SHELL',
])
type DshCredentialRefName = `DSH_${string}`
type MarivoCredentialStorageRefName = `DSH_DATA_ANALYSIS_CREDENTIAL_${string}`

interface MarivoCredentialBinding {
  environmentRef: string
  storageRef: MarivoCredentialStorageRefName
}

export interface MarivoShellLeaseReceipt {
  [key: string]: string | number
  token: string
  expires_in_ms: number
  max_uses: number
  usage: 'bounded-foreground-shell-lease'
  bash_prelude: string
  pwsh_prelude: string
}

interface PendingLease {
  agent: Agent
  workspaceFingerprint: string
  datasourceName: string
  bindings: readonly MarivoCredentialBinding[]
  expiresAt: number
  remainingUses: number
}

interface ExecutionSnapshot {
  agent: Agent
  values: ReadonlyMap<DshCredentialRefName, string>
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

function credentialBindings(refs: readonly string[]): readonly MarivoCredentialBinding[] {
  return Object.freeze(
    [...new Set(refs)].map((environmentRef) => ({
      environmentRef,
      storageRef: marivoCredentialStorageRef(environmentRef),
    })),
  )
}

function bashPrelude(token: string, bindings: readonly MarivoCredentialBinding[]): string {
  return [
    `${MARIVO_CREDENTIAL_LEASE_PREFIX}${token}`,
    ...bindings.flatMap(({ environmentRef, storageRef }) => [
      `export ${environmentRef}="\${${storageRef}}"`,
      `unset ${storageRef}`,
    ]),
    'export MARIVO_PERSIST_CREDENTIALS=0',
  ].join('\n')
}

function pwshPrelude(token: string, bindings: readonly MarivoCredentialBinding[]): string {
  return [
    `${MARIVO_CREDENTIAL_LEASE_PREFIX}${token}`,
    ...bindings.flatMap(({ environmentRef, storageRef }) => [
      `$env:${environmentRef} = $env:${storageRef}`,
      `Remove-Item Env:${storageRef}`,
    ]),
    "$env:MARIVO_PERSIST_CREDENTIALS = '0'",
  ].join('\n')
}

function leaseFailure(
  code:
    | 'shell-credential-lease-invalid'
    | 'shell-credential-lease-expired'
    | 'shell-credential-lease-exhausted'
    | 'shell-credential-lease-scope-mismatch'
    | 'shell-credential-injection-unsupported'
    | 'shell-credential-lease-resolve-failed',
  message: string,
  details: Readonly<Record<string, unknown>> = {},
): MarivoEnvironmentError {
  return new MarivoEnvironmentError(code, message, details)
}

function commandArguments(execution: ToolExecution): Record<string, unknown> | undefined {
  return typeof execution.arguments === 'object' &&
    execution.arguments !== null &&
    !Array.isArray(execution.arguments)
    ? (execution.arguments as Record<string, unknown>)
    : undefined
}

function leaseToken(execution: ToolExecution): string | undefined {
  const command = commandArguments(execution)?.command
  if (typeof command !== 'string') return undefined
  const firstLine = command.split(/\r?\n/, 1)[0] ?? ''
  const candidate = firstLine.startsWith(MARIVO_CREDENTIAL_LEASE_PREFIX)
    ? firstLine.slice(MARIVO_CREDENTIAL_LEASE_PREFIX.length)
    : undefined
  if (candidate !== undefined && TOKEN_PATTERN.test(candidate)) return candidate
  if (firstLine.includes('dsh-marivo-credential-')) {
    throw leaseFailure(
      'shell-credential-lease-invalid',
      'Marivo shell credential lease marker is malformed or unsupported',
    )
  }
  return undefined
}

function isHarnessPersistentShell(agent: Agent, name: string): boolean {
  const definition = agent.ctx.tools.get(name, agent)
  return definition?.output.schema.type === 'string'
}

export function assertMarivoCredentialReferences(refs: readonly string[]): void {
  for (const ref of refs) {
    marivoCredentialStorageRef(ref)
  }
}

/** Own bounded leases and expose credential values only to each admitted Shell execution. */
export class MarivoShellCredentialLeases {
  readonly #ctx: Context
  readonly #credentials: Pick<CredentialProvider, 'resolve'>
  readonly #ttlMs: number
  readonly #maxUses: number
  readonly #leases = new Map<string, PendingLease>()
  readonly #executionValues = new Map<ToolExecution, ExecutionSnapshot>()
  readonly #contributors = new Map<DshCredentialRefName, () => void>()
  #disposed = false

  constructor(
    ctx: Context,
    credentials: Pick<CredentialProvider, 'resolve'>,
    options: { ttlMs?: number; maxUses?: number } = {},
  ) {
    const ttlMs = options.ttlMs ?? DEFAULT_MARIVO_CREDENTIAL_LEASE_TTL_MS
    const maxUses = options.maxUses ?? DEFAULT_MARIVO_CREDENTIAL_LEASE_MAX_USES
    if (
      !Number.isSafeInteger(ttlMs) ||
      ttlMs < 1 ||
      ttlMs > DEFAULT_MARIVO_CREDENTIAL_LEASE_TTL_MS
    ) {
      throw new TypeError(
        `Marivo shell credential lease ttlMs must be an integer from 1 to ${DEFAULT_MARIVO_CREDENTIAL_LEASE_TTL_MS}`,
      )
    }
    if (
      !Number.isSafeInteger(maxUses) ||
      maxUses < 1 ||
      maxUses > DEFAULT_MARIVO_CREDENTIAL_LEASE_MAX_USES
    ) {
      throw new TypeError(
        `Marivo shell credential lease maxUses must be an integer from 1 to ${DEFAULT_MARIVO_CREDENTIAL_LEASE_MAX_USES}`,
      )
    }
    this.#ctx = ctx
    this.#credentials = credentials
    this.#ttlMs = ttlMs
    this.#maxUses = maxUses
  }

  #ensureContributor(ref: DshCredentialRefName): void {
    if (this.#disposed) throw new Error('Marivo shell credential leases are disposed')
    if (this.#contributors.has(ref)) return
    const dispose = shellEnvironmentRegistry(this.#ctx).register({
      name: `dsh-data-analysis:credential:${ref}`,
      variables: {
        [ref]: {
          description: 'Marivo datasource credential authorized for this Shell execution.',
        },
      },
      resolve: (execution) => {
        const value = this.#executionValues.get(execution)?.values.get(ref)
        return value === undefined ? {} : { [ref]: value }
      },
    })
    this.#contributors.set(ref, dispose)
  }

  #purgeExpired(now: number): void {
    for (const [token, lease] of this.#leases) {
      if (lease.expiresAt <= now) this.#leases.delete(token)
    }
  }

  revokeLease(agent: Agent, bridge: MarivoDatasourceBridgePort, datasourceName: string): void {
    for (const [token, lease] of this.#leases) {
      if (
        lease.agent === agent &&
        lease.workspaceFingerprint === bridge.binding.fingerprint &&
        lease.datasourceName === datasourceName
      ) {
        this.#leases.delete(token)
      }
    }
  }

  issueLease(
    agent: Agent,
    bridge: MarivoDatasourceBridgePort,
    datasourceName: string,
    refs: readonly string[],
  ): MarivoShellLeaseReceipt {
    if (this.#disposed) throw new Error('Marivo shell credential leases are disposed')
    const now = Date.now()
    this.#purgeExpired(now)
    this.revokeLease(agent, bridge, datasourceName)
    assertMarivoCredentialReferences(refs)
    const bindings = credentialBindings(refs)
    for (const binding of bindings) this.#ensureContributor(binding.storageRef)
    const token = randomBytes(32).toString('base64url')
    this.#leases.set(token, {
      agent,
      workspaceFingerprint: bridge.binding.fingerprint,
      datasourceName,
      bindings,
      expiresAt: now + this.#ttlMs,
      remainingUses: this.#maxUses,
    })
    return {
      token,
      expires_in_ms: this.#ttlMs,
      max_uses: this.#maxUses,
      usage: 'bounded-foreground-shell-lease',
      bash_prelude: bashPrelude(token, bindings),
      pwsh_prelude: pwshPrelude(token, bindings),
    }
  }

  async #claim(
    agent: Agent,
    bridgeSource: MarivoDatasourceBridgeSource,
    execution: ToolExecution,
    token: string,
  ): Promise<void> {
    const lease = this.#leases.get(token)
    if (lease === undefined) {
      throw leaseFailure(
        'shell-credential-lease-invalid',
        'Marivo shell credential lease is unknown; call marivo_datasource_access again',
      )
    }
    if (lease.expiresAt <= Date.now()) {
      this.#leases.delete(token)
      throw leaseFailure(
        'shell-credential-lease-expired',
        'Marivo shell credential lease has expired; call marivo_datasource_access again',
        { datasourceName: lease.datasourceName },
      )
    }
    if (execution.agent !== agent || lease.agent !== agent) {
      throw leaseFailure(
        'shell-credential-lease-scope-mismatch',
        'Marivo shell credential lease belongs to another Agent',
      )
    }
    const bridge = await resolveMarivoDatasourceBridge(bridgeSource)
    if (this.#leases.get(token) !== lease) {
      throw leaseFailure(
        'shell-credential-lease-invalid',
        'Marivo shell credential lease was revoked; call marivo_datasource_access again',
      )
    }
    if (lease.workspaceFingerprint !== bridge.binding.fingerprint) {
      throw leaseFailure(
        'shell-credential-lease-scope-mismatch',
        'Marivo shell credential lease belongs to another Workspace binding',
      )
    }
    if (lease.expiresAt <= Date.now()) {
      this.#leases.delete(token)
      throw leaseFailure(
        'shell-credential-lease-expired',
        'Marivo shell credential lease has expired; call marivo_datasource_access again',
        { datasourceName: lease.datasourceName },
      )
    }

    const args = commandArguments(execution)
    if (args?.run_in_background === true) {
      throw leaseFailure(
        'shell-credential-injection-unsupported',
        'Marivo shell credential leases cannot be used by background Shell executions',
        { tool: execution.name },
      )
    }
    if (isHarnessPersistentShell(agent, execution.name)) {
      throw leaseFailure(
        'shell-credential-injection-unsupported',
        `Marivo shell credential leases cannot be used by persistent ${execution.name}`,
        { tool: execution.name },
      )
    }
    if (lease.remainingUses < 1) {
      this.#leases.delete(token)
      throw leaseFailure(
        'shell-credential-lease-exhausted',
        'Marivo shell credential lease is exhausted; call marivo_datasource_access again',
        { datasourceName: lease.datasourceName },
      )
    }
    lease.remainingUses--

    const values = new Map<DshCredentialRefName, string>()
    for (const binding of lease.bindings) {
      execution.signal.throwIfAborted()
      let resolved: { readonly value: string } | undefined
      try {
        resolved = await this.#credentials.resolve(credentialRef(binding.storageRef))
      } catch {
        throw leaseFailure(
          'shell-credential-lease-resolve-failed',
          'A credential authorized by the Marivo shell lease could not be resolved',
          { datasourceName: lease.datasourceName, ref: binding.environmentRef },
        )
      }
      if (resolved === undefined) {
        throw leaseFailure(
          'shell-credential-lease-resolve-failed',
          'A credential authorized by the Marivo shell lease is no longer configured',
          { datasourceName: lease.datasourceName, ref: binding.environmentRef },
        )
      }
      values.set(binding.storageRef, resolved.value)
    }
    this.#executionValues.set(execution, { agent, values })
  }

  async prepareExecution(
    agent: Agent,
    bridgeSource: MarivoDatasourceBridgeSource,
    execution: ToolExecution,
  ): Promise<boolean> {
    if (this.#disposed) throw new Error('Marivo shell credential leases are disposed')
    const token = leaseToken(execution)
    if (token === undefined) return false
    await this.#claim(agent, bridgeSource, execution, token)
    return true
  }

  installAgent(agent: Agent, bridgeSource: MarivoDatasourceBridgeSource): () => void {
    const stopPreExecute = agent.ctx.on('tools/pre-execute', async (execution, next) => {
      if (execution.agent === agent && SHELL_TOOL_NAMES.has(execution.name)) {
        await this.prepareExecution(agent, bridgeSource, execution)
      }
      return next()
    })
    const stopResult = agent.ctx.on('tools/result', (execution) => {
      if (execution.agent === agent) this.#executionValues.delete(execution)
    })
    let active = true
    return () => {
      if (!active) return
      active = false
      stopPreExecute()
      stopResult()
      for (const [token, lease] of this.#leases) {
        if (lease.agent === agent) this.#leases.delete(token)
      }
      for (const [execution, snapshot] of this.#executionValues) {
        if (snapshot.agent === agent) this.#executionValues.delete(execution)
      }
    }
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#leases.clear()
    this.#executionValues.clear()
    for (const dispose of this.#contributors.values()) dispose()
    this.#contributors.clear()
  }
}
