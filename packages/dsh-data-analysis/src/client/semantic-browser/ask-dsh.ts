import {
  CHANNEL,
  closed,
  envelopeJson,
  parseEnvelope,
  type SemanticRef,
} from '../../semantic-reference/contracts.ts'
import { type InputContextHost, inputEnd, ownedInput } from '../input-context.ts'
import { semanticReference } from '../semantic-reference.ts'
import type { BrowserRpc } from './model.ts'

export interface SemanticQuestion {
  sessionId: string
  workspaceId: string
  environmentFingerprint: string
  ref: SemanticRef
}

/** Prepare identity, then perform one guarded native editor operation. */
export async function appendSemanticReference(
  host: InputContextHost,
  rpc: BrowserRpc,
  request: SemanticQuestion,
  lifetime: AbortSignal,
): Promise<void> {
  const controller = new AbortController()
  const signal = AbortSignal.any([lifetime, controller.signal])
  signal.throwIfAborted()
  const initial = ownedInput(host, request.sessionId, request.workspaceId)
  const check = () => {
    const current = ownedInput(host, request.sessionId, request.workspaceId)
    if (current.actx !== initial.actx || current.workspace.path !== initial.workspace.path)
      throw new Error('input-owner-changed')
    return current
  }
  let previous = initial.input.state.getSnapshot()
  const editable = () => {
    const current = initial.input.state.getSnapshot()
    if (current.phase !== 'plain' && current.phase !== 'claimed')
      throw new Error('input-unavailable')
    // Harness commits ordinary sends optimistically while phase stays plain.
    // An emptied draft (including manual reset) ends this pending insertion.
    if (
      (previous.draft.length > 0 || previous.attachmentIds.length > 0) &&
      current.draft.length === 0 &&
      current.attachmentIds.length === 0
    )
      throw new Error('input-reset')
    previous = current
  }
  editable()
  const changed = () => {
    try {
      check()
      editable()
    } catch {
      controller.abort()
    }
  }
  const stops = [
    host.sessions.list.subscribe(changed),
    host.workspaces.list.subscribe(changed),
    initial.input.state.subscribe(changed),
  ]
  try {
    const result = (await rpc.call(CHANNEL, 'semantic-references/prepare', request, signal)) as {
      ok?: boolean
      value?: unknown
    }
    signal.throwIfAborted()
    if (!result.ok) throw new Error('reference-prepare-failed')
    const envelope = parseEnvelope(closed(result.value, ['envelope']).envelope)
    const expected = {
      schema: 'dsh-data-analysis-semantic-reference/v1' as const,
      sessionId: request.sessionId,
      environmentFingerprint: request.environmentFingerprint,
      ref: request.ref,
    }
    if (envelopeJson(envelope) !== envelopeJson(expected)) throw new Error('reference-mismatch')
    const { actx, input } = check()
    const snapshot = input.state.getSnapshot()
    if (snapshot.phase !== 'plain' && snapshot.phase !== 'claimed')
      throw new Error('input-unavailable')
    const applied = actx.bail(actx, 'slash/input-insert-reference', {
      reference: semanticReference(envelope),
      span: inputEnd(snapshot),
    })
    if (applied !== true) throw new Error('input-unavailable')
    // Selection statistics are best effort and must never turn an applied edit into failure.
    void Promise.resolve()
      .then(() => rpc.call(CHANNEL, 'semantic-references/selected', { envelope }, signal))
      .catch(() => {})
  } finally {
    for (const stop of stops) stop()
  }
}
