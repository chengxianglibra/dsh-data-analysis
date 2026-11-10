import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import type { MarivoCheckedRunner } from '../environment/types.ts'
import { type ResultReference, resultReference } from './contracts/result-reference.ts'
import { isFrameSnapshotV2, parseAnalysisSnapshot } from './contracts/snapshot.ts'
import { PRESENTATION_BUDGETS } from './contracts/types.ts'

const projectionRoot = fileURLToPath(new URL('../../python/presentation/', import.meta.url))
/** Load the Host-owned projection by exact installation path, outside Workspace import lookup. */
const READ_RESULT = String.raw`
import importlib.util, os, sys
os.environ["MARIVO_PROJECT_ROOT"] = os.getcwd()
spec = importlib.util.spec_from_file_location("_dsh_projection", sys.argv[1] + "/__init__.py", submodule_search_locations=[sys.argv[1]])
module = importlib.util.module_from_spec(spec)
sys.modules["_dsh_projection"] = module
spec.loader.exec_module(module)
from _dsh_projection.read_result import main
main()
`.trim()

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
    'The saved result contains a type unsupported by this display.',
  'result-read-failed': 'Verify the saved reference and bound Runtime; do not replay analysis.',
} as const

export async function readMarivoResult(
  runner: MarivoCheckedRunner,
  reference: ResultReference,
  signal: AbortSignal,
) {
  signal.throwIfAborted()
  const ref = resultReference.parse(reference)
  if (
    ref.schema === 'marivo.dataframe_ref/v2' &&
    (!path.isAbsolute(ref.project_root) ||
      path.normalize(ref.project_root) !== runner.binding.projectRoot)
  )
    throw new Error('result-workspace-mismatch')
  const result = await runner.runChecked({
    program: READ_RESULT,
    args: [projectionRoot],
    stdin: JSON.stringify(ref),
    environmentOverlay: { MARIVO_TELEMETRY: 'off', PYTHONDONTWRITEBYTECODE: '1' },
    limits: {
      timeoutMs: 120_000,
      stdoutMaxBytes: PRESENTATION_BUDGETS.datasetBytes,
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
    throw new Error(`${code}: ${repairs[code]}`)
  }
  const snapshot = parseAnalysisSnapshot(JSON.parse(result.stdout.toString('utf8')))
  if (
    ref.schema === 'marivo.frame_ref/v2'
      ? !isFrameSnapshotV2(snapshot) ||
        snapshot.source.sessionId !== ref.session_id ||
        snapshot.source.artifactId !== ref.artifact_id
      : snapshot.kind !== 'dataset'
  )
    throw new Error('result-identity-mismatch')
  return snapshot
}
