import { autoClose } from '@openuidev/lang-core'
import { analysisStatements } from '../../presentation/contracts/analysis-program.ts'

/** Keep the admitted definitions before the incoming patch. OpenUI's streaming
 * parser owns their evaluation. Only delimited statements replace an existing
 * view while the program field is still arriving (even `root = Sta` is partial).
 * Unknown resource scope waits as a whole instead of predicting dependency graphs.
 */
export function streamingAnalysisProgram(
  base: string | undefined,
  prefix: string,
  streaming = true,
  holdPatch = false,
): string {
  const readable = streaming ? readableAnalysisPrefix(prefix) : prefix
  if (!base) return candidateStatements(readable).join('\n')
  if (!prefix.trim() || holdPatch) return analysisStatements(base)
  return `${analysisStatements(base)}\n${candidateStatements(readable, !streaming).join('\n')}`
}

/** Hide only an unfinished resource invocation before autoClose can invent its props.
 * This extends the existing delimiter scan; the public parser still owns Lang syntax.
 */
export function readableAnalysisPrefix(prefix: string): string {
  const stack: { delimiter: string; resourceStart?: number }[] = []
  let quote = ''
  let escaped = false
  for (let i = 0; i < prefix.length; i++) {
    const c = prefix[i]!
    if (quote) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === quote) quote = ''
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if ('([{'.includes(c)) {
      let end = i
      while (end > 0 && /\s/.test(prefix[end - 1]!)) end--
      let start = end
      while (start > 0 && /[A-Za-z0-9_]/.test(prefix[start - 1]!)) start--
      const name = prefix.slice(start, end)
      // Direct named resources already have precise pending statement identity.
      const inlineResource =
        c === '(' &&
        stack.length > 0 &&
        ['AnalysisFrameView', 'DatasetView', 'Image'].includes(name)
      stack.push({ delimiter: c, ...(inlineResource ? { resourceStart: start } : {}) })
    } else if (')]}'.includes(c)) {
      const expected = '([{'.charAt(')]}'.indexOf(c))
      if (stack.at(-1)?.delimiter === expected) stack.pop()
    }
  }
  const resource = stack.find((item) => item.resourceStart !== undefined)
  return resource?.resourceStart === undefined
    ? prefix
    : `${prefix.slice(0, resource.resourceStart)}null`
}

/** Identify the trailing resource configuration before OpenUI auto-closes it. */
export function pendingAnalysisStatement(prefix: string): string | undefined {
  const last = candidateStatements(prefix).at(-1)
  return last && autoClose(last).wasIncomplete
    ? /^([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(last)?.[1]
    : undefined
}

function candidateStatements(source: string, includeTrailing = true): string[] {
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
    else if ((!depth && (c === ';' || c === '\n')) || (includeTrailing && c === undefined)) {
      const raw = source.slice(start, i).trim()
      start = i + 1
      if (!raw) continue
      statements.push(raw)
    }
  }
  // An open quote/bracket consumes the rest of the original prefix.
  const trailing = source.slice(start).trim()
  if (includeTrailing && trailing) statements.push(trailing)
  return statements
}
