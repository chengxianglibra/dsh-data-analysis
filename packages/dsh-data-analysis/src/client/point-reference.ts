import type { Context } from '@deepseek-ai/cordis'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import type { ReferenceInsert } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import {
  type PointEnvelope,
  type PointRequest,
  parsePointEnvelope,
} from '../presentation/contracts/point-reference.ts'
import { MARIVO_PRESENTATION_RPC_CHANNEL } from '../presentation/receipt.ts'
import { boundedText, closed, parseJson } from '../semantic-reference/contracts.ts'
import { type InputContextHost, inputEnd, ownedInput } from './input-context.ts'

const SOURCE = 'marivo-analysis-frame-point'
const MAX_REFERENCE = 524_288

function label(envelope: PointEnvelope): string {
  const coordinates = envelope.point.axes.flatMap((axis) =>
    axis.keys.map((key) => (key.value === null ? '∅' : String(key.value))),
  )
  return [envelope.point.column.label, ...coordinates]
    .join(' · ')
    .replace(/[\r\n\t]/g, ' ')
    .slice(0, 160)
}

function reference(envelope: PointEnvelope): ReferenceInsert {
  const name = label(envelope)
  return {
    source: SOURCE,
    ref: JSON.stringify(envelope),
    label: name,
    clipboardText: `@${name}`,
  }
}

function parseReference(ref: string): PointEnvelope {
  return parsePointEnvelope(parseJson(ref, MAX_REFERENCE))
}

export function createPointReferenceSource(
  rpc: ClientConnectionRpc,
  lifetime: AbortSignal,
): InputTriggerSource {
  return {
    trigger: '@',
    name: SOURCE,
    showGroupTitle: false,
    async candidates() {
      return []
    },
    onPick() {
      throw new Error('point-picker-unavailable')
    },
    codec: {
      clipboardText(ref) {
        return `@${label(parseReference(ref))}`
      },
      async serialize(ref, caller) {
        const envelope = parseReference(ref)
        const signal = AbortSignal.any([caller, lifetime])
        signal.throwIfAborted()
        const result = await rpc.call(
          MARIVO_PRESENTATION_RPC_CHANNEL,
          'point/serialize',
          { envelope },
          signal,
        )
        signal.throwIfAborted()
        if (!result.ok) throw new Error('point-serialize-failed')
        return boundedText(closed(result.value, ['text']).text, 262_144)
      },
    },
  }
}

export function installPointReferenceSource(ctx: Context, rpc: ClientConnectionRpc): void {
  ctx.effect(() => {
    const controller = new AbortController()
    const remove = ctx.inputTriggers.registerSource(
      createPointReferenceSource(rpc, controller.signal),
    )
    return () => {
      controller.abort()
      remove()
    }
  })
}

/** Prepare an immutable point before atomically appending it to the owning input. */
export async function appendPointReference(
  host: InputContextHost,
  rpc: ClientConnectionRpc,
  request: PointRequest,
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
    const result = await rpc.call(MARIVO_PRESENTATION_RPC_CHANNEL, 'point/prepare', request, signal)
    signal.throwIfAborted()
    if (!result.ok) throw new Error('point-prepare-failed')
    const envelope = parsePointEnvelope(closed(result.value, ['envelope']).envelope)
    if (
      envelope.sessionId !== request.sessionId ||
      envelope.workspaceId !== request.workspaceId ||
      envelope.recordId !== request.recordId ||
      envelope.resourceName !== request.resourceName ||
      envelope.row !== request.row ||
      envelope.field !== request.field
    )
      throw new Error('point-reference-mismatch')
    const { actx, input } = check()
    const snapshot = input.state.getSnapshot()
    if (snapshot.phase !== 'plain' && snapshot.phase !== 'claimed')
      throw new Error('input-unavailable')
    const applied = actx.bail(actx, 'slash/input-insert-reference', {
      reference: reference(envelope),
      span: inputEnd(snapshot),
    })
    if (applied !== true) throw new Error('input-unavailable')
  } finally {
    for (const stop of stops) stop()
  }
}
