import type { ToolExecution, ToolExecutionToken } from '@deepseek-ai/dsh-tools'

export type SavedWriteCommitted = (exec: Pick<ToolExecution, 'token'>, ref: string) => void

/** Installation-local proof of a real writer body commit, never delivery metadata or history. */
export class SavedWriteProofs {
  private readonly refs = new Map<ToolExecutionToken, string>()
  private closed = false
  readonly committed: SavedWriteCommitted = (exec, ref) => {
    if (!this.closed) this.refs.set(exec.token, ref)
  }
  take(token: ToolExecutionToken): string | undefined {
    const ref = this.refs.get(token)
    this.refs.delete(token)
    return ref
  }
  close(): void {
    this.closed = true
    this.refs.clear()
  }
}
