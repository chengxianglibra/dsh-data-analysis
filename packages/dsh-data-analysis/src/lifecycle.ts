/** Tracks owned work, including work whose caller stopped waiting after cancellation. */
export class PendingTasks {
  readonly #tasks = new Set<Promise<void>>()

  track<T>(task: Promise<T>): Promise<T> {
    const settled = task.then(
      () => {},
      () => {},
    )
    this.#tasks.add(settled)
    void settled.then(() => this.#tasks.delete(settled))
    return task
  }

  async drain(): Promise<void> {
    while (this.#tasks.size) await Promise.all([...this.#tasks])
  }
}

/** Start every stop synchronously, then await every cleanup even if another one fails. */
export function finishCleanup(actions: readonly (() => unknown)[]): Promise<void> {
  const pending = actions.map((action) => {
    try {
      return Promise.resolve(action())
    } catch (error) {
      return Promise.reject(error)
    }
  })
  const completion = Promise.allSettled(pending).then((results) => {
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    )
    if (failures.length) throw new AggregateError(failures, 'Marivo cleanup failed')
  })
  // Legacy synchronous callers may ignore completion; awaiting it still reports failures.
  void completion.catch(() => {})
  return completion
}
