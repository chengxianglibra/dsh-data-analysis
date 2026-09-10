import { CHART_STYLES } from './chart-styles.ts'

export const PRESENTATION_STYLES = `
.pr-reader {
  --pr-bg:#fff; --pr-soft:#f7f7f8; --pr-text:#242424; --pr-muted:#666;
  --pr-code-keyword:#8a3294; --pr-code-string:#216b43; --pr-code-number:#995119; --pr-code-function:#285d9e;
  --pr-border:#e5e5e7; --pr-accent:#3567b7; --pr-warning:#805b20;
  --pr-chart-1:#286dee; --pr-chart-2:#ba7039; --pr-chart-3:#548878;
  --pr-chart-muted:#96969b; --pr-chart-grid:rgba(13,13,13,.06); --pr-chart-hover:rgba(13,13,13,.03); --pr-chart-4:#8d6cb0; --pr-chart-5:#b46379; --pr-chart-6:#727c38;
  box-sizing:border-box; margin:0 auto; padding:48px clamp(20px,4%,64px); width:100%; max-width:none; min-width:0;
  color:var(--pr-text); background:var(--pr-bg); font:16px/1.65 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  overflow-wrap:anywhere; color-scheme:light;
}
.pr-reader * { box-sizing:border-box }
.pr-reader h1,.pr-reader h2,.pr-reader h3,.pr-reader h4 { line-height:1.4; font-weight:600; text-wrap:balance }
.pr-reader h1 { font-size:30px; margin:0 0 12px; letter-spacing:-.025em }
.pr-reader h2 { font-size:21px; margin:0 0 16px }
.pr-reader h3 { font-size:17px; margin:0 0 12px }
.pr-reader p { margin:10px 0 }
.pr-reader button,.pr-reader select,.pr-reader textarea { font:inherit; color:inherit }
.pr-reader button,.pr-reader select { border:1px solid var(--pr-border); border-radius:8px; background:var(--pr-bg); padding:6px 10px; max-width:100% }
.pr-reader button { cursor:pointer }
.pr-reader button:hover { background:var(--pr-soft) }
.pr-reader button:disabled { opacity:.45; cursor:default }
.pr-reader :focus-visible { outline:3px solid var(--pr-accent); outline-offset:3px }
.pr-reader a { color:var(--pr-accent); text-decoration:underline; text-underline-offset:3px }
.pr-reader summary { cursor:pointer; color:var(--pr-muted); padding:8px 0; font-size:13px }
.pr-reader summary:hover { color:var(--pr-text) }
.pr-reader details[open]>summary { margin-bottom:8px }
.pr-muted { color:var(--pr-muted); font-size:13px }
.pr-title-row{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.pr-title-row>h1,.pr-title-row>.pr-report-title-editor{flex:1;min-width:0;margin-top:0}.pr-export-menu{display:flex;align-items:center;gap:8px;position:relative;flex:none;z-index:6}.pr-report-version{font:12px/34px ui-monospace,monospace;color:var(--pr-muted)}.pr-export-menu .pr-menu-divider{border-top:1px solid var(--pr-border);margin-top:4px;padding-top:10px}.pr-export-menu small{display:block;font-size:12px;color:var(--pr-muted);margin-top:3px}.pr-export-menu .pr-cell-menu-popup{min-width:240px}.pr-export-menu .pr-icon-button{width:34px;height:34px}
.pr-header { padding-bottom:28px; margin-bottom:32px; border-bottom:1px solid var(--pr-border) }
.pr-blocks { display:flex; flex-direction:column; gap:32px }
.pr-block { min-width:0; position:relative }
.pr-block-markdown { padding:0; width:100% }
.pr-block-chart { padding:0; border:0; border-radius:0 }
.pr-block-chart>h2 { font-size:17px }
.pr-chart-row { display:flex; flex-direction:column; gap:32px; min-width:0 }
.pr-chart-row>.pr-block-chart { width:100% }
.pr-reader[data-mode=interactive] .pr-chart-row { flex-direction:row; flex-wrap:wrap; align-items:flex-start }
.pr-reader[data-mode=interactive] .pr-chart-row>.pr-block-chart { flex:1 1 calc((100% - 32px)/2); min-width:min(100%,560px); max-width:100% }
.pr-reader[data-mode=interactive] .pr-chart-row>.pr-block-chart[data-chart-layout=wide] { min-width:min(100%,720px) }
.pr-metric-group { display:flex; flex-wrap:wrap; gap:16px; min-width:0 }
.pr-metric-group>.pr-block-metric { flex:1 1 240px; min-width:min(100%,240px); max-width:min(100%,480px) }
.pr-block-metric { border:1px solid var(--pr-border); border-radius:14px; padding:20px; display:flex; flex-direction:column; gap:4px }
.pr-block-metric h2 { font-size:13px; font-weight:500; color:var(--pr-muted); margin:0 }
.pr-metric-value { font-size:clamp(24px,3vw,32px); font-variant-numeric:tabular-nums; font-weight:600; line-height:1.35; letter-spacing:-.025em }
.pr-metric-value { white-space:nowrap; overflow-x:auto; max-width:100% }
.pr-metric-comparisons { display:grid; gap:12px; margin-top:auto; padding-top:12px }
.pr-metric-comparison { display:flex; flex-wrap:wrap; gap:4px 10px; border-top:1px solid var(--pr-border); padding-top:10px; font-size:13px; font-variant-numeric:tabular-nums }
.pr-metric-comparison>.pr-muted { flex-basis:100% }
.pr-metric-change { display:flex; flex-wrap:wrap; gap:4px 8px }
.pr-metric-change-positive { color:#167044 }
.pr-metric-change-negative { color:#b42318 }
.pr-metric-change-neutral { color:var(--pr-muted) }
.pr-notice { color:var(--pr-warning); font-size:13px; border-left:2px solid currentColor; padding-left:12px }
.pr-empty { padding:24px; text-align:center; color:var(--pr-muted); background:var(--pr-soft); border-radius:8px }
.pr-markdown p { white-space:pre-wrap }
.pr-markdown pre { max-width:100%; overflow:auto; background:var(--pr-soft); padding:16px; border-radius:8px; font:13px/1.65 ui-monospace,monospace }
.pr-markdown code { font-family:ui-monospace,monospace; font-size:.9em; background:var(--pr-soft); padding:2px 4px; border-radius:3px }
.pr-markdown pre code { padding:0 }
.pr-markdown blockquote { border-left:3px solid var(--pr-border); padding-left:18px; margin:16px 0; color:var(--pr-muted) }
.pr-markdown hr { border:0; border-top:1px solid var(--pr-border); margin:24px 0 }
.pr-markdown ul,.pr-markdown ol { padding-left:24px }
.pr-markdown li+li { margin-top:6px }
.pr-table-scroll { max-width:100%; overflow:auto }
.pr-table table { border-collapse:collapse; min-width:100%; font-size:13px }
.pr-table caption { text-align:left; font-size:12px; color:var(--pr-muted); padding:8px 12px }
.pr-table th,.pr-table td { padding:12px; text-align:left; border-bottom:1px solid var(--pr-border); vertical-align:top; white-space:pre-wrap; overflow-wrap:anywhere; min-width:90px; max-width:400px }
.pr-table th { font-weight:500; color:var(--pr-muted) }
.pr-table th button { position:relative; font-weight:500; padding:0; text-align:inherit; border:0; background:transparent; border-radius:0 }
.pr-table th.pr-numeric { text-align:right }
.pr-sort-indicator { position:absolute; left:calc(100% + 3px); top:0; font-size:11px; line-height:inherit }
.pr-table tbody tr:hover { background:var(--pr-soft) }
.pr-table td.pr-numeric { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap }
.pr-table td[data-cell-null=true] { color:var(--pr-muted) }
.pr-pagination { display:flex; gap:12px; align-items:center; justify-content:flex-end; flex-wrap:wrap; margin-top:12px; font-size:12px }
.pr-diagnostics { margin:0 0 28px; padding:16px; background:var(--pr-soft); border-radius:10px; font-size:13px }
.pr-diagnostics h2 { font-size:14px; margin:0 }
.pr-diagnostics ul { padding-left:20px }
.pr-legend { display:flex; flex-wrap:wrap; gap:8px 16px; margin:8px 0 0; justify-content:center }
.pr-legend button { display:flex; align-items:center; gap:7px; font-size:12px; border:0; padding:4px 0; background:transparent }
.pr-legend button[aria-pressed=false] { opacity:.5; text-decoration:line-through }
.pr-swatch { display:inline-block; width:9px; height:9px; border-radius:50%; flex-shrink:0 }
.pr-chart { margin:0; width:100%; min-width:0; height:320px }
.pr-chart svg { overflow:visible }
.pr-chart-group+.pr-chart-group { margin-top:24px }
.pr-chart .recharts-cartesian-axis-tick-value { font-variant-numeric:tabular-nums }
.pr-tooltip { padding:10px 13px; border:1px solid var(--pr-border); border-radius:10px; background:var(--pr-bg); color:var(--pr-text); font-size:12px; box-shadow:0 4px 18px #0001; max-width:min(420px,80vw) }
.pr-tooltip dl { margin:5px 0 0 }
.pr-tooltip dl>div { display:flex; flex-wrap:wrap; justify-content:space-between; gap:6px 20px }
.pr-tooltip dt { color:var(--pr-muted) }
.pr-tooltip dd { margin:0; font-variant-numeric:tabular-nums; overflow-wrap:anywhere }

.pr-cell-toolbar { position:absolute; top:0; right:0; display:flex; align-items:center; gap:4px; z-index:2 }
.pr-block-metric>.pr-cell-toolbar { top:12px; right:12px }
.pr-block-metric>h2,.pr-block-chart>h2 { padding-right:32px }
.pr-block-markdown .pr-markdown>:first-child { padding-right:40px }
.pr-reader[data-mode=interactive] .pr-block-table { padding-top:30px }
.pr-block-source>h2 { padding-right:40px }
.pr-reader .pr-icon-button { display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; padding:5px; border:0; background:transparent; color:var(--pr-muted); border-radius:6px; flex-shrink:0 }
.pr-reader .pr-icon-button:hover { background:var(--pr-soft); color:var(--pr-text) }
.pr-icon-button svg { width:18px; height:18px; display:block }
.pr-copy,.pr-cell-menu { position:relative; display:inline-flex; align-items:center }
.pr-copy-status { position:absolute; right:0; top:calc(100% + 4px); white-space:nowrap; font-size:12px; background:var(--pr-bg); color:var(--pr-text); border-radius:5px }
.pr-copy-status:not(:empty) { padding:4px 8px; border:1px solid var(--pr-border); box-shadow:0 2px 8px #0001 }
.pr-cell-menu-popup { position:absolute; right:0; top:calc(100% + 4px); min-width:136px; padding:4px; background:var(--pr-bg); border:1px solid var(--pr-border); border-radius:10px; box-shadow:0 6px 24px #0002; z-index:3 }
.pr-cell-menu-popup>button { display:block; width:100%; border:0; border-radius:6px; text-align:left; font-size:13px; padding:8px 12px; white-space:nowrap }
.pr-cell-menu-popup>button[aria-disabled=true] { color:var(--pr-muted); cursor:not-allowed }
.pr-cell-menu-popup>button small { display:block; font-size:12px; font-weight:normal }
.pr-source-dialog,.pr-dialog { color:var(--pr-text); background:var(--pr-bg); border:1px solid var(--pr-border); border-radius:24px; width:min(800px,calc(100vw - 48px)); max-width:none; max-height:min(760px,calc(100dvh - 48px)); margin:auto; padding:0; box-shadow:0 18px 70px #0003; font:14px/1.6 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; overflow:hidden }
.pr-source-dialog[open],.pr-dialog[open] { display:flex; flex-direction:column }
.pr-source-dialog-shell { display:flex; flex-direction:column; min-height:0; width:100% }
.pr-reader .pr-source-dialog-context { font-size:13px; color:var(--pr-muted); margin:4px 0 0 }
.pr-source-dialog::backdrop,.pr-dialog::backdrop { background:#0005 }
.pr-source-dialog-header,.pr-dialog-header { display:flex; justify-content:space-between; align-items:center; gap:16px; padding:20px 24px 4px; flex-shrink:0 }
.pr-source-dialog .pr-source-dialog-title,.pr-dialog-header h2 { font-size:24px; font-weight:500; margin:0 }
.pr-reader .pr-source-dialog-close { width:32px; height:32px; border:0; padding:6px; background:transparent; color:var(--pr-muted); flex-shrink:0 }
.pr-source-dialog-close svg { width:18px; height:18px }
.pr-source-tabs { display:flex; gap:28px; padding:0 24px; border-bottom:1px solid var(--pr-border); flex-shrink:0 }
.pr-reader .pr-source-tab { padding:14px 0; border:0; border-bottom:2px solid transparent; border-radius:0; background:transparent; color:var(--pr-muted); font-size:14px }
.pr-reader .pr-source-tab[aria-selected=true] { color:var(--pr-text); border-bottom-color:var(--pr-text) }
.pr-source-dialog-body { padding:20px 24px 24px; overflow:auto; min-height:0; overscroll-behavior:contain }
.pr-source-overview { font-size:14px; min-width:0 }
.pr-source-overview-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:20px 24px; margin:0 0 24px }
.pr-source-overview-grid>div { min-width:0 }
.pr-source-overview-grid dt { color:var(--pr-muted); font-size:13px; margin:0 0 4px }
.pr-source-overview-label { color:var(--pr-muted); font-size:13px; font-weight:400; margin:0 0 4px }
.pr-source-overview dd { margin:0; overflow-wrap:anywhere }
.pr-source-field-section { margin-bottom:24px }
.pr-source-fields { width:100%; border-collapse:collapse; font-size:13px; text-align:left }
.pr-source-fields th,.pr-source-fields td { padding:8px 12px; border-bottom:1px solid var(--pr-border); vertical-align:top }
.pr-source-fields th { color:var(--pr-muted); font-weight:500 }
.pr-artifact-details { margin-bottom:16px; overflow-wrap:anywhere }
.pr-artifact-details summary { cursor:pointer; margin-bottom:12px }
.pr-artifact-details summary span { color:var(--pr-accent); text-decoration:underline }
.pr-source-list { display:flex; flex-direction:column; gap:24px }
.pr-source-card { min-width:0 }
.pr-source-card+.pr-source-card { border-top:1px solid var(--pr-border); padding-top:20px }
.pr-source-card h3 { font-size:14px; margin:0 0 12px; font-weight:500 }
.pr-source-semantic-group { margin-top:16px }
.pr-source-semantic-list { display:flex; flex-wrap:wrap; gap:6px; list-style:none; padding:0; margin:4px 0 16px }
.pr-source-semantic-list>li { border:1px solid var(--pr-border); border-radius:14px; padding:2px 8px; overflow-wrap:anywhere; max-width:100%; font-size:13px }
.pr-reader .pr-semantic-link { font:inherit; color:var(--pr-accent); background:none; border:0; padding:0; cursor:pointer; text-align:left; overflow-wrap:anywhere; text-decoration:underline; text-underline-offset:3px }
.pr-reader .pr-semantic-link:focus-visible { outline:2px solid var(--pr-accent); outline-offset:3px; border-radius:3px }
.pr-source-issues { margin:12px 0 0; color:var(--pr-warning); font-size:13px }
.pr-source-summary { margin-top:32px; padding-top:16px; border-top:1px solid var(--pr-border) }
.pr-source-summary>summary { font-size:14px }
.pr-source-code { display:flex; flex-direction:column; gap:20px; min-width:0 }
.pr-source-code-snippet { min-width:0 }
.pr-source-code-header { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:8px; margin-bottom:8px }
.pr-source-code-header h3 { margin:0; font-size:14px; font-weight:500 }
.pr-source-code-copy { display:flex; flex-wrap:wrap; align-items:center; gap:8px; font-size:12px; color:var(--pr-muted) }
.pr-reader .pr-source-code-note { margin:0 0 8px; font-size:12px; color:var(--pr-muted) }
.pr-source-code-copy button { font-size:12px }
.pr-source-code pre { margin:0; padding:14px 16px; border:1px solid var(--pr-border); border-radius:10px; background:var(--pr-soft); max-height:420px; overflow:auto; white-space:pre; tab-size:4; user-select:text; font:12px/1.7 ui-monospace,SFMono-Regular,Consolas,monospace }
.pr-source-code-summary { margin-top:20px }
.pr-source-code-summary>summary { margin-bottom:12px; font-size:14px }
.pr-copy-dialog { max-width:640px; padding-bottom:24px; overflow:auto }
.pr-copy-dialog>p,.pr-copy-dialog>label { margin:16px 24px }
.pr-copy-dialog textarea { display:block; width:calc(100% - 48px); min-height:220px; max-height:50vh; margin:16px 24px 0; padding:12px; background:var(--pr-soft); color:var(--pr-text); border:1px solid var(--pr-border); border-radius:8px; font:13px/1.65 ui-monospace,monospace; resize:vertical }

.pr-chart-explorer { margin:18px 0; padding:20px; border:1px solid var(--pr-border); border-radius:12px; background:var(--pr-soft); font-size:13px; min-width:0 }
.pr-explorer-header { display:flex; justify-content:space-between; gap:12px; align-items:flex-start }
.pr-explorer-header h3 { margin:0 }
.pr-explorer-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr)); gap:14px; margin:14px 0 }
.pr-explorer-grid>label { display:flex; flex-direction:column; gap:6px; min-width:0 }
.pr-explorer-grid select { width:100%; min-width:0 }
.pr-explorer-fields { border:0; border-top:1px solid var(--pr-border); padding:12px 0 0; margin:16px 0 0; min-width:0 }
.pr-explorer-fields legend { font-weight:600; padding:0 8px 0 0 }
.pr-explorer-series { display:flex; align-items:center; flex-wrap:wrap; gap:10px; margin:8px 0 }
.pr-explorer-series label { display:flex; align-items:center; gap:6px }
.pr-explorer-series input { accent-color:var(--pr-accent); min-width:16px; min-height:16px }
.pr-explorer-visible { color:var(--pr-muted) }
.pr-explorer-footer { margin-top:16px; display:flex; justify-content:flex-end }
.pr-host-print { display:none }

.pr-host { min-width:0 }
.pr-host-actions { display:flex; gap:10px; justify-content:flex-end; padding:12px }
body[data-presentation-portable] { margin:0; background:#fff }
html[data-presentation-ready=true] body[data-presentation-portable] #presentation-fallback { display:none }
@media(prefers-color-scheme:dark) {
  body[data-presentation-portable] { background:#1c1c1f }
  .pr-reader { --pr-code-keyword:#d9a0e5; --pr-code-string:#99cda7; --pr-code-number:#ebbb8a; --pr-code-function:#9bbef3; --pr-bg:#1c1c1f; --pr-soft:#262629; --pr-text:#ededed; --pr-muted:#aaa; --pr-border:#39393e; --pr-accent:#91b7f3; --pr-warning:#e3bb70; --pr-chart-1:#8cb0ed; --pr-chart-2:#dbab7f; --pr-chart-3:#8ec0a9; --pr-chart-muted:#a0a0a6; --pr-chart-grid:rgba(255,255,255,.08); --pr-chart-hover:rgba(255,255,255,.04); --pr-chart-4:#b7a0d6; --pr-chart-5:#d99bb0; --pr-chart-6:#b8be86; color-scheme:dark }
}
.dark .pr-reader,[data-theme=dark] .pr-reader { --pr-code-keyword:#d9a0e5; --pr-code-string:#99cda7; --pr-code-number:#ebbb8a; --pr-code-function:#9bbef3; --pr-bg:#1c1c1f; --pr-soft:#262629; --pr-text:#ededed; --pr-muted:#aaa; --pr-border:#39393e; --pr-accent:#91b7f3; --pr-warning:#e3bb70; --pr-chart-1:#8cb0ed; --pr-chart-2:#dbab7f; --pr-chart-3:#8ec0a9; --pr-chart-muted:#a0a0a6; --pr-chart-grid:rgba(255,255,255,.08); --pr-chart-hover:rgba(255,255,255,.04); --pr-chart-4:#b7a0d6; --pr-chart-5:#d99bb0; --pr-chart-6:#b8be86; color-scheme:dark }
.light .pr-reader,[data-theme=light] .pr-reader { --pr-bg:#fff; --pr-soft:#f7f7f8; --pr-text:#242424; --pr-muted:#666; --pr-border:#e5e5e7; --pr-accent:#3567b7; --pr-warning:#805b20; --pr-chart-1:#286dee; --pr-chart-2:#ba7039; --pr-chart-3:#548878; --pr-chart-muted:#96969b; --pr-chart-grid:rgba(13,13,13,.06); --pr-chart-hover:rgba(13,13,13,.03); --pr-chart-4:#8d6cb0; --pr-chart-5:#b46379; --pr-chart-6:#727c38; color-scheme:light }
@media(max-width:640px) {
  .pr-reader { padding:28px 20px; font-size:15px }
  .pr-reader h1 { font-size:26px }
  .pr-block-markdown h2 { font-size:20px }
  .pr-blocks { gap:26px }
  .pr-source-dialog,.pr-dialog { width:calc(100vw - 24px); max-height:calc(100dvh - 24px); border-radius:18px }
  .pr-source-dialog-header,.pr-dialog-header { padding:16px 18px 4px }
  .pr-source-tabs { padding:0 18px }
  .pr-source-dialog-body { padding:18px }
  .pr-source-overview-grid { grid-template-columns:1fr; gap:16px }
  .pr-metric-group { gap:12px }
  .pr-block-metric { padding:16px }
  .pr-metric-value { font-size:25px }
  .pr-pagination { justify-content:space-between; gap:8px }
  .pr-tooltip { max-width:80vw }
}
@media(pointer:coarse) { .pr-reader summary,.pr-reader button { min-height:44px } .pr-reader .pr-icon-button { width:36px } .pr-block-metric>h2,.pr-block-chart>h2 { padding-right:44px } .pr-reader select,.pr-reader textarea { font-size:16px } }
@media print {
  .pr-host-live { display:none!important }
  .pr-host-print { display:block!important }
  html[data-presentation-ready=true] body[data-presentation-portable] #presentation-fallback,body[data-presentation-portable] #presentation-fallback { display:block!important }
  body[data-presentation-portable] #reader,.pr-interactive { display:none!important }
  .pr-reader { --pr-bg:#fff; --pr-soft:#fff; --pr-text:#111; --pr-muted:#444; --pr-border:#bbb; --pr-accent:#222; --pr-warning:#333; max-width:none; padding:0; font-size:10pt; color-scheme:light }
  .pr-blocks { display:block }
  .pr-block { border:0; padding:12px 0; border-radius:0 }
  .pr-block-markdown { max-width:none }
  .pr-block-metric>h2,.pr-block-chart>h2,.pr-block-markdown .pr-markdown>:first-child { padding-right:0 }
  .pr-source-summary::details-content { content-visibility:visible }
  .pr-source-summary>* { display:block }
  .pr-source-code-summary { display:none!important }
  .pr-source-dialog,.pr-dialog { display:none!important }
  .pr-metric-group { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)) }
  .pr-metric-group>.pr-block-metric { min-width:0; max-width:none }
  .pr-reader[data-mode] .pr-chart-row { display:block }
  .pr-reader[data-mode] .pr-chart-row>.pr-block-chart { min-width:0; max-width:none }
  .pr-header { break-after:avoid }
  .pr-reader h1,.pr-reader h2,.pr-reader h3 { break-after:avoid }
  .pr-table-scroll { overflow:visible }
  .pr-table table { table-layout:fixed; width:100%; font-size:8pt }
  .pr-table caption { padding-left:5px; padding-right:5px }
  .pr-table th,.pr-table td { min-width:0; padding:5px; white-space:pre-wrap!important; overflow-wrap:anywhere }
  .pr-table tr { break-inside:avoid }
  .pr-table thead { display:table-header-group }
  .pr-reader pre { white-space:pre-wrap }
}
.pr-region-label{color:var(--pr-muted);font-size:12px;letter-spacing:.02em;margin:0!important}
.pr-interaction-region{min-width:0}
.pr-region-divider{border:0;border-top:1px solid var(--pr-border);margin:0;width:100%}
@media print{.pr-region-divider{margin:20px 0}}
.pr-interaction-header{margin-bottom:28px}.pr-interaction-header h2{margin-bottom:4px}.pr-interaction-header>.pr-muted{margin:4px 0 16px}
.pr-filter-toolbar{border:0;padding:0;margin:0;min-width:0;display:flex;flex-wrap:wrap;gap:8px;align-items:center;position:relative;z-index:5}
.pr-filter-menu{position:relative;min-width:0;max-width:100%}
.pr-reader .pr-filter-trigger{display:flex;align-items:center;gap:8px;border-radius:999px;padding:5px 12px;min-height:34px;font-size:14px;line-height:22px;max-width:100%}
.pr-filter-label{color:var(--pr-muted);flex-shrink:0}.pr-filter-value{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px}
.pr-filter-popup{position:absolute;top:calc(100% + 6px);left:0;width:260px;max-width:calc(100vw - 80px);padding:8px;border:1px solid var(--pr-border);border-radius:12px;background:var(--pr-bg);box-shadow:0 8px 24px #0002;z-index:10;animation:pr-filter-in .12s ease-out}
.pr-filter-popup input{width:100%;min-width:0;padding:8px 10px;border:1px solid var(--pr-border);border-radius:7px;background:var(--pr-bg);color:var(--pr-text);font:inherit;font-size:14px;margin-bottom:6px}
.pr-filter-options{max-height:260px;overflow-y:auto}.pr-reader .pr-filter-options button{display:flex;justify-content:space-between;align-items:center;gap:12px;text-align:left;width:100%;border:0;border-radius:6px;padding:8px 10px;font-size:14px}
.pr-filter-options button[aria-checked=true]{background:var(--pr-soft);font-weight:600}
.pr-reader .pr-filter-reset{border:0;background:transparent;font-size:13px;color:var(--pr-muted)}
.pr-reader .pr-filter-status{font-size:12px;color:var(--pr-muted);margin:12px 0 0}
@keyframes pr-filter-in{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:translateY(0)}}
@media(prefers-reduced-motion:reduce){.pr-filter-popup{animation:none}}
@media(max-width:600px){.pr-filter-menu{width:100%}.pr-reader .pr-filter-trigger{width:100%;justify-content:space-between}.pr-filter-popup{width:100%;max-width:100%}}
${CHART_STYLES}

.pr-cell-editor{border:1px solid var(--pr-border);border-radius:8px;padding:12px;margin:8px 0 16px;min-width:0;background:var(--pr-soft)}
.pr-editor-actions{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}.pr-cell-editor label{display:block}.pr-cell-editor textarea{display:block;width:100%;min-height:120px;resize:vertical}.pr-cell-editor input:not([type=checkbox]),.pr-report-title-editor input{display:block;width:100%;min-width:0}.pr-cell-editor button{margin:4px;padding:5px 9px}.pr-cell-editor .pr-editor-column{display:inline-flex;align-items:center;gap:6px;margin:4px 12px 4px 0}
.pr-report-title-editor{display:block;font-weight:600}.pr-report-title-editor input{font:inherit;font-size:24px;padding:8px}
.pr-cell-editor input,.pr-cell-editor textarea,.pr-report-title-editor input{font-family:inherit;color:var(--pr-text);background:var(--pr-bg);border:1px solid var(--pr-border);border-radius:5px;padding:6px;box-sizing:border-box}
`
