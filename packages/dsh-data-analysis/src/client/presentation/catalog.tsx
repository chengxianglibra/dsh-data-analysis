// @ts-nocheck -- Host hooks and Session navigation are supplied by the module table.
import { useSyncExternalStore } from 'react'
import { visibleReports } from './catalog-model.ts'

export function publicationTime(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '保存时间未记录'
}
export function ReportSource({ version, sessions, onOpenSession, showKind = true }) {
  const id = version.source?.sessionId
  const session = id && sessions?.[id]
  return (
    <span className="pd-source">
      {showKind && version.source
        ? version.source.kind === 'agent'
          ? 'Agent 更新 · '
          : '阅读器编辑 · '
        : ''}
      {session && onOpenSession ? (
        <button
          type="button"
          className="pd-link"
          title={session.displayTitle}
          onClick={() => onOpenSession(id)}
        >
          {session.displayTitle}
        </button>
      ) : id ? (
        '来源会话不可用'
      ) : version.source?.kind === 'reader' ? (
        'Workspace 内保存'
      ) : (
        '来源未记录'
      )}
    </span>
  )
}
export function ReportCatalogView({ model, reader, sessions, onOpenSession }) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot)
  const reports = visibleReports(state)
  return (
    <div className="pd-catalog">
      <div className="pd-catalog-controls">
        <input
          type="search"
          aria-label="按标题搜索"
          value={state.query}
          placeholder="搜索此 Workspace 的报告"
          onChange={(e) => model.patch({ query: e.target.value })}
        />
      </div>
      {state.loading && <p role="status">正在读取报告列表…</p>}
      {state.error && (
        <p role="alert" className="pd-error">
          {state.error}
        </p>
      )}
      {!!state.catalog?.unavailable && (
        <p role="status">{state.catalog.unavailable} 份报告的记录不可读，未列入下方列表。</p>
      )}
      {!state.loading && !state.error && reports.length === 0 && (
        <p className="pd-empty">
          {state.query ? '没有匹配标题的报告。' : '此 Workspace 暂无已发布的报告。'}
        </p>
      )}
      {reports.length > 0 && (
        // biome-ignore lint/a11y/noNoninteractiveTabindex: The scroll region needs keyboard access to all three columns in narrow panes.
        <section className="pd-report-scroll" aria-label="报告列表" tabIndex={0}>
          <table className="pd-report-table">
            <thead>
              <tr>
                <th scope="col">报告标题</th>
                <th scope="col">生成对话</th>
                <th scope="col">更新时间</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((version) => (
                <tr key={version.receipt.reportId}>
                  <td>
                    <button
                      type="button"
                      className="pd-link pd-report-title"
                      title={version.receipt.title}
                      onClick={() =>
                        void reader.showReport(state.workspaceId, version.receipt.reportId)
                      }
                    >
                      {version.receipt.title}
                    </button>
                  </td>
                  <td>
                    <ReportSource
                      version={version}
                      sessions={sessions}
                      onOpenSession={onOpenSession}
                      showKind={false}
                    />
                  </td>
                  <td>{publicationTime(version.publishedAt)}</td>
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
  return (
    <aside className="pd-history" aria-label="历史版本">
      <h3>历史版本</h3>
      {state.historyLoading && <p role="status">正在读取历史…</p>}
      {state.historyError && (
        <p role="alert" className="pd-error">
          {state.historyError}
        </p>
      )}
      {state.history?.legacyHistoryUnavailable && (
        <p className="pd-muted">早期版本缺少发布记录，仅展示已确认的版本。</p>
      )}
      <ol>
        {state.history?.versions.map((version) => (
          <li key={version.receipt.buildId}>
            <button
              type="button"
              className="pd-version"
              aria-pressed={state.resolvedReceipt?.buildId === version.receipt.buildId}
              disabled={state.loading || !!state.editing || state.saving}
              onClick={() => void model.selectVersion(version.receipt.buildId)}
            >
              <strong>{publicationTime(version.publishedAt)}</strong>
              <span>
                {version.receipt.buildId === state.history.currentBuildId ? '当前版本' : '历史版本'}{' '}
                · {version.receipt.buildId.slice(0, 8)}
              </span>
              <span>{version.receipt.title}</span>
            </button>
            <ReportSource version={version} sessions={sessions} onOpenSession={onOpenSession} />
          </li>
        ))}
      </ol>
    </aside>
  )
}

export const catalogStyles = `
.pd-catalog{padding:20px}.pd-toolbar select{font:inherit;color:inherit;background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dsw-alias-border-l2,#dce5e5);border-radius:6px;padding:6px;max-width:100%}.pd-toolbar label{min-width:0;max-width:100%}.pd-catalog-controls{display:flex}.pd-catalog input,.pd-catalog button,.pd-history button{font:inherit;color:inherit}.pd-catalog input{width:100%;min-width:0;padding:9px 12px;border:1px solid var(--dsw-alias-border-l2,#dce5e5);border-radius:6px;background:var(--dsw-alias-bg-base,#fff)}
.pd-catalog button,.pd-history button{cursor:pointer;background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dsw-alias-border-l2,#dce5e5);padding:6px 10px;border-radius:6px}.pd-report-scroll{overflow-x:auto;margin-top:16px}.pd-report-table{width:100%;min-width:540px;table-layout:fixed;border-collapse:collapse;font-size:13px}.pd-report-table th{text-align:left;font-weight:500;color:var(--dsw-alias-label-secondary,#5b7076)}.pd-report-table th,.pd-report-table td{padding:14px 10px;vertical-align:middle;border-bottom:1px solid var(--dsw-alias-border-l2,#dce5e5);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pd-report-table th:first-child{width:48%}.pd-report-table th:last-child{width:180px}.pd-report-table .pd-link,.pd-report-table .pd-source{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pd-link{border:0!important;background:transparent!important;padding:0!important;color:var(--dsw-alias-state-business-primary,#087c71)!important;text-align:left;cursor:pointer;font:inherit;text-decoration:underline;text-underline-offset:3px}.pd-report-title{font-size:14px!important;font-weight:500}.pd-source{font-size:12px;overflow-wrap:anywhere}.pd-empty{padding:64px 0;text-align:center}.pd-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
.pd-reading-layout{display:flex;align-items:flex-start}.pd-reading-layout>.pd-reader{flex:1;min-width:0}.pd-history{position:sticky;top:70px;flex:0 0 270px;box-sizing:border-box;padding:16px;border-right:1px solid var(--dsw-alias-border-l2,#dce5e5);max-height:75vh;overflow:auto}.pd-history h3{margin:0 0 16px;font-size:15px}.pd-history ol{list-style:none;padding:0;margin:0}.pd-history li{margin-bottom:20px}.pd-version{display:grid;gap:7px;width:100%;text-align:left;margin-bottom:7px}.pd-version span{font-size:12px;overflow-wrap:anywhere}.pd-version[aria-pressed=true]{border-color:var(--dsw-alias-state-business-primary,#087c71);background:var(--dsw-alias-bg-module-platform,#f4f7f7)}.pd-history button:disabled{opacity:.5;cursor:default}.pd-catalog button:focus-visible,.pd-history button:focus-visible,.pd-link:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#087c71);outline-offset:3px}
@media(max-width:850px){.pd-reading-layout{flex-direction:column}.pd-history{position:static;flex:auto;width:100%;max-height:260px;border-right:0;border-bottom:1px solid var(--dsw-alias-border-l2,#dce5e5)}.pd-reading-layout>.pd-reader{width:100%;box-sizing:border-box}.pd-catalog{padding:12px}}
`
