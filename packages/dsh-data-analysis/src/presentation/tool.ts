import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { defineTool, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import { registerMarivoTool } from '../tool-lifecycle.ts'
import { createAnalysisDocument } from './analysis.ts'
import { analysisCatalogSpec } from './contracts/analysis-catalog.ts'
import {
  type AnalysisDocument,
  analysisPresentInput,
  analysisRecordId,
  parseAnalysisRecordId,
} from './contracts/analysis-document.ts'
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
import { PresentationRecoveryError, unavailableDraft } from './recovery.ts'
import { publishPresentation, readAnalysisRecord, resolvePresentation } from './reports.ts'

export type PresentationWorkspaceSource = () =>
  | { id: string; path: string }
  | Promise<{ id: string; path: string }>

const presentationToolInput = analysisPresentInput.extend({
  stage: z.enum(['preview', 'save']).default('save'),
  draftId: z.string().uuid().optional(),
  draftRevision: z.string().uuid().optional(),
  rebaseOnRecordId: z.string().min(1).max(512).optional(),
})

function presentationTurn(session: Session, exec: ToolRunContext): number {
  const rootCallId = String(exec.rootCallId ?? exec.callId)
  const call = [...session.snapshotEvents()]
    .reverse()
    .find((event) => event.type === 'tool/call' && String(event.data.callId) === rootCallId)
  if (call?.type !== 'tool/call' || !Number.isSafeInteger(call.data.turn) || call.data.turn < 0)
    throw new Error('presentation-turn-unavailable')
  return call.data.turn
}

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
      'Present a result or compose a report. For custom pages, load dsh-data-analysis-presentation and use stage=preview as views become ready, then stage=save once complete. One in-memory draft per Session Turn; it expires at Turn end or Host restart. Preview returns draftId/draftRevision; save returns recordId. Calls must be sequential. Single results can save directly with resources and no program. Use marivo_ui_read only for missing editing context or conflict recovery; deliveryJson is the Host delivery envelope.',
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
      rebaseOnRecordId: {
        type: 'string',
        description:
          'Explicit conflict repair only: with stage=preview and the latest draftId/draftRevision, name the reviewed current saved version of the same report. Supply the cumulative program patch against that version and full resources, plus intended title/locale/labels changes. Does not merge changes automatically.',
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
        properties: {
          stage: { type: 'string', required: true, enum: ['preview', 'save'] },
          draftId: { type: 'string' },
          draftRevision: { type: 'string' },
          recordId: { type: 'string' },
          deliveryJson: { type: 'string', required: true },
        },
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
        (input.draftId && input.basedOnRecordId) ||
        (input.rebaseOnRecordId &&
          (input.stage !== 'preview' || !input.draftId || !input.program || !input.resources))
      )
        throw new PresentationRecoveryError(
          'analysis-draft-invalid-request',
          'Pair draftId with draftRevision. Use basedOnRecordId only before a draft exists. Explicit rebase requires stage=preview, both draft identifiers, rebaseOnRecordId, a reviewed program patch and the full resources map.',
        )
      const owner = exec.agent
      if (!owner || owner.session !== session) throw new Error('presentation-session-mismatch')
      const turn = presentationTurn(session, exec)
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
      const perform = async (lease?: AnalysisDraftLease) => {
        const check = async () => {
          await checkWorkspace()
          lease?.check()
        }
        await check()
        const current = lease ? drafts.get(sessionId) : undefined
        const active = current?.delivery.turn === turn ? current : undefined
        if (
          active &&
          (active.workspacePath !== identity.path || active.document.workspaceId !== identity.id)
        )
          throw unavailableDraft()
        if (
          input.draftId &&
          (!active ||
            active.delivery.draftId !== input.draftId ||
            active.workspacePath !== identity.path ||
            active.document.workspaceId !== identity.id)
        )
          throw unavailableDraft()
        if (active && active.delivery.draftRevision !== input.draftRevision)
          throw new PresentationRecoveryError(
            'analysis-draft-conflict',
            'Read marivo_ui_read({draft:true}) and reconcile the intended edit with the latest draft before using its identifiers. Do not blindly replay a stale patch.',
            { draftId: active.delivery.draftId, draftRevision: active.delivery.draftRevision },
          )
        const savedBaseId = input.rebaseOnRecordId ?? input.basedOnRecordId
        const baseId = savedBaseId ? parseAnalysisRecordId(savedBaseId) : undefined
        if (input.rebaseOnRecordId && active && baseId) {
          if (baseId.reportId !== active.document.reportId)
            throw new PresentationRecoveryError(
              'analysis-draft-invalid-request',
              'Rebase only onto a saved version of this draft report. Read the current report and draft before selecting the base.',
            )
          const latest = await resolvePresentation(
            identity.path,
            identity.id,
            baseId.reportId,
            signal,
          )
          if (latest.buildId !== baseId.buildId)
            throw new PresentationRecoveryError(
              'report-save-conflict',
              'The proposed rebase version is stale. Read currentRecordId and the active draft, reconcile the changes, then preview the rebase again.',
              { currentRecordId: analysisRecordId(latest.reportId, latest.buildId) },
            )
        }
        const base =
          (input.rebaseOnRecordId ? undefined : active?.document) ??
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
          input.rebaseOnRecordId ? active?.document.resources : undefined,
        )
        await check()
        const baseBuildId =
          active && !input.rebaseOnRecordId ? active.baseBuildId : (base?.buildId ?? null)
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
          return {
            stage: 'preview' as const,
            draftId: delivery.draftId,
            draftRevision: delivery.draftRevision,
            deliveryJson: JSON.stringify(delivery),
          }
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
          stage: 'save' as const,
          recordId: document.recordId,
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

const uiReadInput = z.union([
  z.strictObject({ recordId: z.string().min(1).max(512), current: z.boolean().optional() }),
  z.strictObject({ draft: z.literal(true) }),
])

/** Editing context only: exact/current saved version or the caller's active Turn draft. */
export function createMarivoUiReadTool(
  source: PresentationWorkspaceSource,
  drafts?: AnalysisDrafts,
): ToolDefinition {
  return defineTool({
    name: 'marivo_ui_read',
    description:
      'Recover missing editing context without querying data: recordId reads that exact saved version; current=true resolves its report to the current saved version; draft=true reads the latest draft in the calling Session Turn. Choose saved or draft input, not both. Returns definitionJson with identifiers, program, reusable resource declarations and bounded schemas, never rows. Do not read back after success by default.',
    parameters: {
      recordId: {
        type: 'string',
        description: 'Exact marivo-ui recordId from the successful presentation receipt.',
      },
      current: {
        type: 'boolean',
        description:
          'With recordId, read the current saved version of that report instead of the exact version.',
      },
      draft: {
        type: 'boolean',
        description:
          'Set true without recordId/current to recover this Session Turn draft and its latest identifiers.',
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
      const input = uiReadInput.parse(args)
      const binding = await source()
      let document: AnalysisDocument
      let identifiers: {
        recordId?: string
        draftId?: string
        draftRevision?: string
        basedOnRecordId?: string
      }
      let checkDraft = () => {}
      if ('draft' in input) {
        const session = exec.agent?.session
        if (!session) throw unavailableDraft()
        const turn = presentationTurn(session, exec)
        const draft = drafts?.get(String(session.id))
        if (
          !draft ||
          draft.delivery.turn !== turn ||
          draft.workspacePath !== binding.path ||
          draft.document.workspaceId !== binding.id
        )
          throw unavailableDraft()
        document = draft.document
        identifiers = {
          draftId: draft.delivery.draftId,
          draftRevision: draft.delivery.draftRevision,
          ...(draft.baseBuildId
            ? { basedOnRecordId: analysisRecordId(document.reportId, draft.baseBuildId) }
            : {}),
        }
        checkDraft = () => {
          if (exec.agent?.session !== session || drafts?.get(String(session.id)) !== draft)
            throw unavailableDraft()
        }
      } else {
        const { reportId, buildId } = parseAnalysisRecordId(input.recordId)
        const selected = input.current
          ? (await resolvePresentation(binding.path, binding.id, reportId, exec.signal)).buildId
          : buildId
        document = await readAnalysisRecord(
          binding.path,
          binding.id,
          reportId,
          selected,
          exec.signal,
        )
        identifiers = { recordId: document.recordId }
      }
      const current = await source()
      if (current.id !== binding.id || current.path !== binding.path)
        throw new Error('presentation-workspace-changed')
      exec.signal.throwIfAborted()
      checkDraft()
      return {
        definitionJson: JSON.stringify({
          ...identifiers,
          title: document.title,
          locale: document.locale,
          catalog: document.catalog,
          program: document.program,
          resources: Object.fromEntries(
            Object.entries(document.resources).map(([name, resource]) => [
              name,
              resource.kind === 'image'
                ? { kind: 'image', mimeType: resource.mimeType, declaration: resource.declaration }
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
export function registerMarivoUiReadTool(
  ctx: Context,
  source: PresentationWorkspaceSource,
  drafts?: AnalysisDrafts,
) {
  return registerMarivoTool(ctx, createMarivoUiReadTool(source, drafts))
}
