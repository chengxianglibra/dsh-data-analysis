import { useEffect, useState } from 'react'
import { useCopy } from '../i18n/context.tsx'

export type ReportProgress = 'generating' | 'draft' | 'loading' | 'saved'

const styles = `
.au-report-motion{display:inline-flex;align-items:center;justify-content:center;flex:none;width:1.5rem;height:1.5rem;color:var(--primary)}
.au-report-motion svg{display:block;width:1.125rem;height:1.125rem}
.au-report-spinner{display:inline-flex;animation:au-report-spin 1s linear infinite}
.au-report-motion[data-progress=saved]{color:#16a34a;animation:au-report-complete 1.2s ease-out forwards}
@keyframes au-report-spin{to{transform:rotate(360deg)}}
@keyframes au-report-complete{0%,65%{opacity:1}100%{opacity:0}}
@media(prefers-reduced-motion:reduce){.au-report-spinner,.au-report-motion[data-progress=saved]{animation:none!important}}
`

/** Completion fades independently of the report body and its reading position. */
export function ReportMotion({ phase }: { phase: ReportProgress }) {
  const t = useCopy()
  const [finished, setFinished] = useState(false)
  useEffect(() => {
    setFinished(false)
    if (phase !== 'saved') return
    const timer = setTimeout(() => setFinished(true), 1200)
    return () => clearTimeout(timer)
  }, [phase])
  if (phase === 'saved' && finished) return null
  return (
    <span
      className="au-report-motion"
      data-progress={phase}
      role="status"
      aria-label={t(
        phase === 'saved'
          ? 'marivo.presentation.ui-saved'
          : phase === 'generating'
            ? 'marivo.presentation.ui-generating'
            : phase === 'draft'
              ? 'marivo.presentation.ui-draft'
              : 'marivo.presentation.ui-loading',
      )}
    >
      <style>{styles}</style>
      <span className={phase === 'saved' ? undefined : 'au-report-spinner'}>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          {phase === 'saved' ? <path d="m5 12 4 4L19 6" /> : <path d="M21 12a9 9 0 1 1-9-9" />}
        </svg>
      </span>
    </span>
  )
}
