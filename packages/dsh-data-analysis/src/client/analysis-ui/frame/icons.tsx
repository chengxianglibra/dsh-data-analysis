import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import type { ResolvedFrameView } from '../../../presentation/contracts/frame-view.ts'
import type { PythonCodeRef } from '../../../python-execution-contracts.ts'
import { useCopy } from '../../i18n/context.tsx'
import { useAnalysisResources } from '../context.tsx'
import { SemanticOrigins, semanticObjects } from '../metadata-view.tsx'
import { FrameIcon } from './frame-icon.tsx'
import {
  comparisonPeriodPage,
  comparisonPeriods,
  endpointLabels,
  interpretationOf,
  periodDetail,
  periodLabel,
  type Snapshot,
} from './model.ts'

const P = 'marivo.presentation.'
type Section = { status: string; reason?: string }

/** Grey state text for an unavailable section; never "0 items". */
function sectionState(t: ReturnType<typeof useCopy>, section: Section): string | undefined {
  if (section.status === 'unavailable')
    return t(`${P}ui-metadata-unavailable-${section.reason ?? 'read-failed'}`)
  return undefined
}

export function Dialog({
  title,
  open,
  onClose,
  children,
}: {
  title: string
  open: boolean
  onClose: () => void
  children: ReactNode
}) {
  const t = useCopy()
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])
  return (
    <dialog ref={ref} className="fv-dialog" aria-label={title} onClose={onClose}>
      {open && (
        <>
          <header>
            <h3>{title}</h3>
            <button type="button" aria-label={t(`${P}ui-frame-close`)} onClick={onClose}>
              <FrameIcon kind="close" />
            </button>
          </header>
          <div>{children}</div>
        </>
      )}
    </dialog>
  )
}

/** Focusable icon button; the tooltip appears on hover and focus. */
export function FrameIconButton({
  label,
  tip,
  disabled,
  kind,
  onOpen,
  expanded,
  hasPopup,
  children,
}: {
  label: string
  tip: string
  disabled?: boolean
  kind: string
  onOpen?: () => void
  expanded?: boolean
  hasPopup?: 'dialog'
  children: ReactNode
}) {
  const id = `fv-tip-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  return (
    <span className="fv-icon" data-icon={kind} data-disabled={disabled ? 'true' : undefined}>
      <button
        type="button"
        aria-label={label}
        aria-describedby={tip === label ? undefined : id}
        aria-disabled={disabled ? true : undefined}
        aria-expanded={expanded}
        aria-haspopup={hasPopup}
        onClick={disabled ? undefined : onOpen}
      >
        {children}
      </button>
      <span role="tooltip" id={id} className="fv-tip">
        {tip}
      </span>
    </span>
  )
}

/** Ring arc shows the captured fraction; the text is the two saved counts. */
export function CoverageIcon({ snapshot: s }: { snapshot: Snapshot }) {
  const t = useCopy()
  const { capturedRows, totalRows } = s.coverage
  const counts = `${capturedRows.toLocaleString(t.locale)}/${totalRows.toLocaleString(t.locale)}`
  const share = totalRows === 0 ? 1 : capturedRows / totalRows
  const c = 2 * Math.PI * 6
  return (
    <FrameIconButton
      kind="coverage"
      label={t(`${P}ui-frame-coverage`)}
      tip={t(`${P}ui-frame-coverage-tip`, { p0: counts, p1: s.fetchedAt })}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="6" fill="none" stroke="var(--fv-grid)" strokeWidth="2.5" />
        <circle
          cx="8"
          cy="8"
          r="6"
          fill="none"
          stroke="var(--pr-accent)"
          strokeWidth="2.5"
          strokeDasharray={`${(share * c).toFixed(2)} ${c.toFixed(2)}`}
          transform="rotate(-90 8 8)"
        />
      </svg>
      <span>{counts}</span>
    </FrameIconButton>
  )
}

/** Period correspondence of a calendar/interval comparison. */
function PeriodsIcon({ snapshot: s, index }: { snapshot: Snapshot; index: number }) {
  const t = useCopy()
  const [open, setOpen] = useState(false)
  const page = comparisonPeriodPage(s, index)
  const state =
    sectionState(t, s.frame.sections.periods as Section) ??
    (page ? undefined : t(`${P}ui-frame-point-periods-unavailable`))
  const items = state ? [] : comparisonPeriods(s, index)
  const ends = endpointLabels(t, s, index)
  const label = t(`${P}ui-frame-periods`)
  return (
    <>
      <FrameIconButton
        kind="periods"
        label={label}
        tip={state ?? `${ends.current} ⇄ ${ends.baseline}`}
        disabled={!!state}
        onOpen={() => setOpen(true)}
      >
        <span aria-hidden="true">⇄</span>
      </FrameIconButton>
      <Dialog title={label} open={open} onClose={() => setOpen(false)}>
        {page?.hasMore && (
          <p>{t(`${P}ui-frame-periods-captured`, { p0: items.length, p1: page.totalCount })}</p>
        )}
        <table>
          <thead>
            <tr>
              <th scope="col">{ends.current}</th>
              <th scope="col">{ends.baseline}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={JSON.stringify(item.key)}>
                <td title={periodDetail(t, item.current)}>
                  {periodLabel(item.current)}
                  <br />
                  <small>{periodDetail(t, item.current)}</small>
                </td>
                <td title={periodDetail(t, item.baseline)}>
                  {item.baseline ? (
                    <>
                      {periodLabel(item.baseline)}
                      <br />
                      <small>{periodDetail(t, item.baseline)}</small>
                    </>
                  ) : (
                    t(
                      `${P}ui-frame-absent-${(item.absentReason ?? 'unmatched').replaceAll('_', '-')}`,
                    )
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Dialog>
    </>
  )
}

function OriginsIcon({ snapshot: s }: { snapshot: Snapshot }) {
  const t = useCopy()
  const [open, setOpen] = useState(false)
  const section = s.frame.sections.semantics
  const state = sectionState(t, section as Section)
  const paths = semanticObjects(section).map((origin) => origin.path)
  const label = t(`${P}ui-metadata-semantics`)
  return (
    <>
      <FrameIconButton
        kind="origins"
        label={label}
        tip={state ?? (paths.slice(0, 6).join('\n') + (paths.length > 6 ? '\n…' : '') || label)}
        disabled={!!state}
        onOpen={() => setOpen(true)}
      >
        <FrameIcon kind="source" />
        {!state && <span>{paths.length}</span>}
      </FrameIconButton>
      <Dialog title={label} open={open} onClose={() => setOpen(false)}>
        <SemanticOrigins section={section} />
      </Dialog>
    </>
  )
}

type CodeState = { kind: 'idle' | 'loading' | 'failed' | 'mismatch' } | { kind: 'ok'; text: string }

/** Python source bound by the Host; greyed without codeRef, on read failure or sha256 mismatch. */
function PythonIcon({ snapshot: s, codeRef }: { snapshot: Snapshot; codeRef?: PythonCodeRef }) {
  const t = useCopy()
  const { readCode } = useAnalysisResources()
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState<CodeState>({ kind: 'idle' })
  const [copied, setCopied] = useState<string>()
  useEffect(() => {
    if (!open || !codeRef || !readCode) return
    const controller = new AbortController()
    setCode((current) => (current.kind === 'ok' ? current : { kind: 'loading' }))
    readCode(codeRef, controller.signal)
      .then((record) => {
        if (controller.signal.aborted) return
        if (!record) return setCode({ kind: 'failed' })
        setCode(
          record.sha256 === codeRef.sha256
            ? { kind: 'ok', text: record.text }
            : { kind: 'mismatch' },
        )
      })
      .catch(() => {
        if (!controller.signal.aborted) setCode({ kind: 'failed' })
      })
    return () => controller.abort()
  }, [open, codeRef, readCode])
  const unavailable = !codeRef || !readCode
  const greyed = unavailable || code.kind === 'failed' || code.kind === 'mismatch'
  const label = t(`${P}ui-frame-python`)
  const state = !codeRef
    ? t(`${P}ui-frame-python-missing`)
    : !readCode || code.kind === 'failed'
      ? t(`${P}ui-frame-python-read-failed`)
      : code.kind === 'mismatch'
        ? t(`${P}ui-frame-python-mismatch`)
        : undefined
  const copy = async (text: string) => {
    const ok = await Promise.resolve()
      .then(() => navigator.clipboard.writeText(text))
      .then(() => true)
      .catch(() => false)
    setCopied(ok ? `${P}copied` : `${P}ui-copy-failed`)
  }
  return (
    <>
      <FrameIconButton
        kind="python"
        label={label}
        tip={state ?? `executionId ${codeRef!.executionId}\nsha256 ${codeRef!.sha256.slice(0, 12)}`}
        disabled={greyed}
        onOpen={() => setOpen(true)}
      >
        <span aria-hidden="true">{'</>'}</span>
      </FrameIconButton>
      <Dialog title={label} open={open} onClose={() => setOpen(false)}>
        {code.kind === 'ok' ? (
          <>
            <div className="fv-table-bar">
              <FrameIconButton
                kind="copy-code"
                label={t(`${P}copy-code`)}
                tip={t(`${P}copy-code`)}
                onOpen={() => void copy(code.text)}
              >
                <FrameIcon kind="copy" />
              </FrameIconButton>
              {copied && <span role="status">{t(copied)}</span>}
            </div>
            <pre className="fv-code">
              <code>{code.text}</code>
            </pre>
          </>
        ) : (
          <p className="pr-muted" role="status">
            {state ?? t(`${P}ui-frame-python-loading`)}
          </p>
        )}
        <details className="fv-dev">
          <summary>{t(`${P}ui-frame-developer`)}</summary>
          <dl>
            <dt>sessionId</dt>
            <dd>{s.source.sessionId}</dd>
            <dt>artifactId</dt>
            <dd>{s.source.artifactId ?? '—'}</dd>
            <dt>executionId</dt>
            <dd>{codeRef?.executionId ?? '—'}</dd>
            <dt>sha256</dt>
            <dd>{codeRef?.sha256 ?? '—'}</dd>
          </dl>
        </details>
      </Dialog>
    </>
  )
}

/** Calendar/interval comparison shown by this view, if any. */
function timeComparison(s: Snapshot, view: ResolvedFrameView): number | undefined {
  const comparisons = interpretationOf(s)?.comparisons ?? []
  if (view.chart === 'comparison')
    return comparisons[view.comparison]?.binding.kind === 'ordinary' ? undefined : view.comparison
  const index = comparisons.findIndex((c) => c.binding.kind !== 'ordinary')
  return index < 0 ? undefined : index
}

export function IconRow({
  snapshot,
  view,
  codeRef,
  compact,
  dataControl,
}: {
  snapshot: Snapshot
  view: ResolvedFrameView
  codeRef?: PythonCodeRef
  compact?: boolean
  dataControl?: ReactNode
}) {
  const periods = timeComparison(snapshot, view)
  const coverage = !snapshot.coverage.complete
  if (compact) {
    if (!dataControl && !coverage && periods === undefined) return null
    return (
      <div className="fv-icons">
        {dataControl}
        {coverage && <CoverageIcon snapshot={snapshot} />}
        {periods !== undefined && <PeriodsIcon snapshot={snapshot} index={periods} />}
      </div>
    )
  }
  return (
    <div className="fv-icons">
      {dataControl}
      {coverage && <CoverageIcon snapshot={snapshot} />}
      {periods !== undefined && <PeriodsIcon snapshot={snapshot} index={periods} />}
      <OriginsIcon snapshot={snapshot} />
      <PythonIcon snapshot={snapshot} codeRef={codeRef} />
    </div>
  )
}
