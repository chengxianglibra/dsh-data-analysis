import type { ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import {
  MarivoPythonExecutionError,
  type MarivoPythonExecutionSummary,
} from '../../src/datasource/python.ts'

/** Harness normalizes ordinary Error to a text block without structured error metadata. */
export function executionFailure(reason: MarivoPythonExecutionSummary['reason']): ToolResultNode {
  const error = new MarivoPythonExecutionError(
    reason === 'not-started'
      ? 'Marivo Python preparation failed or was cancelled; Python was not started'
      : 'Marivo Python execution outcome is unknown after an execution service failure or cancellation',
    {
      phase: reason === 'not-started' ? 'preparing' : 'executing',
      reason,
      requestedTimeoutMs: 120000,
      effectiveTimeoutMs: reason === 'not-started' ? null : 120000,
      elapsedMs: 30,
      executionElapsedMs: null,
      nextAction:
        'Inspect existing effects and the intended Session before retrying; do not automatically replay.',
    },
  )
  return { ...settled(error.message), isError: true }
}

export const source =
  '\nimport marivo\ntext = r"literal \\n"\nfor i in range(2):\n    print(i, "中文 <script>")\n'
export const successful = {
  exitCode: 0,
  timedOut: false,
  aborted: false,
  stdout: 'cluster    count\nalpha         3\nbeta          7\n',
  stderr: '',
}
export function settled(value: unknown = successful, code = source): ToolResultNode {
  return {
    kind: 'tool-result',
    seq: 1,
    time: 1,
    callId: 'python-call',
    callTime: 0,
    call: {
      name: 'marivo_python',
      argsRaw: JSON.stringify({ code, datasources: ['trino_bili'], timeoutMs: 1000 }),
    },
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
    isError: false,
    subCalls: [],
  }
}
