import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import type { MarivoCheckedRunner } from '../environment/types.ts'
import { type ResultReference, resultReference } from './contracts/result-reference.ts'
import { isFrameSnapshotV2, parseAnalysisSnapshot } from './contracts/snapshot.ts'
import { PRESENTATION_BUDGETS } from './contracts/types.ts'
import {
  numericViewTypes,
  timeAxisRoles,
  viewCandidateUsage,
  type viewFieldMetadata,
} from './contracts/view-fields.ts'

const projectionRoot = fileURLToPath(new URL('../../python/presentation/', import.meta.url))
/** Load the Host-owned projection by exact installation path, outside Workspace import lookup. */
const LOAD_PROJECTION = String.raw`
import importlib.util, os, sys
os.environ["MARIVO_PROJECT_ROOT"] = os.getcwd()
spec = importlib.util.spec_from_file_location("_dsh_projection", sys.argv[1] + "/__init__.py", submodule_search_locations=[sys.argv[1]])
module = importlib.util.module_from_spec(spec)
sys.modules["_dsh_projection"] = module
spec.loader.exec_module(module)
`.trim()
const READ_RESULT = `${LOAD_PROJECTION}
from _dsh_projection.read_result import main
main()
`
const READ_CANDIDATES = `${LOAD_PROJECTION}
import json
from _dsh_projection.result_metadata import write_candidate_page
write_candidate_page(json.load(sys.stdin))
`

const readFailure = z.strictObject({
  error: z.strictObject({
    code: z.enum([
      'result-session-busy',
      'result-identity-mismatch',
      'result-workspace-mismatch',
      'result-budget',
      'result-display-type-unsupported',
      'result-read-failed',
    ]),
  }),
})
const repairs = {
  'result-session-busy':
    'Wait for the current Session action to finish, then read the same fixed reference; do not replay analysis.',
  'result-identity-mismatch':
    'Use the exact saved reference in its original Workspace and bound Runtime.',
  'result-workspace-mismatch': 'Read this reference in its original Workspace.',
  'result-budget':
    'The saved result exceeds the presentation budget; explicitly select a smaller result.',
  'result-display-type-unsupported':
    'Use the existing result to derive a projection with supported display types.',
  'result-read-failed':
    'Verify the exact saved reference and its original Runtime. Reuse other available fixed results.',
} as const

export class ResultReadError extends Error {
  constructor(code: keyof typeof repairs) {
    super(`${code}: ${repairs[code]}`)
    this.name = 'ResultReadError'
  }
}

async function runResultRead(
  runner: MarivoCheckedRunner,
  reference: ResultReference,
  signal: AbortSignal,
  program: string,
  input: unknown,
  stdoutMaxBytes: number,
) {
  signal.throwIfAborted()
  const ref = resultReference.parse(reference)
  if (
    ref.schema === 'marivo.dataframe_ref/v2' &&
    (!path.isAbsolute(ref.project_root) ||
      path.normalize(ref.project_root) !== runner.binding.projectRoot)
  )
    throw new ResultReadError('result-workspace-mismatch')
  const result = await runner.runChecked({
    program,
    args: [projectionRoot],
    stdin: JSON.stringify(input),
    environmentOverlay: { MARIVO_TELEMETRY: 'off', PYTHONDONTWRITEBYTECODE: '1' },
    limits: {
      timeoutMs: 120_000,
      stdoutMaxBytes,
      stderrMaxBytes: 16_384,
    },
    signal,
  })
  signal.throwIfAborted()
  if (runner.status !== 'ready') throw new Error('result-runtime-unavailable')
  if (result.exitCode !== 0) {
    let code: keyof typeof repairs = 'result-read-failed'
    try {
      code = readFailure.parse(JSON.parse(result.stdout.toString('utf8'))).error.code
    } catch {
      // Unknown process failures retain the safe fallback, never stderr.
    }
    throw new ResultReadError(code)
  }
  return JSON.parse(result.stdout.toString('utf8')) as unknown
}

export async function readMarivoResult(
  runner: MarivoCheckedRunner,
  reference: ResultReference,
  signal: AbortSignal,
) {
  const ref = resultReference.parse(reference)
  const snapshot = parseAnalysisSnapshot(
    await runResultRead(runner, ref, signal, READ_RESULT, ref, PRESENTATION_BUDGETS.datasetBytes),
  )
  if (
    ref.schema === 'marivo.frame_ref/v2'
      ? !isFrameSnapshotV2(snapshot) ||
        snapshot.source.sessionId !== ref.session_id ||
        snapshot.source.artifactId !== ref.artifact_id
      : snapshot.kind !== 'dataset'
  )
    throw new ResultReadError('result-identity-mismatch')
  return snapshot
}

const candidatePage = z.strictObject({
  kind: z.enum(['frame', 'dataset']),
  candidates: z.array(z.string().min(1)).max(12),
  nextOffset: z.number().int().nonnegative().nullable(),
})

export async function readMarivoCandidates(
  runner: MarivoCheckedRunner,
  reference: ResultReference,
  group: keyof z.infer<typeof viewFieldMetadata.viewCandidates>,
  offset: number,
  signal: AbortSignal,
) {
  const result = candidatePage.parse(
    await runResultRead(
      runner,
      reference,
      signal,
      READ_CANDIDATES,
      { reference, group, offset, numericTypes: numericViewTypes, timeAxisRoles },
      16_384,
    ),
  )
  const expectedKind = reference.schema === 'marivo.frame_ref/v2' ? 'frame' : 'dataset'
  if (result.kind !== expectedKind) throw new ResultReadError('result-identity-mismatch')
  if (
    result.nextOffset !== null &&
    (!result.candidates.length || result.nextOffset !== offset + result.candidates.length)
  )
    throw new ResultReadError('result-read-failed')
  return {
    candidates: result.candidates,
    ...viewCandidateUsage(result.kind)[group],
    nextOffset: result.nextOffset,
  }
}
