import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import {
  defineTool,
  type ToolDefinition,
  type ToolExecutionToken,
  type ToolRunContext,
} from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import type { MarivoCheckedRunner } from '../environment/types.ts'
import type { SavedWriteCommitted } from '../next-steps/saved-writes.ts'
import { type PythonCodeRef, readPythonExecution } from '../python-execution.ts'
import { registerMarivoTool } from '../tool-lifecycle.ts'
import { PresentationWorkspaceUnavailable } from '../workspace-identity.ts'
import { createAnalysisDocument, validateRefreshShape } from './analysis.ts'
import {
  type AnalysisDocument,
  AnalysisViewError,
  analysisPresentInput,
  analysisRecordId,
  parseAnalysisRecordId,
} from './contracts/analysis-document.ts'
import { AnalysisProgramError } from './contracts/analysis-program.ts'
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
import { resultReference } from './contracts/result-reference.ts'
import { isFrameSnapshotV2 } from './contracts/snapshot.ts'
import { viewFieldMetadata } from './contracts/view-fields.ts'
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
import {
  PresentationRecoveryError,
  reportLookupFailure,
  reportSaveOutcomeUnknown,
  savedReportRecovery,
  savedReportRecoveryPrefix,
  unavailableDraft,
  workspaceChanged,
  workspaceMismatch,
  workspaceUnavailable,
} from './recovery.ts'
import {
  deletePresentation,
  publishPresentation,
  readAnalysisRecord,
  resolvePresentation,
} from './reports.ts'
import { ResultReadError, readMarivoCandidates } from './result-reader.ts'
import { analysisResultSummary, analysisResultSummaryToolSchema } from './result-summary.ts'

export type PresentationWorkspaceSource = () =>
  | { id: string; path: string }
  | Promise<{ id: string; path: string }>

export async function reportWorkspace(
  source: PresentationWorkspaceSource,
  phase: PresentationRecoveryError['phase'],
) {
  try {
    return await source()
  } catch (error) {
    if (error instanceof PresentationWorkspaceUnavailable) throw workspaceUnavailable(phase)
    throw error
  }
}

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
    throw new Error(
      'presentation-turn-unavailable: use this tool from the active analysis Session and Turn.',
    )
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
  committedRef?: (token: ToolExecutionToken) => string | undefined,
): ToolDefinition {
  return defineTool({
    name: MARIVO_PRESENT_TOOL_NAME,
    description:
      'Create or update an analysis view. Load dsh-data-analysis-presentation. Preview scope before new computation, update the same draft, then save once. For uncertain saves, find the committed Build with marivo_report_list({callId}) before retrying.',
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
          'Opaque saved ref to edit, or latest draft ref to continue. Omit for a new view. An active draft must be completed before starting another preview.',
      },
      mode: {
        type: 'string',
        enum: ['edit', 'refresh-data'],
        description:
          'First operation defaults to edit. refresh-data requires a saved analysis view and forbids page or metadata changes. Draft mode is inherited and cannot change.',
      },
      onto: {
        type: 'string',
        description:
          'Conflict repair only: stage=preview with a draft ref and the reviewed current saved ref. Never automatically rebase or save.',
      },
      resourcePatch: {
        type: 'object',
        description:
          'Changes only. Copy results[name].resource unchanged into put. External fixed results can omit codeRef. Images use {kind:"image-file",path}. Use remove for deleted names. Refresh replaces existing names only. Identical declarations reuse their snapshot.',
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
              text: `Preview updated (unsaved).\nRef: ${value.ref}\nReader: right sidebar\nMode: ${value.mode}\nChanged: ${JSON.stringify(value.changed)}\nReused: ${JSON.stringify(value.reused)}\nUnchanged aliases: ${JSON.stringify(value.unchangedAliases)}\nResult metadata: ${JSON.stringify(value.resultMetadata)}`,
            },
          ]
        if (
          value.ref !==
          savedReportRef({
            workspaceId: delivery.receipt.workspaceId,
            reportId: delivery.receipt.reportId,
            buildId: delivery.receipt.buildId,
          })
        )
          throw new Error('report-receipt-ref-mismatch')
        return [
          {
            type: 'text',
            text: `${presentationReceiptText(delivery.receipt)}\nMode: ${value.mode}\nChanged: ${JSON.stringify(value.changed)}\nReused: ${JSON.stringify(value.reused)}\nUnchanged aliases: ${JSON.stringify(value.unchangedAliases)}\nResult metadata: ${JSON.stringify(value.resultMetadata)}`,
          },
        ]
      },
      presentationMeta: (_args, value) => JSON.parse(value.deliveryJson),
    },
    finalizeContent(exec, result) {
      if (!result.isError || result.error.message.startsWith(savedReportRecoveryPrefix))
        return undefined
      const ref = committedRef?.(exec.token)
      if (ref) return [...result.content, { type: 'text', text: savedReportRecovery(ref) }]
      const code = result.error.info?.code
      if (
        (code === 'ABORTED' || code === 'TOOL_TIMEOUT') &&
        z.object({ stage: z.literal('save') }).safeParse(exec.arguments).success
      )
        return [
          ...result.content,
          { type: 'text', text: reportSaveOutcomeUnknown(String(exec.callId)) },
        ]
      return undefined
    },
    timeoutMs: PRESENTATION_EXECUTION_BUDGETS.toolTimeoutMs,
    async execute(args, exec) {
      const signal = lifecycleSignal ? AbortSignal.any([exec.signal, lifecycleSignal]) : exec.signal
      if (args.stage === undefined)
        throw new PresentationRecoveryError(
          'analysis-draft-stage-required',
          'Select stage=preview or stage=save explicitly.',
        )
      const parsed = presentationToolInput.safeParse(args)
      if (!parsed.success) {
        const issue = parsed.error.issues[0]
        const path =
          issue?.code === 'unrecognized_keys'
            ? [...issue.path, issue.keys[0]].join('.')
            : issue?.path.join('.')
        throw new PresentationRecoveryError(
          'report-input-invalid',
          issue?.code === 'unrecognized_keys'
            ? 'Omit the unrecognized key and retry the same intended patch.'
            : 'Correct the field using the writer schema and retry the same intended patch.',
          { path, applied: false },
        )
      }
      const request = parsed.data
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
      if (!owner || owner.session !== session)
        throw new PresentationRecoveryError(
          'presentation-session-mismatch',
          'Retry from the Session that owns this analysis view.',
        )
      const turn = presentationTurn(session, exec)
      signal.throwIfAborted()
      const workspace = workspaceSource
      const identity = await reportWorkspace(workspace, 'report-write')
      const checkWorkspace = async () => {
        signal.throwIfAborted()
        if (owner.session !== session) throw new Error('presentation-session-mismatch')
        const current = await reportWorkspace(workspace, 'report-write')
        if (current.id !== identity.id || current.path !== identity.path)
          throw workspaceChanged('report-write')
        signal.throwIfAborted()
      }
      const sessionId = String(session.id)
      for (const ref of [requestedRef, onto])
        if (ref && ref.workspaceId !== identity.id) throw workspaceMismatch('report-write')
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
        let committed: string | undefined
        let checkResourceStream: (() => void) | undefined
        const check = async () => {
          await checkWorkspace()
          lease?.check()
          checkResourceStream?.()
        }
        await check()
        const current = lease ? drafts.get(sessionId) : undefined
        if (
          !input.draftId &&
          input.stage === 'preview' &&
          current?.delivery.turn === turn &&
          current.workspacePath === identity.path &&
          current.document.workspaceId === identity.id
        )
          throw new PresentationRecoveryError(
            'analysis-draft-conflict',
            'Read the active draft with marivo_report_read({draft:true}). Continue it with its latest ref, or start a separate draft in a new Turn.',
            {
              applied: false,
              currentRef: draftReportRef({
                workspaceId: identity.id,
                sessionId,
                turn,
                draftId: current.delivery.draftId,
                revision: current.delivery.draftRevision,
              }),
            },
          )
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
              applied: false,
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
          ).catch((error: unknown) => reportLookupFailure(error, 'report-write', signal))
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
              ).catch((error: unknown) => reportLookupFailure(error, 'report-write', signal))
            : undefined)
        const mode = active?.mode ?? input.mode ?? 'edit'
        if (active && input.mode !== undefined && input.mode !== (active.mode ?? 'edit'))
          throw new PresentationRecoveryError(
            'report-mode-conflict',
            'Continue in the draft mode, or start the other operation from the saved report in a new Turn.',
            { currentRef: request.ref, applied: false },
          )
        if (mode === 'refresh-data') {
          if (!base || (!active && requestedRef?.kind !== 'saved'))
            throw new PresentationRecoveryError(
              'report-refresh-saved-ref-required',
              'Read the target saved report and start refresh-data with its saved ref.',
              { applied: false },
            )
          for (const field of ['program', 'title', 'locale', 'labels'] as const)
            if (input[field] !== undefined)
              throw new PresentationRecoveryError(
                'report-refresh-field-forbidden',
                'Omit this field and replace only existing resources.',
                { path: field, currentRef: request.ref, applied: false },
              )
          if (input.resourcePatch?.remove !== undefined)
            throw new PresentationRecoveryError(
              'report-refresh-field-forbidden',
              'Omit resourcePatch.remove and replace only existing resources.',
              { path: 'resourcePatch.remove', currentRef: request.ref, applied: false },
            )
          for (const name of Object.keys(input.resourcePatch?.put ?? {}))
            if (!Object.hasOwn(base.resources, name))
              throw new PresentationRecoveryError(
                'report-refresh-resource-unknown',
                'Read the saved definition and use the exact existing resource name.',
                { resource: name, currentRef: request.ref, applied: false },
              )
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
              changed: changedNames,
              unchangedAliases,
              reused: Object.keys(document.resources).filter(
                (name) => !changedNames.includes(name),
              ),
              deliveryJson: JSON.stringify(delivery),
              resultMetadata: analysisResultSummary(changedResources),
            }
          }
          const savedRef = reportRefFromRecordId(document.recordId, identity.id)
          const receipt = await publishPresentation(
            identity.path,
            document,
            baseBuildId,
            check,
            signal,
            { kind: 'agent', sessionId, surface, callId: String(exec.callId) },
            () => {
              committed = savedRef
              onSaved?.(exec, savedRef)
            },
          )
          streamSucceeded = true
          const value = {
            stage: 'save' as const,
            ref: savedRef,
            mode,
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
          return value
        } catch (error) {
          if (committed) throw new Error(savedReportRecovery(committed), { cause: error })
          if (error instanceof AnalysisProgramError)
            throw new PresentationRecoveryError(
              error.code,
              error.code === 'analysis-program-deleted-reference'
                ? 'Remove references to the deleted statement in the same program patch, then retry with the latest ref and intended changes.'
                : error.code === 'analysis-program-root-deleted'
                  ? 'Keep a valid root statement in the resulting program, then retry with the latest ref and intended changes.'
                  : 'Correct the OpenUI program and resubmit the same program and resource changes.',
              { currentRef: request.ref, applied: false, ...error.details },
            )
          if (error instanceof AnalysisViewError)
            throw new AnalysisViewError(
              error.code,
              error.path,
              error.recovery.nextAction,
              error.resourceName,
              error.details,
              request.ref,
            )
          if (error instanceof PresentationRecoveryError)
            throw new PresentationRecoveryError(error.code, error.recovery.nextAction, {
              ...(request.ref ? { currentRef: request.ref } : {}),
              ...error.recovery,
              applied: false,
            })
          signal.throwIfAborted()
          if (error instanceof Error && error.message === 'report-not-found')
            reportLookupFailure(error, 'report-write', signal)
          throw new PresentationRecoveryError(
            'report-write-failed',
            'Check report storage and the active Workspace, then reuse the same fixed resources and ref.',
            { applied: false, currentRef: request.ref },
          )
        } finally {
          resourceStream.finish(streamSucceeded)
          if (committed && active) drafts.clear(sessionId, turn)
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
  committedRef?: (token: ToolExecutionToken) => string | undefined,
): () => Promise<void> {
  return registerMarivoTool(
    ctx,
    createMarivoPresentTool(
      workspaceSource,
      session,
      undefined,
      drafts,
      runner,
      onSaved,
      committedRef,
    ),
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

const resultReadInput = z.strictObject({
  resource: resultReference,
  candidateGroup: viewFieldMetadata.viewCandidates.keyof(),
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
})

function parseUiReadInput(args: unknown): z.infer<typeof uiReadInput> {
  const parsed = uiReadInput.safeParse(args)
  if (parsed.success) return parsed.data
  const issues: { path: string; reason: string; expected?: string; conflictsWith?: string }[] = []
  const object = z.record(z.string(), z.unknown()).safeParse(args)
  if (!object.success) issues.push({ path: '', reason: 'invalid-type', expected: 'object' })
  else {
    const input = object.data
    const hasRef = Object.hasOwn(input, 'ref')
    const hasDraft = Object.hasOwn(input, 'draft')
    if (!hasRef && !hasDraft)
      issues.push({ path: '', reason: 'selector-required', expected: 'ref or draft:true' })
    if (hasRef && hasDraft)
      issues.push({ path: 'draft', reason: 'mutually-exclusive', conflictsWith: 'ref' })
    if (
      hasRef &&
      (typeof input.ref !== 'string' || input.ref.length < 1 || input.ref.length > 4096)
    )
      issues.push({
        path: 'ref',
        reason: 'invalid-value',
        expected: 'non-empty string of at most 4096 characters',
      })
    if (hasDraft && input.draft !== true)
      issues.push({ path: 'draft', reason: 'invalid-value', expected: 'true' })
    if (Object.hasOwn(input, 'version')) {
      if (hasDraft) issues.push({ path: 'version', reason: 'forbidden-with-draft' })
      else if (input.version !== 'exact' && input.version !== 'current')
        issues.push({ path: 'version', reason: 'invalid-value', expected: 'exact or current' })
    }
    if (Object.hasOwn(input, 'includeCode') && typeof input.includeCode !== 'boolean')
      issues.push({ path: 'includeCode', reason: 'invalid-type', expected: 'boolean' })
    for (const key of Object.keys(input))
      if (!['ref', 'draft', 'version', 'includeCode'].includes(key))
        issues.push({ path: key, reason: 'unknown-field' })
  }
  const code = 'report-read-invalid-input'
  const recovery = {
    nextAction:
      'Choose either {ref, version?, includeCode?} or {draft:true, includeCode?}; omit version for drafts. Use an opaque ref from a successful write, read, or report list.',
  }
  throw new Error(
    `${code}; error=${JSON.stringify({ code, tool: 'marivo_report_read', phase: 'input', issues, recovery })}`,
  )
}

/** Permanently delete the saved view and all its history in the current Workspace. */
export function createMarivoReportDeleteTool(source: PresentationWorkspaceSource): ToolDefinition {
  return defineTool({
    name: 'marivo_report_delete',
    description:
      'Permanently delete an entire saved analysis view and all its history when the user asks. Use its exact current saved ref; old refs are rejected on conflict. The action cannot be undone. A cleanupPending result means the view is unavailable but disk cleanup needs the same request retried. Does not delete source data or exported files.',
    parameters: {
      ref: {
        type: 'string',
        required: true,
        description: 'Exact current saved analysis view ref.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          deleted: { type: 'boolean', required: true },
          workspaceId: { type: 'string', required: true },
          reportId: { type: 'string', required: true },
          cleanupPending: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const input = z.strictObject({ ref: z.string().min(1).max(4096) }).parse(args)
      const ref = parseReportRef(input.ref)
      if (ref.kind !== 'saved')
        throw new PresentationRecoveryError(
          'report-saved-ref-required',
          'Find the saved report and confirm its current version before deleting.',
          {},
          'report-delete',
        )
      const binding = await reportWorkspace(source, 'report-delete')
      if (ref.workspaceId !== binding.id) throw workspaceMismatch('report-delete')
      const check = async () => {
        const current = await reportWorkspace(source, 'report-delete')
        if (current.id !== binding.id || current.path !== binding.path)
          throw workspaceChanged('report-delete')
      }
      const result = await deletePresentation(
        binding.path,
        binding.id,
        ref.reportId,
        ref.buildId,
        check,
        exec.signal,
      ).catch((error: unknown) => {
        exec.signal.throwIfAborted()
        if (error instanceof Error && error.message === 'report-delete-conflict')
          throw new PresentationRecoveryError(
            'report-delete-conflict',
            'Read the current version with marivo_report_read({ref,version:"current"}). Confirm that it is the version the user wants deleted before using its ref.',
            { applied: false },
            'report-delete',
          )
        reportLookupFailure(error, 'report-delete', exec.signal)
      })
      return {
        deleted: true,
        workspaceId: binding.id,
        reportId: ref.reportId,
        cleanupPending: result.cleanupPending,
      }
    },
  })
}

export function registerMarivoReportDeleteTool(ctx: Context, source: PresentationWorkspaceSource) {
  return registerMarivoTool(ctx, createMarivoReportDeleteTool(source))
}

/** Editing context only: exact/current saved version or the caller's active Turn draft. */
export function createMarivoUiReadTool(
  source: PresentationWorkspaceSource,
  drafts?: AnalysisDrafts,
  runner?: () => Promise<MarivoCheckedRunner>,
): ToolDefinition {
  return defineTool({
    name: 'marivo_report_read',
    description:
      'Read an exact/current saved analysis view or the active Turn draft. Find missing saved refs with marivo_report_list. If fixed result metadata is missing, request one candidateGroup using the exact results[name].resource.ref. Reads use saved data and never rerun analysis.',
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
      resource: {
        type: 'object',
        additionalProperties: true,
        description:
          'Exact fixed results[name].resource.ref. Use with candidateGroup instead of a report selector.',
      },
      candidateGroup: {
        type: 'string',
        enum: resultReadInput.shape.candidateGroup.options,
        description: 'One group of chart field names. Use nextOffset to continue.',
      },
      offset: {
        type: 'integer',
        description: 'Optional nextOffset from the same resource and group.',
      },
    },
    output: {
      schema: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: { definition: { ...reportDefinitionToolSchema, required: true } },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              candidates: { type: 'array', items: { type: 'string' }, required: true },
              nameKind: { type: 'string', required: true },
              parameters: { type: 'array', items: { type: 'string' }, required: true },
              nextOffset: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true },
            },
          },
        ],
      },
      render: (_args, value) => [
        { type: 'text', text: JSON.stringify('definition' in value ? value.definition : value) },
      ],
    },
    async execute(args, exec) {
      if (
        args.resource !== undefined ||
        args.candidateGroup !== undefined ||
        args.offset !== undefined
      ) {
        const parsed = resultReadInput.safeParse(args)
        if (!parsed.success)
          throw new PresentationRecoveryError(
            'report-input-invalid',
            'Pass an exact resource.ref and one candidateGroup, without a report selector.',
            { path: parsed.error.issues[0]?.path.join('.') },
            'report-read',
          )
        if (!runner)
          throw new PresentationRecoveryError(
            'report-read-failed',
            'Fixed-result lookup requires the bound Runtime. Read saved report metadata if available.',
            {},
            'report-read',
          )
        const { resource, candidateGroup, offset } = parsed.data
        const workspace = await reportWorkspace(source, 'report-read')
        const page = await (async () => {
          try {
            const bound = await runner()
            if (bound.binding.projectRoot !== (await realpath(workspace.path)))
              throw workspaceMismatch('report-read')
            return await readMarivoCandidates(bound, resource, candidateGroup, offset, exec.signal)
          } catch (error) {
            exec.signal.throwIfAborted()
            if (error instanceof PresentationRecoveryError) throw error
            throw new PresentationRecoveryError(
              'report-read-failed',
              error instanceof ResultReadError
                ? error.message
                : 'Check the exact fixed result and its bound Runtime.',
              {},
              'report-read',
            )
          }
        })()
        const current = await reportWorkspace(source, 'report-read')
        if (current.id !== workspace.id || current.path !== workspace.path)
          throw workspaceChanged('report-read')
        exec.signal.throwIfAborted()
        return page
      }
      const input = parseUiReadInput(args)
      const binding = await reportWorkspace(source, 'report-read')
      let document: AnalysisDocument
      let identifiers: { ref: string; mode?: 'edit' | 'refresh-data'; basedOn?: string }
      const selectedRef = 'ref' in input ? parseReportRef(input.ref) : undefined
      if (selectedRef && selectedRef.workspaceId !== binding.id)
        throw workspaceMismatch('report-read')
      if (selectedRef?.kind === 'draft' && 'version' in input && input.version === 'current')
        throw new PresentationRecoveryError(
          'report-draft-version-forbidden',
          'Use {draft:true} for the active draft, or omit version to read an exact draft ref.',
          {},
          'report-read',
        )
      let checkDraft = () => {}
      if ('draft' in input || selectedRef?.kind === 'draft') {
        const session = exec.agent?.session
        if (!session) throw unavailableDraft('report-read')
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
              selectedRef.draftId !== draft.delivery.draftId))
        )
          throw unavailableDraft('report-read')
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
        if (selectedRef?.kind === 'draft' && selectedRef.revision !== draft.delivery.draftRevision)
          throw new PresentationRecoveryError(
            'analysis-draft-conflict',
            'Read the latest draft with marivo_report_read({draft:true}). Review the revision before editing.',
            { currentRef: identifiers.ref },
            'report-read',
          )

        checkDraft = () => {
          if (exec.agent?.session !== session || drafts?.get(String(session.id)) !== draft)
            throw unavailableDraft('report-read')
        }
      } else {
        if (selectedRef?.kind !== 'saved') throw new Error('report-saved-ref-required')
        const { reportId, buildId } = selectedRef
        const selected =
          'version' in input && input.version === 'current'
            ? (
                await resolvePresentation(binding.path, binding.id, reportId, exec.signal).catch(
                  (error: unknown) => reportLookupFailure(error, 'report-read', exec.signal),
                )
              ).buildId
            : buildId
        document = await readAnalysisRecord(
          binding.path,
          binding.id,
          reportId,
          selected,
          exec.signal,
        ).catch((error: unknown) => reportLookupFailure(error, 'report-read', exec.signal))
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
      const current = await reportWorkspace(source, 'report-read')
      if (current.id !== binding.id || current.path !== binding.path)
        throw workspaceChanged('report-read')
      exec.signal.throwIfAborted()
      checkDraft()
      return {
        definition: reportDefinition.parse({
          ...identifiers,
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
  runner?: () => Promise<MarivoCheckedRunner>,
) {
  return registerMarivoTool(ctx, createMarivoUiReadTool(source, drafts, runner))
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
