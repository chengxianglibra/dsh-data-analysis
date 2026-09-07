import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { MarivoPresentationProjection } from './projection/index.ts'
import {
  MARIVO_PRESENT_TOOL_NAME,
  MARIVO_PRESENTATION_DELIVERY_KIND,
  parsePresentationDelivery,
  presentationReceiptText,
} from './receipt.ts'
import { publishPresentation } from './reports.ts'

export interface PresentationBinding {
  workspaceId: string
  projection: MarivoPresentationProjection
}
export type PresentationBindingSource = () => PresentationBinding | Promise<PresentationBinding>

/** One call projects a draft, builds both assets, commits them, then emits the receipt. */
export function createMarivoPresentTool(
  source: PresentationBindingSource,
  session: Session,
  lifecycleSignal?: AbortSignal,
): ToolDefinition {
  return defineTool({
    name: MARIVO_PRESENT_TOOL_NAME,
    description:
      'Present a Workspace-relative analysis draft as one saved document and self-contained offline HTML. Returns exact file locations and a reader card. Only saved Artifact and computed snapshots are read; sources are declarations, not verification of calculations.',
    parameters: {
      draft_path: {
        type: 'string',
        required: true,
        description: 'Workspace-relative path of the presentation draft JSON.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { deliveryJson: { type: 'string', required: true } },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: presentationReceiptText(
            parsePresentationDelivery(JSON.parse(value.deliveryJson)).receipt,
          ),
        },
      ],
      presentationMeta: (_args, value) => JSON.parse(value.deliveryJson),
    },
    timeoutMs: 120_000,
    async execute(args, exec) {
      const signal = lifecycleSignal ? AbortSignal.any([exec.signal, lifecycleSignal]) : exec.signal
      if (
        typeof args.draft_path !== 'string' ||
        args.draft_path.length === 0 ||
        args.draft_path.length > 4096
      )
        throw new Error('invalid-draft-path')
      const owner = exec.agent
      if (!owner || owner.session !== session) throw new Error('presentation-session-mismatch')
      const rootCallId = String(exec.rootCallId ?? exec.callId)
      const call = [...session.events]
        .reverse()
        .find((event) => event.type === 'tool/call' && String(event.data.callId) === rootCallId)
      if (call?.type !== 'tool/call' || !Number.isSafeInteger(call.data.turn) || call.data.turn < 0)
        throw new Error('presentation-turn-unavailable')
      signal.throwIfAborted()
      const binding = await source()
      const identity = {
        workspaceId: binding.workspaceId,
        projectRoot: binding.projection.binding.projectRoot,
        fingerprint: binding.projection.binding.fingerprint,
      }
      const check = async () => {
        signal.throwIfAborted()
        if (owner.session !== session) throw new Error('presentation-session-mismatch')
        const current = await source()
        if (
          current.projection.status !== 'ready' ||
          current.workspaceId !== identity.workspaceId ||
          current.projection.binding.projectRoot !== identity.projectRoot ||
          current.projection.binding.fingerprint !== identity.fingerprint ||
          current.projection.binding !== binding.projection.binding
        )
          throw new Error('presentation-workspace-changed')
        signal.throwIfAborted()
      }
      await check()
      const draft = await binding.projection.readDraft(args.draft_path, signal)
      await check()
      const document = await binding.projection.project(draft, {
        workspaceId: binding.workspaceId,
        reportId: randomUUID(),
        buildId: randomUUID(),
        signal,
      })
      await check()
      const receipt = await publishPresentation(identity.projectRoot, document, null, check, signal)
      return {
        deliveryJson: JSON.stringify(
          parsePresentationDelivery({
            kind: MARIVO_PRESENTATION_DELIVERY_KIND,
            schemaVersion: 2,
            dshSessionId: String(session.id),
            turn: call.data.turn,
            receipt,
          }),
        ),
      }
    },
  })
}

export function registerMarivoPresentTool(
  ctx: Context,
  source: PresentationBindingSource,
  session: Session,
): () => void {
  const controller = new AbortController()
  const unregister = ctx.tools.register(createMarivoPresentTool(source, session, controller.signal))
  return () => {
    controller.abort()
    unregister()
  }
}
