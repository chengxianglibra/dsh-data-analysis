import wasm from '@wasm-fmt/ruff_fmt/wasm'
import { format as formatPython, initSync } from '@wasm-fmt/ruff_fmt/web'
import { formatDialect, sql } from 'sql-formatter'

/** Presentation-only formatting; never execute code or change the saved snapshot. */
export function formatSource(text: string, language: 'python' | 'sql') {
  try {
    if (!text.trim()) return { text, formatted: true }
    if (language === 'python') {
      initSync(wasm)
      return {
        text: formatPython(text, 'source.py', {
          indent_style: 'space',
          indent_width: 4,
          line_width: 88,
          quote_style: 'preserve',
        }),
        formatted: true,
      }
    }
    // The execution snapshot has no SQL dialect. Do not guess one from its text.
    return { text: formatDialect(text, { dialect: sql, tabWidth: 2 }), formatted: true }
  } catch {
    return { text, formatted: false }
  }
}
