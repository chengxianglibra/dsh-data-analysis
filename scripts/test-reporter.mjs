import { inspect } from 'node:util'

// Node emits file summaries as well as one aggregate summary. Buffer stdout so
// successful tests stay quiet, but their diagnostics remain available on failure.
const outputLimit = 256 * 1024

/** @param {AsyncIterable<import('node:test/reporters').TestEvent>} source */
export default async function* reporter(source) {
  const skipped = new Map()
  let stdout = ''
  let stdoutTruncated = false
  let failed = false

  for await (const { type, data } of source) {
    if (type === 'test:stdout') {
      stdout += `[${data.file ?? 'unknown file'}] ${data.message}`
      if (stdout.length > outputLimit) {
        stdout = stdout.slice(-outputLimit)
        stdoutTruncated = true
      }
    } else if (type === 'test:stderr') {
      // Warnings and process-level errors may be the only indication of a problem.
      yield data.message
    } else if (type === 'test:diagnostic' && data.file) {
      yield `Diagnostic ${data.file}:${data.line ?? '?'}: ${data.message}\n`
    } else if (type === 'test:pass' || type === 'test:fail') {
      if (data.skip) {
        const reason = typeof data.skip === 'string' ? data.skip : 'reason not provided'
        skipped.set(reason, (skipped.get(reason) ?? 0) + 1)
      }
      if (type === 'test:fail' && !data.skip && !data.todo) {
        failed = true
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
    } else if (type === 'test:summary' && !data.file) {
      const { tests, passed, cancelled, skipped: skips, todo } = data.counts
      // The Node 22 event includes failed, although @types/node omits it.
      const failures =
        'failed' in data.counts ? data.counts.failed : tests - passed - cancelled - skips - todo
      yield `Tests: ${tests}; passed: ${passed}; failed: ${failures}; cancelled: ${cancelled}; skipped: ${skips}; todo: ${todo}; duration: ${(data.duration_ms / 1000).toFixed(2)}s\n`
      for (const [reason, count] of skipped) yield `Skipped (${count}): ${reason}\n`
      if ((failed || failures || cancelled) && stdout) {
        yield `Test stdout${stdoutTruncated ? ' (last 262144 characters; earlier output truncated)' : ''}:\n${stdout}${stdout.endsWith('\n') ? '' : '\n'}`
      }
    }
  }
}
