import type { ReferenceInsert } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { type Envelope, envelopeJson, refKey, SOURCE } from '../semantic-reference/contracts.ts'

/** Both the @ picker and semantic details insert exactly this Host reference. */
export function semanticReference(envelope: Envelope): ReferenceInsert {
  return {
    source: SOURCE,
    ref: envelopeJson(envelope),
    label: refKey(envelope.ref),
    clipboardText: `@${refKey(envelope.ref)}`,
  }
}
