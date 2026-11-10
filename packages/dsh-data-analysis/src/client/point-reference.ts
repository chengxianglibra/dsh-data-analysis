import type { Context } from '@deepseek-ai/cordis'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import type { ReferenceInsert } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import {
  type PointEnvelope,
  type PointRequest,
  parsePointEnvelope,
} from '../presentation/contracts/point-reference.ts'
import { pointReferenceLabel } from '../presentation/contracts/selection-text.ts'
import { MARIVO_PRESENTATION_RPC_CHANNEL } from '../presentation/receipt.ts'
import { boundedText, closed, parseJson } from '../semantic-reference/contracts.ts'
import {
  focusOwnedInput,
  type InputContextHost,
  withInputReferenceInsertion,
} from './input-context.ts'

const SOURCE = 'marivo-analysis-frame-point'
const MAX_REFERENCE = 524_288

function reference(envelope: PointEnvelope): ReferenceInsert {
  const name = pointReferenceLabel(envelope)
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
        return `@${pointReferenceLabel(parseReference(ref))}`
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
export function appendPointReference(
  host: InputContextHost,
  rpc: ClientConnectionRpc,
  request: PointRequest,
  lifetime: AbortSignal,
): Promise<() => void> {
  return withInputReferenceInsertion(host, request, lifetime, async (signal, insert) => {
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
    insert(reference(envelope))
  }).then(() => () => focusOwnedInput(host, request, lifetime))
}
