import { createHighlighterCoreSync } from '@shikijs/core'
import { createJavaScriptRegexEngine } from '@shikijs/engine-javascript'
import python from '@shikijs/langs/python'
import sql from '@shikijs/langs/sql'

let highlighter: ReturnType<typeof createHighlighterCoreSync> | undefined

export interface SourceToken {
  text: string
  offset: number
  color?: string
}

/** Local, synchronous highlighting also works in the scripts-disabled HTML fallback. */
export function highlightSource(text: string, language: 'python' | 'sql'): SourceToken[] {
  try {
    highlighter ??= createHighlighterCoreSync({
      langs: [python, sql],
      engine: createJavaScriptRegexEngine({ forgiving: true }),
      themes: [
        {
          name: 'presentation-source',
          colors: { 'editor.foreground': 'var(--pr-text)' },
          settings: [
            { scope: ['keyword', 'storage'], settings: { foreground: 'var(--pr-code-keyword)' } },
            { scope: 'string', settings: { foreground: 'var(--pr-code-string)' } },
            { scope: 'comment', settings: { foreground: 'var(--pr-muted)' } },
            {
              scope: ['constant', 'support.constant'],
              settings: { foreground: 'var(--pr-code-number)' },
            },
            {
              scope: ['entity.name.function', 'support.function'],
              settings: { foreground: 'var(--pr-code-function)' },
            },
          ],
        },
      ],
    })
    const lines = highlighter.codeToTokensBase(text, {
      lang: language,
      theme: 'presentation-source',
    })
    const result: SourceToken[] = []
    let offset = 0
    for (const line of lines) {
      for (const token of line) {
        if (!token.content) continue
        // Preserve every original character, including CRLF and trailing whitespace.
        if (
          token.offset < offset ||
          text.slice(token.offset, token.offset + token.content.length) !== token.content
        ) {
          return [{ text, offset: 0 }]
        }
        if (token.offset > offset) result.push({ text: text.slice(offset, token.offset), offset })
        result.push({ text: token.content, offset: token.offset, color: token.color })
        offset = token.offset + token.content.length
      }
    }
    if (offset < text.length) result.push({ text: text.slice(offset), offset })
    return result
  } catch {
    // A display failure must never hide or modify an execution snapshot.
    return [{ text, offset: 0 }]
  }
}
