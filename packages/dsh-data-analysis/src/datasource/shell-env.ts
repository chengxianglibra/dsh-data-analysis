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

export const DSH_CREDENTIAL_REF_PATTERN = /^DSH_[A-Z][A-Z0-9_]*$/
export const MARIVO_CREDENTIAL_GRANT_PREFIX = '# dsh-marivo-credential-grant:'
export const DEFAULT_MARIVO_CREDENTIAL_GRANT_TTL_MS = 60_000

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
const SHELL_TOOL_NAMES = new Set(['bash', 'pwsh'])
type DshCredentialRefName = `DSH_${string}`

export interface MarivoShellGrantReceipt {
  [key: string]: string | number
  token: string
  expires_in_ms: number
  usage: 'one-foreground-shell'
}

interface PendingGrant {
  agent: Agent
  workspaceFingerprint: string
  datasourceName: string
  refs: readonly DshCredentialRefName[]
  expiresAt: number
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
  return new MarivoEnvironmentError(
    'datasource-credential-ref-invalid',
    `Marivo datasource credential reference must use the DSH_* namespace: ${ref}`,
    { ref, expected: 'DSH_[A-Z][A-Z0-9_]*' },
  )
}

function grantFailure(
  code:
    | 'shell-credential-grant-invalid'
    | 'shell-credential-grant-expired'
    | 'shell-credential-grant-scope-mismatch'
    | 'shell-credential-injection-unsupported'
    | 'shell-credential-grant-resolve-failed',
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

function grantToken(execution: ToolExecution): string | undefined {
  const command = commandArguments(execution)?.command
  if (typeof command !== 'string') return undefined
  const firstLine = command.split(/\r?\n/, 1)[0] ?? ''
  const candidate = firstLine.startsWith(MARIVO_CREDENTIAL_GRANT_PREFIX)
    ? firstLine.slice(MARIVO_CREDENTIAL_GRANT_PREFIX.length)
    : undefined
  if (candidate !== undefined && TOKEN_PATTERN.test(candidate)) return candidate
  if (firstLine.includes('dsh-marivo-credential-grant')) {
    throw grantFailure(
      'shell-credential-grant-invalid',
      'Marivo shell credential grant marker is malformed',
    )
  }
  return undefined
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

/** Own short-lived grants and expose credential values only to their claimed Shell execution. */
export class MarivoShellCredentialGrants {
  readonly #ctx: Context
  readonly #credentials: Pick<CredentialProvider, 'resolve'>
  readonly #ttlMs: number
  readonly #grants = new Map<string, PendingGrant>()
  readonly #executionValues = new Map<ToolExecution, ExecutionSnapshot>()
  readonly #contributors = new Map<DshCredentialRefName, () => void>()
  #disposed = false

  constructor(
    ctx: Context,
    credentials: Pick<CredentialProvider, 'resolve'>,
    options: { ttlMs?: number } = {},
  ) {
    const ttlMs = options.ttlMs ?? DEFAULT_MARIVO_CREDENTIAL_GRANT_TTL_MS
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 60_000) {
      throw new TypeError('Marivo shell credential grant ttlMs must be an integer from 1 to 60000')
    }
    this.#ctx = ctx
    this.#credentials = credentials
    this.#ttlMs = ttlMs
  }

  #ensureContributor(ref: DshCredentialRefName): void {
    if (this.#disposed) throw new Error('Marivo shell credential grants are disposed')
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
    for (const [token, grant] of this.#grants) {
      if (grant.expiresAt <= now) this.#grants.delete(token)
    }
  }

  issueGrant(
    agent: Agent,
    bridge: MarivoDatasourceBridgePort,
    datasourceName: string,
    refs: readonly string[],
  ): MarivoShellGrantReceipt {
    if (this.#disposed) throw new Error('Marivo shell credential grants are disposed')
    const now = Date.now()
    this.#purgeExpired(now)
    assertDshCredentialReferences(refs)
    const accepted = [...new Set(refs)]
    for (const ref of accepted) this.#ensureContributor(ref)
    const token = randomBytes(32).toString('base64url')
    this.#grants.set(token, {
      agent,
      workspaceFingerprint: bridge.binding.fingerprint,
      datasourceName,
      refs: Object.freeze(accepted),
      expiresAt: now + this.#ttlMs,
    })
    return { token, expires_in_ms: this.#ttlMs, usage: 'one-foreground-shell' }
  }

  async #claim(
    agent: Agent,
    bridgeSource: MarivoDatasourceBridgeSource,
    execution: ToolExecution,
    token: string,
  ): Promise<void> {
    const grant = this.#grants.get(token)
    if (grant === undefined) {
      throw grantFailure(
        'shell-credential-grant-invalid',
        'Marivo shell credential grant is unknown or has already been used',
      )
    }
    if (grant.expiresAt <= Date.now()) {
      this.#grants.delete(token)
      throw grantFailure(
        'shell-credential-grant-expired',
        'Marivo shell credential grant has expired',
        { datasourceName: grant.datasourceName },
      )
    }
    if (execution.agent !== agent || grant.agent !== agent) {
      throw grantFailure(
        'shell-credential-grant-scope-mismatch',
        'Marivo shell credential grant belongs to another Agent',
      )
    }
    const bridge = await resolveMarivoDatasourceBridge(bridgeSource)
    if (grant.workspaceFingerprint !== bridge.binding.fingerprint) {
      throw grantFailure(
        'shell-credential-grant-scope-mismatch',
        'Marivo shell credential grant belongs to another Workspace binding',
      )
    }
    if (grant.expiresAt <= Date.now()) {
      this.#grants.delete(token)
      throw grantFailure(
        'shell-credential-grant-expired',
        'Marivo shell credential grant has expired',
        { datasourceName: grant.datasourceName },
      )
    }

    this.#grants.delete(token)
    const args = commandArguments(execution)
    if (args?.run_in_background === true) {
      throw grantFailure(
        'shell-credential-injection-unsupported',
        'Marivo shell credential grants cannot be used by background Shell executions',
        { tool: execution.name },
      )
    }
    if (isHarnessPersistentShell(agent, execution.name)) {
      throw grantFailure(
        'shell-credential-injection-unsupported',
        `Marivo shell credential grants cannot be used by persistent ${execution.name}`,
        { tool: execution.name },
      )
    }

    const values = new Map<DshCredentialRefName, string>()
    for (const ref of grant.refs) {
      execution.signal.throwIfAborted()
      let resolved: { readonly value: string } | undefined
      try {
        resolved = await this.#credentials.resolve(credentialRef(ref))
      } catch {
        throw grantFailure(
          'shell-credential-grant-resolve-failed',
          'A credential authorized by the Marivo shell grant could not be resolved',
          { datasourceName: grant.datasourceName, ref },
        )
      }
      if (resolved === undefined) {
        throw grantFailure(
          'shell-credential-grant-resolve-failed',
          'A credential authorized by the Marivo shell grant is no longer configured',
          { datasourceName: grant.datasourceName, ref },
        )
      }
      values.set(ref, resolved.value)
    }
    this.#executionValues.set(execution, { agent, values })
  }

  async prepareExecution(
    agent: Agent,
    bridgeSource: MarivoDatasourceBridgeSource,
    execution: ToolExecution,
  ): Promise<boolean> {
    if (this.#disposed) throw new Error('Marivo shell credential grants are disposed')
    const token = grantToken(execution)
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
      for (const [token, grant] of this.#grants) {
        if (grant.agent === agent) this.#grants.delete(token)
      }
      for (const [execution, snapshot] of this.#executionValues) {
        if (snapshot.agent === agent) this.#executionValues.delete(execution)
      }
    }
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#grants.clear()
    this.#executionValues.clear()
    for (const dispose of this.#contributors.values()) dispose()
    this.#contributors.clear()
  }
}
