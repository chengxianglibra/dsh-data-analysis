// @ts-nocheck -- Host hooks and Session navigation are supplied by the module table.

import { useId, useSyncExternalStore } from 'react'
import { useCopy } from './../i18n/context.tsx'
import { Button } from '../ui/controls.tsx'
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
export function ReportHistoryPanel({ state, model, sessions, onOpenSession }) {
  const t = useCopy()

  return (
    <aside className="mv-ui pd-history" aria-label={t('marivo.presentation.history')}>
      <UIStyleSheet />
      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={3}>
            {t('marivo.presentation.history')}
          </CardTitle>
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
              <li key={version.receipt.buildId}>
                <Button
                  type="button"
                  className="pd-version"
                  variant={
                    state.resolvedReceipt?.buildId === version.receipt.buildId
                      ? 'secondary'
                      : 'outline'
                  }
                  aria-pressed={state.resolvedReceipt?.buildId === version.receipt.buildId}
                  disabled={state.loading}
                  onClick={() => void model.selectVersion(version.receipt.buildId)}
                >
                  <strong>
                    <time dateTime={version.publishedAt}>
                      {publicationTime(version.publishedAt, t.locale)}
                    </time>
                  </strong>
                  <span>
                    {version.receipt.buildId === state.history.currentBuildId
                      ? t('marivo.presentation.current-version')
                      : t('marivo.presentation.history')}{' '}
                    · {version.receipt.buildId.slice(0, 8)}
                  </span>
                  <span>{version.receipt.title}</span>
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
.pd-history ol{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:1rem}
.pd-history li{display:flex;flex-direction:column;gap:.5rem}
.pd-version{display:flex;flex-direction:column;align-items:stretch;gap:.5rem;width:100%;height:auto;white-space:normal;text-align:left}
.pd-version span{overflow-wrap:anywhere}
.pd-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
`
