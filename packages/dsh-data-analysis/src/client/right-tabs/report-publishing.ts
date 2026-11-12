import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import type { AnalysisDocument } from '../../presentation/contracts/analysis-document.ts'
import { savedReportRef } from '../../presentation/contracts/report-ref.ts'
import {
  type PublishingCredentialView,
  publishingCredentialResultSchema,
  REPORT_PUBLISHING_CHANNEL,
} from '../../report-publishing/credential-contract.ts'
import type { BrowserRpc } from '../semantic-browser/model.ts'

const publicationResult = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    value: z.object({
      url: z.url({ protocol: /^https?$/ }),
      workspaceId: z.string(),
      reportId: z.string(),
      buildId: z.string(),
    }),
  }),
  z.object({ ok: z.literal(false), error: z.object({ message: z.string() }) }),
])

const failures = {
  'report-publishing-credentials-missing': 'credentials-missing',
  'report-publishing-config-changed': 'config-changed',
  'report-publishing-disabled': 'config-changed',
  'report-publishing-upload-unconfirmed': 'unconfirmed',
} as const

type PublishStatus =
  | { kind: 'working' | 'credentials-missing' | 'config-changed' | 'unconfirmed' | 'failed' }
  | { kind: 'success'; url: string }

export function useReportPublishing({
  rpc,
  document,
  signal,
  isCurrent,
}: {
  rpc: BrowserRpc
  document: AnalysisDocument
  signal: AbortSignal
  isCurrent: () => boolean
}) {
  const [config, setConfig] = useState<PublishingCredentialView | 'unavailable'>()
  const [status, setStatus] = useState<PublishStatus>()
  const active = useRef<AbortController>()
  useEffect(() => () => active.current?.abort(), [])

  const { workspaceId, reportId, buildId } = document
  async function run(operation: (signal: AbortSignal) => Promise<void>) {
    if (active.current || signal.aborted || !isCurrent()) return
    const controller = new AbortController()
    active.current = controller
    try {
      await operation(AbortSignal.any([signal, controller.signal]))
    } finally {
      active.current = undefined
    }
  }
  const canUpdate = (operationSignal: AbortSignal) => !operationSignal.aborted && isCurrent()

  async function check() {
    await run(async (operationSignal) => {
      setConfig(undefined)
      try {
        const response = publishingCredentialResultSchema.parse(
          await rpc.call(REPORT_PUBLISHING_CHANNEL, 'describe', { workspaceId }, operationSignal),
        )
        if (canUpdate(operationSignal)) setConfig(response.ok ? response.value : 'unavailable')
      } catch {
        if (canUpdate(operationSignal)) setConfig('unavailable')
      }
    })
  }

  async function publish() {
    if (!config || config === 'unavailable' || !config.enabled) return
    await run(async (operationSignal) => {
      if (config.fields.some((field) => field.required && !field.configured)) {
        setStatus({ kind: 'credentials-missing' })
        return
      }
      setStatus({ kind: 'working' })
      try {
        const response = publicationResult.parse(
          await rpc.call(
            REPORT_PUBLISHING_CHANNEL,
            'publish',
            {
              workspaceId,
              configId: config.configId,
              ref: savedReportRef({ workspaceId, reportId, buildId }),
            },
            operationSignal,
          ),
        )
        if (!canUpdate(operationSignal)) return
        if (!response.ok) {
          const code = response.error.message
          setStatus({
            kind: Object.hasOwn(failures, code)
              ? failures[code as keyof typeof failures]
              : 'failed',
          })
          return
        }
        const receipt = response.value
        if (
          receipt.workspaceId !== workspaceId ||
          receipt.reportId !== reportId ||
          receipt.buildId !== buildId
        )
          throw new Error('publication-owner-mismatch')
        setStatus({ kind: 'success', url: receipt.url })
      } catch {
        if (canUpdate(operationSignal)) setStatus({ kind: 'unconfirmed' })
      } finally {
        if (!operationSignal.aborted)
          setStatus((current) => (current?.kind === 'working' ? undefined : current))
      }
    })
  }

  const mode: 'unavailable' | 'publish' | 'download' | 'checking' =
    config === 'unavailable'
      ? 'unavailable'
      : config?.enabled
        ? 'publish'
        : config
          ? 'download'
          : 'checking'
  return { mode, status, check, publish, dismiss: () => setStatus(undefined) }
}
