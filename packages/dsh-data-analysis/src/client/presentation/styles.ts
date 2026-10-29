export const PRESENTATION_STYLES = `
.pr-reader {
  --pr-bg:#fff; --pr-soft:#f7f7f8; --pr-text:#242424; --pr-muted:#666;
  --pr-border:#e5e5e7; --pr-accent:#3567b7; --pr-warning:#805b20;
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
.pr-notice { color:var(--pr-warning); font-size:13px; border-left:2px solid currentColor; padding-left:12px }
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
@media(prefers-color-scheme:dark) {
  .pr-reader { --pr-bg:#1c1c1f; --pr-soft:#262629; --pr-text:#ededed; --pr-muted:#aaa; --pr-border:#39393e; --pr-accent:#91b7f3; --pr-warning:#e3bb70; color-scheme:dark }
}
.dark .pr-reader,[data-theme=dark] .pr-reader { --pr-bg:#1c1c1f; --pr-soft:#262629; --pr-text:#ededed; --pr-muted:#aaa; --pr-border:#39393e; --pr-accent:#91b7f3; --pr-warning:#e3bb70; color-scheme:dark }
.light .pr-reader,[data-theme=light] .pr-reader { --pr-bg:#fff; --pr-soft:#f7f7f8; --pr-text:#242424; --pr-muted:#666; --pr-border:#e5e5e7; --pr-accent:#3567b7; --pr-warning:#805b20; color-scheme:light }
@media(max-width:640px) {
  .pr-reader { padding:28px 20px; font-size:15px }
  .pr-reader h1 { font-size:26px }
  .pr-pagination { justify-content:space-between; gap:8px }
}
@media(pointer:coarse) { .pr-reader summary,.pr-reader button { min-height:44px } .pr-reader select,.pr-reader textarea { font-size:16px } }
@media print {
  .pr-reader { --pr-bg:#fff; --pr-soft:#fff; --pr-text:#111; --pr-muted:#444; --pr-border:#bbb; --pr-accent:#222; --pr-warning:#333; max-width:none; padding:0; font-size:10pt; color-scheme:light }
  .pr-reader h1,.pr-reader h2,.pr-reader h3 { break-after:avoid }
  .pr-table-scroll { overflow:visible }
  .pr-table table { table-layout:fixed; width:100%; font-size:8pt }
  .pr-table caption { padding-left:5px; padding-right:5px }
  .pr-table th,.pr-table td { min-width:0; padding:5px; white-space:pre-wrap!important; overflow-wrap:anywhere }
  .pr-table tr { break-inside:avoid }
  .pr-table thead { display:table-header-group }
  .pr-reader pre { white-space:pre-wrap }
}
`
