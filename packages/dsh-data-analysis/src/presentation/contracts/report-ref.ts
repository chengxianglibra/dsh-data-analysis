import { z } from 'zod'
import { analysisRecordId, parseAnalysisRecordId } from './analysis-document.ts'

const scope = z.string().min(1).max(512)
const id = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/)
const saved = z.strictObject({
  kind: z.literal('saved'),
  workspaceId: scope,
  reportId: id,
  buildId: id,
})
const draft = z.strictObject({
  kind: z.literal('draft'),
  workspaceId: scope,
  sessionId: scope,
  turn: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  draftId: z.string().uuid(),
  revision: z.string().uuid(),
})
export type SavedReportRef = z.infer<typeof saved>
export type DraftReportRef = z.infer<typeof draft>
export type ReportRef = SavedReportRef | DraftReportRef

function encode(value: ReportRef): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const ref = `mr1:${value.kind === 'saved' ? 's' : 'd'}:${btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')}`
  if (ref.length > 4096) throw new Error('report-ref-budget')
  return ref
}
/** A locator is never authorization; callers must check the live Workspace and owner. */
export function parseReportRef(value: unknown): ReportRef {
  const invalid = () =>
    new Error(
      'report-ref-invalid: use the exact ref from a successful write or read. To recover the current Turn draft, use marivo_report_read({draft:true}) and confirm the target before continuing.',
    )
  if (typeof value !== 'string' || value.length > 4096) throw invalid()
  const match = /^mr1:([sd]):([A-Za-z0-9_-]+)$/.exec(value)
  if (!match) throw invalid()
  try {
    const text = atob(match[2]!.replaceAll('-', '+').replaceAll('_', '/'))
    const json: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        Uint8Array.from(text, (c) => c.charCodeAt(0)),
      ),
    )
    const result = (match[1] === 's' ? saved : draft).parse(json)
    if (encode(result) !== value) throw new Error('report-ref-noncanonical')
    return result
  } catch {
    throw invalid()
  }
}
export function savedReportRef(value: Omit<SavedReportRef, 'kind'>): string {
  return encode(saved.parse({ kind: 'saved', ...value }))
}
export function draftReportRef(value: Omit<DraftReportRef, 'kind'>): string {
  return encode(draft.parse({ kind: 'draft', ...value }))
}
export function savedReportRecordId(value: unknown, workspaceId: string): string {
  const ref = parseReportRef(value)
  if (ref.kind !== 'saved') throw new Error('report-saved-ref-required')
  if (ref.workspaceId !== workspaceId) throw new Error('report-workspace-mismatch')
  return analysisRecordId(ref.reportId, ref.buildId)
}
/** Compatibility is confined to internal persisted receipt identities. */
export function reportRefFromRecordId(recordId: string, workspaceId: string): string {
  return savedReportRef({ workspaceId, ...parseAnalysisRecordId(recordId) })
}
