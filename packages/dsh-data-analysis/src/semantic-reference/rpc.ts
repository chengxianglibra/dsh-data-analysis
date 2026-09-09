import type { ConnectionRpcHandler, HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import type { MarivoCheckedRunner } from '../environment/types.ts'
import { finishCleanup, PendingTasks } from '../lifecycle.ts'
import { registerPluginRpc } from '../rpc.ts'
import { SemanticReferenceBridge } from './bridge.ts'
import {
  CHANNEL,
  closed,
  type Envelope,
  MAX_WIRE_BYTES,
  modelMarker,
  parseCandidatesRequest,
  parseEnvelope,
  parsePrepareRequest,
} from './contracts.ts'
import { search } from './search.ts'
import { type SemanticReferenceUsage, workspaceKey } from './usage.ts'
export type EnvironmentResolver = (
  sessionId: string,
  purpose: 'candidates' | 'reference' | 'prepare',
  workspaceId?: string,
) => Promise<MarivoCheckedRunner>
/** Abort the caller's wait, without pretending to cancel the shared Environment resolver. */
export async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort)
      reject(new Error('cancelled'))
    }
    signal.addEventListener('abort', abort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort)
        if (signal.aborted) reject(new Error('cancelled'))
        else resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort)
        reject(error)
      },
    )
    if (signal.aborted) abort()
  })
}
export class SemanticReferenceService {
  readonly #resolve: EnvironmentResolver
  readonly #usage: SemanticReferenceUsage
  readonly #bridge: SemanticReferenceBridge
  readonly #controller = new AbortController()
  #closed = false
  readonly #tasks = new PendingTasks()
  #closing: Promise<void> | undefined
  constructor(
    resolve: EnvironmentResolver,
    usage: SemanticReferenceUsage,
    bridge = new SemanticReferenceBridge(),
  ) {
    this.#resolve = resolve
    this.#usage = usage
    this.#bridge = bridge
  }
  async #environment(
    sessionId: string,
    signal: AbortSignal,
    purpose: 'candidates' | 'reference' | 'prepare' = 'reference',
    workspaceId?: string,
  ): Promise<MarivoCheckedRunner> {
    const runner = await abortable(
      this.#tasks.track(this.#resolve(sessionId, purpose, workspaceId)),
      signal,
    )
    if (runner.status !== 'ready') {
      this.#bridge.invalidate(runner.binding.fingerprint)
      throw new Error('environment-failed')
    }
    return runner
  }
  async #owner(envelope: Envelope, signal: AbortSignal): Promise<MarivoCheckedRunner> {
    const runner = await this.#environment(envelope.sessionId, signal)
    if (runner.binding.fingerprint !== envelope.environmentFingerprint)
      throw new Error('environment-mismatch')
    return runner
  }
  handle(endpoint: string, payload: unknown, caller: AbortSignal): Promise<unknown> {
    return this.#tasks.track(this.#handle(endpoint, payload, caller))
  }
  async #handle(endpoint: string, payload: unknown, caller: AbortSignal): Promise<unknown> {
    if (this.#closed) throw new Error('disposed')
    const signal = AbortSignal.any([caller, this.#controller.signal])
    signal.throwIfAborted()
    if (Buffer.byteLength(JSON.stringify(payload) ?? '') > MAX_WIRE_BYTES)
      throw new Error('invalid-request')
    if (endpoint === 'semantic-references/prepare') {
      const { workspaceId, envelope } = parsePrepareRequest(payload)
      const runner = await this.#environment(envelope.sessionId, signal, 'prepare', workspaceId)
      if (runner.binding.fingerprint !== envelope.environmentFingerprint)
        throw new Error('environment-mismatch')
      signal.throwIfAborted()
      return { envelope }
    }
    if (endpoint === 'semantic-references/candidates') {
      const request = parseCandidatesRequest(payload)
      const environment = await this.#environment(request.sessionId, signal, 'candidates')
      const projection = await this.#bridge.candidates(environment, signal)
      const scores = await abortable(
        this.#tasks.track(this.#usage.scores(workspaceKey(environment.binding.projectRoot))),
        signal,
      )
      // A live Agent may disappear or change binding while Catalog/storage work awaits.
      const current = await this.#environment(request.sessionId, signal)
      if (current.binding.fingerprint !== environment.binding.fingerprint)
        throw new Error('environment-mismatch')
      return {
        environmentFingerprint: environment.binding.fingerprint,
        items: search(projection, request.query, scores),
      }
    }
    if (
      endpoint === 'semantic-references/selected' ||
      endpoint === 'semantic-references/serialize'
    ) {
      const request = closed(payload, ['envelope']),
        envelope = parseEnvelope(request.envelope)
      const environment = await this.#owner(envelope, signal)
      if (endpoint === 'semantic-references/serialize') return { text: modelMarker(envelope) }
      await this.#usage.selected(
        workspaceKey(environment.binding.projectRoot),
        envelope.ref,
        signal,
      )
      return { selected: true }
    }
    throw new Error('unknown-endpoint')
  }
  stop(): void {
    this.#closed = true
    this.#controller.abort()
    this.#bridge.dispose()
  }
  close(): Promise<void> {
    if (this.#closing) return this.#closing
    this.stop()
    this.#closing = finishCleanup([
      () => this.#bridge.close(),
      () => this.#tasks.drain(),
      () => this.#usage.close(),
    ])
    return this.#closing
  }
}
export function registerSemanticReferenceRpc(
  connection: HostConnectionHandle,
  service: SemanticReferenceService,
  browser?: ConnectionRpcHandler,
): () => Promise<void> {
  const unregister = registerPluginRpc(
    connection,
    CHANNEL,
    [
      'semantic-references/prepare',
      'semantic-references/candidates',
      'semantic-references/selected',
      'semantic-references/serialize',
      'semantic-browser/catalog',
    ],
    async (endpoint, payload, signal) => {
      if (browser && endpoint === 'semantic-browser/catalog') {
        return browser(endpoint, payload, signal)
      }
      try {
        return { ok: true, value: await service.handle(endpoint, payload, signal) }
      } catch {
        return {
          ok: false,
          error: {
            code: 'internal',
            message: 'Marivo semantic reference request failed',
            details: {},
          },
        }
      }
    },
  )
  let closing: Promise<void> | undefined
  return () =>
    (closing ??= finishCleanup([() => service.stop(), unregister, () => service.close()]))
}
