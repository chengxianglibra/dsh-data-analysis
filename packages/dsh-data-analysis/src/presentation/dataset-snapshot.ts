import { lstat } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { readPythonCaptures } from '../python-execution.ts'
import type { PythonCaptureRecord, PythonCodeRef } from '../python-execution-contracts.ts'
import { type DatasetSnapshot, parseAnalysisSnapshot } from './contracts/snapshot.ts'
import { PRESENTATION_BUDGETS } from './contracts/types.ts'
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

/** Read only the exact per-call manifest, without scanning the Workspace or stdout. */
export async function collectDatasetCaptures(
  root: string,
  directory: string,
  secrets: readonly string[],
  signal?: AbortSignal,
): Promise<PythonCaptureRecord['entries']> {
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
    if (snapshot.kind !== 'dataset') throw new Error('dataset-capture-kind-mismatch')
    const containsSecret = (value: unknown): boolean => {
      if (typeof value === 'string')
        return secrets.some((secret) => secret && value.includes(secret))
      if (Array.isArray(value)) return value.some(containsSecret)
      if (value && typeof value === 'object')
        return Object.entries(value).some(([k, v]) => containsSecret(k) || containsSecret(v))
      return false
    }
    if (containsSecret(snapshot)) throw new Error('dataset-capture-forbidden')
  }
  return manifest.entries
}

export function datasetSnapshotRef(code: PythonCodeRef, captureId: string): string {
  return `marivo-dataset:${code.executionId}:${code.sha256}:${captureId}`
}

/** Resolve Host provenance before reading Workspace bytes. Never starts Python or SQL. */
export async function readDatasetSnapshot(
  root: string,
  workspaceId: string,
  snapshotRef: string,
  signal?: AbortSignal,
): Promise<{
  snapshot: DatasetSnapshot
  codeRef: PythonCodeRef
  owner: Omit<PythonCaptureRecord, 'entries'>
}> {
  const match = /^marivo-dataset:([a-f0-9-]{36}):([a-f0-9]{64}):([a-f0-9-]{36})$/.exec(snapshotRef)
  if (!match) throw new Error('dataset-snapshot-reference-invalid')
  const codeRef = { executionId: match[1]!, sha256: match[2]! }
  const { entries, ...owner } = await readPythonCaptures(root, codeRef, signal)
  if (owner.workspaceId !== workspaceId) throw new Error('dataset-snapshot-workspace-mismatch')
  const entry = entries.find((e) => e.captureId === match[3])
  if (!entry) throw new Error('dataset-snapshot-reference-invalid')
  const bytes = await readReportFile(
    root,
    path.join(root, entry.path),
    PRESENTATION_BUDGETS.datasetBytes,
    signal,
  )
  if (presentationSha256(bytes) !== entry.sha256)
    throw new Error('dataset-snapshot-digest-mismatch')
  const snapshot = parseAnalysisSnapshot(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
  )
  if (snapshot.kind !== 'dataset') throw new Error('dataset-snapshot-kind-mismatch')
  return { snapshot, codeRef, owner }
}
