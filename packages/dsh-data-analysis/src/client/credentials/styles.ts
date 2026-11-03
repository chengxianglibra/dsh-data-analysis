/** Datasource arrangement and saved-property reading; controls use shadcn primitives. */
export const credentialStyles = `
.mc-panel{min-width:0;width:100%}
.mc-shell,.mc-columns,.mc-main,.mc-form{display:flex;flex-direction:column;min-width:0}
.mc-shell,.mc-columns,.mc-form-body{gap:1.5rem}
.mc-form{gap:1rem;flex:1}
.mc-form-body{display:flex;flex-direction:column;flex:1}
.mc-detail-heading,.mc-name-row,.mc-heading-actions,.mc-field-header,.mc-field-actions,.mc-test-heading,.mc-request-heading,.mc-progress{display:flex;align-items:center;flex-wrap:wrap;gap:.75rem;min-width:0}
.mc-detail-heading,.mc-name-row,.mc-field-header,.mc-test-heading{justify-content:space-between}
.mc-name-row{width:100%}
.mc-name-row h3{min-width:0;flex:1 1 180px}
.mc-heading-actions{flex:none}
.mc-test-heading>.mc-heading-actions{margin-left:auto}
.mc-detail-heading{margin-bottom:.5rem}
.mc-detail-heading h3{margin:0;font-size:1.25rem;line-height:1.4;font-weight:600;overflow-wrap:anywhere}
.mc-nav{min-width:0}
.mc-nav-heading{margin-bottom:.75rem;color:var(--muted-foreground);font-size:.875rem}
.mc-nav-heading h3{font:inherit;margin:0}
.mc-datasources{list-style:none;margin:0;padding:.25rem;display:flex;gap:.5rem;overflow-x:auto}
.mc-datasources li{flex:0 0 220px;max-width:260px}
.mc-datasource{width:100%;height:auto;align-items:flex-start;justify-content:flex-start;white-space:normal;text-align:left}
.mc-datasource>svg{flex:none}
.mc-datasource-copy{min-width:0;display:flex;flex-direction:column;gap:.375rem}
.mc-datasource-name{overflow-wrap:anywhere}
.mc-datasource-status{display:flex;align-items:center;gap:.375rem;font-size:.75rem;color:var(--muted-foreground)}
.mc-dot{width:6px;height:6px;background:var(--muted-foreground);border-radius:50%;flex:none}
.mc-dot[data-ready=true]{background:var(--mv-success)}
.mc-dot[data-ready=false]{background:var(--mv-warning)}
.mc-properties,.mc-fields{min-width:0}
.mc-property-list{margin:0;min-width:0}
.mc-property{display:grid;grid-template-columns:minmax(0,140px) minmax(0,1fr);gap:1rem;padding:.75rem 0}
.mc-property+.mc-property{border-top:1px solid var(--border)}
.mc-property dt{color:var(--muted-foreground);overflow-wrap:anywhere}
.mc-property dd{margin:0;min-width:0;white-space:pre-wrap;overflow-wrap:anywhere}
.mc-property pre{font-family:var(--mv-font-mono,ui-monospace,monospace);tab-size:4;white-space:pre-wrap;overflow-wrap:anywhere;margin:0}
.mc-property-json{max-height:240px;overflow:auto}
.mc-field{min-width:0;margin:0;border:0;padding:0;display:flex;flex-direction:column;gap:1rem}

.mc-field-title{min-width:0;overflow-wrap:anywhere}
.mc-field-title h4,.mc-field-title p{margin:0}
.mc-field-title p,.mc-field-note,.mc-note,.mc-eyebrow{color:var(--muted-foreground);font-size:.875rem;overflow-wrap:anywhere}
.mc-eyebrow{margin:0}
.mc-confirm{margin-top:.75rem}
.mc-test{display:flex;flex-direction:column;gap:1rem}
.mc-result-title{display:flex;align-items:center;gap:.5rem}
.mc-result pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:180px;overflow:auto}
.mc-form-footer{display:flex;align-items:center;flex-wrap:wrap;gap:.5rem}
.mc-form-footer .mc-cancel{margin-left:auto}
.mc-requests,.mc-activity-list{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
.mc-request-status,.mc-operation-note{overflow-wrap:anywhere}
.mc-request-choice{min-width:0;display:flex;flex-wrap:wrap;gap:.5rem;border:0;padding:0}
.mc-request-reason{margin-top:.75rem}
.mc-request-reason summary,.mc-reference-options summary{cursor:pointer}
.mc-request-reason p{white-space:pre-wrap;overflow-wrap:anywhere}
.mc-credential-entry,.mc-credential-group,.mc-existing-source,.mc-inline-credentials{display:flex;flex-direction:column;gap:1rem;min-width:0}
.mc-reference-options{min-width:0}
.mc-activity{display:flex;flex-direction:column;gap:.75rem}
.mc-activity-heading{margin:0;color:var(--muted-foreground);font-size:.875rem}
.mc-progress button{margin-left:auto}
.mc-empty{margin:auto}
@container(max-width:650px){.mc-name-row>.mc-heading-actions{width:100%}.mc-property{grid-template-columns:minmax(0,1fr);gap:.375rem}.mc-field-actions{margin-left:auto}}
`
