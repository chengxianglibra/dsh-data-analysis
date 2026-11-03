/** Domain reading rules; primitive visuals are supplied by the scoped shadcn stylesheet. */
export const PRESENTATION_STYLES = `
.pr-reader{box-sizing:border-box;width:100%;min-width:0;overflow-wrap:anywhere}
.pr-markdown p{white-space:pre-wrap}
.pr-markdown pre{max-width:100%;overflow:auto;background:var(--muted);padding:1rem;border-radius:var(--radius-lg);font:0.8125rem/1.65 var(--mv-font-mono,ui-monospace,monospace)}
.pr-markdown code{font-family:var(--mv-font-mono,ui-monospace,monospace);font-size:.9em;background:var(--muted);padding:2px 4px;border-radius:var(--radius-sm)}
.pr-markdown pre code{padding:0}
.pr-markdown blockquote{border-left:2px solid var(--border);padding-left:1rem;margin:1rem 0;color:var(--muted-foreground)}
.pr-markdown hr{border:0;border-top:1px solid var(--border);margin:1.5rem 0}
.pr-markdown ul,.pr-markdown ol{padding-left:1.25rem}
.pr-markdown li+li{margin-top:.375rem}
.pr-table{min-width:0;display:flex;flex-direction:column;gap:1rem}
.pr-table-scroll{max-width:100%;overflow:auto}.pr-table-scroll>[data-slot=table-container]{overflow:visible}
.pr-table :is(th,td){min-width:90px;max-width:400px}
.pr-table td{white-space:pre-wrap;overflow-wrap:anywhere}
.pr-table .pr-numeric{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.pr-table td[data-cell-null=true]{color:var(--muted-foreground)}
.pr-table th.pr-numeric button{margin-left:auto}
.pr-column-label{white-space:normal;overflow-wrap:anywhere}
.pr-sort-indicator{flex:none}
.pr-cell-select{max-width:100%;white-space:normal}
.pr-pagination{display:flex;gap:.75rem;align-items:center;justify-content:flex-end;flex-wrap:wrap}
.pr-pagination>span{color:var(--muted-foreground);font-size:.875rem}
@media print{.pr-table-scroll{overflow:visible}.pr-table table{table-layout:fixed;width:100%;font-size:8pt}.pr-table :is(th,td){min-width:0;white-space:pre-wrap!important;overflow-wrap:anywhere}.pr-table tr{break-inside:avoid}.pr-table thead{display:table-header-group}.pr-reader pre{white-space:pre-wrap}}
`
