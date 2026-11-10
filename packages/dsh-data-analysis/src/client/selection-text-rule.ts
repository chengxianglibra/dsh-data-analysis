import type { UserTextRule } from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  parseSelectionText,
  SELECTION_TEXT_END,
  SELECTION_TEXT_MAX_BYTES,
  SELECTION_TEXT_START,
} from '../presentation/contracts/selection-text.ts'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface UserTextDataMap {
    'marivo-selection': { readonly label: string }
  }
}

/** Match only complete, valid plugin forms; offsets always refer to original text. */
export const selectionTextRule: UserTextRule<'marivo-selection'> = {
  id: 'marivo-selection',
  order: 10,
  match(text, from) {
    let start = text.indexOf(SELECTION_TEXT_START, from)
    while (start !== -1) {
      const close = text.indexOf(SELECTION_TEXT_END, start + SELECTION_TEXT_START.length)
      if (close === -1) return undefined
      const end = close + SELECTION_TEXT_END.length
      const value =
        end - start <= SELECTION_TEXT_MAX_BYTES
          ? parseSelectionText(text.slice(start, end))
          : undefined
      if (value) return { id: 'marivo-selection', start, end, data: { label: value.label } }
      start = text.indexOf(SELECTION_TEXT_START, start + SELECTION_TEXT_START.length)
    }
    return undefined
  },
}
