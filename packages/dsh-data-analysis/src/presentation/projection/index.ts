import { MarivoEnvironmentError } from '../../environment/errors.ts'
import type { MarivoCheckedRunner } from '../../environment/types.ts'
import { readPythonExecution } from '../../python-execution.ts'
import {
  type DocumentDataset,
  PRESENTATION_BUDGETS,
  PresentationContractError,
  type PresentationDiagnostic,
  type PresentationDocument,
  type PresentationDraft,
  parsePresentationDocument,
  parsePresentationDraft,
  parseTypedDataset,
} from '../contracts/index.ts'
import { readWorkspaceJson } from './files.ts'
import { MARIVO_PRESENTATION_READ_PROGRAM } from './program.ts'

export { readWorkspaceJson } from './files.ts'

export interface PresentationProjectionOptions {
  /** Workspace identity is resolved by Host together with this runner, never from a draft. */
  workspaceId: string
  reportId: string
  buildId: string
  generatedAt?: string
  signal?: AbortSignal
}

function invalidOutput(): never {
  throw new MarivoEnvironmentError(
    'subprocess-output-invalid',
    'Marivo presentation reader returned an invalid projection.',
  )
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidOutput()
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).sort().join(',') !== keys.sort().join(',')) invalidOutput()
}

/** Internal S2 bridge: restores public data without observe, revalidation or credential admission. */
export class MarivoPresentationProjection {
  readonly #runner: MarivoCheckedRunner

  constructor(runner: MarivoCheckedRunner) {
    this.#runner = runner
  }

  get status() {
    return this.#runner.status
  }

  get binding() {
    return this.#runner.binding
  }

  async readDraft(relativePath: string, signal?: AbortSignal): Promise<PresentationDraft> {
    this.#assertReady(signal)
    return parsePresentationDraft(
      await readWorkspaceJson(
        this.binding.projectRoot,
        relativePath,
        PRESENTATION_BUDGETS.draftBytes,
        '/draft_path',
        signal,
      ),
    )
  }

  #assertReady(signal?: AbortSignal) {
    signal?.throwIfAborted()
    if (this.#runner.status !== 'ready')
      throw new MarivoEnvironmentError(
        'binding-failed',
        'Presentation projection requires a ready bound Runtime.',
      )
    if (!this.binding.presentationKit)
      throw new MarivoEnvironmentError(
        'binding-identity-mismatch',
        'Presentation projection requires the checked presentation helper identity.',
      )
  }

  async project(
    value: unknown,
    options: PresentationProjectionOptions,
  ): Promise<PresentationDocument> {
    this.#assertReady(options.signal)
    // Snapshot caller-owned input before awaiting IO.
    const draft = structuredClone(parsePresentationDraft(value))
    const datasets: DocumentDataset[] = []
    const artifactSelections = draft.datasets.flatMap((dataset, index) =>
      dataset.kind === 'artifact'
        ? [
            {
              id: dataset.id,
              kind: dataset.kind,
              sourceId: dataset.sourceId,
              rowLimit: dataset.rowLimit,
              ...(dataset.columns ? { columns: dataset.columns } : {}),
              index,
            },
          ]
        : [],
    )
    let sources: unknown = []
    let diagnostics: PresentationDiagnostic[] = []
    const artifactData = new Map<string, unknown>()
    if (draft.sources.length > 0) {
      const result = await this.#runner.runChecked({
        program: MARIVO_PRESENTATION_READ_PROGRAM,
        args: [JSON.stringify({ sources: draft.sources, datasets: artifactSelections })],
        limits: {
          timeoutMs: 30_000,
          stdoutMaxBytes: PRESENTATION_BUDGETS.documentBytes,
          stderrMaxBytes: 65_536,
        },
        signal: options.signal,
      })
      this.#assertReady(options.signal)
      if (result.exitCode !== 0)
        throw new MarivoEnvironmentError(
          'subprocess-failed',
          'The bound Marivo presentation read failed.',
          { exitCode: result.exitCode },
        )
      let payload: Record<string, unknown>
      try {
        payload = record(
          JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(result.stdout)),
        )
      } catch {
        invalidOutput()
      }
      if (payload.ok === false) {
        exactKeys(payload, ['ok', 'error'])
        const error = record(payload.error)
        exactKeys(error, ['code', 'path', 'message'])
        if (
          typeof error.code !== 'string' ||
          !/^[a-z_]{1,128}$/.test(error.code) ||
          typeof error.path !== 'string' ||
          error.path.length > 1024 ||
          !/^(?:\/(?:[^~]|~[01])*)*$/.test(error.path) ||
          typeof error.message !== 'string' ||
          error.message.length > 1024
        )
          invalidOutput()
        throw new PresentationContractError(error.code, error.path, error.message)
      }
      exactKeys(payload, ['ok', 'sources', 'datasets', 'diagnostics'])
      if (
        payload.ok !== true ||
        !Array.isArray(payload.sources) ||
        !Array.isArray(payload.datasets) ||
        !Array.isArray(payload.diagnostics)
      )
        invalidOutput()
      if (
        payload.sources.length !== draft.sources.length ||
        payload.datasets.length !== artifactSelections.length
      )
        invalidOutput()
      for (const [index, source] of payload.sources.entries()) {
        const actual = record(source)
        const ref = record(actual.ref)
        const expected = draft.sources[index]!
        if (
          actual.id !== expected.id ||
          ref.sessionId !== expected.ref.sessionId ||
          ref.artifactRef !== expected.ref.artifactRef ||
          ref.findingId !== expected.ref.findingId
        )
          invalidOutput()
      }
      for (const [index, entry] of payload.datasets.entries()) {
        const dataset = record(entry)
        exactKeys(dataset, ['id', 'data'])
        if (dataset.id !== artifactSelections[index]!.id) invalidOutput()
        artifactData.set(artifactSelections[index]!.id, dataset.data)
      }
      sources = payload.sources
      diagnostics = payload.diagnostics as PresentationDiagnostic[]
    }
    for (const [index, dataset] of draft.datasets.entries()) {
      this.#assertReady(options.signal)
      const location = `/datasets/${index}`
      let data: unknown
      if (dataset.kind === 'computed') {
        data = await readWorkspaceJson(
          this.binding.projectRoot,
          dataset.path,
          PRESENTATION_BUDGETS.datasetBytes,
          `${location}/path`,
          options.signal,
        )
      } else data = artifactData.get(dataset.id)
      data = parseTypedDataset(data, `${location}/data`)
      if (dataset.kind === 'artifact') {
        const typed = data as DocumentDataset['data']
        if (
          typed.limit > dataset.rowLimit ||
          (dataset.columns !== undefined &&
            (typed.columns.length !== dataset.columns.length ||
              typed.columns.some((column, index) => column.id !== dataset.columns![index])))
        )
          invalidOutput()
      }
      const code: NonNullable<DocumentDataset['code']> = []
      for (const [codeIndex, ref] of (dataset.codeRefs ?? []).entries()) {
        this.#assertReady(options.signal)
        try {
          code.push(await readPythonExecution(this.binding.projectRoot, ref, options.signal))
        } catch {
          options.signal?.throwIfAborted()
          throw new PresentationContractError(
            'code_unavailable',
            `${location}/codeRefs/${codeIndex}`,
            'The captured Python execution cannot be read with its exact Workspace identity and digest.',
            'Check the codeRef returned by the successful marivo_python call; do not rerun analysis to repair presentation.',
          )
        }
      }
      this.#assertReady(options.signal)
      datasets.push({
        id: dataset.id,
        origin: dataset.kind,
        data: data as DocumentDataset['data'],
        sourceIds: dataset.kind === 'artifact' ? [dataset.sourceId] : dataset.sourceIds,
        ...(dataset.codeRefs !== undefined ? { code } : {}),
      })
    }
    for (const [index, dataset] of datasets.entries()) {
      if (dataset.data.truncated)
        diagnostics.push({
          code: 'truncated',
          path: `/datasets/${index}/data/rows`,
          message: `Showing ${dataset.data.rows.length} of ${dataset.data.rowCount} rows; truncated data must not imply full totals or rankings.`,
        })
    }
    for (const [index, source] of (sources as { status: string }[]).entries()) {
      if (source.status === 'unavailable')
        diagnostics.push({
          code: 'source_unavailable',
          path: `/sources/${index}`,
          message: 'The declared Artifact source cannot be restored in the bound Workspace.',
        })
    }
    this.#assertReady(options.signal)
    return parsePresentationDocument({
      schemaVersion: 3,
      locale: draft.locale,
      reportId: options.reportId,
      workspaceId: options.workspaceId,
      buildId: options.buildId,
      title: draft.title,
      generatedAt: options.generatedAt ?? new Date().toISOString(),
      datasets,
      sources,
      blocks: draft.blocks,
      ...(draft.interaction ? { interaction: draft.interaction } : {}),
      diagnostics,
    })
  }
}
