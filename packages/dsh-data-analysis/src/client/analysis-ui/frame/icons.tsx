import { type ReactNode, useEffect, useRef, useState } from 'react'
import type { ResolvedFrameView } from '../../../presentation/contracts/frame-view.ts'
import type { PythonCodeRef } from '../../../python-execution-contracts.ts'
import { useCopy } from '../../i18n/context.tsx'
import { IconButton } from '../../ui/controls.tsx'
import { DetailsDialog } from '../../ui/overlays.tsx'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../ui/primitives/table.tsx'
import { DataActions } from '../components/result.tsx'
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
  return (
    <DetailsDialog
      title={title}
      open={open}
      onClose={onClose}
      closeLabel={t(`${P}ui-frame-close`)}
      className="fv-dialog"
    >
      {children}
    </DetailsDialog>
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
  iconOnly,
  children,
}: {
  label: string
  tip: string
  disabled?: boolean
  kind: string
  onOpen?: () => void
  expanded?: boolean
  hasPopup?: 'dialog'
  iconOnly?: boolean
  children: ReactNode
}) {
  return (
    <span className="fv-icon" data-icon={kind} data-disabled={disabled ? 'true' : undefined}>
      <IconButton
        label={label}
        tip={tip}
        unavailable={disabled}
        aria-expanded={expanded}
        aria-haspopup={hasPopup}
        onClick={disabled ? undefined : onOpen}
      >
        {children}
        {!iconOnly && <span className="fv-icon-label">{label}</span>}
      </IconButton>
    </span>
  )
}

/** Ring arc shows the captured fraction; the text is the two saved counts. */
export function CoverageIcon({
  snapshot: s,
}: {
  snapshot: Pick<Snapshot, 'coverage' | 'fetchedAt'>
}) {
  const t = useCopy()
  const { candidate } = useAnalysisResources()
  const [open, setOpen] = useState(false)
  const { capturedRows, totalRows } = s.coverage
  const counts = `${capturedRows.toLocaleString(t.locale)}/${totalRows.toLocaleString(t.locale)}`
  const share = totalRows === 0 ? 1 : capturedRows / totalRows
  const c = 2 * Math.PI * 6
  const label = t(`${P}ui-frame-coverage`)
  return (
    <>
      <FrameIconButton
        kind="coverage"
        label={label}
        tip={t(`${P}ui-frame-coverage-tip`, { p0: counts, p1: s.fetchedAt })}
        hasPopup="dialog"
        expanded={open}
        onOpen={candidate ? undefined : () => setOpen(true)}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="6" fill="none" stroke="var(--border)" strokeWidth="2.5" />
          <circle
            cx="8"
            cy="8"
            r="6"
            fill="none"
            stroke="var(--primary)"
            strokeWidth="2.5"
            strokeDasharray={`${(share * c).toFixed(2)} ${c.toFixed(2)}`}
            transform="rotate(-90 8 8)"
          />
        </svg>
        <span>{counts}</span>
      </FrameIconButton>
      <Dialog title={label} open={open} onClose={() => setOpen(false)}>
        <p>{t(`${P}ui-capture-range`, { p0: capturedRows, p1: totalRows })}</p>
        <p>{t(`${P}ui-captured-at`, { p0: s.fetchedAt })}</p>
        <p>{t(`${P}ui-business-unknown`)}</p>
      </Dialog>
    </>
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
        <FrameIcon kind="calendar" />
      </FrameIconButton>
      <Dialog title={label} open={open} onClose={() => setOpen(false)}>
        {page?.hasMore && (
          <p>{t(`${P}ui-frame-periods-captured`, { p0: items.length, p1: page.totalCount })}</p>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{ends.current}</TableHead>
              <TableHead scope="col">{ends.baseline}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={JSON.stringify(item.key)}>
                <TableCell title={periodDetail(t, item.current)}>
                  {periodLabel(item.current)}
                  <br />
                  <small>{periodDetail(t, item.current)}</small>
                </TableCell>
                <TableCell title={periodDetail(t, item.baseline)}>
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
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
      </FrameIconButton>
      <Dialog title={label} open={open} onClose={() => setOpen(false)}>
        <SemanticOrigins section={section} />
      </Dialog>
    </>
  )
}

type CodeState =
  | { kind: 'idle' }
  | { kind: 'loading' | 'failed' | 'mismatch'; key: string }
  | { kind: 'ok'; key: string; text: string }

/** Python source bound by the Host; greyed without codeRef, on read failure or sha256 mismatch. */
export function PythonIcon({
  snapshot: s,
  codeRef,
}: {
  snapshot: { source: { sessionId?: string; artifactId?: string | null } }
  codeRef?: PythonCodeRef
}) {
  const t = useCopy()
  const { readCode } = useAnalysisResources()
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState<CodeState>({ kind: 'idle' })
  const [copied, setCopied] = useState<{ key: string; message: string }>()
  const codeKey = codeRef ? JSON.stringify([codeRef.executionId, codeRef.sha256]) : undefined
  const currentKey = useRef(codeKey)
  currentKey.current = codeKey
  const currentCode = code.kind !== 'idle' && code.key === codeKey ? code : undefined
  useEffect(() => {
    if (!open || !codeRef || !codeKey || !readCode) return
    const controller = new AbortController()
    setCode((current) =>
      current.kind === 'ok' && current.key === codeKey
        ? current
        : { kind: 'loading', key: codeKey },
    )
    readCode(codeRef, controller.signal)
      .then((record) => {
        if (controller.signal.aborted) return
        if (!record) return setCode({ kind: 'failed', key: codeKey })
        setCode(
          record.sha256 === codeRef.sha256
            ? { kind: 'ok', key: codeKey, text: record.text }
            : { kind: 'mismatch', key: codeKey },
        )
      })
      .catch(() => {
        if (!controller.signal.aborted) setCode({ kind: 'failed', key: codeKey })
      })
    return () => controller.abort()
  }, [open, codeRef, codeKey, readCode])
  const unavailable = !codeRef || !readCode
  const greyed = unavailable || currentCode?.kind === 'failed' || currentCode?.kind === 'mismatch'
  const label = t(`${P}ui-frame-python`)
  const state = !codeRef
    ? t(`${P}ui-frame-python-missing`)
    : !readCode || currentCode?.kind === 'failed'
      ? t(`${P}ui-frame-python-read-failed`)
      : currentCode?.kind === 'mismatch'
        ? t(`${P}ui-frame-python-mismatch`)
        : undefined
  const copy = async (text: string, key: string) => {
    const ok = await Promise.resolve()
      .then(() => navigator.clipboard.writeText(text))
      .then(() => true)
      .catch(() => false)
    if (currentKey.current === key)
      setCopied({ key, message: ok ? `${P}copied` : `${P}ui-copy-failed` })
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
        <FrameIcon kind="code" />
      </FrameIconButton>
      <Dialog title={label} open={open} onClose={() => setOpen(false)}>
        {currentCode?.kind === 'ok' ? (
          <>
            <div className="fv-table-bar">
              <FrameIconButton
                kind="copy-code"
                label={t(`${P}copy-code`)}
                tip={t(`${P}copy-code`)}
                onOpen={() => void copy(currentCode.text, currentCode.key)}
              >
                <FrameIcon kind="copy" />
              </FrameIconButton>
              {copied && copied.key === codeKey && <span role="status">{t(copied.message)}</span>}
            </div>
            <pre className="fv-code rounded-lg bg-muted p-3 text-xs">
              <code>{currentCode.text}</code>
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
  if (view.chart === 'comparison' || view.chart === 'comparison-grid')
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
  const { candidate } = useAnalysisResources()
  const t = useCopy()
  const periods = timeComparison(snapshot, view)
  const coverage = !snapshot.coverage.complete
  if (compact) {
    if (!dataControl && !coverage && periods === undefined) return null
    return (
      <DataActions>
        {dataControl}
        {coverage && <CoverageIcon snapshot={snapshot} />}
        {periods !== undefined && <PeriodsIcon snapshot={snapshot} index={periods} />}
        {periods !== undefined && !comparisonPeriodPage(snapshot, periods) && (
          <span className="au-result-status" role="status">
            {t(`${P}ui-frame-point-periods-unavailable`)}
          </span>
        )}
      </DataActions>
    )
  }
  return (
    <DataActions>
      {dataControl}
      {coverage && <CoverageIcon snapshot={snapshot} />}
      {periods !== undefined && <PeriodsIcon snapshot={snapshot} index={periods} />}
      {!candidate && <OriginsIcon snapshot={snapshot} />}
      {!candidate && <PythonIcon snapshot={snapshot} codeRef={codeRef} />}
      {periods !== undefined && !comparisonPeriodPage(snapshot, periods) && (
        <span className="au-result-status" role="status">
          {t(`${P}ui-frame-point-periods-unavailable`)}
        </span>
      )}
    </DataActions>
  )
}
