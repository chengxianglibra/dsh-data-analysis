import type { Context } from '@deepseek-ai/cordis'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import { PRESENTATION_BUDGETS, parsePresentationBuildId } from '../presentation/contracts/index.ts'
import { registerPluginRpc } from '../rpc.ts'
import { registerMarivoTool } from '../tool-lifecycle.ts'
import type { ReportPublishingService } from './service.ts'

export const PUBLISHING_CHANNEL = '/dsh-report-publishing'
const identity = z.string().transform((value) => parsePresentationBuildId(value))
const field = z.enum(['accessKeyId', 'secretAccessKey', 'sessionToken'])
export function registerPublishingCredentials(
  connection: HostConnectionHandle,
  service: ReportPublishingService,
  workspaceExists: (id: string) => boolean,
) {
  return registerPluginRpc(
    connection,
    PUBLISHING_CHANNEL,
    ['describe', 'set', 'unset', 'publish'],
    async (endpoint, payload, signal) => {
      try {
        const base = { workspaceId: z.string().min(1).max(512) }
        const { workspaceId } = z.object(base).parse(payload)
        if (!workspaceExists(workspaceId)) throw new Error('workspace-unavailable')
        signal.throwIfAborted()
        const mutation = { ...base, configId: z.string().uuid() }
        if (endpoint !== 'describe')
          service.assertConfig(z.object(mutation).parse(payload).configId)
        if (endpoint === 'publish') {
          const input = z
            .object({
              ...mutation,
              reportId: identity,
              buildId: identity,
              viewHtml: z.string().max(PRESENTATION_BUDGETS.htmlBytes).optional(),
            })
            .strict()
            .parse(payload)
          return {
            ok: true,
            value: await service.publish(
              { workspaceId },
              input.reportId,
              input.buildId,
              AbortSignal.any([signal, AbortSignal.timeout(110_000)]),
              input.viewHtml,
            ),
          }
        }
        if (endpoint === 'set') {
          const input = z
            .object({ ...mutation, field, value: z.string().min(1).max(65536) })
            .strict()
            .parse(payload)
          await service.change(input.field, input.value, signal)
        } else if (endpoint === 'unset') {
          const input = z
            .object({ ...mutation, field })
            .strict()
            .parse(payload)
          await service.change(input.field, undefined, signal)
        } else z.object(base).strict().parse(payload)
        return { ok: true, value: await service.describe() }
      } catch (error) {
        const message = publishingError(error)
        return { ok: false, error: { code: 'internal', message, details: {} } }
      }
    },
  )
}
export function registerReportPublishTool(
  ctx: Context,
  service: ReportPublishingService,
  sessionId: string,
) {
  return registerMarivoTool(
    ctx,
    defineTool({
      name: 'marivo_publish_report',
      description:
        'Publish a saved report Build as self-contained HTML to the configured object storage only when the user requests publication. Returns the immutable URL. Does not run analysis or include unsaved edits or temporary filters. Credentials are configured under 数据源与凭证 → 报告发布凭证. An unconfirmed upload may already exist; retry the same Build safely. Never send credentials or storage settings as tool arguments.',
      parameters: {
        report_id: {
          type: 'string',
          required: true,
          description: 'Saved Report ID from the presentation receipt.',
        },
        build_id: {
          type: 'string',
          required: true,
          description: 'Exact saved Build ID to publish.',
        },
      },
      output: {
        schema: {
          type: 'object',
          properties: { publicationJson: { type: 'string', required: true } },
          additionalProperties: false,
        },
        render: (_args, value) => [{ type: 'text', text: value.publicationJson }],
      },
      timeoutMs: 120_000,
      async execute(args, exec) {
        if (!exec.agent || exec.agent.session.id !== sessionId)
          throw new Error('presentation-session-mismatch')
        const input = z.object({ report_id: identity, build_id: identity }).strict().parse(args)
        try {
          return {
            publicationJson: JSON.stringify(
              await service.publish(
                { sessionId },
                input.report_id,
                input.build_id,
                AbortSignal.any([exec.signal, AbortSignal.timeout(110_000)]),
              ),
            ),
          }
        } catch (error) {
          throw new Error(publishingError(error))
        }
      },
    }),
  )
}

function publishingError(error: unknown): string {
  return error instanceof Error &&
    [
      'report-publishing-config-changed',
      'report-publishing-disabled',
      'report-publishing-build-unavailable',
      'report-publishing-credentials-missing',
      'report-publishing-upload-unconfirmed',
      'report-publishing-view-invalid',
    ].includes(error.message)
    ? error.message
    : 'report-publishing-operation-failed'
}
