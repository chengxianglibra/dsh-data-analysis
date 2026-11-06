import { lstat } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { readPythonCaptures } from '../python-execution.ts'
import type { PythonCaptureRecord, PythonCodeRef } from '../python-execution-contracts.ts'
import {
  type AnalysisSnapshot,
  type DatasetSnapshot,
  type FrameSnapshotV2,
  isFrameSnapshotV2,
  parseAnalysisSnapshot,
} from './contracts/snapshot.ts'
import { type DatasetColumn, PRESENTATION_BUDGETS } from './contracts/types.ts'
import { presentationSha256, readReportFile } from './files.ts'

const uuid = z.string().uuid()
const manifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  failed: z.boolean(),
  entries: z
    .array(
      z.strictObject({
        captureId: uuid,
        path: z.string(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .max(16),
})

export type CapturedSnapshotKind = 'dataset' | 'frame'
export type CapturedSnapshotEntry = PythonCaptureRecord['entries'][number] & {
  kind: CapturedSnapshotKind
  summary: {
    schema: {
      columns: Pick<DatasetColumn, 'id' | 'type' | 'nullable'>[]
      columnCount: number
      columnsTruncated: boolean
    }
    coverage: Pick<
      AnalysisSnapshot['coverage'],
      'totalRows' | 'capturedRows' | 'complete' | 'business'
    >
  }
}
/** capture_dataset writes Dataset snapshots; capture_frame writes only v2 Frame snapshots. */
function capturedKind(snapshot: AnalysisSnapshot): CapturedSnapshotKind | undefined {
  if (snapshot.kind === 'dataset') return 'dataset'
  return isFrameSnapshotV2(snapshot) ? 'frame' : undefined
}

/** Read only the exact per-call manifest, without scanning the Workspace or stdout. */
export async function collectSnapshotCaptures(
  root: string,
  directory: string,
  secrets: readonly string[],
  signal?: AbortSignal,
): Promise<CapturedSnapshotEntry[]> {
  const filename = path.join(root, directory, 'manifest.json')
  try {
    await lstat(filename)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const manifest = manifestSchema.parse(
    JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        await readReportFile(root, filename, 65_536, signal),
      ),
    ),
  )
  if (
    manifest.failed ||
    manifest.entries.length === 0 ||
    new Set(manifest.entries.map((e) => e.captureId)).size !== manifest.entries.length
  )
    throw new Error('dataset-capture-failed')
  const entries: CapturedSnapshotEntry[] = []
  // Bound model context across all captures, separately from snapshot storage budgets.
  let remainingColumns = 64
  for (const entry of manifest.entries) {
    if (entry.path !== `${directory}/${entry.captureId}.json`)
      throw new Error('dataset-capture-path-mismatch')
    const bytes = await readReportFile(
      root,
      path.join(root, entry.path),
      PRESENTATION_BUDGETS.datasetBytes,
      signal,
    )
    if (presentationSha256(bytes) !== entry.sha256)
      throw new Error('dataset-capture-digest-mismatch')
    const snapshot = parseAnalysisSnapshot(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    )
    const kind = capturedKind(snapshot)
    if (!kind) throw new Error('dataset-capture-kind-mismatch')
    const containsSecret = (value: unknown): boolean => {
      if (typeof value === 'string')
        return secrets.some((secret) => secret && value.includes(secret))
      if (Array.isArray(value)) return value.some(containsSecret)
      if (value && typeof value === 'object')
        return Object.entries(value).some(([k, v]) => containsSecret(k) || containsSecret(v))
      return false
    }
    if (containsSecret(snapshot)) throw new Error('dataset-capture-forbidden')
    const columns = snapshot.data.columns.slice(0, Math.min(16, remainingColumns))
    remainingColumns -= columns.length
    const { totalRows, capturedRows, complete, business } = snapshot.coverage
    entries.push({
      ...entry,
      kind,
      summary: {
        schema: {
          columns: columns.map(({ id, type, nullable }) => ({ id, type, nullable })),
          columnCount: snapshot.data.columns.length,
          columnsTruncated: columns.length < snapshot.data.columns.length,
        },
        coverage: { totalRows, capturedRows, complete, business },
      },
    })
  }
  return entries
}

/** Snapshot references carry their kind; reading checks the saved snapshot against it. */
export function capturedSnapshotRef(
  kind: CapturedSnapshotKind,
  code: PythonCodeRef,
  captureId: string,
): string {
  return `marivo-${kind}:${code.executionId}:${code.sha256}:${captureId}`
}
export function datasetSnapshotRef(code: PythonCodeRef, captureId: string): string {
  return capturedSnapshotRef('dataset', code, captureId)
}
export function frameSnapshotRef(code: PythonCodeRef, captureId: string): string {
  return capturedSnapshotRef('frame', code, captureId)
}

interface CapturedSnapshot<T> {
  snapshot: T
  codeRef: PythonCodeRef
  owner: Omit<PythonCaptureRecord, 'entries'>
}
/** Resolve Host provenance before reading Workspace bytes. Never starts Python or SQL. */
export function readDatasetSnapshot(
  root: string,
  workspaceId: string,
  snapshotRef: string,
  signal?: AbortSignal,
): Promise<CapturedSnapshot<DatasetSnapshot>> {
  return readCapturedSnapshot(root, workspaceId, snapshotRef, 'dataset', signal) as Promise<
    CapturedSnapshot<DatasetSnapshot>
  >
}
export function readFrameSnapshot(
  root: string,
  workspaceId: string,
  snapshotRef: string,
  signal?: AbortSignal,
): Promise<CapturedSnapshot<FrameSnapshotV2>> {
  return readCapturedSnapshot(root, workspaceId, snapshotRef, 'frame', signal) as Promise<
    CapturedSnapshot<FrameSnapshotV2>
  >
}
async function readCapturedSnapshot(
  root: string,
  workspaceId: string,
  snapshotRef: string,
  kind: CapturedSnapshotKind,
  signal?: AbortSignal,
): Promise<CapturedSnapshot<AnalysisSnapshot>> {
  const match = /^marivo-(dataset|frame):([a-f0-9-]{36}):([a-f0-9]{64}):([a-f0-9-]{36})$/.exec(
    snapshotRef,
  )
  if (!match || match[1] !== kind) throw new Error(`${kind}-snapshot-reference-invalid`)
  const codeRef = { executionId: match[2]!, sha256: match[3]! }
  const { entries, ...owner } = await readPythonCaptures(root, codeRef, signal)
  if (owner.workspaceId !== workspaceId) throw new Error(`${kind}-snapshot-workspace-mismatch`)
  const entry = entries.find((e) => e.captureId === match[4])
  if (!entry) throw new Error(`${kind}-snapshot-reference-invalid`)
  const bytes = await readReportFile(
    root,
    path.join(root, entry.path),
    PRESENTATION_BUDGETS.datasetBytes,
    signal,
  )
  if (presentationSha256(bytes) !== entry.sha256)
    throw new Error(`${kind}-snapshot-digest-mismatch`)
  const snapshot = parseAnalysisSnapshot(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
  )
  if (capturedKind(snapshot) !== kind) throw new Error(`${kind}-snapshot-kind-mismatch`)
  return { snapshot, codeRef, owner }
}
