import type { ToolExecution, ToolExecutionToken } from '@deepseek-ai/dsh-tools'

export type SavedWriteCommitted = (exec: Pick<ToolExecution, 'token'>, ref: string) => void

/** Installation-local proof of a real writer body commit, never delivery metadata or history. */
export class SavedWriteProofs {
  private readonly refs = new Map<ToolExecutionToken, { ref: string; sequence: number }>()
  private sequence = 0
  private closed = false
  readonly committed: SavedWriteCommitted = (exec, ref) => {
    if (!this.closed) this.refs.set(exec.token, { ref, sequence: ++this.sequence })
  }
  get(token: ToolExecutionToken): string | undefined {
    return this.refs.get(token)?.ref
  }
  take(token: ToolExecutionToken): { ref: string; sequence: number } | undefined {
    const ref = this.refs.get(token)
    this.refs.delete(token)
    return ref
  }
  close(): void {
    this.closed = true
    this.refs.clear()
  }
}
