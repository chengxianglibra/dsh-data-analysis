import { createHash } from 'node:crypto'
import {
  type Domain,
  type DomainFacility,
  defineDomain,
  domainTable,
} from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { parseRef, refKey, type SemanticRef } from './contracts.ts'
import type { UsageScores } from './search.ts'

const refSchema = z.unknown().transform((value, ctx): SemanticRef => {
  try {
    return parseRef(value)
  } catch {
    ctx.addIssue({ code: 'custom', message: 'invalid semantic ref' })
    return z.NEVER
  }
})
const daySchema = z.strictObject({
  day: z.iso.date(),
  count: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
})
export const usageSchema = z
  .strictObject({
    entries: z.record(
      z.string(),
      z.strictObject({
        ref: refSchema,
        days: z
          .array(daySchema)
          .min(1)
          .max(7)
          .refine((days) => days.every((day, i) => i === 0 || days[i - 1]!.day < day.day)),
        lastSelectedAt: z.number().int().min(0).max(8_640_000_000_000_000),
      }),
    ),
  })
  .refine((row) => Object.entries(row.entries).every(([key, entry]) => key === refKey(entry.ref)))
export type UsageWorkspace = z.infer<typeof usageSchema>
export const usageSpec = defineDomain({
  name: 'dsh_data_analysis_semantic_reference_usage',
  version: 0,
  tables: { workspaces: domainTable(usageSchema) },
})
export function workspaceKey(canonicalRoot: string): string {
  return createHash('sha256').update(canonicalRoot).digest('hex')
}
export function localDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function windowDays(now: number): string[] {
  const date = new Date(now)
  date.setHours(12, 0, 0, 0)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(date)
    d.setDate(d.getDate() - (6 - i))
    return localDay(d)
  })
}
export function increment(row: UsageWorkspace, input: SemanticRef, now: number): UsageWorkspace {
  const ref = parseRef(input),
    window = windowDays(now),
    today = window[6]!
  const entries: UsageWorkspace['entries'] = Object.create(null)
  for (const [key, value] of Object.entries(row.entries)) {
    const days = value.days.filter((day) => window.includes(day.day))
    if (days.length) entries[key] = { ...value, days }
  }
  const key = refKey(ref),
    prior = entries[key],
    days = prior?.days ?? []
  const count = days.find((day) => day.day === today)?.count ?? 0
  entries[key] = {
    ref,
    days: [
      ...days.filter((day) => day.day !== today),
      { day: today, count: Math.min(Number.MAX_SAFE_INTEGER, count + 1) },
    ].sort((a, b) => a.day.localeCompare(b.day)),
    lastSelectedAt: now,
  }
  return { entries }
}
/** Only admitted mutations join the per-Workspace queue; close drains those jobs. */
export class SemanticReferenceUsage {
  readonly #ready: Promise<Domain<typeof usageSpec> | undefined>
  readonly #queues = new Map<string, Promise<void>>()
  readonly #clock: () => number
  readonly #diagnostic: () => void
  #closed = false
  constructor(
    facility: Pick<DomainFacility, 'open'>,
    clock: () => number = Date.now,
    diagnostic: () => void = () => {},
  ) {
    this.#clock = clock
    this.#diagnostic = diagnostic
    this.#ready = Promise.resolve()
      .then(() => facility.open(usageSpec))
      .catch(() => {
        diagnostic()
        return undefined
      })
  }
  async scores(key: string): Promise<UsageScores> {
    try {
      const domain = await this.#ready
      if (!domain || this.#closed) return new Map()
      const window = windowDays(this.#clock()),
        row = domain.table('workspaces').get(key)
      return new Map(
        Object.entries(row?.entries ?? {}).map(([key, entry]) => [
          key,
          {
            count: entry.days
              .filter((day) => window.includes(day.day))
              .reduce((sum, day) => Math.min(Number.MAX_SAFE_INTEGER, sum + day.count), 0),
            last: entry.lastSelectedAt,
          },
        ]),
      )
    } catch {
      this.#diagnostic()
      return new Map()
    }
  }
  async selected(key: string, ref: SemanticRef, signal: AbortSignal): Promise<void> {
    const parsed = parseRef(ref)
    const domain = await this.#ready
    signal.throwIfAborted()
    if (this.#closed) throw new Error('disposed')
    if (!domain) return
    const now = this.#clock()
    const job = (this.#queues.get(key) ?? Promise.resolve())
      .then(async () => {
        const table = domain.table('workspaces')
        if (table.get(key) === undefined)
          await table.put(key, increment({ entries: {} }, parsed, now))
        else await table.update(key, (row) => increment(row, parsed, now))
      })
      .catch(() => {
        this.#diagnostic()
      })
    this.#queues.set(key, job)
    try {
      await job
    } finally {
      if (this.#queues.get(key) === job) this.#queues.delete(key)
    }
  }
  async close(): Promise<void> {
    this.#closed = true
    await Promise.all(this.#queues.values())
    await (await this.#ready)?.close()
  }
}
