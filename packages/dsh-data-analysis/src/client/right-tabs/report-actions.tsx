import { CheckCircle2, CircleAlert, Ellipsis, X } from 'lucide-react'
import { Dialog, DropdownMenu } from 'radix-ui'
import { useRef, useState } from 'react'
import type { AnalysisDocument } from '../../presentation/contracts/analysis-document.ts'
import { useCopy } from '../i18n/context.tsx'
import { Button, IconButton } from '../ui/controls.tsx'
import { useThemedPortal } from '../ui/portal.tsx'
import { useExportHtml } from './export-html.tsx'

export function ReportActions({
  document,
  isCurrent,
  onHistory,
  refreshLocked,
  onRefreshData,
  onDelete,
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
}) {
  const t = useCopy()
  const source = useRef<HTMLSpanElement>(null)
  const container = useThemedPortal(source)
  const { status, download, dismiss } = useExportHtml({ document, isCurrent })
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
      <DropdownMenu.Root>
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
              disabled={status === 'working'}
              onSelect={() => void download()}
            >
              {t(
                status === 'working'
                  ? 'marivo.presentation.exporting-html'
                  : 'marivo.presentation.export-html',
              )}
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
    </>
  )
}
