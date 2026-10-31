import path from 'node:path'
import { analysisCatalogBuild, analysisCatalogId } from './contracts/analysis-catalog.ts'
import {
  ANALYSIS_UI_FORMAT,
  type AnalysisDocument,
  type AnalysisPresentInput,
  type AnalysisResourceDeclaration,
  analysisElements,
  analysisRecordId,
  parseAnalysisDocument,
  sameAnalysisDeclaration,
} from './contracts/analysis-document.ts'
import {
  analysisStatements,
  mergeAnalysisProgram,
  parseAnalysisProgram,
} from './contracts/analysis-program.ts'
import { PRESENTATION_BUDGETS } from './contracts/types.ts'
import { readDatasetSnapshot, readFrameSnapshot } from './dataset-snapshot.ts'
import { presentationSha256, readReportFile } from './files.ts'
import type { MarivoPresentationProjection } from './projection/index.ts'

/** Present-level labels live only in the embedded snapshot; they never become a document field. */
const LABEL_BYTES = 16 * 1024
const LABEL_HINT = `at most ${PRESENTATION_BUDGETS.columns} labels per resource and ${LABEL_BYTES} UTF-8 bytes in total.`
/**
 * Merge display labels into embedded snapshot columns before the Build is written. A resource
 * named in `labels` replaces its present-level labels: every column starts from its id again so
 * stale labels cannot survive an update. Omitted resources keep their inherited labels.
 */
export function applyAnalysisLabels(
  resources: AnalysisDocument['resources'],
  labels: AnalysisPresentInput['labels'],
): void {
  if (!labels) return
  const entries = Object.entries(labels)
  for (const [name, map] of entries) {
    const target = resources[name]
    if (target?.kind !== 'snapshot')
      throw new Error(
        `analysis-label-unknown at /labels/${name}: expected a declared snapshot resource named "${name}".`,
      )
    if (Object.keys(map).length > PRESENTATION_BUDGETS.columns)
      throw new Error(`analysis-label-budget at /labels: ${LABEL_HINT}`)
    const columns = new Set(target.snapshot.data.columns.map((column) => column.id))
    for (const column of Object.keys(map))
      if (!columns.has(column))
        throw new Error(
          `analysis-label-unknown at /labels/${name}/${column}: expected a column id of this snapshot.`,
        )
  }
  const bytes = entries.reduce(
    (total, [, map]) =>
      total +
      Object.values(map).reduce((sum, label) => sum + new TextEncoder().encode(label).length, 0),
    0,
  )
  if (bytes > LABEL_BYTES) throw new Error(`analysis-label-budget at /labels: ${LABEL_HINT}`)
  for (const [name, map] of entries) {
    const target = resources[name]
    if (target?.kind !== 'snapshot') continue
    const snapshot = structuredClone(target.snapshot)
    snapshot.data.columns = snapshot.data.columns.map((column) => ({
      ...column,
      label: map[column.id] ?? column.id,
    }))
    target.snapshot = snapshot
  }
}

function imageMime(bytes: Buffer) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png'
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())) return 'image/gif'
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP')
    return 'image/webp'
  throw new Error('analysis-image-format-unsupported')
}
const defaultComponent: Record<AnalysisResourceDeclaration['kind'], string> = {
  'marivo-frame': 'AnalysisFrameView',
  'frame-snapshot': 'AnalysisFrameView',
  'dataset-snapshot': 'DatasetView',
  'image-file': 'Image',
}
/** Read each admitted resource once; saved bytes never depend on the capture directory. */
export async function createAnalysisDocument(
  input: AnalysisPresentInput,
  source: { projectRoot: string; projection: () => Promise<MarivoPresentationProjection> },
  identity: { workspaceId: string; reportId: string; buildId: string },
  signal: AbortSignal,
  base?: AnalysisDocument,
): Promise<AnalysisDocument> {
  const declarations =
    input.resources ??
    Object.fromEntries(
      Object.entries(base?.resources ?? {}).map(([name, resource]) => [name, resource.declaration]),
    )
  const title = input.title ?? base?.title ?? 'Analysis'
  const entries = Object.entries(declarations)
  if (entries.length > PRESENTATION_BUDGETS.datasets) throw new Error('analysis-resource-budget')
  const single = entries.length === 1 ? entries[0] : undefined
  const program = base
    ? input.program
      ? mergeAnalysisProgram(base.program, input.program)
      : base.program
    : input.program
      ? analysisStatements(input.program)
      : single
        ? `root = ${defaultComponent[single[1].kind]}(${single[1].kind === 'image-file' ? `${JSON.stringify(title)}, ` : ''}${JSON.stringify(single[0])});`
        : ''
  const nodes = analysisElements(parseAnalysisProgram(program))
  for (const node of nodes) {
    const ref =
      node.typeName === 'Image'
        ? node.props.src
        : ['AnalysisFrameView', 'DatasetView'].includes(node.typeName)
          ? node.props.ref
          : undefined
    if (ref !== undefined && (typeof ref !== 'string' || !declarations[ref]))
      throw new Error('analysis-resource-missing')
  }
  const resources: AnalysisDocument['resources'] = {}
  const pending = entries.filter(([name, declaration]) => {
    const saved = base?.resources[name]
    if (!saved || !sameAnalysisDeclaration(saved.declaration, declaration)) return true
    resources[name] = structuredClone(saved)
    return false
  })
  const frameEntries = pending.filter(
    (entry): entry is [string, Extract<AnalysisResourceDeclaration, { kind: 'marivo-frame' }>] =>
      entry[1].kind === 'marivo-frame',
  )
  const projection = frameEntries.length ? await source.projection() : undefined
  const frames = frameEntries.length
    ? await projection!.readFrames(
        frameEntries.map(([name, r]) => {
          const views = nodes
            .filter((n) => n.typeName === 'AnalysisFrameView' && n.props.ref === name)
            .map(
              (n) =>
                n.props.view as
                  | { chart: string; columns?: string[]; encoding?: { value: string } }
                  | undefined,
            )
          // Only explicit table columns and metric values bound the read; every other
          // chart (comparison, decomposition, time and heatmap views) needs full columns.
          const all =
            !views.length ||
            views.some(
              (v) =>
                !v ||
                (v.chart !== 'table' && v.chart !== 'metric') ||
                (v.chart === 'table' && !v.columns) ||
                (v.chart === 'metric' && !v.encoding),
            )
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
  for (const [name, declaration] of pending) {
    signal.throwIfAborted()
    if (declaration.kind === 'marivo-frame') {
      resources[name] = {
        kind: 'snapshot',
        declaration,
        snapshot: frames[frameEntries.findIndex(([id]) => id === name)]!,
        binding: {
          workspaceId: identity.workspaceId,
          runtimeFingerprint: projection!.binding.fingerprint,
        },
      }
    } else if (declaration.kind === 'dataset-snapshot' || declaration.kind === 'frame-snapshot') {
      const { snapshot, codeRef, owner } = await (declaration.kind === 'dataset-snapshot'
        ? readDatasetSnapshot
        : readFrameSnapshot)(
        source.projectRoot,
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
        source.projectRoot,
        path.join(source.projectRoot, declaration.path),
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
  applyAnalysisLabels(resources, input.labels)
  return parseAnalysisDocument({
    schemaVersion: ANALYSIS_UI_FORMAT,
    ...identity,
    recordId: analysisRecordId(identity.reportId, identity.buildId),
    title,
    locale: input.locale ?? base?.locale ?? 'zh-CN',
    generatedAt: new Date().toISOString(),
    catalog: { id: analysisCatalogId, build: analysisCatalogBuild },
    program,
    resources,
  })
}
