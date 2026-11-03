import { UI_STYLES } from '../ui/theme.ts'
/** Host-only chrome for right-side tabs. */
export const rightTabStyles =
  UI_STYLES +
  `
.rt-page{height:100%;width:100%;min-width:0;overflow:auto;padding:16px;box-sizing:border-box;color:var(--mv-text);background:var(--mv-bg);container-type:inline-size}
.rt-page *{box-sizing:border-box}.rt-page h2{font-size:18px;line-height:26px;font-weight:600;overflow-wrap:anywhere}.rt-page .rt-heading{margin:0 0 4px}.rt-heading-row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px;margin-bottom:4px}.rt-page .rt-heading-row .rt-heading{margin:0}.rt-heading-row>button{flex:none}.rt-caption{color:var(--mv-muted);font-size:12px;margin:0 0 16px;overflow-wrap:anywhere}
.rt-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding-bottom:12px;border-bottom:1px solid var(--mv-border);margin-bottom:16px}
.rt-page button,.rt-page select,.rt-page input{font:inherit;color:inherit;max-width:100%}.rt-page button{cursor:pointer;border:1px solid var(--mv-control-border);background:var(--mv-bg);border-radius:6px;min-height:32px;padding:5px 12px}.rt-page button:hover:not(:disabled){background:var(--mv-soft)}.rt-page button:disabled{opacity:.5;cursor:default}.rt-page :focus-visible{outline:2px solid var(--mv-focus);outline-offset:3px}
.rt-page select{min-height:36px;padding:6px 10px;border:1px solid var(--mv-control-border);border-radius:6px;background:var(--mv-bg)}.rt-page [role=alert]{color:var(--mv-danger);overflow-wrap:anywhere}.rt-notice{padding:12px;border:1px solid var(--mv-border);border-radius:8px;background:var(--mv-soft)}
.rt-page .pd-catalog{padding:0;overflow:auto}.rt-page .pd-history{position:static;max-height:300px;border:1px solid var(--mv-border);border-radius:8px;margin-bottom:16px;width:100%}


`
