import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { defineTool, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import type { MarivoCheckedRunner } from '../environment/types.ts'
import type { SavedWriteCommitted } from '../next-steps/saved-writes.ts'
import { type PythonCodeRef, readPythonExecution } from '../python-execution.ts'
import { registerMarivoTool } from '../tool-lifecycle.ts'
import { createAnalysisDocument, validateRefreshShape } from './analysis.ts'
import {
  type AnalysisDocument,
  analysisPresentInput,
  analysisRecordId,
  parseAnalysisRecordId,
} from './contracts/analysis-document.ts'
import {
  frameReadSummary,
  type ReportSourceSummary,
  reportDefinition,
  reportDefinitionToolSchema,
} from './contracts/report-definition.ts'
import {
  draftReportRef,
  parseReportRef,
  reportRefFromRecordId,
  savedReportRef,
} from './contracts/report-ref.ts'
import { sameAnalysisResult } from './contracts/resource-declaration.ts'
import { isFrameSnapshotV2 } from './contracts/snapshot.ts'
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
import { analysisResultSummary, analysisResultSummaryToolSchema } from './result-summary.ts'

export type PresentationWorkspaceSource = () =>
  | { id: string; path: string }
  | Promise<{ id: string; path: string }>

const presentationToolInput = analysisPresentInput
  .omit({ surface: true, basedOnRecordId: true })
  .extend({
    stage: z.enum(['preview', 'save']),
    ref: z.string().min(1).max(4096).optional(),
    mode: z.enum(['edit', 'refresh-data']).optional(),
    onto: z.string().min(1).max(4096).optional(),
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
  onSaved?: SavedWriteCommitted,
): ToolDefinition {
  return defineTool({
    name: MARIVO_PRESENT_TOOL_NAME,
    description:
      'Present an existing result or update an analysis document. New reports always appear in one Chat region; only the reader can move it to the sidebar. For reports requiring analysis, preview early, update the same draft as results become ready, and save once. Already-ready changes can save directly. Send only changed resources and named program statements. Preview and save return an opaque ref and may include final changes. Drafts expire at Turn end or Host restart. Use marivo_report_read to recover editing context or review conflicts. stage is required. refresh-data preserves page content and only replaces compatible existing resources. deliveryJson is for Host delivery.',
    parameters: {
      stage: {
        type: 'string',
        required: true,
        enum: ['preview', 'save'],
        description:
          'Required: preview updates an unsaved Turn draft; save publishes one immutable Build. Save may include final changes. Use only the latest successful ref.',
      },
      ref: {
        type: 'string',
        description:
          'Opaque saved ref to edit a report, or latest draft ref to continue it. Omit only for a new report.',
      },
      mode: {
        type: 'string',
        enum: ['edit', 'refresh-data'],
        description:
          'First operation defaults to edit. refresh-data requires a saved report and forbids page or metadata changes. Draft mode is inherited and cannot change.',
      },
      onto: {
        type: 'string',
        description:
          'Conflict repair only: stage=preview with a draft ref and the reviewed current saved ref. Never automatically rebase or save.',
      },
      resourcePatch: {
        type: 'object',
        description:
          'Changes only: copy each marivo_python results[name].resource unchanged into put, including codeRef when present; do not reconstruct it from ref. External fixed results may omit codeRef. put accepts {kind:"analysis-frame",ref,codeRef?}, {kind:"dataframe",ref,codeRef?}, or {kind:"image-file",path}; remove names resources to delete. Omitted names remain. Candidates wait for complete identity and patch; {} means no changes. Use exact fixed references and their producer codeRef. For a data refresh replace only existing names and omit program/title/locale/labels. Identical declarations reuse the saved snapshot; same-path images do not refresh. No rows or arbitrary URLs.',
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
          'OpenUI Lang assignment syntax, e.g. root = TextContent("Confirmed scope");. Use a complete program for a new page and changed named statements for an update. Keep changes reachable from root. Remove parent references before deleting a statement with name = null. Omit during a saved-report data refresh, including conflict rebase.',
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
          ref: { type: 'string', required: true },
          mode: { type: 'string', required: true, enum: ['edit', 'refresh-data'] },
          contentReview: {
            type: 'string',
            required: true,
            enum: ['required', 'not-needed', 'unknown'],
          },
          changed: { type: 'array', items: { type: 'string' }, required: true },
          reused: { type: 'array', items: { type: 'string' }, required: true },
          unchangedAliases: {
            type: 'array',
            items: { type: 'string' },
            required: true,
            description:
              'Existing aliases of changed fixed results that remain on their previous data; never auto-updated.',
          },
          deliveryJson: {
            type: 'string',
            required: true,
            description: 'Host-owned durable delivery identity; preserve for replay.',
          },
          resultMetadata: { ...analysisResultSummaryToolSchema, required: true },
        },
      },
      render: (_args, value) => {
        const delivery = parsePresentationToolDelivery(JSON.parse(value.deliveryJson))
        if (delivery.kind === MARIVO_DRAFT_DELIVERY_KIND)
          return [
            {
              type: 'text',
              text: `Preview updated (unsaved).\nRef: ${value.ref}\nInitial location: Chat\nMode: ${value.mode}\nChanged: ${JSON.stringify(value.changed)}\nReused: ${JSON.stringify(value.reused)}\nContent review: ${value.contentReview}\nUnchanged aliases: ${JSON.stringify(value.unchangedAliases)}\nResult metadata: ${JSON.stringify(value.resultMetadata)}`,
            },
          ]
        return [
          {
            type: 'text',
            text: `${presentationReceiptText(delivery.receipt, delivery.surface)}\nMode: ${value.mode}\nChanged: ${JSON.stringify(value.changed)}\nReused: ${JSON.stringify(value.reused)}\nContent review: ${value.contentReview}\nUnchanged aliases: ${JSON.stringify(value.unchangedAliases)}\nResult metadata: ${JSON.stringify(value.resultMetadata)}`,
          },
        ]
      },
      presentationMeta: (_args, value) => JSON.parse(value.deliveryJson),
    },
    timeoutMs: PRESENTATION_EXECUTION_BUDGETS.toolTimeoutMs,
    async execute(args, exec) {
      const signal = lifecycleSignal ? AbortSignal.any([exec.signal, lifecycleSignal]) : exec.signal
      if (args.stage === undefined)
        throw new PresentationRecoveryError(
          'analysis-draft-stage-required',
          'Select stage=preview or stage=save explicitly.',
        )
      const request = presentationToolInput.parse(args)
      const requestedRef = request.ref ? parseReportRef(request.ref) : undefined
      const onto = request.onto ? parseReportRef(request.onto) : undefined
      if (
        onto &&
        (onto.kind !== 'saved' || request.stage !== 'preview' || requestedRef?.kind !== 'draft')
      )
        throw new PresentationRecoveryError(
          'analysis-draft-invalid-request',
          'onto requires stage=preview, a current draft ref, and a reviewed saved ref.',
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
      for (const ref of [requestedRef, onto])
        if (ref && ref.workspaceId !== identity.id) throw new Error('report-workspace-mismatch')
      if (
        requestedRef?.kind === 'draft' &&
        (requestedRef.sessionId !== sessionId || requestedRef.turn !== turn)
      )
        throw unavailableDraft()
      const input = {
        ...request,
        ...(requestedRef?.kind === 'saved'
          ? { basedOnRecordId: analysisRecordId(requestedRef.reportId, requestedRef.buildId) }
          : {}),
        ...(requestedRef?.kind === 'draft'
          ? { draftId: requestedRef.draftId, draftRevision: requestedRef.revision }
          : {}),
        ...(onto?.kind === 'saved'
          ? { rebaseOnRecordId: analysisRecordId(onto.reportId, onto.buildId) }
          : {}),
      }

      const perform = async (lease?: AnalysisDraftLease) => {
        let checkResourceStream: (() => void) | undefined
        const check = async () => {
          await checkWorkspace()
          lease?.check()
          checkResourceStream?.()
        }
        await check()
        const current = lease ? drafts.get(sessionId) : undefined
        const active = input.draftId && current?.delivery.turn === turn ? current : undefined
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
            'Read marivo_report_read({draft:true}) and reconcile the intended edit with the latest draft before using its identifiers. Do not blindly replay a stale patch.',
            {
              currentRef: draftReportRef({
                workspaceId: identity.id,
                sessionId,
                turn,
                draftId: active.delivery.draftId,
                revision: active.delivery.draftRevision,
              }),
            },
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
              'The proposed rebase version is stale. Read currentRef and the active draft, reconcile the changes, then preview the rebase again.',
              {
                currentRef: savedReportRef({
                  workspaceId: identity.id,
                  reportId: latest.reportId,
                  buildId: latest.buildId,
                }),
              },
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
        const mode = active?.mode ?? input.mode ?? 'edit'
        if (active && input.mode !== undefined && input.mode !== (active.mode ?? 'edit'))
          throw new Error('report-mode-conflict: a draft mode cannot change')
        if (mode === 'refresh-data') {
          if (!base || (!active && requestedRef?.kind !== 'saved'))
            throw new Error('report-refresh-saved-ref-required')
          for (const field of ['program', 'title', 'locale', 'labels'] as const)
            if (input[field] !== undefined)
              throw new Error(`report-refresh-field-forbidden: ${field}`)
          if (input.resourcePatch?.remove !== undefined)
            throw new Error('report-refresh-field-forbidden: resourcePatch.remove')
          for (const name of Object.keys(input.resourcePatch?.put ?? {}))
            if (!Object.hasOwn(base.resources, name))
              throw new Error(`report-refresh-resource-unknown: ${name}`)
        }
        // Preserve the v2 wire identity. Placement is owned by the reader, never the model.
        const surface = 'tool' as const
        const changedNames = Object.entries(input.resourcePatch?.put ?? {})
          .filter(([name, declaration]) => {
            const previous = base?.resources[name]
            return !previous || !sameAnalysisResult(previous.declaration, declaration)
          })
          .map(([name]) => name)
        const unchangedAliases = base
          ? sharedResourceGroups(base).flatMap((group) =>
              group.some((name) => changedNames.includes(name))
                ? group.filter((name) => !changedNames.includes(name))
                : [],
            )
          : []
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
          if (mode === 'refresh-data' && base) validateRefreshShape(base, document)
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
            lease.write({ delivery, workspacePath: identity.path, baseBuildId, document, mode })
            streamSucceeded = true
            return {
              stage: 'preview' as const,
              ref: draftReportRef({
                workspaceId: identity.id,
                sessionId,
                turn,
                draftId: delivery.draftId,
                revision: delivery.draftRevision,
              }),
              mode,
              contentReview: document.contentReview ?? 'unknown',
              changed: changedNames,
              unchangedAliases,
              reused: Object.keys(document.resources).filter(
                (name) => !changedNames.includes(name),
              ),
              deliveryJson: JSON.stringify(delivery),
              resultMetadata: analysisResultSummary(changedResources),
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
          const value = {
            stage: 'save' as const,
            ref: reportRefFromRecordId(document.recordId, identity.id),
            mode,
            contentReview: document.contentReview ?? 'unknown',
            changed: changedNames,
            unchangedAliases,
            reused: Object.keys(document.resources).filter((name) => !changedNames.includes(name)),
            resultMetadata: analysisResultSummary(changedResources),
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
          onSaved?.(exec, value.ref)
          return value
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
  onSaved?: SavedWriteCommitted,
): () => Promise<void> {
  return registerMarivoTool(
    ctx,
    createMarivoPresentTool(workspaceSource, session, undefined, drafts, runner, onSaved),
  )
}

const uiReadInput = z.union([
  z.strictObject({
    ref: z.string().min(1).max(4096),
    version: z.enum(['exact', 'current']).optional(),
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
    name: 'marivo_report_read',
    description:
      "Read an exact/current saved report or the active Turn draft without querying data or executing scripts. Use it to establish data-refresh context, recover missing editing context or resolve conflicts. ref selects an exact version; version=current selects its report's current version; draft=true selects the calling Session Turn draft. A draft ref reads only its original active Turn. Choose ref or draft input. definition contains the actual ref, program, reusable declarations, codeRefs and bounded schemas, not business rows. includeCode reads available bound execution records in deduplicated sources. For data refresh, review inputs and scripts, prepare explicit new fixed results, reuse shared results across their dependent views, and preview same-name resource replacements while preserving the page definition. Do not routinely read back after successful previews or saves.",
    parameters: {
      ref: { type: 'string', description: 'Opaque ref returned by a successful write or read.' },
      version: {
        type: 'string',
        enum: ['exact', 'current'],
        description: 'Defaults to exact. current is allowed only with a saved ref.',
      },
      draft: {
        type: 'boolean',
        description: 'Set true without ref/version to recover this Session Turn draft.',
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
        properties: { definition: { ...reportDefinitionToolSchema, required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value.definition) }],
    },
    async execute(args, exec) {
      const input = uiReadInput.parse(args)
      const binding = await source()
      let document: AnalysisDocument
      let identifiers: { ref: string; mode?: 'edit' | 'refresh-data'; basedOn?: string }
      const selectedRef = 'ref' in input ? parseReportRef(input.ref) : undefined
      if (selectedRef && selectedRef.workspaceId !== binding.id)
        throw new Error('report-workspace-mismatch')
      if (selectedRef?.kind === 'draft' && 'version' in input && input.version === 'current')
        throw new Error('report-draft-version-forbidden')
      let checkDraft = () => {}
      if ('draft' in input || selectedRef?.kind === 'draft') {
        const session = exec.agent?.session
        if (!session) throw unavailableDraft()
        const turn = presentationTurn(session, exec)
        const draft = drafts?.get(String(session.id))
        if (
          !draft ||
          draft.delivery.turn !== turn ||
          draft.workspacePath !== binding.path ||
          draft.document.workspaceId !== binding.id ||
          (selectedRef?.kind === 'draft' &&
            (selectedRef.sessionId !== String(session.id) ||
              selectedRef.turn !== turn ||
              selectedRef.draftId !== draft.delivery.draftId ||
              selectedRef.revision !== draft.delivery.draftRevision))
        )
          throw unavailableDraft()
        document = draft.document
        identifiers = {
          ref: draftReportRef({
            workspaceId: binding.id,
            sessionId: String(session.id),
            turn,
            draftId: draft.delivery.draftId,
            revision: draft.delivery.draftRevision,
          }),
          mode: draft.mode ?? 'edit',
          ...(draft.baseBuildId
            ? {
                basedOn: savedReportRef({
                  workspaceId: binding.id,
                  reportId: document.reportId,
                  buildId: draft.baseBuildId,
                }),
              }
            : {}),
        }

        checkDraft = () => {
          if (exec.agent?.session !== session || drafts?.get(String(session.id)) !== draft)
            throw unavailableDraft()
        }
      } else {
        if (selectedRef?.kind !== 'saved') throw new Error('report-saved-ref-required')
        const { reportId, buildId } = selectedRef
        const selected =
          'version' in input && input.version === 'current'
            ? (await resolvePresentation(binding.path, binding.id, reportId, exec.signal)).buildId
            : buildId
        document = await readAnalysisRecord(
          binding.path,
          binding.id,
          reportId,
          selected,
          exec.signal,
        )
        identifiers = { ref: reportRefFromRecordId(document.recordId, binding.id) }
      }
      const sources: ReportSourceSummary[] = []
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
        definition: reportDefinition.parse({
          ...identifiers,
          contentReview: document.contentReview ?? 'unknown',
          reuseGroups: sharedResourceGroups(document),
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

/** Exact fixed-result identities only; codeRef and coincident values are not identity. */
function sharedResourceGroups(document: AnalysisDocument): string[][] {
  const groups = new Map<string, string[]>()
  for (const [name, resource] of Object.entries(document.resources)) {
    const declaration = resource.declaration
    const key =
      declaration.kind === 'analysis-frame'
        ? JSON.stringify([
            'frame',
            declaration.ref.store_id,
            declaration.ref.session_id,
            declaration.ref.artifact_id,
          ])
        : declaration.kind === 'dataframe'
          ? JSON.stringify(['dataframe', declaration.ref.project_root, declaration.ref.result_id])
          : declaration.kind === 'dataset-snapshot' || declaration.kind === 'frame-snapshot'
            ? JSON.stringify([declaration.kind, declaration.snapshotRef])
            : undefined
    if (!key) continue
    const group = groups.get(key) ?? []
    group.push(name)
    groups.set(key, group)
  }
  return [...groups.values()].filter((group) => group.length > 1)
}
