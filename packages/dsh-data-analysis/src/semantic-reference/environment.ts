import { createHash } from 'node:crypto'
import type { MarivoCheckedRunner } from '../environment/types.ts'
import type { EnvironmentResolver } from './rpc.ts'

interface Workspace {
  id: string
  path: string
}
interface Binding {
  root: string
  environment: Promise<MarivoCheckedRunner>
}
export interface ReferenceEnvironmentHost<A extends object> {
  agent(sessionId: string): A | undefined
  binding(agent: A): Binding | undefined
  projectRoot(agent: A): string
  resolve(agent: A): Promise<MarivoCheckedRunner>
  workspace(sessionId: string): Workspace
}

/** Reference identity includes Harness ownership; the underlying Runtime stays unchanged. */
export function semanticEnvironmentFingerprint(
  workspaceId: string,
  runtimeFingerprint: string,
): string {
  return createHash('sha256')
    .update(JSON.stringify(['marivo-semantic-workspace/v1', workspaceId, runtimeFingerprint]))
    .digest('hex')
}

/** Explicit selection establishes ownership; serialization never repairs it. */
export function referenceEnvironmentResolver<A extends object>(
  host: ReferenceEnvironmentHost<A>,
): EnvironmentResolver {
  const owners = new WeakMap<A, { workspace: Workspace; binding: Binding }>()
  return async (sessionId, purpose, workspaceId) => {
    const agent = host.agent(sessionId)
    if (!agent) throw new Error('unknown-session')
    const priorOwner = owners.get(agent)
    const owner = purpose === 'reference' ? priorOwner?.workspace : host.workspace(sessionId)
    if (purpose === 'prepare' && (!workspaceId || owner?.id !== workspaceId))
      throw new Error('workspace-mismatch')
    const checkOwner = () => {
      if (!owner) return
      const current = host.workspace(sessionId)
      if (current.id !== owner.id || current.path !== owner.path)
        throw new Error('workspace-changed')
    }
    checkOwner()
    const bound = host.binding(agent)
    if (
      purpose === 'reference' &&
      (!owner || !bound || bound !== priorOwner?.binding || bound.root !== host.projectRoot(agent))
    )
      throw new Error('environment-unbound')
    const pending = purpose === 'reference' ? bound!.environment : host.resolve(agent)
    const expected = host.binding(agent)
    const environment = await pending
    if (
      host.agent(sessionId) !== agent ||
      host.binding(agent) !== expected ||
      expected?.root !== host.projectRoot(agent)
    )
      throw new Error('environment-changed')
    checkOwner()
    if (!owner || !expected) throw new Error('environment-unbound')
    if (purpose !== 'reference') owners.set(agent, { workspace: owner, binding: expected })
    // Only the semantic surface uses the ownership fingerprint. Execution is delegated
    // to the original runner, preserving its Runtime identity and dynamic health.
    return {
      binding: {
        ...environment.binding,
        fingerprint: semanticEnvironmentFingerprint(owner.id, environment.binding.fingerprint),
      },
      get status() {
        return environment.status
      },
      runChecked: (request) => environment.runChecked(request),
    }
  }
}
