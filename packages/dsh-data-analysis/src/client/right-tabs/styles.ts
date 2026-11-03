/** Content layout inside the native Host right-side tab. */
export const rightTabStyles = `
.rt-page{height:100%;width:100%;min-width:0;overflow:auto;padding:1rem;box-sizing:border-box;container-type:inline-size}
.rt-heading-row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:.25rem}
.rt-heading{margin:0;font-size:1.25rem;line-height:1.4;font-weight:600;overflow-wrap:anywhere}
.rt-heading-row>button{flex:none}
.rt-caption{color:var(--muted-foreground);font-size:.875rem;margin:0 0 1.5rem;overflow-wrap:anywhere}
.rt-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:.75rem;margin-bottom:1rem}
.rt-toolbar>span{color:var(--muted-foreground);font-size:.875rem}
.rt-notice{display:flex;align-items:center;flex-wrap:wrap;gap:.75rem;margin-bottom:1rem}
.rt-page .pd-catalog{padding:0;overflow:auto}
.rt-page .pd-history{position:static;max-height:300px;margin-bottom:1rem;width:100%}
`
