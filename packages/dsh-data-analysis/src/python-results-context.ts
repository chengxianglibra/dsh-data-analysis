import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import { z } from 'zod'
import { analysisResourceDeclaration } from './presentation/contracts/resource-declaration.ts'
import { pythonResult } from './python-result-references.ts'

const kind = 'marivo-python-results'
const maxOutputs = 16
const resultName = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/)
const receipt = z.strictObject({
  kind: z.literal(kind),
  project: z.string().regex(/^[0-9a-f]{64}$/),
  results: z.record(
    resultName,
    z.strictObject({
      resource: analysisResourceDeclaration.refine(
        ({ kind }) => kind === 'analysis-frame' || kind === 'dataframe',
      ),
      columns: z.array(z.string().max(256)).max(8).optional(),
    }),
  ),
})
const output = z.object({
  project: z.object({ projectRoot: z.string() }),
  results: z.record(resultName, pythonResult),
})

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'marivo-python-results': { kind: 'marivo-python-results'; events: number[] }
  }
}

function projectKey(projectRoot: string): string {
  return createHash('sha256').update(projectRoot).digest('hex')
}

/** Persist the handoff in the existing Harness Tool event, including for partial outcomes. */
export function pythonResultsMeta(value: unknown) {
  const result = output.safeParse(value)
  if (!result.success) return null
  return {
    kind,
    project: projectKey(result.data.project.projectRoot),
    results: Object.fromEntries(
      Object.entries(result.data.results).map(([name, { resource, metadata }]) => [
        name,
        {
          resource,
          ...(metadata.status === 'captured' ? { columns: metadata.columns.slice(0, 8) } : {}),
        },
      ]),
    ),
  }
}

export async function restorePythonResults(
  session: Pick<Session, 'surface' | 'snapshotEvents'>,
  messages: readonly UserMessage[],
  workspacePath: () => string,
  signal: AbortSignal,
): Promise<UserMessage | undefined> {
  const visible = new Set(session.surface.nodes)
  const events = session.snapshotEvents()
  const disclosed = new Set<number>()
  const remember = (source: UserMessage['source']) => {
    if (source?.kind === kind && Array.isArray(source.events))
      for (const seq of source.events) if (Number.isSafeInteger(seq)) disclosed.add(seq)
  }
  for (const message of messages) remember(message.source)
  for (const event of events)
    if (visible.has(event.seq) && event.type === 'user/message') remember(event.data.source)

  const groups: { event: number; results: z.infer<typeof receipt>['results'] }[] = []
  let remaining = maxOutputs
  let project: string | undefined
  for (const event of [...events].reverse()) {
    if (remaining === 0) break
    if (
      !(event.type === 'tool/result' && !event.data.message.isError) &&
      !(
        event.type === 'tool/ptc-dispatch' &&
        event.data.name === 'marivo_python' &&
        !event.data.isError
      )
    )
      continue
    const parsed = receipt.safeParse(event.data.meta)
    if (!parsed.success) continue
    if (project === undefined) {
      try {
        project = projectKey(await realpath(workspacePath()))
      } catch {
        return undefined
      }
      signal.throwIfAborted()
    }
    if (project !== parsed.data.project) continue
    const entries = Object.entries(parsed.data.results)
    const shown =
      disclosed.has(event.seq) || (event.type === 'tool/result' && visible.has(event.seq))
    if (!shown && entries.length <= remaining)
      groups.push({ event: event.seq, results: parsed.data.results })
    remaining = Math.max(0, remaining - entries.length)
  }
  if (!groups.length) return undefined
  return createUserMessage({
    source: { kind, events: groups.map(({ event }) => event) },
    content: [
      {
        type: 'text',
        text: `Recent fixed outputs in this Workspace. Reuse matching resources unchanged. If chart fields are needed, use marivo_report_read with resource.ref and candidateGroup.\n${JSON.stringify(groups)}`,
      },
    ],
  })
}
