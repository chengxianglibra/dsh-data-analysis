import { CheckCircle2, CircleAlert, Ellipsis, X } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import { useRef } from 'react'
import type { AnalysisDocument } from '../../presentation/contracts/analysis-document.ts'
import { useCopy } from '../i18n/context.tsx'
import { IconButton } from '../ui/controls.tsx'
import { useThemedPortal } from '../ui/portal.tsx'
import { useExportHtml } from './export-html.tsx'

export function ReportActions({
  document,
  isCurrent,
  onHistory,
}: {
  document: AnalysisDocument
  isCurrent: () => boolean
  onHistory: () => void
}) {
  const t = useCopy()
  const source = useRef<HTMLSpanElement>(null)
  const container = useThemedPortal(source)
  const { status, download, dismiss } = useExportHtml({ document, isCurrent })
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
            <p className="rt-actions-note">{t('marivo.presentation.export-html-scope')}</p>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
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
