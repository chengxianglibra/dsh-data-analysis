import { CheckCircle2, CircleAlert, Ellipsis, X } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import { useRef, useState } from 'react'
import type { AnalysisDocument } from '../../presentation/contracts/analysis-document.ts'
import { useCopy } from '../i18n/context.tsx'
import { IconButton } from '../ui/controls.tsx'
import { useThemedPortal } from '../ui/portal.tsx'
import { useExportHtml } from './export-html.tsx'

export function ReportActions({
  document,
  isCurrent,
  onHistory,
  refreshLocked,
  onRefreshData,
}: {
  document: AnalysisDocument
  isCurrent: () => boolean
  onHistory: () => void
  refreshLocked: boolean
  onRefreshData: (
    isCurrent: () => boolean,
  ) => Promise<'accepted' | 'stale' | 'unavailable' | 'failed' | 'uncertain'>
}) {
  const t = useCopy()
  const source = useRef<HTMLSpanElement>(null)
  const container = useThemedPortal(source)
  const { status, download, dismiss } = useExportHtml({ document, isCurrent })
  const [refreshStatus, setRefreshStatus] = useState<
    'accepted' | 'stale' | 'unavailable' | 'failed' | 'uncertain'
  >()
  const pending = useRef(false)
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
