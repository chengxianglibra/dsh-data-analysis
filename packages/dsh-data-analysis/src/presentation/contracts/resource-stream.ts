import { z } from 'zod'
import { type AnalysisDocument, parseAnalysisResource } from './analysis-document.ts'
import { PRESENTATION_BUDGETS } from './types.ts'

const identity = {
  sessionId: z.string().min(1).max(512),
  workspaceId: z.string().min(1).max(512),
  turn: z.number().int().nonnegative(),
  callId: z.string().min(1).max(512),
}
export const resourceStreamRequest = z.strictObject({
  ...identity,
  after: z.number().int().nonnegative(),
})
export type ResourceStreamRequest = z.infer<typeof resourceStreamRequest>
const response = z.strictObject({
  ...identity,
  revision: z.number().int().nonnegative(),
  status: z.enum(['waiting', 'reading', 'complete', 'failed']),
  resources: z.record(z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/), z.unknown()),
})
export interface ResourceStreamResponse extends Omit<z.infer<typeof response>, 'resources'> {
  resources: AnalysisDocument['resources']
}
export function parseResourceStream(value: unknown): ResourceStreamResponse {
  if (new TextEncoder().encode(JSON.stringify(value)).length > PRESENTATION_BUDGETS.documentBytes)
    throw new Error('analysis-document-budget')
  const parsed = response.parse(value)
  if (Object.keys(parsed.resources).length > PRESENTATION_BUDGETS.datasets)
    throw new Error('analysis-resource-budget')
  return {
    ...parsed,
    resources: Object.fromEntries(
      Object.entries(parsed.resources).map(([name, resource]) => [
        name,
        parseAnalysisResource(resource, parsed.workspaceId),
      ]),
    ),
  }
}
