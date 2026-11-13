import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool, type ToolExecutionToken } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import { finishCleanup } from '../lifecycle.ts'
import { parseReportRef, savedReportRef } from '../presentation/contracts/report-ref.ts'
import {
  MARIVO_PRESENT_TOOL_NAME,
  MARIVO_PRESENTATION_DELIVERY_KIND,
  parsePresentationToolDelivery,
} from '../presentation/receipt.ts'
import { reportLookupFailure } from '../presentation/recovery.ts'
import { readAnalysisRecord } from '../presentation/reports.ts'
import { type PresentationWorkspaceSource, presentationTurn } from '../presentation/tool.ts'
import { registerMarivoTool } from '../tool-lifecycle.ts'
import {
  NEXT_STEPS_TOOL,
  type NextStepsNotice,
  nextStepsInput,
  nextStepsReceipt,
  nextStepsReceiptValueSchema,
} from './contracts.ts'
import { SavedWriteProofs } from './saved-writes.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'marivo-next-steps': { kind: 'marivo-next-steps'; form: 'notice'; summary: string }
  }
}

/** Live saves or explicit saved-report requests arm a bounded completion check. */
export function installNextStepsAgent(
  ctx: Context,
  agent: Agent,
  workspace: PresentationWorkspaceSource,
  publish: (notice: NextStepsNotice) => void,
  savedWrites = new SavedWriteProofs(),
): () => Promise<void> {
  const boundary = [...agent.session.snapshotEvents()]
    .reverse()
    .find((event) => event.type === 'turn/start' || event.type === 'turn/end')
  let activeTurn = boundary?.type === 'turn/start' ? boundary.data.turn : undefined
  let latestTurn = boundary?.data.turn ?? -1
  let retriedTurn: number | undefined
  let inputGeneration = 0
  let latestSaveSequence = 0
  const presentationTool = agent.ctx.tools.get(MARIVO_PRESENT_TOOL_NAME, agent)
  let disposed = false
  const saveAdmissions = new Map<
    ToolExecutionToken,
    {
      generation: number
      workspace: { id: string; path: string }
    }
  >()
  let armed:
    | {
        turn: number
        workspaceId: string
        workspacePath: string
        reportId: string
        buildId: string
        callId?: string
      }
    | undefined
  let submitted:
    | (NonNullable<typeof armed> & { items: NextStepsNotice['items']; declined: boolean })
    | undefined
  const callStates = new Map<
    ToolExecutionToken,
    {
      armed: NonNullable<typeof armed>
      generation: number
      ref: string
      items: NextStepsNotice['items']
      declined: boolean
    }
  >()
  const sameVersion = (left: NonNullable<typeof armed>, right: NonNullable<typeof armed>) =>
    left.turn === right.turn &&
    left.workspaceId === right.workspaceId &&
    left.workspacePath === right.workspacePath &&
    left.reportId === right.reportId &&
    left.buildId === right.buildId
  const clear = () => {
    armed = undefined
    submitted = undefined
  }
  const stops: Array<() => unknown> = []
  try {
    stops.push(
      agent.ctx.on('tools/pre-execute', async (exec, next) => {
        if (
          exec.agent === agent &&
          presentationTool &&
          exec.name === MARIVO_PRESENT_TOOL_NAME &&
          agent.ctx.tools.get(exec.name, agent) === presentationTool
        ) {
          const generation = inputGeneration
          let identity: Awaited<ReturnType<PresentationWorkspaceSource>>
          try {
            identity = await workspace()
          } catch {
            return next()
          }
          exec.signal.throwIfAborted()
          saveAdmissions.set(exec.token, { generation, workspace: identity })
        }
        return next()
      }),
    )
    stops.push(
      registerMarivoTool(
        agent.ctx,
        defineTool({
          name: NEXT_STEPS_TOOL,
          description:
            'Provide temporary Chat follow-up suggestions for an exact saved analysis view ref. Use the final saved ref from this Turn, or a ref read for an existing analysis view when the user requests recommendations; never save an unchanged analysis view just for suggestions. Generate fresh recommendations for each final saved version. If the user declined, send items=[] with emptyReason="declined" without generating suggestions. Otherwise offer 1–4 useful immediately feasible follow-up analyses, usually three when appropriate. If none is useful, send items=[] with emptyReason="no-suggestions"; this is a valid result and does not request a retry. Each short action label must fully describe the task; prompt may only expand that task. Use existing data and capabilities; do not propose adding unavailable dimensions, periods, datasets or inputs, repeat work already answered, or run analysis merely to generate suggestions. Prefer fewer items to filler. This tool only receives suggestions; it does not end the Turn or send a user message. Continue any requested file delivery or necessary final answer normally. Do not repeat the suggestions in prose.',
          parameters: {
            ref: {
              type: 'string',
              required: true,
              description:
                'Exact saved analysis view ref from the final successful save or a read of an existing view.',
            },
            emptyReason: { type: 'string', enum: ['declined', 'no-suggestions'] },
            items: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  label: { type: 'string', required: true },
                  prompt: { type: 'string', required: true },
                },
              },
            },
          },
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                accepted: { type: 'boolean', const: true, required: true },
                ref: { type: 'string', required: true },
                receipt: nextStepsReceiptValueSchema,
              },
            },
            render: () => [{ type: 'text', text: 'Next steps received.' }],
            presentationMeta: (_args, value) =>
              z.object({ receipt: nextStepsReceipt }).safeParse(value).data?.receipt ?? null,
          },
          async execute(args, exec) {
            exec.signal.throwIfAborted()
            const input = nextStepsInput.parse(args)
            const turn = presentationTurn(agent.session, exec)
            if (exec.agent !== agent || turn !== activeTurn)
              throw new Error(
                'next-steps-requires-current-saved-analysis: submit from the active report Session and Turn.',
              )
            const generation = inputGeneration
            const identity = await workspace()
            const target = parseReportRef(input.ref)
            if (target.kind !== 'saved')
              throw new Error(
                'report-saved-ref-required: use the final saved ref from the writer or read the intended saved report.',
              )
            if (target.workspaceId !== identity.id)
              throw new Error(
                'report-workspace-mismatch: open the report in its original Workspace.',
              )
            if (
              armed &&
              (armed.turn !== turn ||
                armed.workspaceId !== identity.id ||
                armed.workspacePath !== identity.path ||
                armed.reportId !== target.reportId ||
                armed.buildId !== target.buildId)
            )
              throw new Error(
                'next-steps-requires-final-saved-analysis: submit suggestions with the final successful save ref from this Turn.',
              )
            if (!armed) {
              await readAnalysisRecord(
                identity.path,
                identity.id,
                target.reportId,
                target.buildId,
                exec.signal,
              ).catch((error: unknown) => reportLookupFailure(error, 'report-read', exec.signal))
              const latest = await workspace()
              exec.signal.throwIfAborted()
              if (
                activeTurn !== turn ||
                inputGeneration !== generation ||
                latest.id !== identity.id ||
                latest.path !== identity.path
              )
                throw new Error(
                  'next-steps-owner-changed: submit again only from the current report Session and Turn.',
                )
              // A concurrent save owns the final version, even while an existing report was read.
              if (armed)
                throw new Error('next-steps-report-changed: use the final successful save ref.')
              armed = {
                turn,
                workspaceId: identity.id,
                workspacePath: identity.path,
                reportId: target.reportId,
                buildId: target.buildId,
                callId: String(exec.callId),
              }
            }
            const current = armed
            exec.signal.throwIfAborted()
            if (
              inputGeneration !== generation ||
              activeTurn !== turn ||
              disposed ||
              identity.id !== current.workspaceId ||
              identity.path !== current.workspacePath
            )
              throw new Error(
                'next-steps-owner-changed: submit again only from the current report Session and Turn.',
              )
            callStates.set(exec.token, {
              armed: current,
              generation,
              ref: input.ref,
              items: input.items,
              declined: input.emptyReason === 'declined',
            })
            return {
              accepted: true,
              ref: input.ref,
              ...(current.callId
                ? {
                    receipt: {
                      kind: nextStepsReceiptValueSchema.properties.kind.const,
                      sessionId: String(agent.session.id),
                      turn,
                      callId: current.callId,
                    },
                  }
                : {}),
            }
          },
        }),
      ),
    )
    stops.push(
      agent.ctx.on('tools/result', (exec, result) => {
        const pending = callStates.get(exec.token)
        callStates.delete(exec.token)
        const accepted =
          pending &&
          !result.isError &&
          z
            .object({ accepted: z.literal(true), ref: z.literal(pending.ref) })
            .safeParse(result.value).success
        if (
          pending &&
          accepted &&
          armed &&
          !disposed &&
          pending.generation === inputGeneration &&
          activeTurn === pending.armed.turn &&
          sameVersion(pending.armed, armed)
        ) {
          submitted = { ...pending.armed, items: pending.items, declined: pending.declined }
        }
        const committed = savedWrites.take(exec.token)
        const admission = saveAdmissions.get(exec.token)
        saveAdmissions.delete(exec.token)
        if (
          exec.agent !== agent ||
          !admission ||
          committed === undefined ||
          result.isError ||
          admission.generation !== inputGeneration ||
          disposed
        )
          return
        const value = z
          .object({ ref: z.string(), deliveryJson: z.string() })
          .safeParse(result.value)
        if (!value.success || value.data.ref !== committed.ref) return
        try {
          const delivery = parsePresentationToolDelivery(JSON.parse(value.data.deliveryJson))
          const ref = parseReportRef(value.data.ref)
          if (
            delivery.kind !== MARIVO_PRESENTATION_DELIVERY_KIND ||
            ref.kind !== 'saved' ||
            delivery.dshSessionId !== String(agent.session.id) ||
            delivery.turn !== activeTurn ||
            delivery.turn !== presentationTurn(agent.session, exec) ||
            delivery.receipt.workspaceId !== admission.workspace.id ||
            ref.workspaceId !== delivery.receipt.workspaceId ||
            ref.reportId !== delivery.receipt.reportId ||
            ref.buildId !== delivery.receipt.buildId
          )
            return
          if (committed.sequence <= latestSaveSequence) return
          latestSaveSequence = committed.sequence
          armed = {
            turn: delivery.turn,
            workspaceId: ref.workspaceId,
            workspacePath: admission.workspace.path,
            reportId: ref.reportId,
            buildId: ref.buildId,
          }
        } catch {
          /* Invalid output cannot arm a completion check. */
        }
      }),
    )
    stops.push(
      agent.ctx.on('agent/inbox/inserted', ({ message }) => {
        if (message.source.kind === 'user') {
          inputGeneration++
          clear()
        }
      }),
    )
    stops.push(
      agent.ctx.on('agent/turn-stopping', async ({ turn, signal }) => {
        if (agent.inbox.nextTurn.length) {
          clear()
          return
        }
        if (
          signal.aborted ||
          !armed ||
          armed.turn !== turn ||
          (submitted !== undefined && sameVersion(submitted, armed)) ||
          retriedTurn === turn
        )
          return
        const current = armed
        const generation = inputGeneration
        let identity: Awaited<ReturnType<PresentationWorkspaceSource>>
        try {
          identity = await workspace()
        } catch {
          if (armed === current) clear()
          return
        }
        if (
          disposed ||
          signal.aborted ||
          armed !== current ||
          activeTurn !== turn ||
          inputGeneration !== generation ||
          agent.inbox.nextTurn.length ||
          (submitted !== undefined && sameVersion(submitted, current))
        )
          return
        if (identity.id !== current.workspaceId || identity.path !== current.workspacePath) {
          clear()
          return
        }
        retriedTurn = turn
        agent.steer(
          createUserMessage({
            source: {
              kind: 'marivo-next-steps',
              form: 'notice',
              summary: 'Complete analysis follow-up suggestions',
            },
            content: [
              {
                type: 'text',
                text: `The final analysis view version is saved (ref=${savedReportRef({ workspaceId: current.workspaceId, reportId: current.reportId, buildId: current.buildId })}). Provide fresh recommendations for this view and Turn even if recommendations were offered previously. Honor the user first: if they declined recommendations, call marivo_next_steps with this ref, items=[] and emptyReason="declined" without generating suggestions. Otherwise offer one to four useful immediately feasible follow-up analyses, or items=[] with emptyReason="no-suggestions" when none is appropriate. This is the only completion reminder; never fabricate recommendations to fill the list. The tool only receives suggestions and does not end the Turn; finish any remaining requested delivery or necessary final answer normally. Use the language of the analysis and existing data. Do not repeat work already answered, propose unavailable inputs, run analysis, alter the view, or repeat the options in prose.`,
              },
            ],
          }),
        )
      }),
    )
    stops.push(
      ctx.on('session/event', (session, event) => {
        if (session !== agent.session) return
        if (event.type === 'turn/start') {
          if (event.data.turn <= latestTurn) return
          latestTurn = event.data.turn
          clear()
          activeTurn = event.data.turn
        }
        if (event.type === 'turn/end') {
          if (event.data.turn !== activeTurn) return
          activeTurn = undefined
        }
        if (event.type === 'turn/end' && armed?.turn === event.data.turn) {
          const current = armed
          const finalSubmission =
            submitted && sameVersion(submitted, current) ? submitted : undefined
          clear()
          if (event.data.reason.kind === 'aborted' || event.data.reason.kind === 'interrupted')
            return
          const completed = event.data.reason.kind === 'completed'
          const status =
            completed && finalSubmission?.declined
              ? 'declined'
              : completed && finalSubmission !== undefined
                ? finalSubmission.items.length
                  ? 'available'
                  : 'empty'
                : 'unavailable'
          const reason: NextStepsNotice['reason'] =
            status !== 'unavailable'
              ? undefined
              : !completed
                ? 'generation-failed'
                : 'generation-incomplete'
          const notice: NextStepsNotice = {
            sessionId: String(session.id),
            workspaceId: current.workspaceId,
            turn: current.turn,
            reportId: current.reportId,
            buildId: current.buildId,
            ...(current.callId ? { callId: current.callId } : {}),
            status,
            ...(reason ? { reason } : {}),
            items: status === 'available' ? (finalSubmission?.items ?? []) : [],
          }
          const generation = inputGeneration
          void (async () => {
            const identity = await workspace()
            if (
              !disposed &&
              inputGeneration === generation &&
              latestTurn === current.turn &&
              identity.id === current.workspaceId &&
              identity.path === current.workspacePath
            )
              publish(notice)
          })().catch(() => {})
        }
      }),
    )
  } catch (error) {
    savedWrites.close()
    void finishCleanup(stops.reverse())
    throw error
  }
  return () => {
    disposed = true
    savedWrites.close()
    saveAdmissions.clear()
    callStates.clear()
    clear()
    return finishCleanup(stops.reverse())
  }
}
