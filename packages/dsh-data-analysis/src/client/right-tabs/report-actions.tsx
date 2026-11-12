import { CheckCircle2, CircleAlert, Ellipsis, X } from 'lucide-react'
import { Dialog, DropdownMenu } from 'radix-ui'
import { useRef, useState } from 'react'
import type { AnalysisDocument } from '../../presentation/contracts/analysis-document.ts'
import { useCopy } from '../i18n/context.tsx'
import type { BrowserRpc } from '../semantic-browser/model.ts'
import { Button, IconButton } from '../ui/controls.tsx'
import { useThemedPortal } from '../ui/portal.tsx'
import { useExportHtml } from './export-html.tsx'
import { useReportPublishing } from './report-publishing.ts'

const deliveryLabels = {
  checking: 'marivo.presentation.report-delivery-checking',
  unavailable: 'marivo.presentation.report-delivery-unavailable',
  download: 'marivo.presentation.export-html',
  publish: 'marivo.presentation.publish-report',
} as const

export function ReportActions({
  document,
  isCurrent,
  onHistory,
  refreshLocked,
  onRefreshData,
  onDelete,
  rpc,
  signal,
  onOpenPublishingCredentials,
}: {
  document: AnalysisDocument
  isCurrent: () => boolean
  onHistory: () => void
  refreshLocked: boolean
  onRefreshData: (
    isCurrent: () => boolean,
  ) => Promise<'accepted' | 'stale' | 'unavailable' | 'failed' | 'uncertain'>
  onDelete: (
    isCurrent: () => boolean,
  ) => Promise<'deleted' | 'cleanup-pending' | 'stale' | 'unavailable' | 'failed' | 'uncertain'>
  rpc: BrowserRpc
  signal: AbortSignal
  onOpenPublishingCredentials: () => void
}) {
  const t = useCopy()
  const source = useRef<HTMLSpanElement>(null)
  const container = useThemedPortal(source)
  const { status, download, dismiss } = useExportHtml({ document, isCurrent })
  const publishing = useReportPublishing({ rpc, document, signal, isCurrent })
  const publication = publishing.status
  const deliveryBusy = status === 'working' || publication?.kind === 'working'
  const deliveryLabel =
    status === 'working'
      ? 'marivo.presentation.exporting-html'
      : publication?.kind === 'working'
        ? 'marivo.presentation.publishing-report'
        : deliveryLabels[publishing.mode]
  const [refreshStatus, setRefreshStatus] = useState<
    'accepted' | 'stale' | 'unavailable' | 'failed' | 'uncertain'
  >()
  const pending = useRef(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteStatus, setDeleteStatus] = useState<
    'stale' | 'unavailable' | 'failed' | 'uncertain'
  >()
  const deletePending = useRef(false)
  const remove = async () => {
    if (deletePending.current) return
    deletePending.current = true
    setDeleting(true)
    setDeleteStatus(undefined)
    try {
      const result = await onDelete(isCurrent)
      setConfirmDelete(false)
      if (result !== 'deleted' && result !== 'cleanup-pending' && isCurrent())
        setDeleteStatus(result)
    } finally {
      deletePending.current = false
      setDeleting(false)
    }
  }
  const refresh = async () => {
    if (pending.current || refreshLocked) return
    pending.current = true
    setRefreshStatus(undefined)
    try {
      const result = await onRefreshData(isCurrent)
      if (isCurrent()) setRefreshStatus(result)
    } finally {
      pending.current = false
    }
  }
  return (
    <>
      <DropdownMenu.Root
        onOpenChange={(open) => {
          if (open) void publishing.check()
        }}
      >
        <span ref={source}>
          <DropdownMenu.Trigger asChild>
            <IconButton label={t('marivo.presentation.report-actions')} variant="ghost">
              <Ellipsis aria-hidden="true" />
            </IconButton>
          </DropdownMenu.Trigger>
        </span>
        <DropdownMenu.Portal container={container}>
          <DropdownMenu.Content align="end" sideOffset={4} className="rt-actions-menu">
            <DropdownMenu.Item
              className="rt-actions-item"
              disabled={refreshLocked}
              onSelect={() => void refresh()}
            >
              {t('marivo.presentation.refresh-data')}
            </DropdownMenu.Item>
            <DropdownMenu.Item className="rt-actions-item" onSelect={() => setConfirmDelete(true)}>
              {t('marivo.presentation.delete-report')}
            </DropdownMenu.Item>
            <DropdownMenu.Item className="rt-actions-item" onSelect={onHistory}>
              {t('marivo.presentation.history')}
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className="rt-actions-item"
              disabled={
                deliveryBusy || publishing.mode === 'checking' || publishing.mode === 'unavailable'
              }
              onSelect={() => {
                if (publishing.mode === 'publish') void publishing.publish()
                else if (publishing.mode === 'download') void download()
              }}
            >
              {t(deliveryLabel)}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <Dialog.Root
        open={confirmDelete}
        onOpenChange={(open) => !deleting && setConfirmDelete(open)}
      >
        <Dialog.Portal container={container}>
          <Dialog.Overlay className="rt-dialog-overlay" />
          <Dialog.Content className="rt-dialog">
            <Dialog.Title>{t('marivo.presentation.delete-report-confirm')}</Dialog.Title>
            <Dialog.Description>
              {document.title} — {t('marivo.presentation.delete-report-description')}
            </Dialog.Description>
            <div className="rt-dialog-actions">
              <Button
                type="button"
                variant="outline"
                disabled={deleting}
                onClick={() => setConfirmDelete(false)}
              >
                {t('marivo.presentation.delete-report-cancel')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={deleting}
                onClick={() => void remove()}
              >
                {t('marivo.presentation.delete-report')}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      {deleteStatus && (
        <div className="rt-export-notice rt-export-notice-error" role="alert">
          <CircleAlert aria-hidden="true" />
          <span>{t(`marivo.presentation.delete-report-${deleteStatus}`)}</span>
          <IconButton
            label={t('marivo.presentation.delete-report-dismiss')}
            variant="ghost"
            onClick={() => setDeleteStatus(undefined)}
          >
            <X aria-hidden="true" />
          </IconButton>
        </div>
      )}
      {refreshStatus && (
        <div
          className={`rt-export-notice${refreshStatus === 'accepted' ? '' : ' rt-export-notice-error'}`}
        >
          {refreshStatus === 'accepted' ? (
            <CheckCircle2 aria-hidden="true" />
          ) : (
            <CircleAlert aria-hidden="true" />
          )}
          <span role={refreshStatus === 'accepted' ? 'status' : 'alert'}>
            {t(`marivo.presentation.refresh-data-${refreshStatus}`)}
          </span>
          <IconButton
            label={t('marivo.presentation.refresh-data-dismiss')}
            variant="ghost"
            onClick={() => setRefreshStatus(undefined)}
          >
            <X aria-hidden="true" />
          </IconButton>
        </div>
      )}
      {status === 'success' && (
        <div className="rt-export-notice" role="status">
          <CheckCircle2 aria-hidden="true" />
          {t('marivo.presentation.export-html-started')}
        </div>
      )}
      {status === 'failed' && (
        <div className="rt-export-notice rt-export-notice-error">
          <CircleAlert aria-hidden="true" />
          <span role="alert">{t('marivo.presentation.export-html-failed')}</span>
          <IconButton
            label={t('marivo.presentation.export-html-dismiss')}
            variant="ghost"
            onClick={dismiss}
          >
            <X aria-hidden="true" />
          </IconButton>
        </div>
      )}
      {publication && publication.kind !== 'working' && (
        <div
          className={`rt-export-notice${publication.kind === 'success' ? '' : ' rt-export-notice-error'}`}
        >
          {publication.kind === 'success' ? (
            <CheckCircle2 aria-hidden="true" />
          ) : (
            <CircleAlert aria-hidden="true" />
          )}
          <div className="rt-publishing-details">
            <span role={publication.kind === 'success' ? 'status' : 'alert'}>
              {t(`marivo.presentation.publish-report-${publication.kind}`)}
            </span>
            {publication.kind === 'success' && (
              <a href={publication.url} target="_blank" rel="noopener noreferrer">
                {t('marivo.presentation.open-published-report')}
              </a>
            )}
            {publication.kind === 'credentials-missing' && (
              <Button
                variant="link"
                type="button"
                onClick={() => {
                  if (!isCurrent()) return
                  publishing.dismiss()
                  onOpenPublishingCredentials()
                }}
              >
                {t('marivo.presentation.open-publishing-credentials')}
              </Button>
            )}
          </div>
          <IconButton
            label={t('marivo.presentation.publish-report-dismiss')}
            variant="ghost"
            onClick={publishing.dismiss}
          >
            <X aria-hidden="true" />
          </IconButton>
        </div>
      )}
    </>
  )
}
