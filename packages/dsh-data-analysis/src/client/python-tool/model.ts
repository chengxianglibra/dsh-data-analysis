import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-chat/client'
import { executionErrorSummary } from './execution-error.ts'

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function parse(text: string): Record<string, unknown> | undefined {
  try {
    return record(JSON.parse(text))
  } catch {
    return undefined
  }
}

export type PythonToolState =
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timed-out'
  | 'not-started'
  | 'warning'
  | 'unknown'

/** Read only the frozen Harness call; never fetch results or infer execution from settlement. */
export function pythonToolModel(block: ToolCallBlock) {
  const done = 'kind' in block
  const input = (done ? block.call?.argsRaw : block.argsRaw) ?? ''
  const args = parse(input)
  const code = typeof args?.code === 'string' ? args.code : undefined
  const output = done
    ? block.content
        .map((part) => (part.type === 'text' ? part.text : JSON.stringify(part)))
        .join('\n')
    : undefined
  const result = output === undefined ? undefined : parse(output)
  const errorExecution =
    done &&
    block.isError &&
    result === undefined &&
    block.content.length === 1 &&
    block.content[0]?.type === 'text'
      ? executionErrorSummary(block.content[0].text)
      : undefined
  const execution = errorExecution ?? record(result?.execution)
  const reason = execution?.reason
  let state: PythonToolState = 'unknown'
  if (!done) state = 'running'
  else if (block.error?.code === 'interrupted') state = 'cancelled'
  else if (block.isError) {
    // A failed tool invocation can still leave the Python outcome unknown.
    // A success claim in an error message must never promote the call to success.
    state =
      errorExecution &&
      errorExecution.reason !== 'succeeded' &&
      errorExecution.reason !== 'nonzero-exit'
        ? errorExecution.reason
        : 'failed'
  } else if (result?.timedOut === true || reason === 'timed-out') state = 'timed-out'
  else if (result?.aborted === true || reason === 'cancelled' || result?.status === 'cancelled')
    state = 'cancelled'
  else if (result?.status === 'failed' || reason === 'nonzero-exit') state = 'failed'
  else if (
    reason === 'not-started' ||
    execution?.phase === 'preparing' ||
    ['needs-credentials', 'needs-configuration', 'call-ended', 'context-changed'].includes(
      String(result?.status),
    )
  )
    state = 'not-started'
  else if (typeof result?.exitCode === 'number' && result.exitCode !== 0) state = 'failed'
  else if (
    (reason === undefined || reason === 'succeeded') &&
    result?.exitCode === 0 &&
    result.timedOut === false &&
    result.aborted === false
  )
    state = result.codeCaptureError || result.truncated === true ? 'warning' : 'succeeded'

  const facts: { name: string; value: string }[] = []
  for (const name of ['exitCode', 'timedOut', 'aborted', 'truncated'] as const) {
    const value = result?.[name]
    if (typeof value === 'number' || typeof value === 'boolean' || value === null)
      facts.push({ name, value: String(value) })
  }
  for (const name of ['effectiveTimeoutMs', 'elapsedMs', 'executionElapsedMs'] as const) {
    const value = execution?.[name]
    if (typeof value === 'number' && Number.isFinite(value))
      facts.push({ name, value: `${value} ms` })
  }
  const notices = [result?.codeCaptureError, execution?.nextAction].filter(
    (value): value is string => typeof value === 'string' && value !== '',
  )
  const stdout = typeof result?.stdout === 'string' ? result.stdout : undefined
  const stderr = typeof result?.stderr === 'string' ? result.stderr : undefined
  return {
    state,
    input,
    output,
    code,
    facts,
    summary: (code ?? input).split(/\r?\n/).find((line) => line.trim()) ?? block.callId,
    datasources:
      Array.isArray(args?.datasources) && args.datasources.every((v) => typeof v === 'string')
        ? (args.datasources as string[])
        : undefined,
    timeoutMs: typeof args?.timeoutMs === 'number' ? args.timeoutMs : undefined,
    stdout,
    stderr,
    notices: [...new Set(notices)],
    // Non-execution results (including credential responses) remain directly readable.
    fallback:
      done && stdout === undefined && stderr === undefined
        ? output || (block.error ? `${block.error.name}: ${block.error.code}` : '')
        : undefined,
  }
}
