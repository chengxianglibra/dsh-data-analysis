# Checker workflow

Call `dsh_data_analysis_report_check` with the exact bundle `index.html` path after writing all
resources. `failed_static` must be repaired and rerun. `passed_static` means only that the declared
static checks passed; inspect `coverage` and warnings before describing remaining boundaries.

The Checker does not run a browser, validate visual layout or analytical conclusions, make a
mutable directory immutable, publish it, or prove that remote resources work. A Tool error is an
incomplete check, not a partial success.

Read only the rule reference selected by the returned code:

- `html.*`, `resource.*`, `css.*`, `javascript.*`, `json.*`, `svg.*`, `security.*`, or `starter.*`:
  `checker-rules/html-resource-syntax.md`
- `dataset.*` or `trace.*`: `checker-rules/dataset-trace.md`
- `a11y.*` or `budget.*`: `checker-rules/accessibility-budget.md`

After static success, use a browser when available and check the console, keyboard order, visible
fallbacks, selected interactions, dark mode, and the actual external-resource boundary.
