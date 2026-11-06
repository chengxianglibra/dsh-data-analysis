import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import { registerMarivoTool } from '../tool-lifecycle.ts'
import { createAnalysisDocument } from './analysis.ts'
import { analysisCatalogSpec } from './contracts/analysis-catalog.ts'
import { analysisPresentInput, parseAnalysisRecordId } from './contracts/analysis-document.ts'
import { type FrameSnapshotV2, isFrameSnapshotV2 } from './contracts/snapshot.ts'
import { type AnalysisDraftLease, AnalysisDrafts } from './drafts.ts'
import { PRESENTATION_EXECUTION_BUDGETS } from './execution-policy.ts'
import {
  MARIVO_DRAFT_DELIVERY_KIND,
  MARIVO_PRESENT_TOOL_NAME,
  MARIVO_PRESENTATION_DELIVERY_KIND,
  parsePresentationDelivery,
  parsePresentationToolDelivery,
  presentationReceiptText,
} from './receipt.ts'
import { publishPresentation, readAnalysisRecord } from './reports.ts'

export type PresentationWorkspaceSource = () =>
  | { id: string; path: string }
  | Promise<{ id: string; path: string }>

const presentationToolInput = analysisPresentInput.extend({
  stage: z.enum(['preview', 'save']).default('save'),
  draftId: z.string().uuid().optional(),
  draftRevision: z.string().uuid().optional(),
})

/** Preview validated working revisions, or publish an immutable report version. */
export function createMarivoPresentTool(
  workspaceSource: PresentationWorkspaceSource,
  session: Session,
  lifecycleSignal?: AbortSignal,
  drafts = new AnalysisDrafts(),
): ToolDefinition {
  return defineTool({
    name: MARIVO_PRESENT_TOOL_NAME,
    description:
      'Present a result or compose a report or dashboard. For custom pages, load dsh-data-analysis-presentation and call stage=preview as each view becomes ready. The same report tab updates and history is unchanged. Once complete, call stage=save with the latest draftId and draftRevision to create one immutable report version. Single results can be saved directly with resources and no program. Use marivo_ui_read only when the saved base definition is missing.',
    parameters: {
      surface: {
        type: 'string',
        enum: ['tool', 'tab'],
        description:
          'Defaults to tool for chat. Use tab for a requested report or dashboard. For native preview, put surface and any basedOnRecordId before the content.',
      },
      stage: {
        type: 'string',
        enum: ['preview', 'save'],
        description: 'Defaults to save. Set preview first to update the unsaved report tab.',
      },
      draftId: {
        type: 'string',
        description: 'Use the returned draft ID to continue or save the current Turn draft.',
      },
      draftRevision: {
        type: 'string',
        description: 'Required with draftId. Use the revision from the last successful preview.',
      },
      basedOnRecordId: {
        type: 'string',
        description:
          'For a direct save or the first preview, use the exact saved recordId to edit an existing report. Omit when creating or continuing a draft. If the saved base is stale, review the current version and reapply the intended edit.',
      },
      resources: {
        type: 'object',
        description:
          'Map a resource name to {kind:"frame-snapshot",snapshotRef}, {kind:"dataset-snapshot",snapshotRef}, or {kind:"image-file",path} (Workspace-relative PNG/JPEG/GIF/WebP). Use the snapshotRef from the successful marivo_python capture of the Frame or DataFrame. On update, omit to reuse saved resources. Supplying a map replaces the full set. No rows or arbitrary URLs.',
        additionalProperties: true,
      },
      labels: {
        type: 'object',
        description:
          'Resource name -> column id -> display label. Display-only: does not change ids, sorting, units or exact values; must name columns of the declared snapshot; replaces previous present-level labels for that resource; omit to inherit.',
        additionalProperties: true,
      },
      title: { type: 'string', description: 'Short document title. Omit on update to inherit.' },
      program: {
        type: 'string',
        description:
          'For a custom page, supply complete OpenUI Lang rooted at root and refer to resources by name. For a layout edit, send only changed named statements, one per line. Remove parent references before deleting a statement with name = null. Omit to retain the saved layout, including for title-only or label-only edits.',
      },
      locale: {
        type: 'string',
        enum: ['zh-CN', 'en-US'],
        description: 'Document language; inherits on update, otherwise defaults to zh-CN.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { deliveryJson: { type: 'string', required: true } },
      },
      render: (_args, value) => {
        const delivery = parsePresentationToolDelivery(JSON.parse(value.deliveryJson))
        if (delivery.kind === MARIVO_DRAFT_DELIVERY_KIND)
          return [
            {
              type: 'text',
              text: `Preview updated (unsaved).\nDraft ID: ${delivery.draftId}\nDraft revision: ${delivery.draftRevision}`,
            },
          ]
        return [{ type: 'text', text: presentationReceiptText(delivery.receipt, delivery.surface) }]
      },
      presentationMeta: (_args, value) => JSON.parse(value.deliveryJson),
    },
    timeoutMs: PRESENTATION_EXECUTION_BUDGETS.toolTimeoutMs,
    async execute(args, exec) {
      const signal = lifecycleSignal ? AbortSignal.any([exec.signal, lifecycleSignal]) : exec.signal
      const input = presentationToolInput.parse(args)
      if (
        Boolean(input.draftId) !== Boolean(input.draftRevision) ||
        (input.draftId && input.basedOnRecordId)
      )
        throw new Error('analysis-draft-invalid-request')
      const owner = exec.agent
      if (!owner || owner.session !== session) throw new Error('presentation-session-mismatch')
      const rootCallId = String(exec.rootCallId ?? exec.callId)
      const call = [...session.snapshotEvents()]
        .reverse()
        .find((event) => event.type === 'tool/call' && String(event.data.callId) === rootCallId)
      if (call?.type !== 'tool/call' || !Number.isSafeInteger(call.data.turn) || call.data.turn < 0)
        throw new Error('presentation-turn-unavailable')
      signal.throwIfAborted()
      const workspace = workspaceSource
      const identity = await workspace()
      const checkWorkspace = async () => {
        signal.throwIfAborted()
        if (owner.session !== session) throw new Error('presentation-session-mismatch')
        const current = await workspace()
        if (current.id !== identity.id || current.path !== identity.path)
          throw new Error('presentation-workspace-changed')
        signal.throwIfAborted()
      }
      const sessionId = String(session.id)
      const turn = call.data.turn
      const perform = async (lease?: AnalysisDraftLease) => {
        const check = async () => {
          await checkWorkspace()
          lease?.check()
        }
        await check()
        const current = lease ? drafts.get(sessionId) : undefined
        const active = current?.delivery.turn === turn ? current : undefined
        if (
          input.draftId &&
          (!active ||
            active.delivery.draftId !== input.draftId ||
            active.workspacePath !== identity.path ||
            active.document.workspaceId !== identity.id)
        )
          throw new Error('analysis-draft-unavailable')
        if (active && active.delivery.draftRevision !== input.draftRevision)
          throw new Error('analysis-draft-conflict: use the latest draft ID and revision')
        const baseId = input.basedOnRecordId
          ? parseAnalysisRecordId(input.basedOnRecordId)
          : undefined
        const base =
          active?.document ??
          (baseId
            ? await readAnalysisRecord(
                identity.path,
                identity.id,
                baseId.reportId,
                baseId.buildId,
                signal,
              )
            : undefined)
        const document = await createAnalysisDocument(
          input,
          {
            projectRoot: identity.path,
          },
          {
            workspaceId: identity.id,
            reportId: base?.reportId ?? randomUUID(),
            buildId: randomUUID(),
          },
          signal,
          base,
        )
        await check()
        const baseBuildId = active ? active.baseBuildId : (base?.buildId ?? null)
        if (input.stage === 'preview' && lease) {
          const delivery = {
            kind: MARIVO_DRAFT_DELIVERY_KIND,
            dshSessionId: sessionId,
            workspaceId: identity.id,
            turn,
            draftId: active?.delivery.draftId ?? randomUUID(),
            draftRevision: document.buildId,
          } as const
          lease.write({ delivery, workspacePath: identity.path, baseBuildId, document })
          return { deliveryJson: JSON.stringify(delivery) }
        }
        const surface = active ? 'tab' : input.surface
        const receipt = await publishPresentation(
          identity.path,
          document,
          baseBuildId,
          check,
          signal,
          { kind: 'agent', sessionId, surface },
        )
        if (active) drafts.clear(sessionId, turn)
        return {
          deliveryJson: JSON.stringify(
            parsePresentationDelivery({
              kind: MARIVO_PRESENTATION_DELIVERY_KIND,
              schemaVersion: 2,
              dshSessionId: sessionId,
              turn,
              receipt,
              surface,
              ...(active ? { draftId: active.delivery.draftId } : {}),
            }),
          ),
        }
      }
      return input.stage === 'preview' || input.draftId
        ? drafts.run(sessionId, turn, perform)
        : perform()
    },
  })
}

export function registerMarivoPresentTool(
  ctx: Context,
  workspaceSource: PresentationWorkspaceSource,
  session: Session,
  drafts?: AnalysisDrafts,
): () => Promise<void> {
  return registerMarivoTool(
    ctx,
    createMarivoPresentTool(workspaceSource, session, undefined, drafts),
  )
}

/**
 * Names the model needs to write AnalysisFrameView `encoding`; never rows, periods or
 * contexts. Unavailable interpretation is reported by its section state.
 */
function frameReadSummary(snapshot: FrameSnapshotV2) {
  const section = snapshot.frame.sections.interpretation
  const values = snapshot.frame.fields.filter((f) => f.role === 'value').map((f) => f.id)
  if (typeof section !== 'object' || section.status !== 'captured')
    return { description: snapshot.frame.description, values, interpretation: section }
  return {
    description: snapshot.frame.description,
    values,
    interpretation: {
      status: section.status,
      comparisons: section.comparisons.map((c) => ({
        alias: c.alias,
        binding: c.binding.kind,
        groups: c.groups.map((g) => ({ name: g.name, values: g.values })),
      })),
      decompositions: section.decompositions.map((d) => ({
        target: d.target.kind,
        outputs: d.outputs.map((o) => ({ role: o.role, name: o.name })),
      })),
      alignments: section.alignments.map((a) => ({
        left: a.left.values,
        right: a.right.values,
      })),
    },
  }
}

/** Optional context recovery for an exact saved record. Never returns rows or starts Python. */
export function createMarivoUiReadTool(source: PresentationWorkspaceSource): ToolDefinition {
  return defineTool({
    name: 'marivo_ui_read',
    description:
      'Read the UI definition and necessary saved resource schemas for one exact recordId when that context is missing. Do not call after successful presentation by default. Does not query live data or list documents.',
    parameters: {
      recordId: {
        type: 'string',
        required: true,
        description: 'Exact marivo-ui recordId from the successful presentation receipt.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { definitionJson: { type: 'string', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: value.definitionJson }],
    },
    async execute(args, exec) {
      const { reportId, buildId } = parseAnalysisRecordId(args.recordId)
      const binding = await source()
      const document = await readAnalysisRecord(
        binding.path,
        binding.id,
        reportId,
        buildId,
        exec.signal,
      )
      const current = await source()
      if (current.id !== binding.id || current.path !== binding.path)
        throw new Error('presentation-workspace-changed')
      exec.signal.throwIfAborted()
      return {
        definitionJson: JSON.stringify({
          recordId: document.recordId,
          title: document.title,
          locale: document.locale,
          catalog: document.catalog,
          program: document.program,
          resources: Object.fromEntries(
            Object.entries(document.resources).map(([name, resource]) => [
              name,
              resource.kind === 'image'
                ? { kind: 'image', mimeType: resource.mimeType }
                : {
                    kind: resource.snapshot.kind,
                    declaration: resource.declaration,
                    columns: resource.snapshot.data.columns,
                    coverage: resource.snapshot.coverage,
                    ...(resource.snapshot.kind === 'frame'
                      ? {
                          fields: resource.snapshot.frame.fields,
                          layout: resource.snapshot.frame.layout,
                          // v2 axes carry their variant (calendar grain, interval, paired).
                          axes: resource.snapshot.frame.axes,
                          ...(isFrameSnapshotV2(resource.snapshot)
                            ? frameReadSummary(resource.snapshot)
                            : {}),
                        }
                      : {}),
                  },
            ]),
          ),
          signatures: Object.fromEntries(
            Object.entries(analysisCatalogSpec.components).map(([name, c]) => [name, c.signature]),
          ),
        }),
      }
    },
  })
}
export function registerMarivoUiReadTool(ctx: Context, source: PresentationWorkspaceSource) {
  return registerMarivoTool(ctx, createMarivoUiReadTool(source))
}
