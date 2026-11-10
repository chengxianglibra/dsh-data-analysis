import { type NextStepsNotice, nextStepsNotice } from '../next-steps/contracts.ts'

/** A single foreground Chat's ephemeral recommendations. */
export class NextStepsModel {
  private notice?: NextStepsNotice
  private revision = 0
  private locked = false
  private retiredTurn = -1
  private readonly listeners = new Set<() => void>()
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  readonly getSnapshot = () => this.revision
  get value(): NextStepsNotice | undefined {
    return this.notice
  }
  readonly touch = () => {
    this.revision++
    for (const listener of this.listeners) listener()
  }
  clear(retire = true, turn = this.notice?.turn): void {
    if (retire && turn !== undefined) this.retiredTurn = Math.max(this.retiredTurn, turn)
    this.notice = undefined
    this.locked = false
    this.touch()
  }
  reset(): void {
    this.retiredTurn = -1
    this.notice = undefined
    this.locked = false
    this.touch()
  }
  accept(value: unknown, owner: { sessionId: string; workspaceId: string }): void {
    const parsed = nextStepsNotice.safeParse(value)
    if (
      !parsed.success ||
      parsed.data.sessionId !== owner.sessionId ||
      parsed.data.workspaceId !== owner.workspaceId
    )
      return
    if (parsed.data.turn <= this.retiredTurn) return
    if (this.notice && parsed.data.turn < this.notice.turn) return
    if (this.notice?.turn === parsed.data.turn && parsed.data.status !== 'declined') return
    if (parsed.data.status === 'declined') {
      this.retiredTurn = Math.max(this.retiredTurn, parsed.data.turn)
      this.notice = undefined
    } else this.notice = parsed.data
    this.touch()
  }
  submit(turn: number, index: number, send: (prompt: string) => boolean): void {
    const notice = this.notice
    const item = notice?.turn === turn ? notice.items[index] : undefined
    if (this.locked || !item) return
    this.locked = true
    try {
      if (send(item.prompt)) this.clear()
    } finally {
      this.locked = false
      this.touch()
    }
  }
}
