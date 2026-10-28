import path from 'node:path'
import { analysisCatalogBuild, analysisCatalogId } from './contracts/analysis-catalog.ts'
import {
  ANALYSIS_UI_FORMAT,
  type AnalysisDocument,
  type AnalysisPresentInput,
  analysisElements,
  analysisRecordId,
  parseAnalysisDocument,
} from './contracts/analysis-document.ts'
import { parseAnalysisProgram } from './contracts/analysis-program.ts'
import { PRESENTATION_BUDGETS } from './contracts/types.ts'
import { readDatasetSnapshot } from './dataset-snapshot.ts'
import { presentationSha256, readReportFile } from './files.ts'
import type { MarivoPresentationProjection } from './projection/index.ts'

function imageMime(bytes: Buffer) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png'
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())) return 'image/gif'
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP')
    return 'image/webp'
  throw new Error('analysis-image-format-unsupported')
}
/** Read each admitted resource once; saved bytes never depend on the capture directory. */
export async function createAnalysisDocument(
  input: AnalysisPresentInput,
  projection: MarivoPresentationProjection,
  identity: { workspaceId: string; reportId: string; buildId: string },
  signal: AbortSignal,
): Promise<AnalysisDocument> {
  const entries = Object.entries(input.resources)
  if (entries.length > PRESENTATION_BUDGETS.datasets) throw new Error('analysis-resource-budget')
  const single = entries.length === 1 ? entries[0] : undefined
  const program =
    input.program ??
    (single
      ? `root = ${single[1].kind === 'marivo-frame' ? 'AnalysisFrameView' : single[1].kind === 'dataset-snapshot' ? 'DatasetView' : 'Image'}(${single[1].kind === 'image-file' ? `${JSON.stringify(input.title)}, ` : ''}${JSON.stringify(single[0])});`
      : '')
  const nodes = analysisElements(parseAnalysisProgram(program))
  for (const node of nodes) {
    const ref =
      node.typeName === 'Image'
        ? node.props.src
        : ['AnalysisFrameView', 'DatasetView'].includes(node.typeName)
          ? node.props.ref
          : undefined
    if (ref !== undefined && (typeof ref !== 'string' || !input.resources[ref]))
      throw new Error('analysis-resource-missing')
  }
  const frameEntries = entries.filter(
    (
      entry,
    ): entry is [
      string,
      Extract<AnalysisPresentInput['resources'][string], { kind: 'marivo-frame' }>,
    ] => entry[1].kind === 'marivo-frame',
  )
  const frames = frameEntries.length
    ? await projection.readFrames(
        frameEntries.map(([name, r]) => {
          const views = nodes
            .filter((n) => n.typeName === 'AnalysisFrameView' && n.props.ref === name)
            .map(
              (n) =>
                n.props.view as
                  | { chart: string; columns?: string[]; encoding?: { value: string } }
                  | undefined,
            )
          const all =
            !views.length ||
            views.some((v) => !v || v.chart === 'auto' || (v.chart === 'table' && !v.columns))
          const columns = all
            ? undefined
            : [
                ...new Set(
                  views.flatMap((v) =>
                    v?.chart === 'table'
                      ? (v.columns ?? [])
                      : v?.encoding
                        ? [v.encoding.value]
                        : [],
                  ),
                ),
              ]
          return {
            sessionId: r.sessionId,
            artifactId: r.artifactId,
            ...(columns ? { columns } : {}),
          }
        }),
        signal,
      )
    : []
  const resources: AnalysisDocument['resources'] = {}
  for (const [name, declaration] of entries) {
    signal.throwIfAborted()
    if (declaration.kind === 'marivo-frame') {
      resources[name] = {
        kind: 'snapshot',
        declaration,
        snapshot: frames[frameEntries.findIndex(([id]) => id === name)]!,
        binding: {
          workspaceId: identity.workspaceId,
          runtimeFingerprint: projection.binding.fingerprint,
        },
      }
    } else if (declaration.kind === 'dataset-snapshot') {
      const { snapshot, codeRef, owner } = await readDatasetSnapshot(
        projection.binding.projectRoot,
        identity.workspaceId,
        declaration.snapshotRef,
        signal,
      )
      resources[name] = {
        kind: 'snapshot',
        declaration,
        snapshot,
        binding: {
          workspaceId: identity.workspaceId,
          codeRef,
          sessionId: owner.sessionId,
          callId: owner.callId,
        },
      }
    } else {
      if (
        path.isAbsolute(declaration.path) ||
        declaration.path.split(/[\\/]/).some((p) => p === '..' || !p)
      )
        throw new Error('analysis-image-path-invalid')
      const bytes = await readReportFile(
        projection.binding.projectRoot,
        path.join(projection.binding.projectRoot, declaration.path),
        PRESENTATION_BUDGETS.datasetBytes,
        signal,
      )
      const mimeType = imageMime(bytes)
      resources[name] = {
        kind: 'image',
        declaration,
        mimeType,
        dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`,
        sha256: presentationSha256(bytes),
      }
    }
  }
  return parseAnalysisDocument({
    schemaVersion: ANALYSIS_UI_FORMAT,
    ...identity,
    recordId: analysisRecordId(identity.reportId, identity.buildId),
    title: input.title,
    locale: input.locale,
    generatedAt: new Date().toISOString(),
    catalog: { id: analysisCatalogId, build: analysisCatalogBuild },
    program,
    resources,
  })
}
