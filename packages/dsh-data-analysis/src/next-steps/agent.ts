import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import { finishCleanup } from '../lifecycle.ts'
import { parseAnalysisRecordId } from '../presentation/contracts/analysis-document.ts'
import {
  MARIVO_PRESENTATION_DELIVERY_KIND,
  parsePresentationToolDelivery,
} from '../presentation/receipt.ts'
import { readAnalysisRecord } from '../presentation/reports.ts'
import { type PresentationWorkspaceSource, presentationTurn } from '../presentation/tool.ts'
import { registerMarivoTool } from '../tool-lifecycle.ts'
import {
  NEXT_STEPS_TOOL,
  type NextStepsNotice,
  nextStepsInput,
  nextStepsReceipt,
} from './contracts.ts'

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
): () => Promise<void> {
  const boundary = [...agent.session.snapshotEvents()]
    .reverse()
    .find((event) => event.type === 'turn/start' || event.type === 'turn/end')
  let activeTurn = boundary?.type === 'turn/start' ? boundary.data.turn : undefined
  let latestTurn = boundary?.data.turn ?? -1
  let retriedTurn: number | undefined
  let inputGeneration = 0
  const saveAdmissions = new Map<string, number>()
  let state:
    | {
        turn: number
        workspaceId: string
        reportId: string
        buildId: string
        callId?: string
        items?: NextStepsNotice['items']
        declined?: boolean
      }
    | undefined
  const callStates = new Map<string, NonNullable<typeof state>>()
  const clear = () => {
    state = undefined
  }
  const stops: Array<() => unknown> = []
  try {
    stops.push(
      agent.ctx.on('tools/pre-execute', async (exec, next) => {
        if (exec.agent === agent && exec.name === 'marivo_present')
          saveAdmissions.set(String(exec.callId), inputGeneration)
        if (exec.agent === agent && exec.name === NEXT_STEPS_TOOL && state)
          callStates.set(String(exec.callId), state)
        return next()
      }),
    )
    stops.push(
      registerMarivoTool(
        agent.ctx,
        defineTool({
          name: NEXT_STEPS_TOOL,
          description:
            'Finalize this analysis Turn after its last successful marivo_present save, or pass an exact recordId when the user requests recommendations for an existing report. Do not save an unchanged report just to provide recommendations. Generate fresh recommendations for the final report version saved in this Turn, even if an earlier Turn already offered suggestions. First honor the user: if they requested no recommendations, call items=[] with emptyReason="declined" without generating any. Otherwise offer 1–4 useful follow-up analyses, usually three when appropriate. A nonempty result or explicit refusal concludes the Turn; an ordinary empty result may request one completion retry. Finish all requested work before this call. Each short action label must fully describe the task; its prompt may only expand that same task. Offer only tasks immediately feasible with the data and capabilities already available. Do not suggest collecting or adding unavailable dimensions, periods, datasets or inputs. If no useful feasible task remains, send items=[] with emptyReason="no-suggestions". An ordinary empty result receives at most one completion retry before showing recommendations unavailable. Never recommend work already answered by the saved report; prefer fewer items to repetition or filler. Never run more analysis just to generate suggestions. These are temporary Chat buttons, not report content. Never claim a user refusal when no suggestion was found. Do not repeat suggestions in prose. This tool does not send a user message.',
          parameters: {
            recordId: {
              type: 'string',
              description:
                'Exact saved report recordId for an explicit request for recommendations. Omit after saving in this Turn.',
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
            schema: { type: 'json' },
            render: () => [{ type: 'text', text: 'Next steps received.' }],
            presentationMeta: (_args, value) =>
              z.object({ receipt: nextStepsReceipt }).safeParse(value).data?.receipt ?? null,
          },
          async execute(args, exec) {
            exec.signal.throwIfAborted()
            const input = nextStepsInput.parse(args)
            const turn = presentationTurn(agent.session, exec)
            if (exec.agent !== agent || turn !== activeTurn)
              throw new Error('next-steps-requires-current-saved-analysis')
            const generation = inputGeneration
            const identity = await workspace()
            if (input.recordId) {
              const target = parseAnalysisRecordId(input.recordId)
              await readAnalysisRecord(
                identity.path,
                identity.id,
                target.reportId,
                target.buildId,
                exec.signal,
              )
              const latest = await workspace()
              exec.signal.throwIfAborted()
              if (
                activeTurn !== turn ||
                inputGeneration !== generation ||
                latest.id !== identity.id ||
                latest.path !== identity.path
              )
                throw new Error('next-steps-owner-changed')
              state = { turn, workspaceId: identity.id, ...target, callId: String(exec.callId) }
            }
            const current = state
            if (!current || current.turn !== turn)
              throw new Error('next-steps-requires-current-saved-analysis')
            exec.signal.throwIfAborted()
            if (
              inputGeneration !== generation ||
              activeTurn !== turn ||
              identity.id !== current.workspaceId
            )
              throw new Error('next-steps-owner-changed')
            callStates.set(String(exec.callId), current)
            current.items = undefined
            current.declined = false
            current.items = input.items
            current.declined = input.emptyReason === 'declined'
            if (input.items.length || current.declined || retriedTurn === current.turn)
              exec.concludeTurn()
            return {
              accepted: true,
              ...(current.callId
                ? {
                    receipt: {
                      kind: 'marivo.next-steps',
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
        if (exec.agent === agent && exec.name === NEXT_STEPS_TOOL) {
          const current = callStates.get(String(exec.callId))
          callStates.delete(String(exec.callId))
          if (result.isError && current && state === current) {
            current.items = undefined
            current.declined = false
          }
        }
        if (exec.agent !== agent || exec.name !== 'marivo_present') return
        const admittedGeneration = saveAdmissions.get(String(exec.callId))
        saveAdmissions.delete(String(exec.callId))
        if (result.isError || admittedGeneration !== inputGeneration) return
        const value = z.object({ deliveryJson: z.string() }).safeParse(result.value)
        if (!value.success) return
        try {
          const delivery = parsePresentationToolDelivery(JSON.parse(value.data.deliveryJson))
          if (
            delivery.kind !== MARIVO_PRESENTATION_DELIVERY_KIND ||
            delivery.dshSessionId !== String(agent.session.id) ||
            delivery.turn !== activeTurn ||
            delivery.turn !== presentationTurn(agent.session, exec)
          )
            return
          state = {
            turn: delivery.turn,
            workspaceId: delivery.receipt.workspaceId,
            reportId: delivery.receipt.reportId,
            buildId: delivery.receipt.buildId,
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
      agent.ctx.on('agent/turn-stopping', ({ turn, signal }) => {
        if (agent.inbox.nextTurn.length) {
          clear()
          return
        }
        if (
          signal.aborted ||
          !state ||
          state.turn !== turn ||
          state.items?.length ||
          state.declined ||
          retriedTurn === turn
        )
          return
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
                text: `The final analysis report version is saved (reportId=${state.reportId}, buildId=${state.buildId}). Generate fresh recommendations for this report and Turn even if recommendations were offered previously. Honor the user first: if they declined recommendations, call marivo_next_steps with items=[] and emptyReason="declined" and do not generate suggestions. This bookkeeping task never overrides that choice. Otherwise finish this Turn with one to four useful immediately feasible follow-up analyses, or items=[] with emptyReason="no-suggestions" only when none is appropriate. This is the only completion retry; never fabricate recommendations to fill the list. A successful call concludes the Turn; no additional prose is needed. Use the language of the analysis. Recommend only tasks feasible with existing data; never propose adding missing dimensions, periods or inputs. Do not repeat work already answered by the report; fewer useful items are better than filler. Each label must state the full action; prompt only expands it. Do not run analysis, alter the report, or repeat the options in prose.`,
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
        if (event.type === 'turn/end' && state?.turn === event.data.turn) {
          const current = state
          state = undefined
          if (event.data.reason.kind === 'aborted' || event.data.reason.kind === 'interrupted')
            return
          const completed = event.data.reason.kind === 'completed'
          const status =
            completed && current.declined
              ? 'declined'
              : completed && current.items?.length
                ? 'available'
                : 'unavailable'
          const reason: NextStepsNotice['reason'] =
            status !== 'unavailable'
              ? undefined
              : !completed
                ? 'generation-failed'
                : current.items
                  ? 'no-suggestions'
                  : 'generation-incomplete'
          publish({
            sessionId: String(session.id),
            workspaceId: current.workspaceId,
            turn: current.turn,
            reportId: current.reportId,
            buildId: current.buildId,
            ...(current.callId ? { callId: current.callId } : {}),
            status,
            ...(reason ? { reason } : {}),
            items: status === 'available' ? (current.items ?? []) : [],
          })
        }
      }),
    )
  } catch (error) {
    void finishCleanup(stops.reverse())
    throw error
  }
  return () => {
    saveAdmissions.clear()
    callStates.clear()
    clear()
    return finishCleanup(stops.reverse())
  }
}
