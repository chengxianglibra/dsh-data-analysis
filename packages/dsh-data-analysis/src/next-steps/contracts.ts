import type { ObjectValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import type {
  InvocationDescriptor,
  TypertRemoteContribution,
} from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry'
import { z } from 'zod'

export const NEXT_STEPS_TOOL = 'marivo_next_steps'
export const NEXT_STEPS_SERVICE = 'dshDataAnalysisNextSteps'
const text = (max: number) =>
  z
    .string()
    .trim()
    .refine((value) => [...value].length > 0 && [...value].length <= max)
export const nextStepsInput = z
  .strictObject({
    items: z.array(z.strictObject({ label: text(40), prompt: text(1000) })).max(4),
    emptyReason: z.enum(['declined', 'no-suggestions']).optional(),
    ref: z.string().min(1).max(4096),
  })
  .superRefine(({ items, emptyReason }, ctx) => {
    if (items.length && emptyReason)
      ctx.addIssue({ code: 'custom', message: 'emptyReason requires an empty list' })
    for (const field of ['label', 'prompt'] as const) {
      const values = items.map((item) => item[field].replace(/\s+/gu, ' '))
      if (new Set(values).size !== values.length)
        ctx.addIssue({ code: 'custom', message: `Duplicate ${field}` })
    }
  })
export const nextStepsNotice = z
  .strictObject({
    sessionId: z.string().min(1).max(512),
    workspaceId: z.string().min(1).max(512),
    turn: z.number().int().nonnegative(),
    reportId: z.string().min(1).max(512),
    buildId: z.string().min(1).max(512),
    callId: z.string().min(1).max(512).optional(),
    status: z.enum(['available', 'empty', 'declined', 'unavailable']),
    reason: z.enum(['generation-incomplete', 'generation-failed']).optional(),
    items: nextStepsInput.shape.items,
  })
  .superRefine(({ status, reason, items }, ctx) => {
    if ((status === 'available') !== items.length > 0)
      ctx.addIssue({ code: 'custom', message: 'Items must match availability' })
    if ((status === 'unavailable') !== (reason !== undefined))
      ctx.addIssue({ code: 'custom', message: 'Unavailable notices require a reason' })
  })
/** Supported output projection of the same identity-only receipt contract. */
export const nextStepsReceiptValueSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', const: 'marivo.next-steps', required: true },
    sessionId: { type: 'string', required: true },
    turn: { type: 'integer', required: true },
    callId: { type: 'string', required: true },
  },
} as const satisfies ObjectValueSchemaSpec
/** A tool anchor contains identity only, never persisted recommendations. */
export const nextStepsReceipt = z.strictObject({
  kind: z.literal(nextStepsReceiptValueSchema.properties.kind.const),
  sessionId: z.string(),
  turn: z.number().int().nonnegative(),
  callId: z.string(),
})
export type NextStepsNotice = z.infer<typeof nextStepsNotice>
export type NextStep = NextStepsNotice['items'][number]
const owner = '@chengxianglibra/dsh-data-analysis'
const descriptor: InvocationDescriptor = {
  id: `${owner}#${NEXT_STEPS_SERVICE}/watch`,
  service: NEXT_STEPS_SERVICE,
  namespace: NEXT_STEPS_SERVICE,
  method: 'watch',
  mode: 'stream',
  invocation: { kind: 'direct' },
  parameters: [
    {
      name: 'sessionId',
      wire: 'sessionId',
      source: 'json',
      codec: {
        mode: 'strict',
        typeSymbol: `${owner}#NextStepsSessionId`,
        create: () => z.string().min(1).max(512),
      },
    },
  ],
  cancellation: { parameter: 'signal' },
  result: { mode: 'strict', typeSymbol: `${owner}#NextStepsNotice`, create: () => nextStepsNotice },
}
export const nextStepsHost: TypertContribution = {
  package: owner,
  face: 'host',
  schemas: [],
  model: { services: [], events: [], objects: [] },
  invocations: [descriptor],
}
export const nextStepsRemote: TypertRemoteContribution = {
  package: owner,
  descriptors: [descriptor],
}
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    dshDataAnalysisNextSteps: {
      watch(sessionId: string, signal?: AbortSignal): AsyncIterable<NextStepsNotice>
    }
  }
}
