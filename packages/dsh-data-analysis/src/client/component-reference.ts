import type { Context } from '@deepseek-ai/cordis'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import type { ReferenceInsert } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import {
  COMPONENT_REFERENCE_MAX_BYTES,
  type ComponentEnvelope,
  type ComponentRequest,
  parseComponentEnvelope,
  parseComponentRequest,
} from '../presentation/contracts/component-reference.ts'
import { MARIVO_PRESENTATION_RPC_CHANNEL } from '../presentation/receipt.ts'
import { boundedText, closed, parseJson } from '../semantic-reference/contracts.ts'
import {
  focusOwnedInput,
  type InputContextHost,
  withInputReferenceInsertion,
} from './input-context.ts'

const SOURCE = 'marivo-analysis-component'
function label(envelope: ComponentEnvelope): string {
  return envelope.resourceName.replace(/[\r\n\t]/g, ' ').slice(0, 160)
}
function reference(envelope: ComponentEnvelope): ReferenceInsert {
  const name = label(envelope)
  return { source: SOURCE, ref: JSON.stringify(envelope), label: name, clipboardText: `@${name}` }
}
function parseReference(ref: string) {
  return parseComponentEnvelope(parseJson(ref, COMPONENT_REFERENCE_MAX_BYTES))
}
export function createComponentReferenceSource(
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
      throw new Error('component-picker-unavailable')
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
          'component/serialize',
          { envelope },
          signal,
        )
        signal.throwIfAborted()
        if (!result.ok) throw new Error('component-serialize-failed')
        return boundedText(closed(result.value, ['text']).text, 262_144)
      },
    },
  }
}
export function installComponentReferenceSource(ctx: Context, rpc: ClientConnectionRpc): void {
  ctx.effect(() => {
    const controller = new AbortController()
    const remove = ctx.inputTriggers.registerSource(
      createComponentReferenceSource(rpc, controller.signal),
    )
    return () => {
      controller.abort()
      remove()
    }
  })
}
export function appendComponentReference(
  host: InputContextHost,
  rpc: ClientConnectionRpc,
  request: ComponentRequest,
  lifetime: AbortSignal,
): Promise<() => void> {
  return withInputReferenceInsertion(host, request, lifetime, async (signal, insert) => {
    const result = await rpc.call(
      MARIVO_PRESENTATION_RPC_CHANNEL,
      'component/prepare',
      request,
      signal,
    )
    signal.throwIfAborted()
    if (!result.ok) throw new Error('component-prepare-failed')
    const envelope = parseComponentEnvelope(closed(result.value, ['envelope']).envelope)
    if (
      envelope.sessionId !== request.sessionId ||
      envelope.workspaceId !== request.workspaceId ||
      envelope.recordId !== request.recordId ||
      envelope.resourceName !== request.resourceName ||
      JSON.stringify(envelope.component) !==
        JSON.stringify(parseComponentRequest(request).component)
    )
      throw new Error('component-reference-mismatch')
    insert(reference(envelope))
  }).then(() => () => focusOwnedInput(host, request, lifetime))
}
