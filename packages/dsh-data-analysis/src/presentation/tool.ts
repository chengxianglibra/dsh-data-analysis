import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { registerMarivoTool } from '../tool-lifecycle.ts'
import { createAnalysisDocument } from './analysis.ts'
import { analysisCatalogSpec } from './contracts/analysis-catalog.ts'
import { analysisPresentInput, parseAnalysisRecordId } from './contracts/analysis-document.ts'
import { PRESENTATION_EXECUTION_BUDGETS } from './execution-policy.ts'
import type { ExportWorkspaceSource } from './export-html.ts'
import type { MarivoPresentationProjection } from './projection/index.ts'
import {
  MARIVO_PRESENT_TOOL_NAME,
  MARIVO_PRESENTATION_DELIVERY_KIND,
  parsePresentationDelivery,
  presentationReceiptText,
} from './receipt.ts'
import { publishPresentation, readAnalysisRecord } from './reports.ts'

export interface PresentationBinding {
  workspaceId: string
  projection: MarivoPresentationProjection
}
export type PresentationBindingSource = () => PresentationBinding | Promise<PresentationBinding>

/** One call admits resources, commits an immutable document and emits the exact delivery. */
export function createMarivoPresentTool(
  source: PresentationBindingSource,
  session: Session,
  lifecycleSignal?: AbortSignal,
): ToolDefinition {
  return defineTool({
    name: MARIVO_PRESENT_TOOL_NAME,
    description:
      'Save and present an existing analysis result. For one result provide only resources: {result: {kind: "marivo-frame", sessionId, artifactId}} or {result: {kind: "dataset-snapshot", snapshotRef}}; omit program for the default view. Rows never belong in program. Default surface is tool; use tab for an explicitly requested report/dashboard. Custom pages use the eight-component analysis Catalog and OpenUI Lang. Saves an immutable recordId and exact snapshots; never reruns analysis. Streaming and patch updates are not connected yet. Legacy draft_path is no longer accepted.',
    parameters: {
      surface: {
        type: 'string',
        enum: ['tool', 'tab'],
        description: 'Default tool. Use tab for an explicitly requested report/dashboard.',
      },
      resources: {
        type: 'object',
        description:
          'Named resources: {kind:"marivo-frame",sessionId,artifactId}, {kind:"dataset-snapshot",snapshotRef}, or {kind:"image-file",path} (Workspace-relative PNG/JPEG/GIF/WebP). Use actual successful analysis references. No rows or arbitrary URLs.',
        additionalProperties: true,
      },
      title: { type: 'string', description: 'Short document title.' },
      locale: {
        type: 'string',
        enum: ['zh-CN', 'en-US'],
        description: 'Document language; defaults to zh-CN.',
      },
      program: {
        type: 'string',
        description:
          'Optional complete OpenUI Lang program using AnalysisFrameView, DatasetView, Stack, TextContent, Card, Tabs, TabItem, Image. Omit for a single resource. Image src is a resource name.',
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
    timeoutMs: PRESENTATION_EXECUTION_BUDGETS.toolTimeoutMs,
    async execute(args, exec) {
      const signal = lifecycleSignal ? AbortSignal.any([exec.signal, lifecycleSignal]) : exec.signal
      const input = analysisPresentInput.parse(args)
      const reportId = randomUUID()
      const owner = exec.agent
      if (!owner || owner.session !== session) throw new Error('presentation-session-mismatch')
      const rootCallId = String(exec.rootCallId ?? exec.callId)
      const call = [...session.snapshotEvents()]
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
      const document = await createAnalysisDocument(
        input,
        binding.projection,
        {
          workspaceId: binding.workspaceId,
          reportId,
          buildId: randomUUID(),
        },
        signal,
      )
      await check()
      const receipt = await publishPresentation(
        identity.projectRoot,
        document,
        null,
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
  source: PresentationBindingSource,
  session: Session,
): () => Promise<void> {
  return registerMarivoTool(ctx, createMarivoPresentTool(source, session))
}

/** Optional context recovery for an exact saved record. Never returns rows or starts Python. */
export function createMarivoUiReadTool(source: ExportWorkspaceSource): ToolDefinition {
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
                          axes: resource.snapshot.frame.axes,
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
export function registerMarivoUiReadTool(ctx: Context, source: ExportWorkspaceSource) {
  return registerMarivoTool(ctx, createMarivoUiReadTool(source))
}
