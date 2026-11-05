import {
  CHANNEL,
  closed,
  envelopeJson,
  parseEnvelope,
  type SemanticRef,
} from '../../semantic-reference/contracts.ts'
import { type InputContextHost, withInputReferenceInsertion } from '../input-context.ts'
import { semanticReference } from '../semantic-reference.ts'
import type { BrowserRpc } from './model.ts'

export interface SemanticQuestion {
  sessionId: string
  workspaceId: string
  environmentFingerprint: string
  ref: SemanticRef
}

/** Prepare identity, then perform one guarded native editor operation. */
export function appendSemanticReference(
  host: InputContextHost,
  rpc: BrowserRpc,
  request: SemanticQuestion,
  lifetime: AbortSignal,
): Promise<void> {
  return withInputReferenceInsertion(host, request, lifetime, async (signal, insert) => {
    const result = (await rpc.call(CHANNEL, 'semantic-references/prepare', request, signal)) as {
      ok?: boolean
      value?: unknown
    }
    signal.throwIfAborted()
    if (!result.ok) throw new Error('reference-prepare-failed')
    const envelope = parseEnvelope(closed(result.value, ['envelope']).envelope)
    const expected = {
      schema: 'dsh-data-analysis-semantic-reference/v1' as const,
      sessionId: request.sessionId,
      environmentFingerprint: request.environmentFingerprint,
      ref: request.ref,
    }
    if (envelopeJson(envelope) !== envelopeJson(expected)) throw new Error('reference-mismatch')
    insert(semanticReference(envelope))
    // Selection statistics are best effort and must never turn an applied edit into failure.
    void Promise.resolve()
      .then(() => rpc.call(CHANNEL, 'semantic-references/selected', { envelope }, signal))
      .catch(() => {})
  })
}
