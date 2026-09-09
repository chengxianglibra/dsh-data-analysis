import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-workspace'

/** Resolve only Harness-owned, header-validated Workspace membership; never infer it from a path. */
export function resolvePresentationWorkspace(
  ctx: Context,
  sessionId: string,
): { id: string; path: string } {
  const matches = ctx.workspaceRegistry
    .list()
    .filter((workspace) => workspace.sessionIds.some((id) => String(id) === sessionId))
  if (matches.length !== 1) throw new Error('Presentation requires one current Session Workspace')
  return { id: String(matches[0]!.id), path: matches[0]!.path }
}
