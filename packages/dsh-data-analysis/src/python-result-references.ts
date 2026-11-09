import { z } from 'zod'
import { resultReference } from './presentation/contracts/result-reference.ts'

export const PYTHON_RESULT_HEADER = '__DSH_MARIVO_RESULTS_V1__:'
const resultName = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/)
export const pythonResultVariables = z
  .record(
    resultName,
    z
      .string()
      .min(1)
      .max(128)
      .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  )
  .refine((value) => Object.keys(value).length > 0 && Object.keys(value).length <= 16)
const resultOutput = z.strictObject({
  status: z.literal('ok'),
  references: z.record(resultName, resultReference),
})
const RESULT_CAPTURE_ERROR =
  'Python completed, but its declared result references were not exported. Inspect existing effects and the declared reference variables; do not rerun successful code merely to recover export metadata.'

/** References returned by one successful invocation, not proof of how it computed them. */
export const pythonResultRecord = z.strictObject({
  sessionId: z.string().min(1).max(512),
  callId: z.string().min(1).max(512),
  rootCallId: z.string().min(1).max(512),
  variables: pythonResultVariables,
  references: z.array(resultReference).min(1).max(16),
})
export type PythonResultRecord = z.infer<typeof pythonResultRecord>

/** Consume only the launcher-owned first control frame, never user output lines. */
export function readPythonResultOutput(stderr: string, variables: Record<string, string>) {
  const end = stderr.indexOf('\n')
  if (!stderr.startsWith(PYTHON_RESULT_HEADER) || end < 0)
    return { stderr, resultCaptureError: RESULT_CAPTURE_ERROR }
  const text = stderr.slice(PYTHON_RESULT_HEADER.length, end)
  const remainder = stderr.slice(end + 1)
  try {
    const bytes = Buffer.from(text, 'base64')
    if (bytes.length > 32768) throw new Error('result-export-budget')
    const output = resultOutput.parse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    )
    if (Object.keys(output.references).sort().join(',') !== Object.keys(variables).sort().join(','))
      throw new Error('result-export-names')
    return { stderr: remainder, resultRefs: output.references }
  } catch {
    return { stderr: remainder, resultCaptureError: RESULT_CAPTURE_ERROR }
  }
}
