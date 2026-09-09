import { type PresentationReceipt, parsePresentationReceipt } from './index.ts'

export interface PublicationSource {
  kind: 'agent' | 'reader'
  sessionId: string | null
}
export interface ReportVersion {
  receipt: PresentationReceipt
  publishedAt: string | null
  source: PublicationSource | null
}
export interface ReportHistory {
  workspaceId: string
  reportId: string
  currentBuildId: string
  legacyHistoryUnavailable: boolean
  versions: ReportVersion[]
}
export interface ReportCatalog {
  workspaceId: string
  reports: ReportVersion[]
  unavailable: number
}
export const REPORT_HISTORY_BYTES = 16 * 1024 * 1024
export const REPORT_HISTORY_LIMIT = 4096

export function parseReportVersion(value: unknown): ReportVersion {
  const entry = value as ReportVersion
  if (
    !entry ||
    Object.keys(entry).sort().join(',') !== 'publishedAt,receipt,source' ||
    !(
      entry.publishedAt === null ||
      (typeof entry.publishedAt === 'string' &&
        Number.isFinite(Date.parse(entry.publishedAt)) &&
        new Date(entry.publishedAt).toISOString() === entry.publishedAt)
    ) ||
    !(
      entry.source === null ||
      (entry.source &&
        Object.keys(entry.source).sort().join(',') === 'kind,sessionId' &&
        ['agent', 'reader'].includes(entry.source.kind) &&
        (entry.source.sessionId === null ||
          (typeof entry.source.sessionId === 'string' &&
            !!entry.source.sessionId.trim() &&
            entry.source.sessionId.length <= 512)))
    )
  )
    throw new Error('invalid-report-history')
  parsePresentationReceipt(entry.receipt)
  return entry
}

export function parseReportHistory(value: unknown): ReportHistory {
  const history = value as ReportHistory
  if (
    !history ||
    !Array.isArray(history.versions) ||
    !history.versions.length ||
    history.versions.length > REPORT_HISTORY_LIMIT ||
    typeof history.legacyHistoryUnavailable !== 'boolean'
  )
    throw new Error('invalid-report-history')
  const ids = new Set<string>()
  for (const entry of history.versions) {
    const { receipt } = parseReportVersion(entry)
    if (
      receipt.workspaceId !== history.workspaceId ||
      receipt.reportId !== history.reportId ||
      ids.has(receipt.buildId)
    )
      throw new Error('invalid-report-history')
    ids.add(receipt.buildId)
  }
  if (history.currentBuildId !== history.versions[0]!.receipt.buildId)
    throw new Error('invalid-report-history')
  return history
}

export function parseReportCatalog(value: unknown): ReportCatalog {
  const catalog = value as ReportCatalog
  if (
    !catalog ||
    typeof catalog.workspaceId !== 'string' ||
    !Array.isArray(catalog.reports) ||
    catalog.reports.length > 4096 ||
    !Number.isInteger(catalog.unavailable) ||
    catalog.unavailable < 0
  )
    throw new Error('invalid-report-catalog')
  const ids = new Set<string>()
  for (const item of catalog.reports) {
    const { receipt } = parseReportVersion(item)
    if (receipt.workspaceId !== catalog.workspaceId || ids.has(receipt.reportId))
      throw new Error('invalid-report-catalog')
    ids.add(receipt.reportId)
  }
  return catalog
}
