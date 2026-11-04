import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { registerMarivoTool } from '../tool-lifecycle.ts'
import { createAnalysisDocument } from './analysis.ts'
import { analysisCatalogSpec } from './contracts/analysis-catalog.ts'
import { analysisPresentInput, parseAnalysisRecordId } from './contracts/analysis-document.ts'
import { type FrameSnapshotV2, isFrameSnapshotV2 } from './contracts/snapshot.ts'
import { PRESENTATION_EXECUTION_BUDGETS } from './execution-policy.ts'
import {
  MARIVO_PRESENT_TOOL_NAME,
  MARIVO_PRESENTATION_DELIVERY_KIND,
  parsePresentationDelivery,
  presentationReceiptText,
} from './receipt.ts'
import { publishPresentation, readAnalysisRecord } from './reports.ts'

export type PresentationWorkspaceSource = () =>
  | { id: string; path: string }
  | Promise<{ id: string; path: string }>

/** One call admits resources, commits an immutable document and emits the exact delivery. */
export function createMarivoPresentTool(
  workspaceSource: PresentationWorkspaceSource,
  session: Session,
  lifecycleSignal?: AbortSignal,
): ToolDefinition {
  return defineTool({
    name: MARIVO_PRESENT_TOOL_NAME,
    description:
      'Create or update an analysis report or dashboard, or present a visual result. A successful save returns an immutable recordId. For one snapshot, pass resources only and omit program. Reuse saved snapshots for edits. Read marivo_ui_read only if the base definition is missing. Load dsh-data-analysis-presentation for custom OpenUI Lang.',
    parameters: {
      surface: {
        type: 'string',
        enum: ['tool', 'tab'],
        description: 'Default tool. Use tab for an explicitly requested report/dashboard.',
      },
      basedOnRecordId: {
        type: 'string',
        description:
          'Exact successful recordId to update. Omit to create. A stale base conflicts; never change only the ID to retry.',
      },
      resources: {
        type: 'object',
        description:
          'Named resources: {kind:"frame-snapshot",snapshotRef}, {kind:"dataset-snapshot",snapshotRef}, or {kind:"image-file",path} (Workspace-relative PNG/JPEG/GIF/WebP). Use actual successful analysis references. Omit to inherit on update; supplying resources replaces the full map. No rows or arbitrary URLs.',
        additionalProperties: true,
      },
      labels: {
        type: 'object',
        description:
          'Resource name -> column id -> display label. Display-only: does not change ids, sorting, units or exact values; must name columns of the declared snapshot; replaces previous present-level labels for that resource; omit to inherit.',
        additionalProperties: true,
      },
      title: { type: 'string', description: 'Short document title.' },
      program: {
        type: 'string',
        description:
          'Complete OpenUI Lang for creation. Call components with positional arguments, e.g. DatasetView("result", {chart: "table"}). Use named resources for data views. For updates, send only changed named statements, one per line; name = null deletes an unreferenced statement. Omit to retain the base program, including for a title-only edit.',
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
        const delivery = parsePresentationDelivery(JSON.parse(value.deliveryJson))
        return [{ type: 'text', text: presentationReceiptText(delivery.receipt, delivery.surface) }]
      },
      presentationMeta: (_args, value) => JSON.parse(value.deliveryJson),
    },
    timeoutMs: PRESENTATION_EXECUTION_BUDGETS.toolTimeoutMs,
    async execute(args, exec) {
      const signal = lifecycleSignal ? AbortSignal.any([exec.signal, lifecycleSignal]) : exec.signal
      const input = analysisPresentInput.parse(args)
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
      const check = async () => {
        signal.throwIfAborted()
        if (owner.session !== session) throw new Error('presentation-session-mismatch')
        const current = await workspace()
        if (current.id !== identity.id || current.path !== identity.path)
          throw new Error('presentation-workspace-changed')
        signal.throwIfAborted()
      }
      await check()
      const baseId = input.basedOnRecordId
        ? parseAnalysisRecordId(input.basedOnRecordId)
        : undefined
      const base = baseId
        ? await readAnalysisRecord(
            identity.path,
            identity.id,
            baseId.reportId,
            baseId.buildId,
            signal,
          )
        : undefined
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
      const receipt = await publishPresentation(
        identity.path,
        document,
        base?.buildId ?? null,
        check,
        signal,
        { kind: 'agent', sessionId: String(session.id), surface: input.surface },
      )
      return {
        deliveryJson: JSON.stringify(
          parsePresentationDelivery({
            kind: MARIVO_PRESENTATION_DELIVERY_KIND,
            schemaVersion: 2,
            dshSessionId: String(session.id),
            turn: call.data.turn,
            receipt,
            surface: input.surface,
          }),
        ),
      }
    },
  })
}

export function registerMarivoPresentTool(
  ctx: Context,
  workspaceSource: PresentationWorkspaceSource,
  session: Session,
): () => Promise<void> {
  return registerMarivoTool(ctx, createMarivoPresentTool(workspaceSource, session))
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
