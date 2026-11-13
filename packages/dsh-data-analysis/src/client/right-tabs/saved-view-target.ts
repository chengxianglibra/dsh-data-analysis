import { parseResource, type Resource, resourceAddress } from './navigation.ts'

const prefix = 'dsh-data-analysis:report-view:'
type ReportTarget = Extract<Resource, { kind: 'report' }>
type Identity = { sessionId: string; workspaceId: string; viewId: string; workspacePath: string }
const keyFor = ({ sessionId, workspaceId, viewId, workspacePath }: Identity) =>
  prefix + JSON.stringify([sessionId, workspaceId, viewId, workspacePath])

/** Refuse to bind an in-memory view to another Session, path or connection. */
export function assertLiveViewOwner(
  owner: { sessionId: string; workspacePath: string },
  view: { sessionId: string | undefined; workspacePath: string | undefined; generation: unknown },
  generation: unknown,
) {
  if (
    view.sessionId !== owner.sessionId ||
    view.workspacePath !== owner.workspacePath ||
    view.generation !== generation
  )
    throw new Error('marivo.navigation.workspace-changed-or-is-unavailable-reopen-the-page')
}

/** Persist only a verified Build identity, never a receipt or its content. */
export function saveViewTarget(storage: Storage, identity: Identity, target: ReportTarget) {
  if (
    target.workspaceId !== identity.workspaceId ||
    target.reportViewId !== identity.viewId ||
    !target.buildId
  )
    throw new Error('report-view-owner-changed')
  storage.setItem(
    keyFor(identity),
    JSON.stringify({ workspacePath: identity.workspacePath, address: resourceAddress(target) }),
  )
}

/** A persisted address is an untrusted hint; the normal Build reader verifies it. */
export function readViewTarget(storage: Storage, identity: Identity): ReportTarget | undefined {
  const raw = storage.getItem(keyFor(identity))
  if (raw === null) return undefined
  try {
    const value: unknown = JSON.parse(raw)
    if (
      !value ||
      typeof value !== 'object' ||
      !('workspacePath' in value) ||
      !('address' in value) ||
      value.workspacePath !== identity.workspacePath ||
      typeof value.address !== 'string'
    )
      throw new Error()
    const target = parseResource(value.address)
    if (
      target.kind !== 'report' ||
      target.workspaceId !== identity.workspaceId ||
      target.reportViewId !== identity.viewId ||
      !target.buildId
    )
      throw new Error()
    return target
  } catch {
    throw new Error('marivo.navigation.workspace-changed-or-is-unavailable-reopen-the-page')
  }
}

/** Removing a report also revokes persisted view-to-Build hints in this browser. */
export function removeViewTargets(
  storage: Storage,
  workspaceId: string,
  reportId: string,
  workspacePath: string,
) {
  for (let index = storage.length - 1; index >= 0; index--) {
    const key = storage.key(index)
    if (!key?.startsWith(prefix)) continue
    try {
      const value: unknown = JSON.parse(storage.getItem(key) ?? '')
      if (
        !value ||
        typeof value !== 'object' ||
        !('address' in value) ||
        typeof value.address !== 'string'
      )
        continue
      if (!('workspacePath' in value) || value.workspacePath !== workspacePath) continue
      const target = parseResource(value.address)
      if (
        target.kind === 'report' &&
        target.workspaceId === workspaceId &&
        target.reportId === reportId
      )
        storage.removeItem(key)
    } catch {
      /* Invalid hints cannot identify the deleted report. */
    }
  }
}
