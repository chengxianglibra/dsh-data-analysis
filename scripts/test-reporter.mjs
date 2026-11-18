import { realpathSync } from 'node:fs'
import { inspect } from 'node:util'

// Node emits file summaries as well as one aggregate summary. Buffer test output
// so successful files stay quiet and failed files retain their diagnostics.
const outputLimit = 256 * 1024

/** @typedef {{ text: string, truncated: boolean }} TestOutput */

/** @param {TestOutput} output */
function formatOutput({ text, truncated }) {
  const notice = truncated ? ` (last ${outputLimit} characters; earlier output truncated)` : ''
  return `Test output${notice}:\n${text}${text.endsWith('\n') ? '' : '\n'}`
}

/** @param {AsyncIterable<import('node:test/reporters').TestEvent>} source */
export default async function* reporter(source) {
  /** @type {Map<string, number>} */
  const skipped = new Map()
  /** @type {Set<string>} */
  const failedFiles = new Set()
  /** @type {Map<string, string>} */
  const filenames = new Map()
  /** @type {Map<string | undefined, TestOutput>} */
  const outputByFile = new Map()

  // Node's stream events use the supplied path, while failures use the real path.
  /** @param {string} file */
  function canonicalFile(file) {
    let resolved = filenames.get(file)
    if (resolved === undefined) {
      try {
        resolved = realpathSync(file)
      } catch {
        // A test can remove its own temporary file before reporting a failure.
        resolved = file
      }
      filenames.set(file, resolved)
    }
    return resolved
  }

  for await (const { type, data } of source) {
    if (
      type === 'test:stdout' ||
      type === 'test:stderr' ||
      (type === 'test:diagnostic' && data.file)
    ) {
      const file = data.file ? canonicalFile(data.file) : undefined
      const message = `[${data.file ?? 'unknown file'}] ${type.slice(5)}: ${data.message}${type === 'test:diagnostic' ? '\n' : ''}`
      const previous = outputByFile.get(file)
      const text = (previous?.text ?? '') + message
      outputByFile.set(file, {
        text: text.slice(-outputLimit),
        truncated: (previous?.truncated ?? false) || text.length > outputLimit,
      })
    } else if (type === 'test:pass' || type === 'test:fail') {
      if (data.skip) {
        const reason = typeof data.skip === 'string' ? data.skip : 'reason not provided'
        skipped.set(reason, (skipped.get(reason) ?? 0) + 1)
      }
      if (type === 'test:fail' && !data.skip && !data.todo) {
        if (data.file) failedFiles.add(canonicalFile(data.file))
        const error = data.details.error
        // The child failure contains the useful error; its parent only reports
        // that a subtest failed, and printing it again obscures the real cause.
        if (!('failureType' in error) || error.failureType !== 'subtestsFailed') {
          const location = data.file
            ? ` (${data.file}:${data.line ?? '?'}:${data.column ?? '?'})`
            : ''
          yield `FAIL ${data.name}${location}\n${inspect(error?.cause ?? error, { depth: null, colors: false })}\n`
        }
      }
    } else if (type === 'test:summary') {
      if (data.file) {
        const file = canonicalFile(data.file)
        const output = outputByFile.get(file)
        if (output && !data.success) yield formatOutput(output)
        outputByFile.delete(file)
        failedFiles.delete(file)
        continue
      }
      const { tests, passed, cancelled, skipped: skips, todo } = data.counts
      // The Node 22 event includes failed, although @types/node omits it.
      const failures =
        'failed' in data.counts ? data.counts.failed : tests - passed - cancelled - skips - todo
      if (!data.success || failures || cancelled) {
        for (const [file, output] of outputByFile) {
          if (!file || failedFiles.has(file)) yield formatOutput(output)
        }
      }
      const suite = process.env.DSH_DATA_ANALYSIS_TEST_SUITE
      yield `${suite ? `[${suite}] ` : ''}Tests: ${tests}; passed: ${passed}; failed: ${failures}; cancelled: ${cancelled}; skipped: ${skips}; todo: ${todo}; duration: ${(data.duration_ms / 1000).toFixed(2)}s\n`
      for (const [reason, count] of skipped) yield `Skipped (${count}): ${reason}\n`
    }
  }
}
