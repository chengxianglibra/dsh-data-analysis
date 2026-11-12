import { z } from 'zod'
import { analysisResourceDeclaration } from './presentation/contracts/resource-declaration.ts'
import { type ResultReference, resultReference } from './presentation/contracts/result-reference.ts'
import {
  numericViewType,
  viewAxis,
  viewCandidates,
  viewFieldMetadata,
  viewNames,
} from './presentation/contracts/view-fields.ts'
import { type PythonException, pythonException, redactPythonException } from './python-exception.ts'
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
const metadataFacts = z.strictObject({
  status: z.literal('captured'),
  kind: z.enum(['frame', 'dataset']),
  columns: z.array(z.string().min(1).max(256)).max(64),
  values: viewNames,
  axes: z.array(viewAxis).max(64),
  coverage: z.strictObject({
    totalRows: z.number().int().nonnegative().nullable(),
    business: z.literal('unknown'),
  }),
})
const unavailableMetadata = z.strictObject({
  status: z.literal('unavailable'),
  reason: z.enum(['budget', 'read-failed', 'identity-mismatch']),
})
const resultMetadata = z.discriminatedUnion('status', [
  metadataFacts.extend(viewFieldMetadata),
  unavailableMetadata,
])
const wireResultMetadata = z.discriminatedUnion('status', [
  metadataFacts.extend({
    valueTypes: z.record(z.string(), z.string()),
    coordinateColumns: viewFieldMetadata.coordinateColumns,
  }),
  unavailableMetadata,
])

function describeMetadata(
  value: z.infer<typeof wireResultMetadata>,
): z.infer<typeof resultMetadata> {
  if (value.status === 'unavailable') return value
  const { valueTypes, ...facts } = value
  const values = facts.kind === 'frame' ? facts.values : facts.columns
  const summary = {
    ...facts,
    viewCandidates: viewCandidates(
      facts.columns,
      facts.kind === 'frame' ? facts.axes : undefined,
      values,
      values.filter((name) => Object.hasOwn(valueTypes, name) && numericViewType(valueTypes[name])),
    ),
  }
  return Buffer.byteLength(JSON.stringify(summary)) > 4096
    ? { status: 'unavailable', reason: 'budget' }
    : summary
}
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
    status: z.literal('collected'),
    references: z.record(resultName, z.unknown()),
    errors: z.record(resultName, z.enum(['missing-variable', 'not-fixed'])),
    error: pythonException.optional(),
    metadata: z.unknown().optional(),
  }),
  z.strictObject({
    status: z.literal('unavailable'),
    name: resultName,
    reason: z.enum(['missing-variable', 'not-dictionary']),
  }),
])
const RESULT_CAPTURE_ERROR =
  'One or more declared outputs could not be exported. Reuse returned resources and inspect existing effects before retrying.'

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
  error?: PythonException
} {
  const end = stderr.indexOf('\n')
  if (!stderr.startsWith(PYTHON_RESULT_HEADER) || end < 0)
    return { stderr, resultCaptureError: RESULT_CAPTURE_ERROR }
  const text = stderr.slice(PYTHON_RESULT_HEADER.length, end)
  const remainder = stderr.slice(end + 1)
  const secrets = secretValues.filter(Boolean)
  let error: PythonException | undefined
  const failure = (name?: string, reason?: string) => ({
    stderr: remainder,
    ...(error ? { error } : {}),
    resultCaptureError:
      name && Object.hasOwn(variables, name) && !containsSecret([name, variables[name]], secrets)
        ? `${RESULT_CAPTURE_ERROR} Output ${JSON.stringify(name)}, variable ${JSON.stringify(variables[name])}: ${reason} Expected a computed Frame, pandas DataFrame or an exact fixed reference (frame_ref/v2 or dataframe_ref/v2).`
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
    const errors = output.status === 'collected' ? output.errors : {}
    error =
      output.status === 'collected' && output.error
        ? redactPythonException(output.error, secrets)
        : undefined
    const names = [...Object.keys(output.references), ...Object.keys(errors)]
    if (names.sort().join(',') !== Object.keys(variables).sort().join(','))
      throw new Error('result-export-names')
    if (containsSecret(output.references, secrets)) throw new Error('result-export-sensitive')
    const references: Record<string, ResultReference> = Object.create(null)
    const diagnostics: string[] = []
    for (const name of names) {
      const ref = resultReference.safeParse(output.references[name])
      if (ref.success) {
        references[name] = ref.data
        continue
      }
      const reason = errors[name]
      const detail =
        reason === 'missing-variable'
          ? 'Variable is not defined.'
          : reason === 'not-fixed'
            ? 'Use a computed Frame, a persistable DataFrame or an exact fixed reference.'
            : 'Reference is invalid.'
      if (!containsSecret([name, variables[name]], secrets))
        diagnostics.push(
          `${JSON.stringify(name)} (variable ${JSON.stringify(variables[name])}): ${detail}`,
        )
    }
    const metadata = z.record(resultName, wireResultMetadata).safeParse(output.metadata)
    const validMetadata =
      metadata.success &&
      Object.keys(metadata.data).sort().join(',') ===
        Object.keys(output.references).sort().join(',')
    const missing = Object.keys(references).length !== names.length
    return {
      stderr: remainder,
      ...(error ? { error } : {}),
      ...(Object.keys(references).length ? { resultRefs: { ...references } } : {}),
      ...(missing ? { resultCaptureError: [RESULT_CAPTURE_ERROR, ...diagnostics].join(' ') } : {}),
      ...(output.metadata === undefined
        ? {}
        : {
            resultMetadata: validMetadata
              ? Object.fromEntries(
                  Object.entries(metadata.data)
                    .filter(([name]) => Object.hasOwn(references, name))
                    .map(([name, value]) => [
                      name,
                      containsSecret(value, secrets)
                        ? { status: 'unavailable' as const, reason: 'read-failed' as const }
                        : describeMetadata(value),
                    ]),
                )
              : Object.fromEntries(
                  Object.keys(references).map((name) => [
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
