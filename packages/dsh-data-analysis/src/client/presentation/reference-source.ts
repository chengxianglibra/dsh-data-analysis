import type { Context } from '@deepseek-ai/cordis'
import type { ReferenceInsert } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { type InputContextHost, ownedInput } from '../input-context.ts'
import {
  PRESENTATION_CONTEXT_BYTES,
  type PresentationContext,
  wrapPresentationContext,
} from './context-reference.ts'

export const PRESENTATION_REFERENCE_SOURCE = 'marivo-report-cell'
const SCHEMA = 'dsh-data-analysis-presentation-reference/v1'
interface Envelope {
  schema: typeof SCHEMA
  sessionId: string
  workspaceId: string
  context: string
}

function parseReference(ref: string): Envelope {
  const value = JSON.parse(ref)
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== 'context,schema,sessionId,workspaceId' ||
    value.schema !== SCHEMA ||
    typeof value.sessionId !== 'string' ||
    !value.sessionId ||
    typeof value.workspaceId !== 'string' ||
    !value.workspaceId ||
    typeof value.context !== 'string' ||
    !value.context ||
    new TextEncoder().encode(value.context).length > PRESENTATION_CONTEXT_BYTES
  )
    throw new Error('报告 Cell 引用无效，请从报告重新添加。')
  return value
}

export function presentationReference(
  sessionId: string,
  workspaceId: string,
  payload: PresentationContext,
  append: boolean,
): ReferenceInsert {
  const envelope: Envelope = {
    schema: SCHEMA,
    sessionId,
    workspaceId,
    context: wrapPresentationContext(payload.context, append ? '\n\n' : ''),
  }
  return {
    source: PRESENTATION_REFERENCE_SOURCE,
    ref: JSON.stringify(envelope),
    label: `# ${payload.label}`,
    // Native copy and persisted plain-text drafts must retain the complete locator.
    clipboardText: envelope.context,
  }
}

export function createPresentationReferenceSource(
  host: InputContextHost,
  lifetime = new AbortController().signal,
): InputTriggerSource {
  return {
    // The Host routes codecs through trigger sources. No picker or # search is exposed.
    trigger: '@',
    name: PRESENTATION_REFERENCE_SOURCE,
    showGroupTitle: false,
    async candidates() {
      return []
    },
    onPick() {
      throw new Error('请从报告 Cell 菜单添加引用。')
    },
    codec: {
      clipboardText(ref) {
        return parseReference(ref).context
      },
      async serialize(ref, signal) {
        lifetime.throwIfAborted()
        signal.throwIfAborted()
        const envelope = parseReference(ref)
        ownedInput(host, envelope.sessionId, envelope.workspaceId)
        return envelope.context
      },
    },
  }
}

export function installPresentationReferenceSource(ctx: Context & InputContextHost): void {
  ctx.effect(() => {
    const controller = new AbortController()
    const remove = ctx.inputTriggers.registerSource(
      createPresentationReferenceSource(ctx, controller.signal),
    )
    // Alpha's generic chip prepends @. Our label already carries its report marker.
    const style = typeof document === 'undefined' ? undefined : document.createElement('style')
    if (style) {
      style.textContent = `[data-composer-chip="${PRESENTATION_REFERENCE_SOURCE}"] > span > span[aria-hidden="true"]{display:none}`
      document.head.append(style)
    }
    return () => {
      controller.abort()
      remove()
      style?.remove()
    }
  })
}
