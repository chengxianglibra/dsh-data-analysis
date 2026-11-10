import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { defineTool, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import type { MarivoCheckedRunner } from '../environment/types.ts'
import {
  type PythonCodeRef,
  type PythonCodeSnippet,
  readPythonExecution,
} from '../python-execution.ts'
import { registerMarivoTool } from '../tool-lifecycle.ts'
import { createAnalysisDocument } from './analysis.ts'
import {
  type AnalysisDocument,
  analysisPresentInput,
  analysisRecordId,
  parseAnalysisRecordId,
  sameAnalysisDeclaration,
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
import { analysisResultSummary } from './result-summary.ts'

export type PresentationWorkspaceSource = () =>
  | { id: string; path: string }
  | Promise<{ id: string; path: string }>

const presentationToolInput = analysisPresentInput.omit({ surface: true }).extend({
  stage: z.enum(['preview', 'save']).default('save'),
  draftId: z.string().uuid().optional(),
  draftRevision: z.string().uuid().optional(),
  rebaseOnRecordId: z.string().min(1).max(512).optional(),
})

export function presentationTurn(
  session: Session,
  exec: Pick<ToolRunContext, 'rootCallId' | 'callId'>,
): number {
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
  runner?: () => Promise<MarivoCheckedRunner>,
): ToolDefinition {
  return defineTool({
    name: MARIVO_PRESENT_TOOL_NAME,
    description:
      'Present an existing result or update an analysis document. New reports always appear in one Chat region; only the reader can move it to the sidebar. For reports requiring analysis, preview early, update the same draft as results become ready, and save once. Already-ready changes can save directly. Send only changed resources and named program statements. Preview returns draftId/draftRevision; save returns recordId and may include final changes. Drafts expire at Turn end or Host restart. Use marivo_ui_read to recover missing context or review conflicts. deliveryJson is for Host delivery.',
    parameters: {
      stage: {
        type: 'string',
        enum: ['preview', 'save'],
        description:
          'Defaults to save only for a standalone request without draft identity. Requests with draftId or draftRevision require an explicit preview or save stage. Preview updates the same unsaved draft without adding history, including a text-only starting page. Native program prefixes stream as candidates; new resources appear after validation. Save the latest draft once the requested report work is complete.',
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
          'Conflict repair only: with stage=preview and the latest draft identity, name the reviewed current saved version. Apply cumulative changes against that version. For data refresh, omit program and metadata and replace only compatible same-name resources.',
      },
      resourcePatch: {
        type: 'object',
        description:
          'Changes only: put maps names to {kind:"analysis-frame",ref,codeRef?}, {kind:"dataframe",ref,codeRef?}, or {kind:"image-file",path}; remove names resources to delete. Omitted names remain. Send before program to retain unchanged resources during streaming; {} means no changes. Use exact fixed references and their producer codeRef. For a data refresh replace only existing names and omit program/title/locale/labels. Identical declarations reuse the saved snapshot; same-path images do not refresh. No rows or arbitrary URLs.',
        additionalProperties: false,
        properties: {
          put: { type: 'object', additionalProperties: true },
          remove: { type: 'array', items: { type: 'string' } },
        },
      },
      labels: {
        type: 'object',
        description:
          "Resource name -> column id -> display label. Display-only: does not change ids, sorting, units or exact values; must name declared columns. Replaces the resource's previous present-level labels. Omit during data refresh to preserve existing labels.",
        additionalProperties: true,
      },
      title: {
        type: 'string',
        description: 'Short document title. Omit to inherit; leave unchanged during data refresh.',
      },
      program: {
        type: 'string',
        description:
          'Complete OpenUI Lang for a new page; changed named statements for an update. Keep changes reachable from root. Remove parent references before deleting a statement with name = null. Omit during a saved-report data refresh, including conflict rebase.',
      },
      locale: {
        type: 'string',
        enum: ['zh-CN', 'en-US'],
        description:
          'Document language; inherits on update, otherwise defaults to zh-CN. Omit during data refresh.',
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
          resultMetadataJson: {
            type: 'string',
            required: true,
            description:
              'JSON metadata for newly added or replaced resources: columns, axes, values and coverage; no business rows.',
          },
        },
      },
      render: (_args, value) => {
        const delivery = parsePresentationToolDelivery(JSON.parse(value.deliveryJson))
        if (delivery.kind === MARIVO_DRAFT_DELIVERY_KIND)
          return [
            {
              type: 'text',
              text: `Preview updated (unsaved).\nDraft ID: ${delivery.draftId}\nDraft revision: ${delivery.draftRevision}\nInitial location: Chat\nResult metadata: ${value.resultMetadataJson}`,
            },
          ]
        return [
          {
            type: 'text',
            text: `${presentationReceiptText(delivery.receipt, delivery.surface)}\nResult metadata: ${value.resultMetadataJson}`,
          },
        ]
      },
      presentationMeta: (_args, value) => JSON.parse(value.deliveryJson),
    },
    timeoutMs: PRESENTATION_EXECUTION_BUDGETS.toolTimeoutMs,
    async execute(args, exec) {
      const signal = lifecycleSignal ? AbortSignal.any([exec.signal, lifecycleSignal]) : exec.signal
      if (
        args.stage === undefined &&
        (args.draftId !== undefined || args.draftRevision !== undefined)
      )
        throw new PresentationRecoveryError(
          'analysis-draft-stage-required',
          'Select stage=preview to update the draft or stage=save to publish it. Continuing a draft never defaults to save; reuse its latest successful draftId/draftRevision.',
        )
      const input = presentationToolInput.parse(args)
      if (
        Boolean(input.draftId) !== Boolean(input.draftRevision) ||
        (input.draftId && input.basedOnRecordId) ||
        (input.rebaseOnRecordId && (input.stage !== 'preview' || !input.draftId))
      )
        throw new PresentationRecoveryError(
          'analysis-draft-invalid-request',
          'Pair draftId with draftRevision. Use basedOnRecordId only before a draft exists. Explicit rebase requires stage=preview, both draft identifiers and the reviewed current recordId.',
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
        let checkResourceStream: (() => void) | undefined
        const check = async () => {
          await checkWorkspace()
          lease?.check()
          checkResourceStream?.()
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
        // Preserve the v2 wire identity. Placement is owned by the reader, never the model.
        const surface = 'tool' as const
        const changedNames = Object.entries(input.resourcePatch?.put ?? {})
          .filter(([name, declaration]) => {
            const previous = base?.resources[name]
            return !previous || !sameAnalysisDeclaration(previous.declaration, declaration)
          })
          .map(([name]) => name)
        const resourceStream = drafts.beginResources(
          { sessionId, workspaceId: identity.id, turn, callId: String(exec.callId) },
          identity.path,
        )
        checkResourceStream = resourceStream.check
        let streamSucceeded = false
        try {
          const document = await createAnalysisDocument(
            { ...input, surface },
            {
              projectRoot: identity.path,
              runner,
            },
            {
              workspaceId: identity.id,
              reportId: base?.reportId ?? randomUUID(),
              buildId: randomUUID(),
            },
            signal,
            base,
            input.rebaseOnRecordId ? active?.document.resources : undefined,
            async (name, resource) => {
              await check()
              resourceStream.put(name, resource)
            },
          )
          await check()
          const changedResources = Object.fromEntries(
            changedNames.flatMap((name) =>
              document.resources[name] ? [[name, document.resources[name]]] : [],
            ),
          )
          const baseBuildId =
            active && !input.rebaseOnRecordId ? active.baseBuildId : (base?.buildId ?? null)
          if (input.stage === 'preview' && lease) {
            const delivery = {
              kind: MARIVO_DRAFT_DELIVERY_KIND,
              dshSessionId: sessionId,
              workspaceId: identity.id,
              turn,
              surface,
              draftId: active?.delivery.draftId ?? randomUUID(),
              draftRevision: document.buildId,
            } as const
            lease.write({ delivery, workspacePath: identity.path, baseBuildId, document })
            streamSucceeded = true
            return {
              stage: 'preview' as const,
              draftId: delivery.draftId,
              draftRevision: delivery.draftRevision,
              deliveryJson: JSON.stringify(delivery),
              resultMetadataJson: JSON.stringify(analysisResultSummary(changedResources)),
            }
          }
          const receipt = await publishPresentation(
            identity.path,
            document,
            baseBuildId,
            check,
            signal,
            { kind: 'agent', sessionId, surface },
          )
          if (active) drafts.clear(sessionId, turn)
          streamSucceeded = true
          return {
            stage: 'save' as const,
            recordId: document.recordId,
            resultMetadataJson: JSON.stringify(analysisResultSummary(changedResources)),
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
        } finally {
          resourceStream.finish(streamSucceeded)
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
  runner?: () => Promise<MarivoCheckedRunner>,
): () => Promise<void> {
  return registerMarivoTool(
    ctx,
    createMarivoPresentTool(workspaceSource, session, undefined, drafts, runner),
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
  z.strictObject({
    recordId: z.string().min(1).max(512),
    current: z.boolean().optional(),
    includeCode: z.boolean().optional(),
  }),
  z.strictObject({ draft: z.literal(true), includeCode: z.boolean().optional() }),
])

/** Editing context only: exact/current saved version or the caller's active Turn draft. */
export function createMarivoUiReadTool(
  source: PresentationWorkspaceSource,
  drafts?: AnalysisDrafts,
): ToolDefinition {
  return defineTool({
    name: 'marivo_ui_read',
    description:
      "Read an exact/current saved report or the active Turn draft without querying data or executing scripts. Use it to establish data-refresh context, recover missing editing context or resolve conflicts. recordId selects an exact version; current=true selects its report's current version; draft=true selects the calling Session Turn draft. Choose saved or draft input, not both. definitionJson contains identifiers, program, reusable declarations, codeRefs and bounded schemas, not business rows. includeCode reads available bound execution records in deduplicated sources. For data refresh, review inputs and scripts, prepare explicit new fixed results, reuse shared results across their dependent views, and preview same-name resource replacements while preserving the page definition. Do not routinely read back after successful previews or saves.",
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
      includeCode: {
        type: 'boolean',
        description:
          'Read only Host-stored scripts bound to these resources, with codeRef and datasource declarations. Use for script traceability or an authorized data update; never executes a script or returns rows.',
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
        surface?: 'tool' | 'tab'
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
          surface: draft.delivery.surface,
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
      const sources: (
        | { codeRef: PythonCodeRef; status: 'available'; code: PythonCodeSnippet }
        | { codeRef: PythonCodeRef; status: 'unavailable' }
      )[] = []
      if (input.includeCode) {
        const refs = new Map<string, PythonCodeRef>()
        for (const resource of Object.values(document.resources))
          if (resource.kind === 'snapshot' && resource.binding.codeRef)
            refs.set(JSON.stringify(resource.binding.codeRef), resource.binding.codeRef)
        for (const codeRef of refs.values()) {
          try {
            const code = await readPythonExecution(binding.path, codeRef, exec.signal)
            sources.push({ codeRef, status: 'available', code })
          } catch {
            exec.signal.throwIfAborted()
            sources.push({ codeRef, status: 'unavailable' })
          }
        }
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
                    ...(resource.binding.codeRef ? { codeRef: resource.binding.codeRef } : {}),
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
          ...(input.includeCode ? { sources } : {}),
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
