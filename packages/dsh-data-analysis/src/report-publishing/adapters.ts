import type { Context } from '@deepseek-ai/cordis'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import type { Session } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import { parseReportRef } from '../presentation/contracts/report-ref.ts'
import { registerPluginRpc } from '../rpc.ts'
import { registerMarivoTool } from '../tool-lifecycle.ts'
import { publishingFieldSchema, REPORT_PUBLISHING_CHANNEL } from './credential-contract.ts'
import { type ReportPublishingService, ReportUploadUnconfirmed } from './service.ts'

const workspace = z.object({ workspaceId: z.string().min(1).max(512) })
const describe = workspace.strict()
const mutation = workspace.extend({ configId: z.string().uuid() })
const field = publishingFieldSchema
const set = mutation.extend({ field, value: z.string().min(1).max(65_536) }).strict()
const unset = mutation.extend({ field }).strict()
const refInput = { ref: z.string().min(1).max(4096) }
const publish = mutation.extend(refInput).strict()
const toolInput = z.strictObject(refInput)

function parseSavedRef(value: string) {
  const ref = parseReportRef(value)
  if (ref.kind !== 'saved') throw new Error('report-saved-ref-required')
  return ref
}

export function registerPublishingRpc(
  connection: HostConnectionHandle,
  service: ReportPublishingService | undefined,
  workspaceExists: (id: string) => boolean,
) {
  return registerPluginRpc(
    connection,
    REPORT_PUBLISHING_CHANNEL,
    ['describe', 'set', 'unset', 'publish'],
    async (endpoint, payload, signal) => {
      try {
        signal.throwIfAborted()
        const { workspaceId } = workspace.parse(payload)
        if (!workspaceExists(workspaceId)) throw new Error('workspace-unavailable')
        if (endpoint === 'describe') {
          describe.parse(payload)
          return {
            ok: true,
            value: service ? await service.describe() : { enabled: false, fields: [] },
          }
        }
        if (!service) throw new Error('report-publishing-disabled')
        service.assertConfig(mutation.parse(payload).configId)
        if (endpoint === 'publish') {
          const input = publish.parse(payload)
          return {
            ok: true,
            value: await service.publish({ workspaceId }, parseSavedRef(input.ref), signal),
          }
        }
        if (endpoint === 'set') {
          const input = set.parse(payload)
          await service.change(input.field, input.value, signal)
        } else {
          await service.change(unset.parse(payload).field, undefined, signal)
        }
        return { ok: true, value: await service.describe() }
      } catch (error) {
        return {
          ok: false,
          error: { code: 'internal', message: publishingError(error, signal), details: {} },
        }
      }
    },
  )
}

export function registerReportPublishTool(
  ctx: Context,
  service: ReportPublishingService,
  session: Session,
) {
  return registerMarivoTool(
    ctx,
    defineTool({
      name: 'marivo_publish_report',
      description:
        'Publish one exact saved report version as self-contained HTML to the configured object storage only when the user explicitly asks to publish it. Pass the saved ref from marivo_report_write or marivo_report_read. The HTML includes the saved data snapshots. Returns the URL and upload receipt. An unconfirmed upload may already exist. If credentials are missing, direct the user to the Credential management tab of Datasources and credentials.',
      parameters: {
        ref: {
          type: 'string',
          required: true,
          description: 'Exact saved report ref.',
        },
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            url: { type: 'string', required: true },
            key: { type: 'string', required: true },
            storage: { type: 'string', required: true },
            bucket: { type: 'string', required: true },
            workspaceId: { type: 'string', required: true },
            reportId: { type: 'string', required: true },
            buildId: { type: 'string', required: true },
            sha256: { type: 'string', required: true },
            bytes: { type: 'integer', required: true },
            publishedAt: { type: 'string', required: true },
          },
          additionalProperties: false,
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      timeoutMs: 120_000,
      async execute(args, exec) {
        if (exec.agent?.session !== session) throw new Error('presentation-session-mismatch')
        try {
          const input = toolInput.parse(args)
          return await service.publish(
            { sessionId: String(session.id) },
            parseSavedRef(input.ref),
            exec.signal,
          )
        } catch (error) {
          const code = publishingError(error, exec.signal)
          if (code === 'report-ref-invalid' && error instanceof Error) throw error
          const nextAction =
            code === 'report-publishing-upload-unconfirmed'
              ? 'Check the configured object storage for this exact saved Build before retrying. The upload may have completed.'
              : code === 'report-publishing-credentials-missing'
                ? 'Complete the object storage credentials in Credential management, then publish the same saved ref.'
                : code === 'report-publishing-build-unavailable' ||
                    code === 'report-saved-ref-required'
                  ? 'Find and read the intended saved Build before publishing.'
                  : code === 'report-document-incompatible' || code === 'report-version-unsupported'
                    ? 'Open the exact Build with a compatible plugin before publishing.'
                    : 'Check the current Workspace and object storage configuration before retrying.'
          throw new Error(
            `${code}; error=${JSON.stringify({
              code,
              phase: 'report-publish',
              recovery: {
                nextAction,
                ...(error instanceof ReportUploadUnconfirmed ? { objectKey: error.key } : {}),
              },
            })}`,
          )
        }
      },
    }),
  )
}

function publishingError(error: unknown, signal: AbortSignal): string {
  if (error instanceof Error && error.message === 'report-publishing-upload-unconfirmed')
    return error.message
  if (signal.aborted) return 'cancelled'
  if (error instanceof z.ZodError) return 'invalid-request'
  if (error instanceof Error) {
    if (error.message.startsWith('report-ref-invalid:')) return 'report-ref-invalid'
    if (error.message === 'report-build-not-found' || ('code' in error && error.code === 'ENOENT'))
      return 'report-publishing-build-unavailable'
    if (error.name === 'TimeoutError') return 'report-publishing-timeout'
    if (
      [
        'workspace-unavailable',
        'workspace-changed',
        'report-version-unsupported',
        'report-document-incompatible',
        'report-saved-ref-required',
        'report-workspace-mismatch',
        'report-publishing-config-changed',
        'report-publishing-disabled',
        'report-publishing-disabled-or-field-unavailable',
        'report-publishing-credentials-missing',
      ].includes(error.message)
    )
      return error.message
  }
  return 'report-publishing-operation-failed'
}
