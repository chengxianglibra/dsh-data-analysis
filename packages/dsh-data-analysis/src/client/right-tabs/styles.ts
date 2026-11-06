/** Content layout inside the native Host right-side tab. */
export const rightTabStyles = `
.rt-page{height:100%;width:100%;min-width:0;overflow:auto;padding:1rem;box-sizing:border-box;container-type:inline-size}
.rt-heading-row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:.25rem}
.rt-heading{margin:0;font-size:1.25rem;line-height:1.4;font-weight:600;overflow-wrap:anywhere}
.rt-heading-row>button{flex:none}
.rt-caption{color:var(--muted-foreground);font-size:.875rem;margin:0 0 1.5rem;overflow-wrap:anywhere}
.rt-report-surface{position:relative;min-width:0}
.rt-report-surface .au-surface-title{padding-right:3rem}
.rt-toolbar{position:absolute;top:1rem;right:1rem;z-index:1}
.rt-actions-menu{z-index:100;min-width:13rem;max-width:min(22rem,calc(100vw - 2rem));padding:.35rem;border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--popover);color:var(--popover-foreground);box-shadow:0 8px 24px #0002;font-size:.875rem}
.rt-actions-item{padding:.5rem .65rem;border-radius:var(--radius-md);cursor:pointer;outline:none}
.rt-actions-item[data-highlighted]{background:var(--accent);color:var(--accent-foreground)}
.rt-actions-item[data-disabled]{opacity:.5;cursor:default}
.rt-actions-note{color:var(--muted-foreground);font-size:.75rem;margin:.5rem .65rem;white-space:normal}
.rt-notice{display:flex;align-items:center;flex-wrap:wrap;gap:.75rem;margin-bottom:1rem}
.rt-page .pd-catalog{padding:0;overflow:auto}
.rt-page .pd-history{position:static;max-height:300px;margin-bottom:1rem;width:100%}
`
