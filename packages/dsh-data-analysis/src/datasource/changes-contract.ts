import type {
  InvocationDescriptor,
  TypertRemoteContribution,
} from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry'
import { z } from 'zod'

export const CREDENTIAL_CHANGES_SERVICE = 'dshDataAnalysisCredentials'
const owner = '@chengxianglibra/dsh-data-analysis'
const sessionId = z.string().min(1).max(256)
export const credentialRevisionSchema = z
  .object({ generation: z.string().uuid(), cursor: z.string().min(1).max(256) })
  .strict()
export type CredentialRevision = z.infer<typeof credentialRevisionSchema>

/** Plugin-owned strict boundary shared by both faces; no Host registry is duplicated. */
const descriptor: InvocationDescriptor = {
  id: `${owner}#${CREDENTIAL_CHANGES_SERVICE}/changes`,
  service: CREDENTIAL_CHANGES_SERVICE,
  namespace: CREDENTIAL_CHANGES_SERVICE,
  method: 'changes',
  mode: 'stream',
  invocation: { kind: 'direct' },
  parameters: [
    {
      name: 'sessionId',
      wire: 'sessionId',
      source: 'json',
      codec: { mode: 'strict', typeSymbol: `${owner}#CredentialSessionId`, schema: sessionId },
    },
  ],
  cancellation: { parameter: 'signal' },
  result: {
    mode: 'strict',
    typeSymbol: `${owner}#CredentialRevision`,
    schema: credentialRevisionSchema,
  },
}
export const credentialChangesHost: TypertContribution = {
  package: owner,
  face: 'host',
  schemas: [],
  model: { services: [], events: [], objects: [] },
  invocations: [descriptor],
}
export const credentialChangesRemote: TypertRemoteContribution = {
  package: owner,
  descriptors: [descriptor],
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    dshDataAnalysisCredentials: {
      changes(sessionId: string, signal?: AbortSignal): AsyncIterable<CredentialRevision>
    }
  }
}
