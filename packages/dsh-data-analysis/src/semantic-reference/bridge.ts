import type { MarivoCheckedRunner } from '../environment/types.ts'
import { finishCleanup, PendingTasks } from '../lifecycle.ts'
import { CATALOG_READ_HELPERS } from './catalog-program.ts'
import { type Projection, parseProjection } from './contracts.ts'
export const CATALOG_PROGRAM = String.raw`
import contextlib, io, json, sys
with contextlib.redirect_stdout(io.StringIO()):
    import marivo.semantic as ms
    from marivo.refs import SemanticKind
${CATALOG_READ_HELPERS}
with contextlib.redirect_stdout(io.StringIO()):
    catalog = ms.load(workspace_dir=sys.argv[1])
    rows = []
    for entry in pages(lambda cursor: catalog.search(limit=100, cursor=cursor)):
        definition = entry.definition.context.business_definition
        rows.append({"ref": wire_ref(entry), "refKey": entry.id,
                     "name": entry.name, "businessDefinition": definition[:240] if definition else None})
    result = {"kinds": [kind.value for kind in SemanticKind], "items": rows}
print(json.dumps(result, ensure_ascii=True))
`.trim()
interface Flight {
  controller: AbortController
  promise: Promise<Projection>
  waiters: number
}
interface Slot {
  snapshot?: Projection
  expires?: number
  flight?: Flight
}
/** One plugin-owned cache, keyed by the exact Environment fingerprint. */
export class SemanticReferenceBridge {
  readonly #slots = new Map<string, Slot>()
  readonly #clock: () => number
  #disposed = false
  readonly #tasks = new PendingTasks()
  #closing: Promise<void> | undefined
  constructor(clock: () => number = Date.now) {
    this.#clock = clock
  }
  async candidates(runner: MarivoCheckedRunner, signal: AbortSignal): Promise<Projection> {
    signal.throwIfAborted()
    if (this.#disposed) throw new Error('disposed')
    const key = runner.binding.fingerprint
    if (runner.status !== 'ready') {
      this.invalidate(key)
      throw new Error('environment-failed')
    }
    let slot = this.#slots.get(key)
    if (!slot) {
      slot = {}
      this.#slots.set(key, slot)
    }
    if (slot.snapshot && this.#clock() < slot.expires!) return slot.snapshot
    if (!slot.flight) {
      const current = slot
      const controller = new AbortController()
      const flight: Flight = {
        controller,
        waiters: 0,
        promise: Promise.resolve({ kinds: [], items: [] }),
      }
      current.flight = flight
      flight.promise = this.#tasks
        .track(this.#load(runner, controller.signal))
        .then((projection) => {
          if (
            !controller.signal.aborted &&
            !this.#disposed &&
            current.flight === flight &&
            runner.status === 'ready'
          ) {
            current.snapshot = projection
            current.expires = this.#clock() + 30_000
          }
          return projection
        })
        .finally(() => {
          if (current.flight === flight) current.flight = undefined
        })
    }
    const current = slot,
      flight = slot.flight!
    flight.waiters++
    return new Promise<Projection>((resolve, reject) => {
      let settled = false
      const finish = (value?: Projection, error?: unknown) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', abort)
        flight.controller.signal.removeEventListener('abort', loadAbort)
        flight.waiters--
        if (!flight.waiters && current.flight === flight) {
          current.flight = undefined
          flight.controller.abort()
        }
        if (error !== undefined) reject(error)
        else resolve(value!)
      }
      const abort = () => finish(undefined, new Error('cancelled'))
      const loadAbort = () => finish(undefined, new Error('cancelled'))
      signal.addEventListener('abort', abort, { once: true })
      flight.controller.signal.addEventListener('abort', loadAbort, { once: true })
      flight.promise.then(
        (value) => finish(value),
        (error: unknown) => finish(undefined, error),
      )
      if (signal.aborted || flight.controller.signal.aborted) abort()
    })
  }
  async #load(runner: MarivoCheckedRunner, signal: AbortSignal): Promise<Projection> {
    const result = await runner.runChecked({
      program: CATALOG_PROGRAM,
      args: [runner.binding.projectRoot],
      signal,
      environmentOverlay: { MARIVO_TELEMETRY: 'off', PYTHONDONTWRITEBYTECODE: '1' },
      limits: { timeoutMs: 30_000, stdoutMaxBytes: 32 * 1024 * 1024, stderrMaxBytes: 8192 },
    })
    signal.throwIfAborted()
    if (result.exitCode !== 0) throw new Error('catalog-load-failed')
    return parseProjection(JSON.parse(result.stdout.toString('utf8')))
  }
  close(): Promise<void> {
    this.dispose()
    this.#closing ??= finishCleanup([() => this.#tasks.drain()])
    return this.#closing
  }
  invalidate(key: string): void {
    const slot = this.#slots.get(key)
    this.#slots.delete(key)
    slot?.flight?.controller.abort()
  }
  dispose(): void {
    this.#disposed = true
    for (const key of this.#slots.keys()) this.invalidate(key)
  }
}
