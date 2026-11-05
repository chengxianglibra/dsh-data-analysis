import type { Context } from '@deepseek-ai/cordis'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import type { ReferenceInsert } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import {
  type DatasetEnvelope,
  type DatasetRequest,
  parseDatasetEnvelope,
} from '../presentation/contracts/dataset-reference.ts'
import { MARIVO_PRESENTATION_RPC_CHANNEL } from '../presentation/receipt.ts'
import { boundedText, closed, parseJson } from '../semantic-reference/contracts.ts'
import {
  focusOwnedInput,
  type InputContextHost,
  withInputReferenceInsertion,
} from './input-context.ts'

const SOURCE = 'marivo-analysis-dataset'
const label = (envelope: DatasetEnvelope) =>
  (envelope.schema === 'dsh-data-analysis-dataset-point/v1'
    ? `${envelope.resourceName} · ${envelope.field} · ${envelope.row + 1}`
    : envelope.resourceName
  )
    .replace(/[\r\n\t]/g, ' ')
    .slice(0, 160)
function parseReference(ref: string) {
  return parseDatasetEnvelope(parseJson(ref, 4096))
}
function reference(envelope: DatasetEnvelope): ReferenceInsert {
  const name = label(envelope)
  return { source: SOURCE, ref: JSON.stringify(envelope), label: name, clipboardText: `@${name}` }
}
export function createDatasetReferenceSource(
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
      throw new Error('dataset-picker-unavailable')
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
          'dataset/serialize',
          { envelope },
          signal,
        )
        signal.throwIfAborted()
        if (!result.ok) throw new Error('dataset-serialize-failed')
        return boundedText(closed(result.value, ['text']).text, 262_144)
      },
    },
  }
}
export function installDatasetReferenceSource(ctx: Context, rpc: ClientConnectionRpc): void {
  ctx.effect(() => {
    const controller = new AbortController()
    const remove = ctx.inputTriggers.registerSource(
      createDatasetReferenceSource(rpc, controller.signal),
    )
    return () => {
      controller.abort()
      remove()
    }
  })
}
export function appendDatasetReference(
  host: InputContextHost,
  rpc: ClientConnectionRpc,
  request: DatasetRequest,
  lifetime: AbortSignal,
): Promise<() => void> {
  return withInputReferenceInsertion(host, request, lifetime, async (signal, insert) => {
    const result = await rpc.call(
      MARIVO_PRESENTATION_RPC_CHANNEL,
      'dataset/prepare',
      request,
      signal,
    )
    signal.throwIfAborted()
    if (!result.ok) throw new Error('dataset-prepare-failed')
    const envelope = parseDatasetEnvelope(closed(result.value, ['envelope']).envelope)
    if (
      envelope.schema !== 'dsh-data-analysis-dataset-point/v1' ||
      envelope.sessionId !== request.sessionId ||
      envelope.workspaceId !== request.workspaceId ||
      envelope.recordId !== request.recordId ||
      envelope.resourceName !== request.resourceName ||
      envelope.row !== request.row ||
      envelope.field !== request.field
    )
      throw new Error('dataset-reference-mismatch')
    insert(reference(envelope))
  }).then(() => () => focusOwnedInput(host, request, lifetime))
}
