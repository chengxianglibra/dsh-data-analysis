import { useEffect, useRef, useState } from 'react'
import type { AnalysisDocument } from '../../presentation/contracts/analysis-document.ts'

/** Downloads the exact already-verified Build displayed by the report reader. */
export function useExportHtml({
  document: report,
  isCurrent,
}: {
  document: AnalysisDocument
  isCurrent: () => boolean
}) {
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
  return { status, download }
}
