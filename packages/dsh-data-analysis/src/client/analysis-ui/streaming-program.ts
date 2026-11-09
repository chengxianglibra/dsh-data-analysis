import { autoClose, mergeStatements } from '@openuidev/lang-core'
import { analysisStatements } from '../../presentation/contracts/analysis-program.ts'

/** Candidate-only merging. Host admission still requires the complete, validated patch. */
export function streamingAnalysisProgram(base: string | undefined, prefix: string): string {
  if (!base) return prefix
  if (!prefix.trim()) return base
  const source = autoClose(prefix).text
  const statements: string[] = []
  let start = 0
  let quote = ''
  let escaped = false
  let depth = 0
  for (let i = 0; i <= source.length; i++) {
    const c = source[i]
    if (quote) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === quote) quote = ''
    } else if (c === '"' || c === "'") quote = c
    else if (c && '([{'.includes(c)) depth++
    else if (c && ')]}'.includes(c)) depth--
    else if ((!depth && (c === ';' || c === '\n')) || c === undefined) {
      const raw = source.slice(start, i).trim()
      start = i + 1
      if (!raw) continue
      try {
        statements.push(analysisStatements(raw))
      } catch {
        // A trailing statement name or expression may still be arriving.
        // Preserve the usable prefix, without promoting it to a draft revision.
        break
      }
    }
  }
  try {
    return mergeStatements(analysisStatements(base), statements.join('\n'))
  } catch {
    return base
  }
}
