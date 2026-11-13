import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import { registerMarivoTool } from '../tool-lifecycle.ts'
import { savedReportRef } from './contracts/report-ref.ts'
import { PresentationRecoveryError, workspaceChanged } from './recovery.ts'
import { listReports } from './reports.ts'
import { type PresentationWorkspaceSource, reportWorkspace } from './tool.ts'

const inputSchema = z.strictObject({
  query: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).max(2048).optional(),
  callId: z.string().min(1).max(512).optional(),
})
const cursorSchema = z.strictObject({
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  offset: z.number().int().min(1).max(4096),
})
const normalize = (value: string) => value.normalize('NFKC').toLowerCase()

/** Recover published identities without a Session receipt, draft, Runtime or data query. */
export function createMarivoReportListTool(source: PresentationWorkspaceSource) {
  return defineTool({
    name: 'marivo_report_list',
    description:
      'Find saved analysis views in the current Workspace, including reports from other Sessions or before a Host restart. Use when a saved ref is missing or invalid. Search titles with query; all whitespace-separated words must match, ignoring case and character width. Returns newest publications first, exact saved refs and unavailable pointer count, not report contents or business rows. Duplicate titles remain separate candidates. Read the selected ref with marivo_report_read to confirm the target before editing. Copy nextCursor unchanged with the same query to continue; if the catalog changed, restart without cursor. Listing does not select a report automatically or recover unsaved drafts.',
    parameters: {
      query: { type: 'string', description: 'Optional title search, at most 200 characters.' },
      limit: { type: 'integer', description: 'Page size from 1 to 50, default 20.' },
      cursor: { type: 'string', description: 'Opaque nextCursor from the preceding page.' },
      callId: {
        type: 'string',
        description:
          'Optional exact writer call ID from this Session (nested call ID in PTC). Finds that committed Build, even if superseded.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          workspaceId: { type: 'string', required: true },
          reports: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                title: { type: 'string', required: true },
                publishedAt: { type: 'string', required: true },
                sourceSessionId: { type: 'string', required: true },
                ref: { type: 'string', required: true },
              },
            },
          },
          unavailable: {
            type: 'integer',
            required: true,
            description:
              'Unreadable publication pointers across this Workspace; not search matches.',
          },
          nextCursor: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const input = inputSchema.parse(args)
      exec.signal.throwIfAborted()
      const binding = await reportWorkspace(source, 'report-list')
      if (input.callId && !exec.agent)
        throw new PresentationRecoveryError(
          'report-input-invalid',
          'Recover a write by call ID from its owning Session.',
          {},
          'report-list',
        )
      const publication =
        input.callId && exec.agent
          ? { sessionId: String(exec.agent.session.id), callId: input.callId }
          : undefined
      const catalog = await listReports(binding.path, binding.id, exec.signal, publication).catch(
        (error: unknown) => {
          exec.signal.throwIfAborted()
          const tooLarge = error instanceof Error && error.message === 'report-catalog-too-large'
          throw new PresentationRecoveryError(
            tooLarge ? 'report-catalog-too-large' : 'report-catalog-unavailable',
            tooLarge
              ? 'The Workspace catalog exceeds its scan limit. Use an existing exact saved ref, or ask the operator to review the catalog.'
              : 'Check the Workspace report directory and access, or use an existing exact saved ref.',
            {},
            'report-list',
          )
        },
      )
      const words = normalize(input.query ?? '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
      const matches = catalog.reports.filter((item) =>
        words.every((word) => normalize(item.receipt.title).includes(word)),
      )
      const digest = createHash('sha256')
        .update(JSON.stringify([binding.id, binding.path, words, publication, catalog]))
        .digest('hex')
      let offset = 0
      if (input.cursor) {
        let cursor: z.infer<typeof cursorSchema>
        try {
          cursor = cursorSchema.parse(
            JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')),
          )
          if (Buffer.from(JSON.stringify(cursor)).toString('base64url') !== input.cursor)
            throw new Error('noncanonical')
        } catch {
          throw new Error('report-list-cursor-invalid: restart marivo_report_list without cursor.')
        }
        if (cursor.digest !== digest || cursor.offset >= matches.length)
          throw new Error(
            'report-list-cursor-stale: Workspace, query or catalog changed; restart marivo_report_list without cursor.',
          )
        offset = cursor.offset
      }
      const reports = matches
        .slice(offset, offset + input.limit)
        .map(({ receipt, publishedAt, source }) => ({
          title: receipt.title,
          publishedAt,
          sourceSessionId: source.sessionId,
          ref: savedReportRef({
            workspaceId: binding.id,
            reportId: receipt.reportId,
            buildId: receipt.buildId,
          }),
        }))
      const current = await reportWorkspace(source, 'report-list')
      if (current.id !== binding.id || current.path !== binding.path)
        throw workspaceChanged('report-list')
      exec.signal.throwIfAborted()
      const nextOffset = offset + reports.length
      return {
        workspaceId: binding.id,
        reports,
        unavailable: catalog.unavailable,
        nextCursor:
          nextOffset < matches.length
            ? Buffer.from(JSON.stringify({ digest, offset: nextOffset })).toString('base64url')
            : null,
      }
    },
  })
}

export function registerMarivoReportListTool(ctx: Context, source: PresentationWorkspaceSource) {
  return registerMarivoTool(ctx, createMarivoReportListTool(source))
}
