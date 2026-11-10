import { z } from 'zod'
import { analysisResourceDeclaration } from './presentation/contracts/resource-declaration.ts'
import { type ResultReference, resultReference } from './presentation/contracts/result-reference.ts'
import type { PythonCodeRef } from './python-execution.ts'

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
const metadataName = z.string().min(1).max(256)
const resultMetadata = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('captured'),
    kind: z.enum(['frame', 'dataset']),
    columns: z.array(metadataName).max(64),
    values: z.array(metadataName).max(64),
    axes: z
      .array(z.strictObject({ token: metadataName, name: metadataName, role: metadataName }))
      .max(64),
    coverage: z.strictObject({
      totalRows: z.number().int().nonnegative().nullable(),
      business: z.literal('unknown'),
    }),
  }),
  z.strictObject({
    status: z.literal('unavailable'),
    reason: z.enum(['budget', 'read-failed', 'identity-mismatch']),
  }),
])
const pythonResourceDeclaration = analysisResourceDeclaration.transform((resource, context) => {
  if (resource.kind === 'analysis-frame' || resource.kind === 'dataframe') return resource
  context.addIssue({
    code: 'custom',
    message: 'Python exports require a persisted Marivo reference',
  })
  return z.NEVER
})
const pythonResultFields = { resource: pythonResourceDeclaration, metadata: resultMetadata }
export const pythonResult = z
  .discriminatedUnion('sourceStatus', [
    z.strictObject({ ...pythonResultFields, sourceStatus: z.literal('recorded') }),
    z.strictObject({
      ...pythonResultFields,
      sourceStatus: z.literal('unavailable'),
      sourceError: z.string().min(1),
    }),
  ])
  .superRefine((value, context) => {
    if ((value.sourceStatus === 'recorded') !== (value.resource.codeRef !== undefined))
      context.addIssue({
        code: 'custom',
        message: 'Python result source status must match codeRef',
      })
  })
export type PythonResult = z.infer<typeof pythonResult>

/** Assemble every public handoff from the same validated export and source record. */
export function pythonResults(
  references: Readonly<Record<string, ResultReference>>,
  metadata: Readonly<Record<string, z.infer<typeof resultMetadata>>> | undefined,
  codeRef: PythonCodeRef | undefined,
  sourceError: string | undefined,
): Record<string, PythonResult> {
  return Object.fromEntries(
    Object.entries(references).map(([name, ref]) => {
      const resource = {
        kind: ref.schema === 'marivo.frame_ref/v2' ? 'analysis-frame' : 'dataframe',
        ref,
        ...(codeRef ? { codeRef } : {}),
      }
      return [
        name,
        pythonResult.parse({
          resource,
          ...(codeRef
            ? { sourceStatus: 'recorded' as const }
            : {
                sourceStatus: 'unavailable' as const,
                sourceError:
                  sourceError ??
                  'Source recording is unavailable; do not rerun successful code to recover it.',
              }),
          metadata: metadata?.[name] ?? { status: 'unavailable', reason: 'read-failed' },
        }),
      ]
    }),
  )
}
const resultOutput = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('ok'),
    references: z.record(resultName, z.unknown()),
    metadata: z.unknown().optional(),
  }),
  z.strictObject({
    status: z.literal('unavailable'),
    name: resultName,
    reason: z.enum(['missing-variable', 'not-dictionary']),
  }),
])
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

function containsSecret(value: unknown, secrets: readonly string[]): boolean {
  if (typeof value === 'string') return secrets.some((secret) => value.includes(secret))
  if (Array.isArray(value)) return value.some((item) => containsSecret(item, secrets))
  if (typeof value !== 'object' || value === null) return false
  return Object.entries(value).some(
    ([key, item]) => containsSecret(key, secrets) || containsSecret(item, secrets),
  )
}

/** Consume only the launcher-owned first control frame, never user output lines. */
export function readPythonResultOutput(
  stderr: string,
  variables: Record<string, string>,
  secretValues: readonly string[] = [],
): {
  stderr: string
  resultRefs?: Record<string, ResultReference>
  resultMetadata?: Record<string, z.infer<typeof resultMetadata>>
  resultCaptureError?: string
} {
  const end = stderr.indexOf('\n')
  if (!stderr.startsWith(PYTHON_RESULT_HEADER) || end < 0)
    return { stderr, resultCaptureError: RESULT_CAPTURE_ERROR }
  const text = stderr.slice(PYTHON_RESULT_HEADER.length, end)
  const remainder = stderr.slice(end + 1)
  const secrets = secretValues.filter(Boolean)
  const failure = (name?: string, reason?: string) => ({
    stderr: remainder,
    resultCaptureError:
      name && Object.hasOwn(variables, name) && !containsSecret([name, variables[name]], secrets)
        ? `${RESULT_CAPTURE_ERROR} Output ${JSON.stringify(name)}, variable ${JSON.stringify(variables[name])}: ${reason} Expected an exact persisted reference dictionary, such as saved.ref.to_dict() for a Frame.`
        : RESULT_CAPTURE_ERROR,
  })
  try {
    const bytes = Buffer.from(text, 'base64')
    if (bytes.length > 32768) throw new Error('result-export-budget')
    const output = resultOutput.parse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    )
    if (output.status === 'unavailable')
      return failure(
        output.name,
        output.reason === 'missing-variable'
          ? 'Variable is not defined.'
          : 'Value is not a dictionary.',
      )
    if (Object.keys(output.references).sort().join(',') !== Object.keys(variables).sort().join(','))
      throw new Error('result-export-names')
    if (containsSecret(output.references, secrets)) throw new Error('result-export-sensitive')
    const references = z.record(resultName, resultReference).safeParse(output.references)
    if (!references.success) {
      const name = references.error.issues[0]?.path[0]
      return failure(typeof name === 'string' ? name : undefined, 'Reference is invalid.')
    }
    const metadata = z.record(resultName, resultMetadata).safeParse(output.metadata)
    const validMetadata =
      metadata.success &&
      Object.keys(metadata.data).sort().join(',') === Object.keys(variables).sort().join(',')
    return {
      stderr: remainder,
      resultRefs: references.data,
      ...(output.metadata === undefined
        ? {}
        : {
            resultMetadata: validMetadata
              ? Object.fromEntries(
                  Object.entries(metadata.data).map(([name, value]) => [
                    name,
                    containsSecret(value, secrets)
                      ? { status: 'unavailable' as const, reason: 'read-failed' as const }
                      : value,
                  ]),
                )
              : Object.fromEntries(
                  Object.keys(variables).map((name) => [
                    name,
                    { status: 'unavailable' as const, reason: 'read-failed' as const },
                  ]),
                ),
          }),
    }
  } catch {
    return failure()
  }
}
