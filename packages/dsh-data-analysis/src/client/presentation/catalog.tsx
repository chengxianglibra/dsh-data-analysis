// @ts-nocheck -- Host hooks and Session navigation are supplied by the module table.

import { useSyncExternalStore } from 'react'
import { useCopy } from './../i18n/context.tsx'
import { Button } from '../ui/controls.tsx'
import { UI_STYLES } from '../ui/theme.ts'
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

  const state = useSyncExternalStore(model.subscribe, model.getSnapshot)
  const reports = visibleReports(state)
  return (
    <div className="mv-ui pd-catalog">
      <div className="pd-catalog-controls">
        <label className="pd-category">
          {t('marivo.presentation.ui-catalog-category')}
          <select
            aria-label={t('marivo.presentation.ui-catalog-category')}
            value={state.surface ?? 'tab'}
            onChange={(event) => model.patch({ surface: event.target.value })}
          >
            <option value="tab">{t('marivo.presentation.ui-catalog-reports')}</option>
            <option value="tool">{t('marivo.presentation.ui-catalog-results')}</option>
          </select>
        </label>
        <input
          type="search"
          aria-label={t('marivo.presentation.search-by-title')}
          value={state.query}
          placeholder={t('marivo.presentation.search-reports-in-this-workspace')}
          onChange={(e) => model.patch({ query: e.target.value })}
        />
      </div>
      {state.loading && <p role="status">{t('marivo.presentation.loading-reports')}</p>}
      {state.error && (
        <p role="alert" className="pd-error">
          {t(state.error)}
        </p>
      )}
      {!!state.catalog?.unavailable && (
        <p role="status">
          {state.catalog.unavailable}{' '}
          {t('marivo.presentation.report-records-could-not-be-read-and-are-omitted')}
        </p>
      )}
      {!state.loading && !state.error && reports.length === 0 && (
        <p className="pd-empty">
          {state.query
            ? t('marivo.presentation.no-reports-match-this-title')
            : t('marivo.presentation.this-workspace-has-no-published-reports')}
        </p>
      )}
      {reports.length > 0 && (
        <section
          className="pd-report-scroll"
          aria-label={t('marivo.presentation.report-list')}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: The scroll region needs keyboard access to all three columns in narrow panes.
          tabIndex={0}
        >
          <table className="pd-report-table">
            <thead>
              <tr>
                <th scope="col">{t('marivo.presentation.report-title')}</th>
                <th scope="col">{t('marivo.presentation.source-conversation')}</th>
                <th scope="col">{t('marivo.presentation.updated')}</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((version) => (
                <tr key={version.receipt.reportId}>
                  <td>
                    <Button
                      type="button"
                      className="pd-link pd-report-title"
                      title={version.receipt.title}
                      onClick={() =>
                        void reader.showReport(state.workspaceId, version.receipt.reportId)
                      }
                    >
                      {version.receipt.title}
                    </Button>
                  </td>
                  <td>
                    <ReportSource
                      version={version}
                      sessions={sessions}
                      onOpenSession={onOpenSession}
                      showKind={false}
                    />
                  </td>
                  <td>
                    <time dateTime={version.publishedAt}>
                      {publicationTime(version.publishedAt, t.locale)}
                    </time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
export function ReportHistoryPanel({ state, model, sessions, onOpenSession }) {
  const t = useCopy()

  return (
    <aside className="mv-ui pd-history" aria-label={t('marivo.presentation.history')}>
      <h3>{t('marivo.presentation.history')}</h3>
      {state.historyLoading && <p role="status">{t('marivo.presentation.loading-history')}</p>}
      {state.historyError && (
        <p role="alert" className="pd-error">
          {t(state.historyError)}
        </p>
      )}
      <ol>
        {state.history?.versions.map((version) => (
          <li key={version.receipt.buildId}>
            <Button
              type="button"
              className="pd-version"
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
    </aside>
  )
}

export const catalogStyles =
  UI_STYLES +
  `
.pd-catalog{padding:16px;color:var(--mv-text);background:var(--mv-bg);container-type:inline-size}.pd-catalog-controls{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.pd-category{display:flex;align-items:center;gap:6px;flex-shrink:0}.pd-category select{font:inherit;color:inherit;min-height:36px;padding:6px 10px;border:1px solid var(--mv-control-border);border-radius:6px;background:var(--mv-bg)}.pd-catalog input,.pd-catalog button,.pd-history button{font:inherit;color:inherit}.pd-catalog input{flex:1 1 240px;width:100%;min-width:0;min-height:36px;padding:6px 10px;border:1px solid var(--mv-control-border);border-radius:6px;background:var(--mv-bg)}
.pd-catalog button,.pd-history button{cursor:pointer;background:var(--mv-bg);border:1px solid var(--mv-border);min-height:32px;padding:5px 10px;border-radius:6px}.pd-report-scroll{overflow-x:auto;margin-top:16px}.pd-report-table{font-variant-numeric:tabular-nums;line-height:18px;width:100%;min-width:540px;table-layout:fixed;border-collapse:collapse;font-size:12px}.pd-report-table th{text-align:left;font-weight:500;color:var(--mv-muted)}.pd-report-table th,.pd-report-table td{padding:14px 10px;vertical-align:middle;border-bottom:1px solid var(--mv-border);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pd-report-table th:first-child{width:48%}.pd-report-table th:last-child{width:180px}.pd-report-table button.pd-link,.pd-report-table .pd-source{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pd-link{display:inline;min-height:24px!important;border:0!important;background:transparent!important;padding:0!important;color:var(--mv-accent)!important;text-align:left;cursor:pointer;font:inherit;text-decoration:underline;text-underline-offset:3px}.pd-report-title{font-size:14px!important;font-weight:500}.pd-source{font-size:12px;line-height:18px;overflow-wrap:anywhere}.pd-empty{padding:64px 0;text-align:center}.pd-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
.pd-history{position:sticky;top:70px;flex:0 0 270px;box-sizing:border-box;padding:16px;border-right:1px solid var(--mv-border);max-height:75vh;overflow:auto}.pd-history h3{margin:0 0 16px;font-size:15px;line-height:22px;font-weight:600}.pd-history ol{list-style:none;padding:0;margin:0}.pd-history li{margin-bottom:20px}.pd-history button.pd-version{display:grid;justify-content:stretch;align-items:stretch;gap:8px;width:100%;text-align:left;margin-bottom:7px}.pd-version span{font-size:12px;overflow-wrap:anywhere}.pd-version[aria-pressed=true]{border-color:var(--mv-accent);background:var(--mv-soft)}.pd-history button:disabled{opacity:.5;cursor:default}.pd-catalog button:focus-visible,.pd-history button:focus-visible,.pd-link:focus-visible{outline:2px solid var(--mv-focus);outline-offset:3px}
@container(max-width:650px){.pd-catalog-controls{flex-wrap:wrap}.pd-history{position:static;flex:auto;width:100%;max-height:260px;border-right:0;border-bottom:1px solid var(--mv-border)}.pd-catalog{padding:12px}}
`
