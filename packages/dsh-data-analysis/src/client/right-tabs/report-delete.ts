import type { AnalysisDocument } from '../../presentation/contracts/analysis-document.ts'
import { MARIVO_PRESENTATION_RPC_CHANNEL } from '../../presentation/receipt.ts'
import type { PresentationRpc } from '../presentation/delivery-model.ts'

export type DeleteStatus =
  | 'deleted'
  | 'cleanup-pending'
  | 'stale'
  | 'unavailable'
  | 'failed'
  | 'uncertain'

interface DeleteContext {
  connection: { generation: { getSnapshot(): unknown } }
  workspaces: {
    list: {
      getSnapshot(): {
        phase: string
        state?: string
        items: { workspaceId: string; path: string; sessionIds: string[] }[]
      }
    }
  }
}
interface DeletePage {
  sessionId: string
  target: { workspaceId: string }
  workspacePath?: string
}

/** Send one user-confirmed deletion using the exact version displayed in this tab. */
export async function deleteReport(
  ctx: DeleteContext,
  rpc: PresentationRpc,
  page: DeletePage,
  tab: { signal: AbortSignal },
  report: Pick<AnalysisDocument, 'workspaceId' | 'reportId' | 'buildId'>,
  isCurrent: () => boolean,
  deleted: (
    workspaceId: string,
    reportId: string,
    expectedBuildId: string,
    cleanupPending: boolean,
  ) => void,
): Promise<DeleteStatus> {
  const workspaceId = page.target.workspaceId
  const generation = ctx.connection.generation.getSnapshot()
  const workspacePath = page.workspacePath
  const sessionId = page.sessionId
  const valid = () => {
    const state = ctx.workspaces.list.getSnapshot()
    const owners = state.items.filter((item) => item.workspaceId === workspaceId)
    const owner = owners[0]
    return Boolean(
      generation &&
        ctx.connection.generation.getSnapshot() === generation &&
        !tab.signal.aborted &&
        isCurrent() &&
        state.phase === 'ready' &&
        state.state !== 'error' &&
        owners.length === 1 &&
        workspacePath &&
        page.workspacePath === workspacePath &&
        page.sessionId === sessionId &&
        owner?.path === workspacePath &&
        owner?.sessionIds.includes(sessionId) &&
        report.workspaceId === workspaceId,
    )
  }
  if (!valid()) return 'unavailable'
  try {
    const result = (await rpc.call(
      MARIVO_PRESENTATION_RPC_CHANNEL,
      'reports/delete',
      {
        workspaceId,
        reportId: report.reportId,
        expectedBuildId: report.buildId,
      },
      tab.signal,
    )) as { ok?: boolean; value?: unknown; error?: { message?: string } }
    // A response from an old connection or binding must not revoke the new UI.
    if (!valid()) return 'uncertain'
    if (result?.ok !== true) {
      if (result?.error?.message === 'report-delete-conflict') return 'stale'
      if (result?.error?.message === 'report-not-found') {
        deleted(workspaceId, report.reportId, report.buildId, false)
        return 'deleted'
      }
      return 'failed'
    }
    if (
      !result.value ||
      typeof result.value !== 'object' ||
      typeof Reflect.get(result.value, 'cleanupPending') !== 'boolean'
    )
      return 'uncertain'
    const cleanupPending = Reflect.get(result.value, 'cleanupPending') as boolean
    deleted(workspaceId, report.reportId, report.buildId, cleanupPending)
    return cleanupPending ? 'cleanup-pending' : 'deleted'
  } catch {
    // The request may have reached the Host before a connection or tab was lost.
    return 'uncertain'
  }
}
