import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import { finishCleanup } from '../lifecycle.ts'
import {
  MARIVO_PRESENTATION_DELIVERY_KIND,
  parsePresentationToolDelivery,
} from '../presentation/receipt.ts'
import { type PresentationWorkspaceSource, presentationTurn } from '../presentation/tool.ts'
import { registerMarivoTool } from '../tool-lifecycle.ts'
import { NEXT_STEPS_TOOL, type NextStepsNotice, nextStepsInput } from './contracts.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'marivo-next-steps': { kind: 'marivo-next-steps'; form: 'notice'; summary: string }
  }
}

/** Only saves observed in this live installation can arm a bounded completion check. */
export function installNextStepsAgent(
  ctx: Context,
  agent: Agent,
  workspace: PresentationWorkspaceSource,
  publish: (notice: NextStepsNotice) => void,
): () => Promise<void> {
  let state:
    | { turn: number; workspaceId: string; items?: NextStepsNotice['items']; retried: boolean }
    | undefined
  const clear = () => {
    if (state)
      publish({
        sessionId: String(agent.session.id),
        workspaceId: state.workspaceId,
        turn: state.turn,
        items: [],
      })
    state = undefined
  }
  const stops: Array<() => unknown> = []
  try {
    stops.push(
      registerMarivoTool(
        agent.ctx,
        defineTool({
          name: NEXT_STEPS_TOOL,
          description:
            'Finalize this analysis Turn after its last successful marivo_present save. First honor the user: if they requested no recommendations, call items=[] without generating any. Otherwise offer 0–4 useful follow-up analyses, usually three when appropriate. Success concludes the Turn; do not plan further work after this call. Each short action label must fully describe the task; its prompt may only expand that same task. Offer only tasks immediately feasible with the data and capabilities already available. Do not suggest collecting or adding unavailable dimensions, periods, datasets or inputs. An empty list is valid when no useful feasible task remains. Never recommend work already answered by the saved report; prefer fewer items to repetition or filler. Never run more analysis just to generate suggestions. These are temporary Chat buttons, not report content. Send items=[] if the user declined or no useful next step exists. Do not repeat suggestions in prose. This tool does not send a user message.',
          parameters: {
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
          },
          async execute(args, exec) {
            exec.signal.throwIfAborted()
            if (
              exec.agent !== agent ||
              !state ||
              state.turn !== presentationTurn(agent.session, exec)
            )
              throw new Error('next-steps-requires-current-saved-analysis')
            const current = state
            current.items = undefined
            const input = nextStepsInput.parse(args)
            const identity = await workspace()
            exec.signal.throwIfAborted()
            if (state !== current || identity.id !== current.workspaceId)
              throw new Error('next-steps-owner-changed')
            current.items = input.items
            exec.concludeTurn()
            return { accepted: true }
          },
        }),
      ),
    )
    stops.push(
      agent.ctx.on('tools/result', (exec, result) => {
        if (exec.agent === agent && exec.name === NEXT_STEPS_TOOL && result.isError && state)
          state.items = undefined
        if (exec.agent !== agent || exec.name !== 'marivo_present' || result.isError) return
        const value = z.object({ deliveryJson: z.string() }).safeParse(result.value)
        if (!value.success) return
        try {
          const delivery = parsePresentationToolDelivery(JSON.parse(value.data.deliveryJson))
          if (
            delivery.kind !== MARIVO_PRESENTATION_DELIVERY_KIND ||
            delivery.dshSessionId !== String(agent.session.id)
          )
            return
          state = {
            turn: delivery.turn,
            workspaceId: delivery.receipt.workspaceId,
            retried: (state?.turn === delivery.turn && state.retried) || false,
          }
        } catch {
          /* Invalid output cannot arm a completion check. */
        }
      }),
    )
    stops.push(
      agent.ctx.on('agent/inbox/inserted', ({ message }) => {
        if (message.source.kind === 'user' && state) {
          state = { ...state, items: undefined }
          publish({
            sessionId: String(agent.session.id),
            workspaceId: state.workspaceId,
            turn: state.turn,
            items: [],
          })
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
          state.items !== undefined ||
          state.retried
        )
          return
        state.retried = true
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
                text: 'The analysis report is saved. Honor the user first: if they declined recommendations, call marivo_next_steps with items=[] and do not generate suggestions. This bookkeeping task never overrides that choice. Otherwise finish this Turn with up to four useful immediately feasible follow-up analyses, or items=[] when none is appropriate. A successful call concludes the Turn; no additional prose is needed. Use the language of the analysis. Recommend only tasks feasible with existing data; never propose adding missing dimensions, periods or inputs. Do not repeat work already answered by the report; fewer useful items are better than filler. Each label must state the full action; prompt only expands it. Do not run analysis, alter the report, or repeat the options in prose.',
              },
            ],
          }),
        )
      }),
    )
    stops.push(
      ctx.on('session/event', (session, event) => {
        if (session !== agent.session) return
        if (event.type === 'turn/start') clear()
        if (event.type === 'turn/end' && state?.turn === event.data.turn) {
          const current = state
          state = undefined
          if (event.data.reason.kind === 'completed' && current.items)
            publish({
              sessionId: String(session.id),
              workspaceId: current.workspaceId,
              turn: current.turn,
              items: current.items,
            })
        }
      }),
    )
  } catch (error) {
    void finishCleanup(stops.reverse())
    throw error
  }
  return () => {
    clear()
    return finishCleanup(stops.reverse())
  }
}
