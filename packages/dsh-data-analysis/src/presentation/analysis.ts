import path from 'node:path'
import type { MarivoCheckedRunner } from '../environment/types.ts'
import { readPythonResults } from '../python-execution.ts'
import { analysisCatalogBuild, analysisCatalogId } from './contracts/analysis-catalog.ts'
import {
  ANALYSIS_UI_FORMAT,
  type AnalysisDocument,
  type AnalysisPresentInput,
  type AnalysisResourceDeclaration,
  AnalysisViewError,
  analysisElements,
  analysisRecordId,
  parseAnalysisDocument,
  parseAnalysisResource,
  sameAnalysisDeclaration,
} from './contracts/analysis-document.ts'
import {
  analysisStatements,
  mergeAnalysisProgram,
  parseAnalysisProgram,
} from './contracts/analysis-program.ts'
import { resolveDatasetView } from './contracts/dataset-view.ts'
import { frameViewSchema, resolveFrameView } from './contracts/frame-view.ts'
import { sameAnalysisResult } from './contracts/resource-declaration.ts'
import { resultReferenceKey } from './contracts/result-reference.ts'
import { PRESENTATION_BUDGETS } from './contracts/types.ts'
import { readDatasetSnapshot, readFrameSnapshot } from './dataset-snapshot.ts'
import { presentationSha256, readReportFile } from './files.ts'
import { PresentationRecoveryError } from './recovery.ts'
import { readMarivoResult } from './result-reader.ts'
import { analysisResultSummary } from './result-summary.ts'

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
  'analysis-frame': 'AnalysisFrameView',
  dataframe: 'DatasetView',
  'frame-snapshot': 'AnalysisFrameView',
  'dataset-snapshot': 'DatasetView',
  'image-file': 'Image',
}

/** Authored report text remains static when the underlying fixed results change. */
function hasNarrativeText(nodes: ReturnType<typeof analysisElements>): boolean {
  return nodes.some((node) => {
    const properties =
      node.typeName === 'TextContent'
        ? ['text']
        : node.typeName === 'TextCallout'
          ? ['title', 'description']
          : node.typeName === 'AccordionItem'
            ? ['trigger']
            : []
    return properties.some((name) => {
      const value = node.props[name]
      return typeof value === 'string' && value.trim().length > 0
    })
  })
}
/** Read each admitted resource once; saved bytes never depend on the capture directory. */
export async function createAnalysisDocument(
  input: AnalysisPresentInput,
  source: { projectRoot: string; runner?: () => Promise<MarivoCheckedRunner> },
  identity: { workspaceId: string; reportId: string; buildId: string },
  signal: AbortSignal,
  base?: AnalysisDocument,
  retainedResources?: AnalysisDocument['resources'],
  resourceReady?: (name: string, resource: AnalysisDocument['resources'][string]) => Promise<void>,
): Promise<AnalysisDocument> {
  const declarations: Record<string, AnalysisResourceDeclaration> = Object.fromEntries(
    Object.entries(base?.resources ?? {}).map(([name, resource]) => [name, resource.declaration]),
  )
  const put = input.resourcePatch?.put ?? {}
  const remove = input.resourcePatch?.remove ?? []
  if (new Set(remove).size !== remove.length) throw new Error('analysis-resource-remove-duplicate')
  for (const name of remove) {
    if (Object.hasOwn(put, name)) throw new Error(`analysis-resource-patch-conflict: ${name}`)
    if (!Object.hasOwn(declarations, name))
      throw new Error(`analysis-resource-remove-unknown: ${name}`)
    delete declarations[name]
  }
  Object.assign(declarations, put)
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
    if (ref !== undefined && (typeof ref !== 'string' || !Object.hasOwn(declarations, ref)))
      throw new PresentationRecoveryError(
        'analysis-resource-missing',
        'Include the missing resource in resourcePatch.put using its existing fixed declaration, or correct the reference in the program.',
        typeof ref === 'string' ? { resource: ref } : {},
      )
  }
  const resources: AnalysisDocument['resources'] = {}
  const pending = entries.filter(([name, declaration]) => {
    const saved = [base?.resources[name], retainedResources?.[name]].find(
      (resource) => resource && sameAnalysisDeclaration(resource.declaration, declaration),
    )
    if (!saved) return true
    resources[name] = structuredClone(saved)
    return false
  })
  let selectedRunner: Promise<MarivoCheckedRunner> | undefined
  const readResource = async (name: string, declaration: AnalysisResourceDeclaration) => {
    signal.throwIfAborted()
    // Exact immutable inputs can serve multiple views. Keep their original producer binding.
    const shared = Object.values(resources).find((resource) =>
      sameAnalysisDeclaration(resource.declaration, declaration),
    )
    if (shared) {
      resources[name] = structuredClone(shared)
      return
    }
    if (declaration.kind === 'analysis-frame' || declaration.kind === 'dataframe') {
      let producer: Awaited<ReturnType<typeof readPythonResults>> | undefined
      if (declaration.codeRef) {
        producer = await readPythonResults(source.projectRoot, declaration.codeRef, signal)
        const key = resultReferenceKey(declaration.ref)
        if (!producer.references.some((ref) => resultReferenceKey(ref) === key))
          throw new Error(
            'analysis-resource-code-not-bound: this readable execution exported other result references. Use codeRef from the successful marivo_python call that exported this exact reference through resultVariables, or present the existing reference without codeRef. Do not rerun successful analysis only to attach provenance.',
          )
      }
      if (!source.runner) throw new Error('result-runtime-required')
      selectedRunner ??= source.runner()
      const runner = await selectedRunner
      if (runner.binding.projectRoot !== source.projectRoot)
        throw new Error('result-workspace-mismatch')
      const snapshot = await readMarivoResult(runner, declaration.ref, signal)
      resources[name] = {
        kind: 'snapshot',
        declaration,
        snapshot,
        binding: {
          workspaceId: identity.workspaceId,
          ...(producer
            ? {
                codeRef: declaration.codeRef,
                sessionId: producer.sessionId,
                callId: producer.callId,
              }
            : {}),
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
  const admit = async (name: string) => {
    if (!resourceReady) return
    const resource = structuredClone(resources[name]!)
    const previous = base?.resources[name]
    if (
      resource.kind === 'snapshot' &&
      previous?.kind === 'snapshot' &&
      input.labels?.[name] === undefined
    ) {
      const labels = new Map(
        previous.snapshot.data.columns.map((column) => [column.id, column.label]),
      )
      resource.snapshot.data.columns = resource.snapshot.data.columns.map((column) => ({
        ...column,
        label: labels.get(column.id) ?? column.label,
      }))
    }
    applyAnalysisLabels(
      { [name]: resource },
      input.labels?.[name] === undefined ? undefined : { [name]: input.labels[name]! },
    )
    await resourceReady(name, parseAnalysisResource(resource, identity.workspaceId))
  }
  let failure: unknown
  const ready = async (name: string) => {
    try {
      await admit(name)
    } catch (error) {
      signal.throwIfAborted()
      failure ??= error
    }
  }
  for (const name of Object.keys(resources)) {
    const previous = base?.resources[name]
    if (!previous || !sameAnalysisDeclaration(previous.declaration, resources[name]!.declaration))
      await ready(name)
  }
  // Session.resume reconciles under a writer lock, even for fixed reads.
  // Read sequentially while publishing each ready resource immediately.
  const groups: { name: string; declaration: AnalysisResourceDeclaration; aliases: string[] }[] = []
  for (const [name, declaration] of pending) {
    const existing = groups.find((group) => sameAnalysisDeclaration(group.declaration, declaration))
    if (existing) existing.aliases.push(name)
    else groups.push({ name, declaration, aliases: [] })
  }
  for (const group of groups) {
    try {
      await readResource(group.name, group.declaration)
      signal.throwIfAborted()
      await ready(group.name)
      for (const alias of group.aliases) {
        resources[alias] = structuredClone(resources[group.name]!)
        await ready(alias)
      }
    } catch (error) {
      signal.throwIfAborted()
      failure ??= error
      delete resources[group.name]
    }
  }
  signal.throwIfAborted()
  if (failure) throw failure
  // A data replacement keeps the existing display labels unless explicitly replaced.
  for (const [name, resource] of Object.entries(resources)) {
    const previous = base?.resources[name]
    if (
      resource.kind !== 'snapshot' ||
      previous?.kind !== 'snapshot' ||
      input.labels?.[name] !== undefined
    )
      continue
    const labels = new Map(
      previous.snapshot.data.columns.map((column) => [column.id, column.label]),
    )
    resource.snapshot.data.columns = resource.snapshot.data.columns.map((column) => ({
      ...column,
      label: labels.get(column.id) ?? column.label,
    }))
  }
  try {
    applyAnalysisLabels(resources, input.labels)
    return parseAnalysisDocument({
      schemaVersion: ANALYSIS_UI_FORMAT,
      contentReview:
        base?.contentReview === 'required'
          ? 'required'
          : base &&
              Object.entries(resources).some(
                ([name, resource]) =>
                  base.resources[name] &&
                  !sameAnalysisResult(base.resources[name]!.declaration, resource.declaration),
              )
            ? hasNarrativeText(nodes)
              ? 'required'
              : 'not-needed'
            : base
              ? (base.contentReview ?? 'unknown')
              : 'not-needed',
      ...identity,
      recordId: analysisRecordId(identity.reportId, identity.buildId),
      title,
      locale: input.locale ?? base?.locale ?? 'zh-CN',
      generatedAt: new Date().toISOString(),
      catalog: { id: analysisCatalogId, build: analysisCatalogBuild },
      program,
      resources,
    })
  } catch (error) {
    if (
      error instanceof Error &&
      /^(analysis-view-|analysis-columns-|analysis-metric-|analysis-label-|analysis-filter-)/.test(
        error.message,
      )
    ) {
      const name =
        error instanceof AnalysisViewError
          ? error.resourceName
          : /^analysis-label-unknown at \/labels\/([^/ :]+)/.exec(error.message)?.[1]
      const relevant = name && resources[name] ? { [name]: resources[name] } : {}
      error.message += ` Result metadata: ${JSON.stringify(analysisResultSummary(relevant))}. Use the result metadata and any supplied candidates to correct the indicated parameter; Frame axis inputs use axes[].name, not column IDs or tokens. Do not rerun analysis to recover metadata.`
    }
    throw error
  }
}

/** Compare resolved chart identity; data-dependent geometry and row layout can still vary. */
export function validateRefreshShape(base: AnalysisDocument, next: AnalysisDocument): void {
  for (const node of analysisElements(parseAnalysisProgram(base.program))) {
    if (node.typeName !== 'AnalysisFrameView' && node.typeName !== 'DatasetView') continue
    const name = String(node.props.ref)
    const before = base.resources[name],
      after = next.resources[name]
    if (
      before?.kind !== 'snapshot' ||
      after?.kind !== 'snapshot' ||
      before.snapshot.kind !== after.snapshot.kind
    )
      throw new Error(`report-refresh-resource-kind-changed: ${name}`)
    const view = frameViewSchema.optional().parse(node.props.view ?? undefined)
    const resolve = (resource: typeof before) =>
      resource.snapshot.kind === 'dataset'
        ? resolveDatasetView(resource.snapshot, view)
        : resolveFrameView(resource.snapshot, view)
    const previous = resolve(before),
      current = resolve(after)
    if (!previous.ok || !current.ok) throw new Error(`report-refresh-view-invalid: ${name}`)
    if (previous.view.chart !== current.view.chart)
      throw new AnalysisViewError(
        'report-refresh-view-shape-changed',
        `${node.statementId ?? node.typeName}/view/chart`,
        `${previous.view.chart} -> ${current.view.chart}; use an explicit edit to change the page.`,
        name,
      )
  }
}
