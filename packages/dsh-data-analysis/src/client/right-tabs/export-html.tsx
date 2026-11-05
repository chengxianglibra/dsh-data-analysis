import { useEffect, useRef, useState } from 'react'
import type { AnalysisDocument } from '../../presentation/contracts/analysis-document.ts'
import { useCopy } from '../i18n/context.tsx'
import { Button } from '../ui/controls.tsx'

/** Downloads the exact already-verified Build displayed by the report reader. */
export function ExportHtml({
  document: report,
  isCurrent,
}: {
  document: AnalysisDocument
  isCurrent: () => boolean
}) {
  const t = useCopy()
  const [status, setStatus] = useState<'working' | 'failed'>()
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  async function download() {
    setStatus('working')
    try {
      const { exportAnalysisHtml } = await import('../analysis-ui/offline-export.ts')
      if (!mounted.current || !isCurrent()) return
      const html = exportAnalysisHtml(report)
      if (!mounted.current || !isCurrent()) return
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
      try {
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = `report-${report.reportId}-${report.buildId}.html`
        anchor.click()
      } finally {
        // Give the browser time to begin consuming the object URL.
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      }
    } catch {
      if (mounted.current) setStatus('failed')
      return
    } finally {
      if (mounted.current) setStatus((current) => (current === 'working' ? undefined : current))
    }
  }
  return (
    <>
      <Button type="button" variant="outline" disabled={status === 'working'} onClick={download}>
        {t(
          status === 'working'
            ? 'marivo.presentation.exporting-html'
            : 'marivo.presentation.export-html',
        )}
      </Button>
      <span>{t('marivo.presentation.export-html-scope')}</span>
      {status === 'failed' && (
        <span role="alert">{t('marivo.presentation.export-html-failed')}</span>
      )}
    </>
  )
}
