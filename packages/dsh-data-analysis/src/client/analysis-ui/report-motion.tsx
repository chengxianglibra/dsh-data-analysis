import { useCopy } from '../i18n/context.tsx'

export type ReportProgress = 'generating' | 'draft' | 'loading'

const styles = `
.au-report-motion{display:inline-flex;align-items:center;flex:none;width:3rem;height:1.5rem;color:var(--primary);overflow:hidden}
.au-report-motion svg{display:block;width:100%;height:100%;overflow:visible}
.au-report-motion-track{opacity:.16}
.au-report-motion-line{stroke-dasharray:30 70;animation:au-report-trace 2.4s linear infinite}
.au-report-motion-dot{transform-box:fill-box;transform-origin:center;animation:au-report-breathe 1.8s ease-in-out infinite}
.au-report-motion[data-progress=draft] .au-report-motion-line{animation:none;stroke-dasharray:none;opacity:.55}
.au-report-motion[data-progress=draft] .au-report-motion-dot{animation-duration:3s}
@keyframes au-report-trace{from{stroke-dashoffset:100}to{stroke-dashoffset:-100}}
@keyframes au-report-breathe{0%,100%{opacity:.45;transform:scale(.8)}50%{opacity:1;transform:scale(1.15)}}
@media(prefers-reduced-motion:reduce){.au-report-motion-line,.au-report-motion-dot{animation:none!important;stroke-dasharray:none;transform:none}}
`

/** Decorative chart motion conveys activity without suggesting measured values. */
export function ReportMotion({ phase }: { phase: ReportProgress }) {
  const t = useCopy()
  return (
    <span
      className="au-report-motion"
      data-progress={phase}
      role="status"
      aria-label={t(
        phase === 'generating'
          ? 'marivo.presentation.ui-generating'
          : phase === 'draft'
            ? 'marivo.presentation.ui-draft'
            : 'marivo.presentation.ui-loading',
      )}
    >
      <style>{styles}</style>
      <svg viewBox="0 0 48 24" fill="none" aria-hidden="true">
        <path
          className="au-report-motion-track"
          d="M3 18 11 13 19 16 28 7 36 10 44 4"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          className="au-report-motion-line"
          d="M3 18 11 13 19 16 28 7 36 10 44 4"
          pathLength="100"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle className="au-report-motion-dot" cx="44" cy="4" r="2.5" fill="currentColor" />
      </svg>
    </span>
  )
}
