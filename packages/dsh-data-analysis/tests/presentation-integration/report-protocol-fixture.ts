import { z } from 'zod'
import { analysisRecordId } from '../../src/presentation/contracts/analysis-document.ts'
import {
  draftReportRef,
  parseReportRef,
  reportRefFromRecordId,
} from '../../src/presentation/contracts/report-ref.ts'

/** Existing fixtures name internal receipt identities; production only accepts ReportRef. */
export function reportWriteInput(args: Record<string, unknown>, turn = 1, sessionId = 'session') {
  const { draftId, draftRevision, basedOnRecordId, rebaseOnRecordId, ...input } = args
  return {
    ...(!draftId && !draftRevision ? { stage: 'save' } : {}),
    ...input,
    ...(typeof draftId === 'string' && typeof draftRevision === 'string'
      ? {
          ref: draftReportRef({
            workspaceId: 'workspace',
            sessionId,
            turn,
            draftId,
            revision: draftRevision,
          }),
        }
      : {}),
    ...(typeof basedOnRecordId === 'string'
      ? { ref: reportRefFromRecordId(basedOnRecordId, 'workspace') }
      : {}),
    ...(typeof rebaseOnRecordId === 'string'
      ? { onto: reportRefFromRecordId(rebaseOnRecordId, 'workspace') }
      : {}),
  }
}
const output = z.object({
  stage: z.enum(['preview', 'save']),
  ref: z.string(),
  deliveryJson: z.string(),
  resultMetadata: z.record(z.string(), z.json()),
})
export function reportWriteOutput(value: unknown) {
  const parsed = output.parse(value)
  const ref = parseReportRef(parsed.ref)
  // Existing assertions use receipt identities; canonical Native/PTC tests assert ref directly.
  return JSON.parse(
    JSON.stringify({
      ...parsed,
      ...(ref.kind === 'saved'
        ? { recordId: analysisRecordId(ref.reportId, ref.buildId) }
        : { draftId: ref.draftId, draftRevision: ref.revision }),
    }),
  )
}
export function reportReadInput(args: Record<string, unknown>) {
  const { recordId, current, ...input } = args
  return {
    ...input,
    ...(typeof recordId === 'string' ? { ref: reportRefFromRecordId(recordId, 'workspace') } : {}),
    ...(current !== undefined ? { version: current ? 'current' : 'exact' } : {}),
  }
}
export function reportReadOutput(value: unknown) {
  const parsed = z.object({ definition: z.record(z.string(), z.json()) }).parse(value).definition
  const ref = parseReportRef(parsed.ref)
  // Preserve the historical fixture's JSON assertion shape after validating the new envelope.
  return JSON.parse(
    JSON.stringify({
      ...parsed,
      ...(ref.kind === 'saved'
        ? { recordId: analysisRecordId(ref.reportId, ref.buildId) }
        : { draftId: ref.draftId, draftRevision: ref.revision }),
      ...(typeof parsed.basedOn === 'string'
        ? {
            basedOnRecordId: (() => {
              const base = parseReportRef(parsed.basedOn)
              if (base.kind !== 'saved') throw new Error('expected saved ref')
              return analysisRecordId(base.reportId, base.buildId)
            })(),
          }
        : {}),
    }),
  )
}
