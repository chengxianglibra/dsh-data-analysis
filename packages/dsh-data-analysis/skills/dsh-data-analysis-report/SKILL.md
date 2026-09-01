---
name: dsh-data-analysis-report
description: Create or revise a Workspace HTML analysis report. Use for requested HTML/web output or when an analysis needs multiple charts/tables or a long multi-section presentation.
---

# DSH data-analysis report

Use this Skill for requested HTML/web output, when an analysis needs multiple charts/tables or a
long multi-section presentation, or to revise an HTML report created in this conversation.

1. Load `marivo-analysis` and follow its live Help routes. For existing analysis, recover its exact
   persisted Artifacts and revalidate them before use. Never rerun `observe` only to render HTML,
   reconstruct trace details, or obtain SQL.
2. Read only the references needed for this report:
   - audience, content, or organization: `references/report-content.md`
   - material data, quality, freshness, or evidence boundaries:
     `references/material-disclosure.md`
   - DataFrame or Artifact snapshot: `references/dataset.md`
   - built-in charts, tables, KPIs, or quality details:
     `references/starter-components.md`
   - persisted Artifact trace appendix: `references/session-trace.md`
3. Start from an empty bundle or copy `starter/basic`; add only selected components and snippets.
   The complete `starter/examples/analysis-brief` is reference-only, not a default template.
4. Keep every required resource under a new Workspace bundle root and use relative paths. Write
   resources first and `index.html` last.
5. For reports using persisted Marivo Artifacts, include a focused ancestors trace by default.
   Delete the trace path for computed-only reports. A user-requested minimal report may omit it,
   but must not claim complete traceability.
6. Run `dsh_data_analysis_report_check({ entry_path })`. On failure, read
   `references/checker.md` and only the checker-rule group named by the returned code, then fix and
   rerun. Static success is not browser or analytical validation.
7. When browser capability exists, load the exact `index.html`, check the console, keyboard,
   fallback content, and selected interactions. Any required failed check leaves the report
   incomplete.
8. In Native/both mode, write or edit `index.html` with a top-level file Tool as the bundle's final
   mutation so DSH can include it in Produced Files. If any bundle file changes afterward, finish
   with another top-level `index.html` edit. In every mode, deliver the exact file-Tool path as
   Markdown inline code; Code-only nested mutations may remain path-only. Produced Files and Host
   opening are navigation only, not readiness, publication, immutability, or recovery.
