// @ts-nocheck -- Host hooks and Session navigation are supplied by the module table.

import { XIcon } from 'lucide-react'
import { useId, useSyncExternalStore } from 'react'
import { useCopy } from './../i18n/context.tsx'
import { Button, IconButton } from '../ui/controls.tsx'
import { Alert, AlertDescription } from '../ui/primitives/alert.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/primitives/card.tsx'
import { Empty, EmptyDescription, EmptyHeader } from '../ui/primitives/empty.tsx'
import { Field, FieldLabel } from '../ui/primitives/field.tsx'
import { Input } from '../ui/primitives/input.tsx'
import { NativeSelect } from '../ui/primitives/native-select.tsx'
import { Skeleton } from '../ui/primitives/skeleton.tsx'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/primitives/table.tsx'
import { UIStyleSheet } from '../ui/theme.ts'
import { visibleReports } from './catalog-model.ts'

export function publicationTime(value: string, locale: string) {
  return new Date(value).toLocaleString(locale, { hour12: false })
}
export function ReportSource({ version, sessions, onOpenSession, showKind = true }) {
  const t = useCopy()

  const id = version.source.sessionId
  const session = id && sessions?.[id]
  return (
    <span className="pd-source">
      {showKind ? t('marivo.presentation.agent-update') : ''}
      {session && onOpenSession ? (
        <Button
          variant="link"
          type="button"
          className="pd-link"
          title={session.displayTitle}
          onClick={() => onOpenSession(id)}
        >
          {session.displayTitle}
        </Button>
      ) : (
        t('marivo.presentation.source-session-unavailable')
      )}
    </span>
  )
}
export function ReportCatalogView({ model, reader, sessions, onOpenSession }) {
  const t = useCopy()
  const categoryId = useId()

  const state = useSyncExternalStore(model.subscribe, model.getSnapshot)
  const reports = visibleReports(state)
  return (
    <div className="mv-ui pd-catalog">
      <UIStyleSheet />
      <Card>
        <CardHeader className="pd-catalog-controls">
          <Field orientation="horizontal" className="pd-category">
            <FieldLabel htmlFor={categoryId}>
              {t('marivo.presentation.ui-catalog-category')}
            </FieldLabel>
            <NativeSelect
              id={categoryId}
              aria-label={t('marivo.presentation.ui-catalog-category')}
              value={state.surface ?? 'tab'}
              onChange={(event) => model.patch({ surface: event.target.value })}
            >
              <option value="tab">{t('marivo.presentation.ui-catalog-reports')}</option>
              <option value="tool">{t('marivo.presentation.ui-catalog-results')}</option>
            </NativeSelect>
          </Field>
          <Input
            type="search"
            aria-label={t('marivo.presentation.search-by-title')}
            value={state.query}
            placeholder={t('marivo.presentation.search-reports-in-this-workspace')}
            onChange={(e) => model.patch({ query: e.target.value })}
          />
        </CardHeader>
        <CardContent className="pd-catalog-body">
          {state.loading && (
            <div role="status">
              <p>{t('marivo.presentation.loading-reports')}</p>
              <Skeleton className="h-24 w-full" />
            </div>
          )}
          {state.error && (
            <Alert variant="destructive">
              <AlertDescription>{t(state.error)}</AlertDescription>
            </Alert>
          )}
          {!!state.catalog?.unavailable && (
            <Alert role="status">
              <AlertDescription>
                {state.catalog.unavailable}{' '}
                {t('marivo.presentation.report-records-could-not-be-read-and-are-omitted')}
              </AlertDescription>
            </Alert>
          )}
          {!state.loading && !state.error && reports.length === 0 && (
            <Empty className="pd-empty">
              <EmptyHeader>
                <EmptyDescription>
                  {state.query
                    ? t('marivo.presentation.no-reports-match-this-title')
                    : t('marivo.presentation.this-workspace-has-no-published-reports')}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {reports.length > 0 && (
            <section
              className="pd-report-scroll"
              aria-label={t('marivo.presentation.report-list')}
              // biome-ignore lint/a11y/noNoninteractiveTabindex: The scroll region needs keyboard access to all three columns in narrow panes.
              tabIndex={0}
            >
              <Table className="pd-report-table">
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">{t('marivo.presentation.report-title')}</TableHead>
                    <TableHead scope="col">
                      {t('marivo.presentation.source-conversation')}
                    </TableHead>
                    <TableHead scope="col">{t('marivo.presentation.updated')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reports.map((version) => (
                    <TableRow key={version.receipt.reportId}>
                      <TableCell>
                        <Button
                          variant="link"
                          type="button"
                          className="pd-link pd-report-title"
                          title={version.receipt.title}
                          onClick={() =>
                            void reader.showReport(state.workspaceId, version.receipt.reportId)
                          }
                        >
                          {version.receipt.title}
                        </Button>
                      </TableCell>
                      <TableCell>
                        <ReportSource
                          version={version}
                          sessions={sessions}
                          onOpenSession={onOpenSession}
                          showKind={false}
                        />
                      </TableCell>
                      <TableCell>
                        <time dateTime={version.publishedAt}>
                          {publicationTime(version.publishedAt, t.locale)}
                        </time>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
export function ReportHistoryPanel({ state, model, sessions, onOpenSession, onClose }) {
  const t = useCopy()

  return (
    <aside className="mv-ui pd-history" aria-label={t('marivo.presentation.history')}>
      <UIStyleSheet />
      <Card>
        <CardHeader className="pd-history-header">
          <CardTitle role="heading" aria-level={3}>
            {t('marivo.presentation.history')}
          </CardTitle>
          <IconButton
            type="button"
            variant="ghost"
            label={t('marivo.presentation.close-history')}
            onClick={onClose}
          >
            <XIcon />
          </IconButton>
        </CardHeader>
        <CardContent className="pd-history-body">
          {state.historyLoading && <p role="status">{t('marivo.presentation.loading-history')}</p>}
          {state.historyError && (
            <Alert variant="destructive">
              <AlertDescription>{t(state.historyError)}</AlertDescription>
            </Alert>
          )}
          <ol>
            {state.history?.versions.map((version) => (
              <li
                key={version.receipt.buildId}
                className={
                  state.resolvedReceipt?.buildId === version.receipt.buildId
                    ? 'is-selected'
                    : undefined
                }
              >
                <Button
                  type="button"
                  className="pd-version"
                  variant="ghost"
                  aria-pressed={state.resolvedReceipt?.buildId === version.receipt.buildId}
                  disabled={state.loading}
                  onClick={() => void model.selectVersion(version.receipt.buildId)}
                >
                  <span className="pd-version-heading">
                    <time dateTime={version.publishedAt}>
                      {publicationTime(version.publishedAt, t.locale)}
                    </time>
                    <span className="pd-version-labels">
                      {version.receipt.buildId === state.history.currentBuildId && (
                        <span className="pd-version-badge">
                          {t('marivo.presentation.current-version')}
                        </span>
                      )}
                      {state.resolvedReceipt?.buildId === version.receipt.buildId && (
                        <span className="pd-version-viewing">
                          {t('marivo.presentation.viewing-version')}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="pd-version-title">{version.receipt.title}</span>
                </Button>
                <ReportSource version={version} sessions={sessions} onOpenSession={onOpenSession} />
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </aside>
  )
}

export const catalogStyles = `
.pd-catalog{min-width:0;container-type:inline-size}
.pd-catalog-controls{display:flex;flex-wrap:wrap;align-items:center;gap:1rem}
.pd-category{display:flex;align-items:center;gap:.75rem;flex-shrink:0}
.pd-catalog-controls>[data-slot=field]{flex:0 1 auto;width:auto}
.pd-catalog-controls>input{flex:1 1 240px;min-width:0}
.pd-catalog-body,.pd-history-body{display:flex;flex-direction:column;gap:1rem;min-width:0}
.pd-report-scroll{overflow-x:auto}.pd-report-scroll>[data-slot=table-container]{overflow:visible}
.pd-report-table{font-variant-numeric:tabular-nums;min-width:540px;table-layout:fixed}
.pd-report-table th:first-child{width:48%}
.pd-report-table th:last-child{width:180px}
.pd-report-table :is(th,td){white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pd-report-table .pd-link,.pd-report-table .pd-source{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pd-link{justify-content:flex-start;height:auto;white-space:normal;text-align:left}
.pd-source{color:var(--muted-foreground);font-size:.875rem;overflow-wrap:anywhere}
.pd-history{min-width:0;max-height:75vh;overflow:auto}
.pd-history-header{display:flex;align-items:center;justify-content:space-between;gap:.75rem}
.pd-history-header button{flex:none}
.pd-history ol{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:.5rem}
.pd-history li{min-width:0;border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden}
.pd-history li.is-selected{border-color:var(--ring);background:var(--accent)}
.pd-version{display:flex;flex-direction:column;align-items:stretch;gap:.35rem;width:100%;height:auto;padding:.75rem .875rem .35rem;white-space:normal;text-align:left}
.pd-version-heading{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.35rem .75rem;font-weight:600;font-variant-numeric:tabular-nums}
.pd-version-labels{display:flex;align-items:center;flex-wrap:wrap;gap:.4rem;font-size:.75rem;font-weight:500}
.pd-version-badge{padding:.1rem .45rem;border-radius:999px;background:var(--secondary);color:var(--secondary-foreground)}
.pd-version-viewing{color:var(--muted-foreground)}
.pd-version-title{font-weight:400;overflow-wrap:anywhere}
.pd-history li>.pd-source{display:block;padding:0 .875rem .75rem}
.pd-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
`
