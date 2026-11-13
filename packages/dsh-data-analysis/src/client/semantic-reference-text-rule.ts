import type { UserTextRule } from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  parseJson,
  parseRef,
  refKey,
  SEMANTIC_REF_TEXT_END,
  SEMANTIC_REF_TEXT_START,
} from '../semantic-reference/contracts.ts'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface UserTextDataMap {
    'marivo-semantic-ref': { readonly label: string }
  }
}

export const semanticReferenceTextRule: UserTextRule<'marivo-semantic-ref'> = {
  id: 'marivo-semantic-ref',
  order: 10,
  match(text, from) {
    let start = text.indexOf(SEMANTIC_REF_TEXT_START, from)
    while (start !== -1) {
      const jsonStart = start + SEMANTIC_REF_TEXT_START.length
      const close = text.indexOf(SEMANTIC_REF_TEXT_END, jsonStart)
      if (close === -1) return undefined
      try {
        const ref = parseRef(parseJson(text.slice(jsonStart, close)))
        return {
          id: 'marivo-semantic-ref',
          start,
          end: close + SEMANTIC_REF_TEXT_END.length,
          data: { label: refKey(ref) },
        }
      } catch {
        // Leave invalid markers in the surrounding message text.
        start = text.indexOf(SEMANTIC_REF_TEXT_START, jsonStart)
      }
    }
    return undefined
  },
}
