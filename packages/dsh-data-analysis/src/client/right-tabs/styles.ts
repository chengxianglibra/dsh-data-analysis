/** Content layout inside the native Host right-side tab. */
export const rightTabStyles = `
.rt-page{height:100%;width:100%;min-width:0;overflow:auto;padding:1rem;box-sizing:border-box;container-type:inline-size}
.rt-heading-row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:.25rem}
.rt-heading{margin:0;font-size:1.25rem;line-height:1.4;font-weight:600;overflow-wrap:anywhere}
.rt-heading-row>button{flex:none}
.rt-caption{color:var(--muted-foreground);font-size:.875rem;margin:0 0 1.5rem;overflow-wrap:anywhere}
.rt-report-surface{position:relative;min-width:0}
.rt-toolbar{position:absolute;top:1rem;right:1rem;z-index:1}
.rt-report-surface:has(.rt-toolbar) .au-surface-content>:first-child:not(.au-surface-body),
.rt-report-surface:has(.rt-toolbar) .au-surface-body:first-child>[aria-busy]>div>:not(.au-stack[data-direction=column]),
.rt-report-surface:has(.rt-toolbar) .au-surface-body:first-child>[aria-busy]>div>.au-stack[data-direction=column]>:first-child{box-sizing:border-box;padding-right:3rem}
.rt-actions-menu{z-index:100;min-width:13rem;max-width:min(22rem,calc(100vw - 2rem));padding:.35rem;border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--popover);color:var(--popover-foreground);box-shadow:0 8px 24px #0002;font-size:.875rem}
.rt-actions-item{padding:.5rem .65rem;border-radius:var(--radius-md);cursor:pointer;outline:none}
.rt-actions-item[data-highlighted]{background:var(--accent);color:var(--accent-foreground)}
.rt-actions-item[data-disabled]{opacity:.5;cursor:default}
.rt-dialog-overlay{position:fixed;inset:0;background:#0008;z-index:200}
.rt-dialog{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:201;width:min(28rem,calc(100vw - 2rem));box-sizing:border-box;padding:1.25rem;border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--popover);color:var(--popover-foreground);box-shadow:0 8px 24px #0003}
.rt-dialog h2{font-size:1.1rem;font-weight:600;margin:0 0 .75rem}.rt-dialog p{margin:0;overflow-wrap:anywhere;line-height:1.5}
.rt-dialog-actions{display:flex;justify-content:flex-end;gap:.5rem;margin-top:1.25rem}
.rt-export-notice{position:absolute;top:calc(100% + .5rem);right:0;z-index:101;display:flex;align-items:center;gap:.5rem;width:max-content;max-width:min(22rem,calc(100vw - 2rem));box-sizing:border-box;padding:.75rem;border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--popover);color:var(--popover-foreground);box-shadow:0 8px 24px #0002;font-size:.875rem;line-height:1.4}
.rt-export-notice>svg{width:1rem;height:1rem;flex:none;color:var(--primary)}
.rt-export-notice-error>svg{color:var(--destructive)}
.rt-export-notice button{width:1.75rem;height:1.75rem;flex:none;margin:-.375rem -.375rem -.375rem 0}
.rt-notice{display:flex;align-items:center;flex-wrap:wrap;gap:.75rem;margin-bottom:1rem}
.rt-page .pd-catalog{padding:0;overflow:auto}
.rt-page .pd-history{position:static;max-height:300px;margin-bottom:1rem;width:100%}
`
